/** Abuse categories scored by the model, in the model's output order. */
export const CATEGORIES = [
  'toxicity',
  'severe_toxicity',
  'obscene',
  'threat',
  'insult',
  'identity_attack',
  'sexual_explicit',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Independent probability (0–1) per category. */
export type CategoryScores = Record<Category, number>;
