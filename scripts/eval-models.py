"""
Compares the AI models on labelled text: how often each hides clean posts (false positives) and how many
toxic ones it catches, in English, Hindi and Hinglish. The models alone, without the word lists.

    .venv-trim/Scripts/python -I scripts/eval-models.py

Needs the corpora from `npm run model:trim` and the models in .cache/models: the toxicity model from
`npm run model:build`; any of the others whose folder is there (download config.json, tokenizer.json and
model.quant.onnx from Hugging Face into .cache/models/<model id>/). Models not there are skipped.

This is how DistilBERT (gravitee-io/distilbert-multilingual-toxicity-classifier) and bert-small
(gravitee-io/bert-small-toxicity) were compared with the toxicity model for 0.3.0; both were dropped
(docs/MODEL-COMPARISON.md).

Text:
  - Civil Comments (.cache/trim/civil-comments-multilingual.parquet): English comments with human toxicity
    labels, and their Hindi and Hinglish machine translations. "clean" = no annotator called it toxic
    (toxicity 0), "toxic" = most did (≥ 0.5). Neither Gravitee model was trained on it; the Horizon-Labs
    toxicity model was, so its numbers there are flattering.
  - "clean, mentions a group": clean English comments naming a religion, caste, nationality, gender or
    sexuality — where toxicity models misfire most.
  - Our labelled posts (spike/samples.json, calibration/*.jsonl).
A verdict is "hidden" when the model's toxicity reaches the threshold (Balanced: 0.75); for the 7-category
toxicity model, when any category reaches its Balanced threshold.
"""

from __future__ import annotations

import json
import random
import re
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / '.cache' / 'models'
BALANCED = {'toxicity': 0.75, 'severe_toxicity': 0.4, 'obscene': 0.85, 'threat': 0.4, 'insult': 0.7, 'identity_attack': 0.5, 'sexual_explicit': 0.6}
THRESHOLDS = [0.5, 0.75, 0.9]
GROUPS = re.compile(r'\b(muslims?|islam|hindus?|christians?|jews?|jewish|sikhs?|dalits?|caste|gays?|lesbians?|trans(gender)?|lgbt\w*|women|black people|blacks|whites|immigrants?|mexicans?|indians?|pakistanis?|chinese|african|asian)\b', re.I)
PER_SET = {'clean': 800, 'toxic': 400, 'group': 400}


class Model:
    def __init__(self, name: str, folder: Path, onnx_file: str, max_batch: int):
        self.name = name
        self.tokenizer = Tokenizer.from_file(str(folder / 'tokenizer.json'))
        self.tokenizer.no_padding()
        self.tokenizer.enable_truncation(256)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1  # like Firefox, and a phone
        self.session = ort.InferenceSession(str(folder / onnx_file), options, providers=['CPUExecutionProvider'])
        self.inputs = {i.name for i in self.session.get_inputs()}
        config = json.loads((folder / 'config.json').read_text(encoding='utf-8'))
        self.labels = [config['id2label'][str(i)] for i in range(len(config['id2label']))]
        self.binary = self.labels == ['not-toxic', 'toxic']
        self.max_batch = max_batch
        self.seconds = 0.0
        self.count = 0

    def scores(self, texts: list[str]) -> np.ndarray:
        """Binary models: P(toxic). The 7-category model: its highest score relative to Balanced (≥ 1 means hidden)."""
        out = []
        for i in range(0, len(texts), self.max_batch):
            encodings = self.tokenizer.encode_batch(texts[i : i + self.max_batch])
            width = max(len(e.ids) for e in encodings)
            ids = np.array([e.ids + [0] * (width - len(e.ids)) for e in encodings], dtype=np.int64)
            mask = np.array([e.attention_mask + [0] * (width - len(e.ids)) for e in encodings], dtype=np.int64)
            feed = {'input_ids': ids, 'attention_mask': mask}
            if 'token_type_ids' in self.inputs:
                feed['token_type_ids'] = np.zeros_like(ids)
            start = time.perf_counter()
            logits = self.session.run(None, feed)[0]
            self.seconds += time.perf_counter() - start
            self.count += len(encodings)
            if self.binary:
                out.extend(1 / (1 + np.exp(logits[:, 0] - logits[:, 1])))
            else:
                probs = 1 / (1 + np.exp(-logits))
                out.extend((probs / np.array([BALANCED[l] for l in self.labels])).max(axis=1) * 0.75)
        return np.array(out)


