"""
Vocabulary trimming for the DistilBERT model (WordPiece tokenizer), for phones.

gravitee-io/distilbert-multilingual-toxicity-classifier has 119,547 tokens for 100+ languages. Its
vocabulary table is 92 MB of the 135 MB model, and the tokenizer is ~120,000 strings in JavaScript.
Phones only need English, Hindi and Hinglish.

WordPiece splits each word greedily, longest piece first. So if every token a text uses is kept, the
trimmed tokenizer splits it exactly as before (a longer piece it could have picked would have been in the
original vocabulary too), and the model gives it exactly the same score. `build` keeps:
  - every token the original tokenizer uses on the chosen languages' texts and on our own word lists and
    test posts (scripts/trim/extra-texts.ts);
  - the special tokens;
  - every single character (and its "##" continuation) of the scripts we care about — Latin, Devanagari,
    digits, punctuation and symbols — so an unseen word still splits into pieces instead of becoming [UNK].
It then checks the "exactly as before" part on real text and stops if it fails.

    .venv-trim/Scripts/python -I scripts/trim/trim_wordpiece.py analyze
    .venv-trim/Scripts/python -I scripts/trim/trim_wordpiece.py build --languages english,hindi,hinglish --extra .cache/trim/extra.txt --out .cache/trim/distilbert-lite
    .venv-trim/Scripts/python -I scripts/trim/trim_wordpiece.py compare .cache/trim/distilbert-lite

npm run model:trim -- distilbert runs build (after `npm run model:build -- distilbert`) and installs the result.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent))
from trim_vocab import load_corpus, remap_post_processor, split  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = 'gravitee-io/distilbert-multilingual-toxicity-classifier'
TARGET_ID = 'x-abuse-shield/distilbert-toxicity-lite'
SOURCE = ROOT / '.cache' / 'models' / MODEL_ID
SOURCE_ONNX = 'model.quant.onnx'
EMBEDDING = 'distilbert.embeddings.word_embeddings.weight'
MAX_TOKENS = 256
# Balanced preset toxicity threshold (src/core/engine/presets.ts): the only category this model scores.
BALANCED_TOXICITY = 0.75
DROPPED_SAMPLE = ['french', 'german', 'spanish', 'arabic', 'russian', 'japanese']


def fallback_char(token: str) -> bool:
    """A single character (or "##" + one) from a script phones need: Latin, Devanagari, digits, punctuation, symbols."""
    ch = token[2:] if token.startswith('##') else token
    if len(ch) != 1:
        return False
    category = unicodedata.category(ch)
    if category[0] in 'PSNZ':  # punctuation, symbols (incl. emoji), numbers, separators
        return True
    name = unicodedata.name(ch, '')
    return name.startswith(('LATIN', 'DEVANAGARI')) or category == 'Mn'  # Mn: combining marks (Hindi vowel signs)


def setup():
    tokenizer = Tokenizer.from_file(str(SOURCE / 'tokenizer.json'))
    tokenizer.no_padding()
    tokenizer.no_truncation()
    tokenizer_json = json.loads((SOURCE / 'tokenizer.json').read_text(encoding='utf-8'))
    return tokenizer, tokenizer_json


def ids_used(tokenizer: Tokenizer, texts: list[str]) -> set[int]:
    used: set[int] = set()
    for i in range(0, len(texts), 20000):
        for encoding in tokenizer.encode_batch(texts[i : i + 20000], add_special_tokens=False):
            used.update(encoding.ids)
    return used


def always_kept(tokenizer_json: dict) -> set[int]:
    vocab: dict[str, int] = tokenizer_json['model']['vocab']
    special = {t['id'] for t in tokenizer_json['added_tokens']}
    return special | {i for t, i in vocab.items() if fallback_char(t)}


def analyze(_args) -> None:
    tokenizer, tokenizer_json = setup()
    corpus = load_corpus()
    vocab_size = len(tokenizer_json['model']['vocab'])
    base = always_kept(tokenizer_json)
    unk = tokenizer_json['model']['vocab']['[UNK]']
    print(f'vocabulary {vocab_size:,} tokens; always kept (special + Latin/Devanagari/symbol characters) {len(base):,}')
    seen: dict[str, set[int]] = {}
    held: dict[str, list[set[int]]] = {}
    for lang in sorted(corpus):
        train, test = split(corpus[lang])
        seen[lang] = ids_used(tokenizer, train)
        held[lang] = [set(e.ids) for e in tokenizer.encode_batch(test[:2000], add_special_tokens=False)]
        print(f'  {lang:12} {len(corpus[lang]):>7,} texts  {len(seen[lang]):>7,} tokens')

    for name, langs in [('English + Hindi + Hinglish', ['english', 'hindi', 'hinglish']),
                        ('… + Urdu + Bengali', ['english', 'hindi', 'hinglish', 'urdu', 'bengali'])]:
        kept = base.union(*(seen[l] for l in langs if l in seen))
        coverage = {l: sum(ids <= kept for ids in held[l]) / max(len(held[l]), 1) for l in held}
        print(f'\n{name}: keep {len(kept):,} tokens ({len(kept) / vocab_size:.0%}); vocabulary table {len(kept) * 768 / 1e6:.0f} MB (now {vocab_size * 768 / 1e6:.0f} MB)')
        print('  unseen texts tokenized exactly as before: ' + ', '.join(f'{l} {coverage[l]:.1%}' for l in langs if l in coverage))
        unk_rate = {l: np.mean([unk in ids for ids in held[l]]) for l in held}
        print('  (original tokenizer, unseen texts with [UNK]: ' + ', '.join(f'{l} {unk_rate[l]:.1%}' for l in langs if l in unk_rate) + ')')


def build(args) -> None:
    tokenizer, tokenizer_json = setup()
    corpus = load_corpus()
    langs = args.languages.split(',')
    missing = [l for l in langs if l not in corpus]
    if missing:
        sys.exit(f'No corpus for: {", ".join(missing)}. Available: {", ".join(sorted(corpus))}')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    kept = always_kept(tokenizer_json)
    for lang in langs:
        kept |= ids_used(tokenizer, corpus[lang])
    extra = [line.strip() for path in args.extra or [] for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]
    kept |= ids_used(tokenizer, extra)

    # New ids follow the old order, so [PAD] keeps 0 and the special tokens keep their relative order.
    old_ids = sorted(kept)
    new_id = {old: new for new, old in enumerate(old_ids)}
    vocab: dict[str, int] = tokenizer_json['model']['vocab']
    by_id = {i: t for t, i in vocab.items()}
    tokenizer_json['model']['vocab'] = {by_id[old]: new_id[old] for old in old_ids}
    for token in tokenizer_json['added_tokens']:
        token['id'] = new_id[token['id']]
    remap_post_processor(tokenizer_json.get('post_processor'), new_id)
    (out / 'tokenizer.json').write_text(json.dumps(tokenizer_json, ensure_ascii=False), encoding='utf-8')

    config = json.loads((SOURCE / 'config.json').read_text(encoding='utf-8'))
    config['vocab_size'] = len(old_ids)
    if isinstance(config.get('pad_token_id'), int):
        config['pad_token_id'] = new_id[config['pad_token_id']]
    (out / 'config.json').write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding='utf-8')
    tokenizer_config = json.loads((SOURCE / 'tokenizer_config.json').read_text(encoding='utf-8'))
    decoder = tokenizer_config.get('added_tokens_decoder')
    if decoder:
        tokenizer_config['added_tokens_decoder'] = {str(new_id[int(k)]): v for k, v in decoder.items() if int(k) in new_id}
    (out / 'tokenizer_config.json').write_text(json.dumps(tokenizer_config, indent=2, ensure_ascii=False), encoding='utf-8')

    # The model: only the kept rows of the (int8) vocabulary table, in the new order. A per-row scale and
    # zero point would need the same rows; a single one (per tensor) stays as it is.
    graph = onnx.load(str(SOURCE / SOURCE_ONNX))
    inits = {i.name: i for i in graph.graph.initializer}
    table_init = inits[f'{EMBEDDING}_quantized']
    table = numpy_helper.to_array(table_init)
    table_init.CopyFrom(numpy_helper.from_array(np.ascontiguousarray(table[old_ids]), table_init.name))
    for suffix in ('_scale', '_zero_point'):
        init = inits[f'{EMBEDDING}{suffix}']
        values = numpy_helper.to_array(init)
        if values.ndim > 0 and values.shape[0] == table.shape[0]:
            init.CopyFrom(numpy_helper.from_array(np.ascontiguousarray(values[old_ids]), init.name))
    onnx.save(graph, str(out / 'model.onnx'))

    print(f'Kept {len(old_ids):,} of {table.shape[0]:,} tokens for {", ".join(langs)}; '
          f'vocabulary table {table.nbytes / 1e6:.0f} → {len(old_ids) * table.shape[1] / 1e6:.0f} MB; '
          f'model {(SOURCE / SOURCE_ONNX).stat().st_size / 1e6:.0f} → {(out / "model.onnx").stat().st_size / 1e6:.0f} MB')
    checked = verify(tokenizer, Tokenizer.from_file(str(out / 'tokenizer.json')), new_id, corpus, langs, extra)
    shutil_copy(SOURCE / 'LICENSE', out / 'LICENSE')
    (out / 'TRIM.json').write_text(json.dumps({
        'base': MODEL_ID,
        'target': TARGET_ID,
        'licence': 'OpenRAIL++',
        'baseTokens': table.shape[0],
        'languages': langs,
        'tokens': len(old_ids),
        'verified_identical': checked,
        'source_sha256': hashlib.sha256((SOURCE / SOURCE_ONNX).read_bytes()).hexdigest(),
    }, indent=2), encoding='utf-8')


def shutil_copy(source: Path, target: Path) -> None:
    if source.exists():
        target.write_bytes(source.read_bytes())
    else:  # model:build copies LICENSE into public/models; the Hugging Face cache doesn't have it
        public = ROOT / 'public' / 'models' / MODEL_ID / 'LICENSE'
        if not public.exists():
            sys.exit(f'No LICENSE for {MODEL_ID}: run `npm run model:build -- distilbert` first.')
        target.write_bytes(public.read_bytes())


def verify(original: Tokenizer, trimmed: Tokenizer, new_id: dict[int, int], corpus: dict[str, list[str]], langs: list[str], extra: list[str]) -> dict[str, str]:
    """Texts whose original tokens are all kept must get the same tokens, renumbered. Stops the build otherwise."""
    trimmed.no_padding()
    trimmed.no_truncation()
    results = {}
    for name, texts in [*((l, split(corpus[l])[1][:5000]) for l in langs), ('word lists and test posts', extra)]:
        same = changed = 0
        for a, b in zip(original.encode_batch(texts), trimmed.encode_batch(texts)):
            mapped = [new_id.get(i) for i in a.ids]
            if None in mapped:
                continue
            if mapped != b.ids:
                changed += 1
                if changed <= 3:
                    print(f'  CHANGED ({name}): {a.tokens[:20]} → {b.tokens[:20]}')
            else:
                same += 1
        results[name] = f'{same} of {len(texts)} identical'
        print(f'  {name}: {same:,} of {len(texts):,} texts tokenize identically' + (f', {changed} CHANGED' if changed else ''))
        if changed:
            sys.exit('Trimming changed the tokenization of kept text; not writing a model that would score differently.')
    return results


class Model:
    """P(toxic) for texts, one per call like the extension (the export has a batch of 1 baked in)."""

    def __init__(self, folder: Path, onnx_file: str):
        import onnxruntime as ort

        self.tokenizer = Tokenizer.from_file(str(folder / 'tokenizer.json'))
        self.tokenizer.enable_truncation(MAX_TOKENS)
        self.tokenizer.no_padding()
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1  # like the browser on a phone
        self.session = ort.InferenceSession(str(folder / onnx_file), options, providers=['CPUExecutionProvider'])
        self.seconds = 0.0

    def scores(self, texts: list[str]) -> np.ndarray:
        out = []
        for encoding in self.tokenizer.encode_batch(texts):
            ids = np.array([encoding.ids], dtype=np.int64)
            mask = np.array([encoding.attention_mask], dtype=np.int64)
            start = time.perf_counter()
            logits = self.session.run(['logits'], {'input_ids': ids, 'attention_mask': mask})[0][0]
            self.seconds += time.perf_counter() - start
            out.append(1 / (1 + np.exp(logits[0] - logits[1])))  # softmax of two: P(toxic)
        return np.array(out)


def compare(args) -> None:
    folder = Path(args.folder)
    trim = json.loads((folder / 'TRIM.json').read_text(encoding='utf-8'))
    corpus = load_corpus()
    sets: dict[str, list[str]] = {lang: split(corpus[lang])[1][:400] for lang in trim['languages']}
    for lang in DROPPED_SAMPLE:
        sets[f'{lang} (dropped)'] = split(corpus[lang])[1][:150]
    own = [json.loads(l)['text'] for l in (ROOT / 'calibration' / 'screenshots.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    own += [s['text'] for s in json.loads((ROOT / 'spike' / 'samples.json').read_text(encoding='utf-8'))]
    sets['our test posts'] = own

    original, lite = Model(SOURCE, SOURCE_ONNX), Model(folder, 'model.onnx')
    print(f'{"texts":24} {"n":>4}  {"P(toxic) mean / max diff":>26}  {"verdicts changed at 0.75":>28}')
    for name, texts in sets.items():
        a, b = original.scores(texts), lite.scores(texts)
        diff = np.abs(a - b)
        flips = int(((a >= BALANCED_TOXICITY) != (b >= BALANCED_TOXICITY)).sum())
        hidden = int(((b >= BALANCED_TOXICITY) & (a < BALANCED_TOXICITY)).sum())
        print(f'{name:24} {len(texts):>4}  {diff.mean():>13.4f} / {diff.max():.3f}  {flips:>5} ({flips / len(texts):.1%}: +{hidden} hidden, -{flips - hidden} shown)', flush=True)
    n = sum(len(t) for t in sets.values())
    print(f'\nScoring, 1 thread, native: original {original.seconds / n * 1000:.1f} ms/post, trimmed {lite.seconds / n * 1000:.1f} ms/post')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(required=True)
    sub.add_parser('analyze').set_defaults(run=analyze)
    b = sub.add_parser('build')
    b.add_argument('--languages', required=True)
    b.add_argument('--extra', action='append', help='text file, one text per line, that must tokenize exactly as before')
    b.add_argument('--out', default=str(ROOT / '.cache' / 'trim' / 'distilbert-lite'))
    b.set_defaults(run=build)
    c = sub.add_parser('compare')
    c.add_argument('folder')
    c.set_defaults(run=compare)
    args = parser.parse_args()
    args.run(args)
