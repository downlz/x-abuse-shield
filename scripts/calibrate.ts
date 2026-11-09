// Scores labelled posts with the word lists and the AI model (onnxruntime-node,
// same model files as the extension), applies each preset, and writes
// docs/CALIBRATION.md. Data format: calibration/README.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadToxicityClassifier } from '../src/adapters/inference/toxicity-classifier';
import { DEFAULT_SETTINGS } from '../src/core/config/defaults';
import { CATEGORIES, type Category, type CategoryScores } from '../src/core/engine/categories';
import { decide, type ScoringConfig } from '../src/core/engine/decide';
import { PRESETS, type PresetName, type Thresholds } from '../src/core/engine/presets';
import { Lexicon, type LexiconResult } from '../src/core/lexicon/match';
import { assessAccount, DEFAULT_SIGNAL_WEIGHTS, type SuspicionLevel } from '../src/core/signals/suspicion';

interface LabelledPost {
  id: string;
  text: string;
  expected: 'abusive' | 'clean';
  lang?: string;
  directed?: boolean;
  note?: string;
  account?: { ageDays?: number; followers?: number; following?: number; defaultAvatar?: boolean; handle?: string; bio?: string };
}

interface Scored {
  post: LabelledPost;
  lexicon: LexiconResult;
  model: CategoryScores;
  suspicion: SuspicionLevel;
  nonEnglish: boolean;
}

const root = join(import.meta.dirname, '..');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const sources = [
  ['spike/samples.json', 'Phase 0 samples'],
  ['calibration/screenshots.jsonl', 'real posts from screenshots'],
  ['calibration/posts.jsonl', 'your labelled posts'],
] as const;

const posts: LabelledPost[] = [];
const loaded: string[] = [];
for (const [file, label] of sources) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const raw = readFileSync(path, 'utf8');
  const items = file.endsWith('.json')
    ? (JSON.parse(raw) as LabelledPost[])
    : raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as LabelledPost);
  posts.push(...items);
  loaded.push(`${items.length} ${label} (\`${file}\`)`);
}

const lexicon = new Lexicon({ languages: { en: true, hi: true, hinglish: true, emoji: true }, customBlock: [], customAllow: [] });
const classifier = await loadToxicityClassifier({ cacheDir: join(root, '.cache', 'models') });
const modelScores: CategoryScores[] = [];
for (let i = 0; i < posts.length; i += 8) modelScores.push(...(await classifier.classify(posts.slice(i, i + 8).map((p) => p.text))));
await classifier.dispose();

const scored: Scored[] = posts.map((post, i) => {
  const lex = lexicon.match(post.text);
  const account = post.account;
  const suspicion = account
    ? assessAccount(
        {
          handle: account.handle ?? 'unknown',
          createdAt: account.ageDays === undefined ? undefined : NOW - account.ageDays * DAY,
          followers: account.followers,
          following: account.following,
          defaultAvatar: account.defaultAvatar,
          bio: account.bio,
          source: 'api',
        },
        { weights: DEFAULT_SIGNAL_WEIGHTS, bioKeywords: [] },
        NOW,
      ).level
    : 'low';
  return {
    post,
    lexicon: lex,
    model: modelScores[i]!,
    suspicion,
    nonEnglish: lex.hinglish || (!!post.lang && post.lang !== 'en'),
  };
});

interface Options {
  model: boolean;
  suspicion: boolean;
  /** Model toxicity a mild word needs (low suspicion). */
  corroboration?: number;
  /** Mild words only count in replies and mentions. */
  mildDirectedOnly?: boolean;
}

function flagged(s: Scored, thresholds: Thresholds, opts: Options): boolean {
  const scoring = DEFAULT_SETTINGS.scoring;
  const config: ScoringConfig = {
    ...scoring,
    thresholds,
    corroboration: { ...scoring.corroboration, low: opts.corroboration ?? scoring.corroboration.low },
    mildWordsRepliesOnly: opts.mildDirectedOnly ?? scoring.mildWordsRepliesOnly,
  };
  return decide(
    {
      lexiconHits: s.lexicon.hits,
      model: opts.model ? s.model : undefined,
      suppressed: s.lexicon.suppressed,
      suspicion: opts.suspicion ? s.suspicion : 'low',
      directed: !!s.post.directed,
      nonEnglish: s.nonEnglish,
    },
    config,
  ).flagged;
}

const GROUPS: [string, (s: Scored) => boolean][] = [
  ['All', () => true],
  ['English', (s) => s.post.lang === 'en'],
  ['Hindi', (s) => s.post.lang === 'hi'],
  ['Hinglish', (s) => s.post.lang === 'hinglish'],
  ['Other', (s) => !['en', 'hi', 'hinglish'].includes(s.post.lang ?? '')],
];

function counts(filter: (s: Scored) => boolean, isFlagged: (s: Scored) => boolean) {
  const group = scored.filter(filter);
  const abusive = group.filter((s) => s.post.expected === 'abusive');
  const clean = group.filter((s) => s.post.expected === 'clean');
  return {
    caught: abusive.filter(isFlagged).length,
    abusive: abusive.length,
    falseAlarms: clean.filter(isFlagged).length,
    clean: clean.length,
  };
}
const cell = (c: ReturnType<typeof counts>) => (c.abusive + c.clean === 0 ? '—' : `${c.caught}/${c.abusive} · ${c.falseAlarms}/${c.clean}`);

