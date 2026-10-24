"""
Vocabulary trimming for the toxicity model (docs/PLAN.md, "Vocabulary trimming").

The model's tokenizer has 256,000 tokens for 1,800+ languages. Its vocabulary
table is 98 MB of the model, and the tokenizer itself (580,604 merge rules)
costs far more than that as JavaScript objects in the browser. Trimming keeps
only the tokens our languages use.

What's kept: every token BPE creates, including the intermediate ones, while
tokenizing the corpus of the chosen languages (replayed word by word, below).
The trimmed tokenizer has those tokens and only the merge rules between them,
in their original order. So a text whose words only need kept tokens is
tokenized exactly as before (renumbered), and the model gives it exactly the
same scores. Other text falls back to smaller pieces, and finally to bytes; it
still works, less accurately. `build` checks the "exactly as before" part on
real text and stops if it fails.

    npm run model:trim -- analyze
    npm run model:trim -- build --languages english,hindi,hinglish,urdu,bengali

Inputs (scripts/trim/README.md):
    .cache/trim/civil-comments-multilingual.parquet   the model's fine-tuning data (English + 33 languages, Hinglish included)
    .cache/trim/english-to-hinglish.json, cmu-hinglish-dog.parquet   more romanised Hindi
    .cache/models/<model>/onnx/model_quantized.onnx, tokenizer.json, tokenizer_config.json, config.json
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import re
import sys
from pathlib import Path

import numpy as np
import onnx
import pyarrow.parquet as pq
from onnx import numpy_helper
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = 'Horizon-Labs/multilingual-toxicity-small'
SOURCE = ROOT / '.cache' / 'models' / MODEL_ID
DATA = ROOT / '.cache' / 'trim'
EMBEDDING = 'm.model.embeddings.tok_embeddings.weight_quantized'
HELD_OUT = 0.1  # share of each language's texts kept back to measure how unseen text fares
BYTE = re.compile(r'<0x[0-9A-F]{2}>')
EMOJI = re.compile('^[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍▁]+$')


def load_corpus() -> dict[str, list[str]]:
    """Texts by language ('english', 'hindi', 'hinglish', …)."""
    table = pq.read_table(DATA / 'civil-comments-multilingual.parquet', columns=['text', 'lang', 'source_text'])
    corpus: dict[str, list[str]] = collections.defaultdict(list)
    english = set()
    for text, lang, source in zip(*(table.column(c).to_pylist() for c in ('text', 'lang', 'source_text'))):
        if text:
            corpus[lang.split(' ')[0].lower()].append(text)  # "Hinglish (Hindi written in Latin letters…)" → hinglish
        if source and source not in english:  # the English originals of the translations
            english.add(source)
            corpus['english'].append(source)
    with open(DATA / 'english-to-hinglish.json', encoding='utf-8') as f:
        for line in f:
            text = json.loads(line).get('translation', {}).get('hi_ng')
            if text:
                corpus['hinglish'].append(text)
    for row in pq.read_table(DATA / 'cmu-hinglish-dog.parquet').to_pylist():
        translation = row.get('translation')
        text = translation.get('hi_en') if isinstance(translation, dict) else None
        if text:
            corpus['hinglish'].append(text)
    return dict(corpus)


class Bpe:
    """Replays the tokenizer's BPE to see every token it creates on the way to a word's final tokens."""

    def __init__(self, tokenizer: Tokenizer, tokenizer_json: dict):
        self.tokenizer = tokenizer
        model = tokenizer_json['model']
        self.vocab: dict[str, int] = model['vocab']
        self.by_id = {i: t for t, i in self.vocab.items()}
        self.ranks: dict[tuple[str, str], int] = {}
        for rank, merge in enumerate(model['merges']):
            a, b = merge.split(' ', 1) if isinstance(merge, str) else merge
            self.ranks.setdefault((a, b), rank)
        self.cache: dict[str, frozenset[str]] = {}

    def words(self, text: str) -> list[str]:
        normalized = self.tokenizer.normalizer.normalize_str(text)
        return [w for w, _ in self.tokenizer.pre_tokenizer.pre_tokenize_str(normalized)]

    def trace(self, word: str) -> frozenset[str]:
        """Every token BPE makes for this word, intermediate ones included."""
        if word in self.cache:
            return self.cache[word]
        symbols: list[str] = []
        for ch in word:
            if ch in self.vocab:
                symbols.append(ch)
            else:  # byte fallback
                symbols.extend(f'<0x{b:02X}>' for b in ch.encode('utf-8'))
        made = set(symbols)
        while len(symbols) > 1:
            best = None
            for i in range(len(symbols) - 1):
                rank = self.ranks.get((symbols[i], symbols[i + 1]))
                if rank is not None and (best is None or rank < best[0]):
                    best = (rank, i)
            if best is None:
                break
            i = best[1]
            symbols[i : i + 2] = [symbols[i] + symbols[i + 1]]
            made.add(symbols[i])
        result = frozenset(made)
        self.cache[word] = result
        return result

    def tokens_for(self, texts: list[str]) -> set[str]:
        out: set[str] = set()
        for text in texts:
            for word in self.words(text):
                out |= self.trace(word)
        return out

    def needs(self, text: str) -> set[str]:
        out: set[str] = set()
        for word in self.words(text):
            out |= self.trace(word)
        return out

    def always_kept(self, tokenizer_json: dict) -> set[str]:
        """Special tokens, all 256 bytes (so any text still tokenizes), and how emoji tokenize."""
        special = {t['content'] for t in tokenizer_json['added_tokens'] if t['content'] in self.vocab}
        kept = special | {t for t in self.vocab if BYTE.fullmatch(t)}
        for token in self.vocab:
            if EMOJI.match(token) and token.strip('▁'):
                kept |= self.tokens_for([token.replace('▁', ' ').strip()])
        return kept


def split(texts: list[str]) -> tuple[list[str], list[str]]:
    shuffled = texts[:]
    random.Random(7).shuffle(shuffled)
    cut = int(len(shuffled) * (1 - HELD_OUT))
    return shuffled[:cut], shuffled[cut:]


def setup() -> tuple[Tokenizer, dict, Bpe, dict[str, list[str]]]:
    tokenizer = Tokenizer.from_file(str(SOURCE / 'tokenizer.json'))
    tokenizer_json = json.loads((SOURCE / 'tokenizer.json').read_text(encoding='utf-8'))
    return tokenizer, tokenizer_json, Bpe(tokenizer, tokenizer_json), load_corpus()


def analyze(_args) -> None:
    _, tokenizer_json, bpe, corpus = setup()
    base = bpe.always_kept(tokenizer_json)
    print(f'vocabulary {len(bpe.vocab):,} tokens, {len(tokenizer_json["model"]["merges"]):,} merges; always kept {len(base):,}')
    seen: dict[str, set[str]] = {}
    held: dict[str, list[set[str]]] = {}
    for lang, texts in sorted(corpus.items()):
        train, test = split(texts)
        seen[lang] = bpe.tokens_for(train)
        held[lang] = [bpe.needs(t) for t in test]
        print(f'  {lang:12} {len(texts):>7,} texts  {len(seen[lang]):>7,} tokens')

    def report(name: str, langs: list[str]) -> None:
        kept = base.union(*(seen[l] for l in langs))
        coverage = {l: sum(t <= kept for t in held[l]) / max(len(held[l]), 1) for l in held}
        print(f'\n{name}: keep {len(kept):,} tokens ({len(kept) / len(bpe.vocab):.0%}); vocabulary table {len(kept) * 384 / 1e6:.0f} MB (now 98 MB)')
        print('  unseen texts tokenized exactly as before: ' + ', '.join(f'{l} {coverage[l]:.1%}' for l in langs))
        others = sorted((c, l) for l, c in coverage.items() if l not in langs)
        if others:
            print(f'  dropped languages: median {np.median([c for c, _ in others]):.0%} '
                  f'(lowest {others[0][1]} {others[0][0]:.0%}, highest {others[-1][1]} {others[-1][0]:.0%})')

    report('English + Hindi + Hinglish', ['english', 'hindi', 'hinglish'])
    report('… + Urdu + Bengali', ['english', 'hindi', 'hinglish', 'urdu', 'bengali'])
    report('All fine-tuning languages', sorted(corpus))


def build(args) -> None:
    tokenizer, tokenizer_json, bpe, corpus = setup()
    langs = args.languages.split(',')
    missing = [l for l in langs if l not in corpus]
    if missing:
        sys.exit(f'No corpus for: {", ".join(missing)}. Available: {", ".join(sorted(corpus))}')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    kept = bpe.always_kept(tokenizer_json)
    for lang in langs:
        kept |= bpe.tokens_for(corpus[lang])
    # Our own word lists and test posts must tokenize exactly as before.
    extra_texts = [line.strip() for path in args.extra or [] for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]
    kept |= bpe.tokens_for(extra_texts)

    # New ids follow the old order, so special tokens keep theirs (<pad> 0, <eos> 1, <bos> 2, <unk> 3 …).
    old_ids = sorted(bpe.vocab[t] for t in kept)
    new_id = {old: new for new, old in enumerate(old_ids)}

    model = tokenizer_json['model']
    model['vocab'] = {bpe.by_id[old]: new_id[old] for old in old_ids}
    merges = []
    for merge in model['merges']:
        a, b = merge.split(' ', 1) if isinstance(merge, str) else merge
        if a in kept and b in kept and a + b in kept:
            merges.append(merge)
    original_merges = len(model['merges'])
    model['merges'] = merges
    for token in tokenizer_json['added_tokens']:
        token['id'] = new_id[token['id']]
    remap_post_processor(tokenizer_json.get('post_processor'), new_id)
    (out / 'tokenizer.json').write_text(json.dumps(tokenizer_json, ensure_ascii=False), encoding='utf-8')

    config = json.loads((SOURCE / 'config.json').read_text(encoding='utf-8'))
    config['vocab_size'] = len(old_ids)
    for key in ('pad_token_id', 'bos_token_id', 'eos_token_id', 'cls_token_id', 'sep_token_id', 'mask_token_id', 'unk_token_id'):
        if isinstance(config.get(key), int):
            config[key] = new_id[config[key]]
    (out / 'config.json').write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding='utf-8')
    tokenizer_config = json.loads((SOURCE / 'tokenizer_config.json').read_text(encoding='utf-8'))
    decoder = tokenizer_config.get('added_tokens_decoder')
    if decoder:
        tokenizer_config['added_tokens_decoder'] = {str(new_id[int(k)]): v for k, v in decoder.items() if int(k) in new_id}
    (out / 'tokenizer_config.json').write_text(json.dumps(tokenizer_config, indent=2, ensure_ascii=False), encoding='utf-8')

    # The model: only the kept rows of the vocabulary table, in the new order.
    graph = onnx.load(str(SOURCE / 'onnx' / 'model_quantized.onnx'))
    init = next(i for i in graph.graph.initializer if i.name == EMBEDDING)
    table = numpy_helper.to_array(init)
    init.CopyFrom(numpy_helper.from_array(np.ascontiguousarray(table[old_ids]), EMBEDDING))
    onnx.save(graph, str(out / 'model_quantized.onnx'))

    print(f'Kept {len(old_ids):,} of {len(bpe.vocab):,} tokens for {", ".join(langs)}; '
          f'merges {original_merges:,} → {len(merges):,}; vocabulary table {table.nbytes / 1e6:.0f} → {len(old_ids) * table.shape[1] / 1e6:.0f} MB')
    checked = verify(tokenizer, Tokenizer.from_file(str(out / 'tokenizer.json')), new_id, corpus, langs, extra_texts)
    (out / 'TRIM.json').write_text(json.dumps({
        'base': MODEL_ID,
        'languages': langs,
        'tokens': len(old_ids),
        'merges': len(merges),
        'verified_identical': checked,
        'source_sha256': hashlib.sha256((SOURCE / 'onnx' / 'model_quantized.onnx').read_bytes()).hexdigest(),
    }, indent=2), encoding='utf-8')


def verify(original: Tokenizer, trimmed: Tokenizer, new_id: dict[int, int], corpus: dict[str, list[str]], langs: list[str], extra: list[str]) -> dict[str, str]:
    """Texts whose original tokens are all kept must get the same tokens, renumbered. Stops the build otherwise."""
    results = {}
    for name, texts in [*((l, corpus[l][:5000]) for l in langs), ('word lists and test posts', extra)]:
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


def remap_post_processor(processor: dict | None, new_id: dict[int, int]) -> None:
    if not processor:
        return
    for special in (processor.get('special_tokens') or {}).values():
        special['ids'] = [new_id[i] for i in special['ids']]
    for child in processor.get('processors') or []:
        remap_post_processor(child, new_id)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(required=True)
    sub.add_parser('analyze').set_defaults(run=analyze)
    b = sub.add_parser('build')
    b.add_argument('--languages', required=True)
    b.add_argument('--extra', action='append', help='text file, one text per line, that must tokenize exactly as before')
    b.add_argument('--out', default=str(ROOT / '.cache' / 'trim' / 'out'))
    b.set_defaults(run=build)
    args = parser.parse_args()
    args.run(args)
