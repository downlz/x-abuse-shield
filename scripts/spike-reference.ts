// Scores spike/samples.json with the same classifier code on onnxruntime-node,
// as an independent baseline for the in-browser run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadToxicityClassifier } from '../src/adapters/inference/toxicity-classifier';
import type { CategoryScores } from '../src/core/engine/categories';
import { chunk, latencyStats } from '../src/spike/stats';
import type { SpikeSample } from '../src/spike/types';

const BATCH_SIZE = 8;
const root = join(import.meta.dirname, '..');
const samples: SpikeSample[] = JSON.parse(readFileSync(join(root, 'spike', 'samples.json'), 'utf8'));

const reported = new Map<string, number>();
const loadStart = performance.now();
const classifier = await loadToxicityClassifier({
  cacheDir: join(root, '.cache', 'models'),
  onProgress: (p) => {
    if (p.status !== 'progress') return;
    const step = Math.floor(p.progress / 10) * 10;
    if ((reported.get(p.file) ?? -1) < step) {
      reported.set(p.file, step);
      console.log(`${p.file}: ${step}%`);
    }
  },
});
const loadMs = performance.now() - loadStart;
console.log(`Loaded in ${Math.round(loadMs)} ms`);

await classifier.classify([samples[0]!.text]);

const singleTimes: number[] = [];
for (const sample of samples) {
  const t = performance.now();
  await classifier.classify([sample.text]);
  singleTimes.push(performance.now() - t);
}

const batchTimes: number[] = [];
const scores: CategoryScores[] = [];
for (const group of chunk(samples, BATCH_SIZE)) {
  const t = performance.now();
  scores.push(...(await classifier.classify(group.map((s) => s.text))));
  batchTimes.push(performance.now() - t);
}
await classifier.dispose();

const result = {
  runtime: 'onnxruntime-node',
  loadMs,
  single: latencyStats(singleTimes),
  batch: {
    ...latencyStats(batchTimes),
    batchSize: BATCH_SIZE,
    perPostMs: batchTimes.reduce((a, b) => a + b, 0) / samples.length,
  },
  scores: Object.fromEntries(samples.map((s, i) => [s.id, scores[i]])),
};

mkdirSync(join(root, 'spike', 'results'), { recursive: true });
writeFileSync(join(root, 'spike', 'results', 'reference.json'), JSON.stringify(result, null, 2));
console.log(`single p50 ${result.single.p50.toFixed(1)} ms · batch ${result.batch.perPostMs.toFixed(1)} ms/post`);
