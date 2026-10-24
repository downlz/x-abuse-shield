"""
Compares a trimmed (and optionally further quantized) model with the original on real text:
how far its scores move, and how often a post's verdict at the Balanced thresholds changes.

    .venv-trim/Scripts/python scripts/trim/compare.py .cache/trim/south-asia [.cache/trim/south-asia-int8]

Texts: 400 held-out comments per kept language and 150 from each of six dropped languages
(same split as trim_vocab.py analyze), plus our calibration and spike posts.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent))
from trim_vocab import SOURCE, load_corpus, split  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LABELS = ['toxicity', 'severe_toxicity', 'obscene', 'threat', 'insult', 'identity_attack', 'sexual_explicit']
# Balanced preset (src/core/engine/presets.ts).
BALANCED = {'toxicity': 0.75, 'severe_toxicity': 0.4, 'obscene': 0.85, 'threat': 0.4, 'insult': 0.7, 'identity_attack': 0.5, 'sexual_explicit': 0.6}
DROPPED_SAMPLE = ['french', 'german', 'spanish', 'arabic', 'russian', 'japanese']


class Model:
    def __init__(self, folder: Path, onnx_file: str):
        self.tokenizer = Tokenizer.from_file(str(folder / 'tokenizer.json'))
        self.tokenizer.enable_truncation(256)
        self.tokenizer.enable_padding(pad_id=0)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1  # like the browser on a phone
        self.session = ort.InferenceSession(str(folder / onnx_file), options, providers=['CPUExecutionProvider'])
        id2label = json.loads((folder / 'config.json').read_text(encoding='utf-8'))['id2label']
        self.order = [id2label[str(i)] for i in range(len(id2label))]

    def scores(self, texts: list[str]) -> np.ndarray:
        out = []
        for i in range(0, len(texts), 8):
            enc = self.tokenizer.encode_batch(texts[i : i + 8])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            logits = self.session.run(['logits'], {'input_ids': ids, 'attention_mask': mask})[0]
            probs = 1 / (1 + np.exp(-logits))
            out.append(probs[:, [self.order.index(l) for l in LABELS]])
        return np.concatenate(out)


def flagged(scores: np.ndarray) -> np.ndarray:
    return (scores >= np.array([BALANCED[l] for l in LABELS])).any(axis=1)


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    candidates = [Path(p) for p in sys.argv[1:] if not p.startswith('--')]
    trim = json.loads((candidates[0] / 'TRIM.json').read_text(encoding='utf-8'))
    corpus = load_corpus()
    sets: dict[str, list[str]] = {}
    for lang in trim['languages']:
        sets[lang] = split(corpus[lang])[1][:400]
    if '--kept-only' not in sys.argv:
        for lang in DROPPED_SAMPLE:
            sets[f'{lang} (dropped)'] = split(corpus[lang])[1][:150]
    own = [json.loads(l)['text'] for l in (ROOT / 'calibration' / 'screenshots.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    own += [s['text'] for s in json.loads((ROOT / 'spike' / 'samples.json').read_text(encoding='utf-8'))]
    sets['our test posts'] = own

    original = Model(SOURCE, 'onnx/model_quantized.onnx')
    models = {c.name: Model(c, 'model_quantized.onnx') for c in candidates}
    print(f'{"texts":24} {"n":>4}  ' + '  '.join(f'{name + ": mean / max diff, verdicts changed":>48}' for name in models))
    for name, texts in sets.items():
        base = original.scores(texts)
        row = f'{name:24} {len(texts):>4}  '
        for model in models.values():
            s = model.scores(texts)
            diff = np.abs(s - base)
            changed = int((flagged(s) != flagged(base)).sum())
            hidden = int((flagged(s) & ~flagged(base)).sum())
            row += f'{diff.mean():>14.4f} / {diff.max():.3f}, {changed:>3} ({changed / len(texts):.1%}: +{hidden} hidden, -{changed - hidden} shown) '
        print(row, flush=True)


if __name__ == '__main__':
    main()