const top = (scores: CategoryScores) => {
  const c = CATEGORIES.reduce((best: Category, k) => (scores[k] > scores[best] ? k : best), 'toxicity');
  return `${c} ${scores[c].toFixed(2)}`;
};
const words = (s: Scored) => s.lexicon.hits.map((h) => `${h.strength === 'strong' ? '**' : ''}${h.term}${h.strength === 'strong' ? '**' : ''}`).join(', ') || '—';
const short = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 90);

const lines: string[] = [];
const push = (...l: string[]) => lines.push(...l);
push(
  '# Calibration report',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run calibrate\`. ${posts.length} labelled posts: ${loaded.join(', ')}.`,
  '',
  'Cells show **abusive posts caught / abusive** · **clean posts flagged / clean**.',
  '',
  '## Presets',
  '',
  `| Tiers | Preset | ${GROUPS.map(([g]) => g).join(' | ')} |`,
  `|---|---|${GROUPS.map(() => '---').join('|')}|`,
);
for (const [tiers, opts] of [
  ['Word lists only', { model: false, suspicion: true }],
  ['Word lists + model', { model: true, suspicion: true }],
] as const) {
  for (const preset of Object.keys(PRESETS) as PresetName[]) {
    push(`| ${tiers} | ${preset} | ${GROUPS.map(([, f]) => cell(counts(f, (s) => flagged(s, PRESETS[preset], opts)))).join(' | ')} |`);
  }
}

push(
  '',
  '## Mild words: corroboration bar (Balanced, word lists + model)',
  '',
  'A mild word ("idiot", "pagal") counts when model toxicity reaches the bar. Optionally only in replies and mentions.',
  '',
  '| Bar | Mild words count in | All | English | Hindi | Hinglish |',
  '|---|---|---|---|---|---|',
);
for (const directedOnly of [false, true]) {
  for (const bar of [0.4, 0.5, 0.6, 0.72, 0.8]) {
    const opts = { model: true, suspicion: true, corroboration: bar, mildDirectedOnly: directedOnly };
    const current =
      bar === DEFAULT_SETTINGS.scoring.corroboration.low && directedOnly === DEFAULT_SETTINGS.scoring.mildWordsRepliesOnly;
    const marker = current ? ' (default)' : '';
    push(
      `| ${bar.toFixed(2)}${marker} | ${directedOnly ? 'replies and mentions' : 'all posts'} | ${GROUPS.slice(0, 4)
        .map(([, f]) => cell(counts(f, (s) => flagged(s, PRESETS.balanced, opts))))
        .join(' | ')} |`,
    );
  }
}

push('', '## Threshold sweep (Balanced, word lists + model)', '', 'One category varied at a time; the others stay at Balanced.', '');
for (const category of ['toxicity', 'insult', 'threat', 'identity_attack'] as const) {
  push(`### ${category}`, '', '| Threshold | All | English | Hindi | Hinglish |', '|---|---|---|---|---|');
  for (const t of [0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9]) {
    const thresholds = { ...PRESETS.balanced, [category]: t };
    const marker = PRESETS.balanced[category] === t ? ' (Balanced)' : '';
    push(`| ${t.toFixed(2)}${marker} | ${GROUPS.slice(0, 4).map(([, f]) => cell(counts(f, (s) => flagged(s, thresholds, { model: true, suspicion: true })))).join(' | ')} |`);
  }
  push('');
}

const withAccounts = scored.filter((s) => s.post.account);
push('## Account suspicion', '');
if (withAccounts.length === 0) {
  push('No labelled posts carry account details yet, so suspicion offsets can’t be tuned. See `calibration/README.md`.', '');
} else {
  const without = counts((s) => !!s.post.account, (s) => flagged(s, PRESETS.balanced, { model: true, suspicion: false }));
  const withS = counts((s) => !!s.post.account, (s) => flagged(s, PRESETS.balanced, { model: true, suspicion: true }));
  push(`${withAccounts.length} posts with account details (Balanced, word lists + model):`, '', `- Without suspicion offsets: ${cell(without)}`, `- With suspicion offsets: ${cell(withS)}`, '');
}

push('## Balanced: misses and false alarms (word lists + model)', '', '| Id | Lang | Expected | Model top | Word lists | Text |', '|---|---|---|---|---|---|');
for (const s of scored) {
  const hit = flagged(s, PRESETS.balanced, { model: true, suspicion: true });
  if (hit === (s.post.expected === 'abusive')) continue;
  push(`| ${s.post.id} | ${s.post.lang ?? '?'} | ${s.post.expected}${s.post.note ? ` (${s.post.note})` : ''} | ${top(s.model)} | ${words(s)} | ${short(s.post.text)} |`);
}

const markdown = `${lines.join('\n')}\n`;
writeFileSync(join(root, 'docs', 'CALIBRATION.md'), markdown);
console.log(markdown);
