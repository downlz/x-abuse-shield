import type { LexiconHit } from '../lexicon/types';
import type { SuspicionLevel } from '../signals/suspicion';
import { CATEGORIES, type Category, type CategoryScores } from './categories';
import type { Thresholds } from './presets';

export interface ScoringConfig {
  thresholds: Thresholds;
  nonEnglishOffset: number;
  suspicionOffsets: { medium: number; high: number };
  floor: number;
  corroboration: { low: number; medium: number };
}

export interface DecisionInput {
  lexiconHits: LexiconHit[];
  /** Model scores, once the model tier runs (Phase 2). */
  model?: CategoryScores;
  /** Categories whose model score is ignored (benign idioms). */
  suppressed?: Category[];
  suspicion: SuspicionLevel;
  /** A reply or mention. Suspicion only counts for these (PLAN §5.3). */
  directed: boolean;
  nonEnglish: boolean;
  /** Another copy in this post's copy-paste cluster was flagged. */
  copyOfFlagged?: boolean;
}

export interface Verdict {
  flagged: boolean;
  categories: Category[];
  /** Threat or severe toxicity: collapsed rather than blurred by default. */
  severe: boolean;
  reasons: string[];
}

/** Their thresholds are never lowered for suspicious accounts: they misfire on identity mentions and friendly swearing. */
const SUSPICION_EXEMPT: ReadonlySet<Category> = new Set(['identity_attack', 'obscene']);

export const NOT_FLAGGED: Verdict = { flagged: false, categories: [], severe: false, reasons: [] };

export function decide(input: DecisionInput, config: ScoringConfig): Verdict {
  const level: SuspicionLevel = input.directed ? input.suspicion : 'low';
  const categories = new Set<Category>();
  const reasons: string[] = [];

  for (const hit of input.lexiconHits) {
    if (config.thresholds[hit.category] === null) continue;
    if (hit.strength === 'strong') {
      categories.add(hit.category);
      reasons.push(`word list: “${hit.matched}”`);
      continue;
    }
    if (level === 'high') {
      categories.add(hit.category);
      reasons.push(`word list: “${hit.matched}” from a highly suspicious account`);
      continue;
    }
    const needed = config.corroboration[level];
    if (input.model && input.model.toxicity >= needed) {
      categories.add(hit.category);
      reasons.push(`word list: “${hit.matched}” + model toxicity ${input.model.toxicity.toFixed(2)}`);
    }
  }

  if (input.model) {
    for (const category of CATEGORIES) {
      const base = config.thresholds[category];
      if (base === null || input.suppressed?.includes(category)) continue;
      const threshold = effectiveThreshold(base, category, level, input.nonEnglish, config);
      const score = input.model[category];
      if (score >= threshold) {
        categories.add(category);
        reasons.push(`model: ${category} ${score.toFixed(2)} ≥ ${threshold.toFixed(2)}`);
      }
    }
  }

  if (input.copyOfFlagged) reasons.push('copy-paste reply: another copy was flagged');

  const flagged = categories.size > 0 || !!input.copyOfFlagged;
  return {
    flagged,
    categories: [...categories],
    severe: categories.has('threat') || categories.has('severe_toxicity'),
    reasons,
  };
}

/** Categories at or above their plain threshold — model only, no offsets (used by the spike report). */
export function flaggedCategories(scores: CategoryScores, thresholds: Thresholds): Category[] {
  return CATEGORIES.filter((category) => {
    const threshold = thresholds[category];
    return threshold !== null && scores[category] >= threshold;
  });
}

export function effectiveThreshold(
  base: number,
  category: Category,
  level: SuspicionLevel,
  nonEnglish: boolean,
  config: ScoringConfig,
): number {
  const suspicion = SUSPICION_EXEMPT.has(category) || level === 'low' ? 0 : config.suspicionOffsets[level];
  const offset = (nonEnglish ? config.nonEnglishOffset : 0) + suspicion;
  if (offset === 0) return base;
  return Math.max(base - offset, Math.min(base, config.floor));
}
