import type { CategoryScores } from '@/core/engine/categories';
import type { SpikeVariant } from './variants';

export interface SpikeSample {
  id: string;
  lang: string;
  expected: 'abusive' | 'clean';
  text: string;
  note?: string;
}

export interface SpikeProgress {
  stage: 'load' | 'warmup' | 'single' | 'batch';
  message: string;
}

export interface LatencyStats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface SpikeRunResult {
  label: string;
  variant: SpikeVariant;
  env: {
    userAgent: string;
    crossOriginIsolated: boolean;
    hardwareConcurrency: number;
    numThreads: number | undefined;
    transformersVersion: string;
    ortWebVersion: string | undefined;
  };
  load: {
    ms: number;
    /** Model files already in the Cache API before loading (0 = cold start). */
    cachedFilesBefore: number;
    files: string[];
    bytes: number;
  };
  warmupMs: number;
  /** One post per inference call. */
  single: LatencyStats;
  /** Batches of `batchSize`; stats are per batch, `perPostMs` is amortised. */
  batch: LatencyStats & { batchSize: number; perPostMs: number };
  /** Batched-run scores keyed by sample id. */
  scores: Record<string, CategoryScores>;
  /** Largest |single − batched| score across all samples and categories. */
  singleVsBatchMaxDiff: number;
}
