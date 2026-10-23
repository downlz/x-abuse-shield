// Combines spike/results/*.json into docs/SPIKE-REPORT.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, type CategoryScores } from '../src/core/engine/categories';
import { flaggedCategories } from '../src/core/engine/decide';
import { PRESETS, type PresetName } from '../src/core/engine/presets';
import type { LatencyStats, SpikeSample } from '../src/spike/types';
import { SPIKE_VARIANTS } from '../src/spike/variants';
import type { MemorySnapshot, SessionResult } from './spike-browser';

const BATCH_BUDGET_MS = 150;

interface BrowserResults {
  chromeVersion: string;
  sessions: SessionResult[];
}
interface ReferenceResults {
  runtime: string;
  loadMs: number;
  single: LatencyStats;
  batch: LatencyStats & { perPostMs: number };
  scores: Record<string, CategoryScores>;
}

const root = join(import.meta.dirname, '..');
const readJson = <T>(...path: string[]): T => JSON.parse(readFileSync(join(root, ...path), 'utf8')) as T;
const samples = readJson<SpikeSample[]>('spike', 'samples.json');
const reference = readJson<ReferenceResults>('spike', 'results', 'reference.json');
const browserResults = readJson<BrowserResults>('spike', 'results', 'browser.json');

const runs = browserResults.sessions.flatMap((s) => s.runs);
const byLabel = (label: string) => runs.find((r) => r.label === label);
const firstLoad = byLabel('first-load')!;
const fresh = byLabel('fresh-document')!;
const restart = byLabel('after-restart');
// Every session that loads the model once from cache: the restart session plus
// all variant runs (spike/results/memory-<variant>.json).
const memorySessions: { name: string; variant: string; session: SessionResult }[] = [
  ...browserResults.sessions.slice(-1).map((session) => ({ name: 'after-restart', variant: 'default', session })),
  ...Object.keys(SPIKE_VARIANTS).flatMap((variant) => {
    const path = join(root, 'spike', 'results', `memory-${variant}.json`);
    if (!existsSync(path)) return [];
    const sessions = JSON.parse(readFileSync(path, 'utf8')) as SessionResult[];
    return sessions.map((session, i) => ({ name: `${variant} #${i + 1}`, variant, session }));
  }),
];

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024).toLocaleString('en-US')} MB`;
const extension = (snapshot: MemorySnapshot) => snapshot.extension ?? 0;
/** Steady-state cost of the loaded model in the extension process. */
const modelCost = (m: NonNullable<SessionResult['processMemory']>) => extension(m.loadedIdle) - extension(m.baseline);
// The downloaded .onnx sessions; the shipped in-place model is reported on its own line.
const measured = memorySessions.flatMap(({ variant, session }) =>
  variant !== 'bundled-ort' && session.processMemory ? [session.processMemory] : [],
);
const steadyCosts = measured.map(modelCost).sort((a, b) => a - b);
const inPlaceCosts = memorySessions
  .flatMap(({ variant, session }) => (variant === 'bundled-ort' && session.processMemory ? [modelCost(session.processMemory)] : []))
  .sort((a, b) => a - b);
const peakReadings = measured.map((m) => extension(m.loaded)).sort((a, b) => a - b);
const releasedTo = measured.map((m) => extension(m.unloadedIdle)).sort((a, b) => a - b);
const range = (values: number[]) =>
  values.length ? (values.length === 1 ? mb(values[0]!) : `${mb(values[0]!)}–${mb(values.at(-1)!)}`) : 'n/a';
const ms = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
const s = (value: number) => `${(value / 1000).toFixed(1)} s`;
const pass = (ok: boolean) => (ok ? '✅' : '❌');

function parity(a: Record<string, CategoryScores>, b: Record<string, CategoryScores>) {
  let max = 0;
  let sum = 0;
  let n = 0;
  for (const sample of samples) {
    for (const c of CATEGORIES) {
      const diff = Math.abs(a[sample.id]![c] - b[sample.id]![c]);
      max = Math.max(max, diff);
      sum += diff;
      n++;
    }
  }
  return { max, mean: sum / n };
}

const GROUPS: Record<string, (lang: string) => boolean> = {
  English: (l) => l === 'en',
  'Hindi (Devanagari)': (l) => l === 'hi',
  Hinglish: (l) => l === 'hinglish',
  'Other languages': (l) => !['en', 'hi', 'hinglish'].includes(l),
};

function confusion(preset: PresetName, filter: (lang: string) => boolean) {
  const counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const sample of samples.filter((x) => filter(x.lang))) {
    const flagged = flaggedCategories(fresh.scores[sample.id]!, PRESETS[preset]).length > 0;
    const abusive = sample.expected === 'abusive';
    if (flagged && abusive) counts.tp++;
    else if (flagged) counts.fp++;
    else if (abusive) counts.fn++;
    else counts.tn++;
  }
  return counts;
}

function topCategory(scores: CategoryScores) {
  return CATEGORIES.reduce((best, c) => (scores[c] > scores[best] ? c : best), CATEGORIES[0]);
}

const browserVsNode = parity(fresh.scores, reference.scores);
const runToRun = parity(firstLoad.scores, fresh.scores);
const restartOk = restart !== undefined && restart.load.cachedFilesBefore > 0;

const lines: string[] = [];
const push = (...l: string[]) => lines.push(...l);

push(
  '# Phase 0 spike report',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} · Chrome for Testing ${browserResults.chromeVersion} · ${fresh.env.hardwareConcurrency} logical CPUs`,
  `Transformers.js ${fresh.env.transformersVersion} · onnxruntime-web ${fresh.env.ortWebVersion} · ` +
    `cross-origin isolated: ${fresh.env.crossOriginIsolated} · WASM threads: ${fresh.env.numThreads ?? 'default'}`,
  '',
  '## Exit criteria',
  '',
  '| Criterion | Result | |',
  '|---|---|---|',
  `| Batched latency ≤ ${BATCH_BUDGET_MS} ms/post | ${ms(fresh.batch.perPostMs)} | ${pass(fresh.batch.perPostMs <= BATCH_BUDGET_MS)} |`,
  `| Loads from cache after a browser restart | ${restart ? `${restart.load.cachedFilesBefore} files cached, loaded in ${s(restart.load.ms)}` : 'not run'} | ${pass(restartOk)} |`,
  `| Memory acceptable | +${range(steadyCosts)} steady while loaded (${measured.length} runs); back to ${range(releasedTo)} within 60 s of unloading | ⚠️ heavy — unload when idle |`,
  `| Browser output matches Node reference | max diff ${browserVsNode.max.toFixed(4)} | ${pass(browserVsNode.max < 0.01)} |`,
  '',
  '## Loading',
  '',
  '| Run | Model files cached before | Load time | Notes |',
  '|---|---|---|---|',
  ...runs.map(
    (r) =>
      `| ${r.label} | ${r.load.cachedFilesBefore} | ${s(r.load.ms)} | ${r.load.cachedFilesBefore === 0 ? `download of ${mb(r.load.bytes)}` : 'from Cache API'} |`,
  ),
  `| Node reference | — | ${s(reference.loadMs)} | onnxruntime-node, files on disk |`,
  '',
  '## Latency',
  '',
  '| Runtime | First inference | Single p50 | Single p95 | Batch of 8 (per batch p50) | Batched, per post |',
  '|---|---|---|---|---|---|',
  ...runs.map(
    (r) =>
      `| Browser · ${r.label} | ${ms(r.warmupMs)} | ${ms(r.single.p50)} | ${ms(r.single.p95)} | ${ms(r.batch.p50)} | ${ms(r.batch.perPostMs)} |`,
  ),
  `| Node reference | — | ${ms(reference.single.p50)} | ${ms(reference.single.p95)} | ${ms(reference.batch.p50)} | ${ms(reference.batch.perPostMs)} |`,
  '',
  '## Memory',
  '',
  'Private bytes of the extension process, which hosts the offscreen document, service worker and',
  'extension pages; other Chrome processes do not change. Each session loads the model once from cache.',
  '"Peak" is read 5 s after the benchmark, "steady" after 60 s idle — V8 frees the large load-time',
  'buffers lazily, so the 5 s reading varies by more than 1 GB between runs.',
  '',
  `- **Steady-state cost of the loaded model: +${range(steadyCosts)}** (downloaded \`.onnx\`)`,
  ...(inPlaceCosts.length ? [`- **Shipped in-place \`.ort\` model: +${range(inPlaceCosts)}**`] : []),
  `- Peak readings 5 s after loading: ${range(peakReadings)}`,
  `- After unloading (offscreen document closed, 60 s): ${range(releasedTo)}`,
  '',
  '| Session | Session options | No model | Loaded, 5 s | Loaded, 60 s idle | Unloaded, 5 s | Unloaded, 60 s | Batched, per post |',
  '|---|---|---|---|---|---|---|---|',
  ...memorySessions.map(({ name, variant, session }) => {
    const m = session.processMemory;
    const settings = JSON.stringify(SPIKE_VARIANTS[variant as keyof typeof SPIKE_VARIANTS]).replace(/"/g, '');
    const cells = m
      ? [m.baseline, m.loaded, m.loadedIdle, m.unloaded, m.unloadedIdle].map((snapshot) => mb(extension(snapshot)))
      : ['n/a', 'n/a', 'n/a', 'n/a', 'n/a'];
    return `| ${name} | \`${settings}\` | ${cells.join(' | ')} | ${ms(session.runs[0]!.batch.perPostMs)} |`;
  }),
  '',
  '### What the memory is (Phase 2 investigation)',
  '',
  '- The tokenizer (256k-token vocabulary) takes ~180 MB: 149 MB of JS heap + 32 MB external, measured in Node (same V8).',
  '- No ONNX Runtime session option changes the total: CPU arena, graph optimisation and weight prepacking were all tried above.',
  '- The rest was two copies of the weights: the model bytes in WebAssembly memory plus the weights parsed (and pre-packed) from them. WebAssembly memory never shrinks, so the load-time peak becomes the steady state.',
  '- **Fix (`bundled-ort` above):** the model converted to ONNX Runtime’s `.ort` format and run in place (`use_ort_model_bytes_for_initializers`, `disable_prepacking`), with onnxruntime-web patched to keep the bytes (scripts/ort-in-place-plugin.ts). Steady cost +507 MB instead of +850 MB (−41%), peak 0.84 GB instead of 1.19 GB, same speed, scores within 1e-6 of the `.onnx`. It ships with the extension (`npm run model:build`).',
  '',
  '## Output parity',
  '',
  `- Browser vs Node reference: max |diff| ${browserVsNode.max.toFixed(5)}, mean ${browserVsNode.mean.toFixed(6)}`,
  `- Browser first load vs fresh document: max |diff| ${runToRun.max.toFixed(5)}`,
  `- Single vs batched inference (padding effect): max |diff| ${fresh.singleVsBatchMaxDiff.toFixed(5)}`,
  '',
  '## Detection quality on the sample set',
  '',
  `${samples.length} hand-written posts — a smoke test, not a benchmark. Phase 2 calibrates on real posts.`,
  '',
  '| Group | Preset | Caught (TP) | Missed (FN) | False alarms (FP) | Correctly clean (TN) |',
  '|---|---|---|---|---|---|',
);
for (const [group, filter] of Object.entries(GROUPS)) {
  for (const preset of Object.keys(PRESETS) as PresetName[]) {
    const c = confusion(preset, filter);
    push(`| ${group} | ${preset} | ${c.tp} | ${c.fn} | ${c.fp} | ${c.tn} |`);
  }
}
push(
  '',
  '### Per post (Balanced preset)',
  '',
  '| Id | Expected | Top category | Flagged | Verdict | Text |',
  '|---|---|---|---|---|---|',
);
for (const sample of samples) {
  const scores = fresh.scores[sample.id]!;
  const top = topCategory(scores);
  const flagged = flaggedCategories(scores, PRESETS.balanced);
  const correct = (flagged.length > 0) === (sample.expected === 'abusive');
  const text = sample.text.replace(/\|/g, '\\|');
  push(
    `| ${sample.id} | ${sample.expected}${sample.note ? ` (${sample.note})` : ''} | ${top} ${scores[top].toFixed(2)} | ${flagged.join(', ') || '—'} | ${correct ? '✓' : '✗'} | ${text} |`,
  );
}

const markdown = lines.join('\n') + '\n';
writeFileSync(join(root, 'docs', 'SPIKE-REPORT.md'), markdown);
console.log(markdown);
