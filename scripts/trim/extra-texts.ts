// Writes .cache/trim/extra.txt: texts that must tokenize exactly as before after trimming —
// every word-list term, the calibration posts and the spike samples. trim_vocab.py --extra reads it.
//
//   npx tsx scripts/trim/extra-texts.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMOJI } from '../../src/core/lexicon/lists/emoji';
import { EN } from '../../src/core/lexicon/lists/en';
import { HI } from '../../src/core/lexicon/lists/hi';
import { HINGLISH, HINGLISH_MARKERS } from '../../src/core/lexicon/lists/hinglish';

const root = join(import.meta.dirname, '..', '..');
const texts = new Set<string>();
for (const entry of [...EN, ...HI, ...HINGLISH, ...EMOJI]) texts.add(entry.term);
for (const marker of HINGLISH_MARKERS) texts.add(marker);

const jsonl = (path: string) =>
  existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as { text?: string })
    : [];
for (const file of ['calibration/screenshots.jsonl', 'calibration/posts.jsonl']) {
  for (const post of jsonl(join(root, file))) if (post.text) texts.add(post.text);
}
const samples = JSON.parse(readFileSync(join(root, 'spike', 'samples.json'), 'utf8')) as { text: string }[];
for (const sample of samples) texts.add(sample.text);

mkdirSync(join(root, '.cache', 'trim'), { recursive: true });
// One text per line: newlines inside a post become spaces (tokenization of words is unaffected).
writeFileSync(join(root, '.cache', 'trim', 'extra.txt'), [...texts].map((t) => t.replace(/\s*\n\s*/g, ' ')).join('\n'));
console.log(`Wrote ${texts.size} texts to .cache/trim/extra.txt`);