def civil_comments() -> dict[str, list[tuple[str, bool]]]:
    table = pq.read_table(ROOT / '.cache' / 'trim' / 'civil-comments-multilingual.parquet', columns=['text', 'lang', 'toxicity', 'source_text'])
    rows = table.to_pylist()
    rng = random.Random(11)
    sets: dict[str, list[tuple[str, bool]]] = {}
    english = {r['source_text']: r['toxicity'] for r in rows if r['source_text']}
    pools = {
        'english': list(english.items()),
        'hindi': [(r['text'], r['toxicity']) for r in rows if r['lang'].startswith('Hindi')],
        'hinglish': [(r['text'], r['toxicity']) for r in rows if r['lang'].startswith('Hinglish')],
    }
    for lang, pool in pools.items():
        clean = [t for t, tox in pool if tox == 0 and t and len(t) < 1500]
        toxic = [t for t, tox in pool if tox >= 0.5 and t and len(t) < 1500]
        rng.shuffle(clean)
        rng.shuffle(toxic)
        sets[f'{lang}: clean'] = [(t, False) for t in clean[: PER_SET['clean']]]
        sets[f'{lang}: toxic'] = [(t, True) for t in toxic[: PER_SET['toxic']]]
        if lang == 'english':
            group = [t for t in clean if GROUPS.search(t)]
            sets['english: clean, mentions a group'] = [(t, False) for t in group[: PER_SET['group']]]
    return sets


def own_posts() -> dict[str, list[tuple[str, bool]]]:
    posts = json.loads((ROOT / 'spike' / 'samples.json').read_text(encoding='utf-8'))
    for name in ('screenshots.jsonl', 'posts.jsonl'):
        path = ROOT / 'calibration' / name
        if path.exists():
            posts += [json.loads(l) for l in path.read_text(encoding='utf-8').splitlines() if l.strip()]
    clean = [(p['text'], False) for p in posts if p['expected'] == 'clean']
    abusive = [(p['text'], True) for p in posts if p['expected'] == 'abusive']
    return {'our posts: clean': clean, 'our posts: abusive': abusive}


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    # DistilBERT's export has a batch of 1 baked in, so it scores one post per call.
    candidates = [
        ('DistilBERT', MODELS / 'gravitee-io' / 'distilbert-multilingual-toxicity-classifier', 'model.quant.onnx', 1),
        ('bert-small', MODELS / 'gravitee-io' / 'bert-small-toxicity', 'model.quant.onnx', 8),
        ('Toxicity*', MODELS / 'Horizon-Labs' / 'multilingual-toxicity-small', 'onnx/model_quantized.onnx', 8),
    ]
    models = [Model(*c) for c in candidates if (c[1] / c[2]).exists()]
    if not models:
        sys.exit('No models in .cache/models: run `npm run model:build` first.')
    sets = {**civil_comments(), **own_posts()}

    print('Share hidden at toxicity 0.75 (Balanced); 0.5 and 0.9 in brackets. Clean rows: lower is better; toxic rows: higher.\n')
    print(f'{"text":36} {"n":>4}  ' + '  '.join(f'{m.name:>24}' for m in models))
    for name, items in sets.items():
        texts = [t for t, _ in items]
        row = f'{name:36} {len(texts):>4}  '
        for model in models:
            s = model.scores(texts)
            at = [(s >= t).mean() for t in THRESHOLDS]
            row += f'{at[1]:>8.1%} ({at[0]:>5.1%} / {at[2]:>5.1%})  '
        print(row, flush=True)
    print('\nScoring, 1 thread, native CPU: ' + ', '.join(f'{m.name} {m.seconds / m.count * 1000:.1f} ms/post' for m in models))
    print('* trained on Civil Comments, so its Civil Comments rows are flattering; compare the Gravitee models with each other.')


if __name__ == '__main__':
    main()
