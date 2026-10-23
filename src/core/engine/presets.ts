import type { Category } from './categories';

/** Per-category flag threshold; `null` ignores the category. */
export type Thresholds = Record<Category, number | null>;

export type PresetName = 'relaxed' | 'balanced' | 'strict';

/** Starting points from the plan; Phase 2 calibrates them on real posts. */
export const PRESETS: Record<PresetName, Thresholds> = {
  relaxed: {
    toxicity: 0.9,
    severe_toxicity: 0.6,
    obscene: null,
    threat: 0.6,
    insult: 0.85,
    identity_attack: 0.7,
    sexual_explicit: 0.8,
  },
  balanced: {
    toxicity: 0.75,
    severe_toxicity: 0.4,
    obscene: 0.85,
    threat: 0.4,
    insult: 0.7,
    identity_attack: 0.5,
    sexual_explicit: 0.6,
  },
  strict: {
    toxicity: 0.5,
    severe_toxicity: 0.25,
    obscene: 0.6,
    threat: 0.25,
    insult: 0.5,
    identity_attack: 0.35,
    sexual_explicit: 0.4,
  },
};
