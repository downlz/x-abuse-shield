import { env } from '@huggingface/transformers';
import { CATEGORIES, type CategoryScores } from '@/core/engine/categories';
import { BUNDLED_MODEL_DIR, MODEL_ID } from '@/adapters/inference/model';
import { loadInPlaceClassifier } from '@/adapters/inference/ort-classifier';
import { loadToxicityClassifier, type ToxicityClassifier } from '@/adapters/inference/toxicity-classifier';
import { chunk, latencyStats } from './stats';
import type { SpikeProgress, SpikeRunResult, SpikeSample } from './types';
import { SPIKE_VARIANTS, type SpikeVariant } from './variants';

const BATCH_SIZE = 8;

/**
 * Kept loaded after the run so the browser's memory can be measured with the
 * model resident; it's released when the offscreen document closes.
 */
let loaded: ToxicityClassifier | null = null;

/** Loads the model and benchmarks it. Runs inside the offscreen document. */
export async function runSpike(
  samples: SpikeSample[],
  label: string,
  variant: SpikeVariant,
  ortBaseUrl: string,
  report: (progress: SpikeProgress) => void,
): Promise<SpikeRunResult> {
  await loaded?.dispose();
  const fileSizes = new Map<string, number>();
  let lastReported = 0;

  const cachedFilesBefore = await countCachedModelFiles();
  report({ stage: 'load', message: `Loading model (${cachedFilesBefore} files cached)…` });
  const loadStart = performance.now();
  const classifier =
    variant === 'bundled-ort'
      ? await loadInPlaceClassifier({ modelBaseUrl: new URL(`/${BUNDLED_MODEL_DIR}`, location.href).href, remote: false, ortBaseUrl })
      : await loadToxicityClassifier({
          ortBaseUrl,
          sessionOptions: SPIKE_VARIANTS[variant],
          onProgress: (p) => {
            if (p.status === 'progress') {
              fileSizes.set(p.file, p.total);
              const now = performance.now();
              if (now - lastReported > 2000) {
                lastReported = now;
                report({ stage: 'load', message: `${p.file}: ${Math.round(p.progress)}%` });
              }
            }
          },
        });
  loaded = classifier;
  const loadMs = performance.now() - loadStart;
  report({ stage: 'load', message: `Loaded in ${Math.round(loadMs)} ms` });

  report({ stage: 'warmup', message: 'Warm-up inference' });
  const warmStart = performance.now();
  await classifier.classify([samples[0]!.text]);
  const warmupMs = performance.now() - warmStart;

  report({ stage: 'single', message: `Scoring ${samples.length} posts one at a time` });
  const singleTimes: number[] = [];
  const singleScores: CategoryScores[] = [];
  for (const sample of samples) {
    const t = performance.now();
    const [scores] = await classifier.classify([sample.text]);
    singleTimes.push(performance.now() - t);
    singleScores.push(scores!);
  }

  report({ stage: 'batch', message: `Scoring in batches of ${BATCH_SIZE}` });
  const batchTimes: number[] = [];
  const batchScores: CategoryScores[] = [];
  for (const group of chunk(samples, BATCH_SIZE)) {
    const t = performance.now();
    batchScores.push(...(await classifier.classify(group.map((s) => s.text))));
    batchTimes.push(performance.now() - t);
  }

  const batch = latencyStats(batchTimes);
  return {
    label,
    variant,
    env: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: self.crossOriginIsolated,
      hardwareConcurrency: navigator.hardwareConcurrency,
      numThreads: env.backends.onnx.wasm?.numThreads,
      transformersVersion: env.version,
      ortWebVersion: env.backends.onnx.versions?.web,
    },
    load: {
      ms: loadMs,
      cachedFilesBefore,
      files: [...fileSizes.keys()],
      bytes: [...fileSizes.values()].reduce((a, b) => a + b, 0),
    },
    warmupMs,
    single: latencyStats(singleTimes),
    batch: {
      ...batch,
      batchSize: BATCH_SIZE,
      perPostMs: batchTimes.reduce((a, b) => a + b, 0) / samples.length,
    },
    scores: Object.fromEntries(samples.map((s, i) => [s.id, batchScores[i]!])),
    singleVsBatchMaxDiff: maxDiff(singleScores, batchScores),
  };
}

async function countCachedModelFiles(): Promise<number> {
  const cache = await caches.open(env.cacheKey);
  const keys = await cache.keys();
  return keys.filter((request) => request.url.includes(MODEL_ID)).length;
}

function maxDiff(a: CategoryScores[], b: CategoryScores[]): number {
  let max = 0;
  a.forEach((row, i) => {
    for (const c of CATEGORIES) max = Math.max(max, Math.abs(row[c] - b[i]![c]));
  });
  return max;
}
