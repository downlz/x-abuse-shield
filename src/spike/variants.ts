import type { SessionOptions } from '@/adapters/inference/toxicity-classifier';

/** ONNX Runtime session settings compared for memory use in the spike. */
export const SPIKE_VARIANTS = {
  default: {},
  /** ONNX Runtime's CPU arena grows to the peak allocation and never shrinks. */
  'no-arena': { enableCpuMemArena: false, enableMemPattern: false },
  /** No graph optimisation, ruling out constant-folded (dequantised) weights. */
  'no-graph-opt': { graphOptimizationLevel: 'disabled' },
} satisfies Record<string, SessionOptions>;

export type SpikeVariant = keyof typeof SPIKE_VARIANTS;

export function isSpikeVariant(value: string): value is SpikeVariant {
  return value in SPIKE_VARIANTS;
}
