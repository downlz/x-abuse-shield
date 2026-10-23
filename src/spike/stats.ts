import type { LatencyStats } from './types';

export function latencyStats(samplesMs: number[]): LatencyStats {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / (sorted.length || 1);
  return { count: sorted.length, mean, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
