import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import type { CategoryScores } from '@/core/engine/categories';
import { decide, effectiveThreshold, type DecisionInput, type ScoringConfig } from '@/core/engine/decide';
import { PRESETS } from '@/core/engine/presets';
import type { LexiconHit } from '@/core/lexicon/types';

const balanced: ScoringConfig = { ...DEFAULT_SETTINGS.scoring, thresholds: PRESETS.balanced };
const strict: ScoringConfig = { ...DEFAULT_SETTINGS.scoring, thresholds: PRESETS.strict };

const scores = (partial: Partial<CategoryScores>): CategoryScores => ({
  toxicity: 0,
  severe_toxicity: 0,
  obscene: 0,
  threat: 0,
  insult: 0,
  identity_attack: 0,
  sexual_explicit: 0,
  ...partial,
});
const hit = (strength: LexiconHit['strength'], category: LexiconHit['category'] = 'insult'): LexiconHit => ({
  term: 'x',
  matched: 'x',
  category,
  strength,
  source: 'en',
});
const input = (patch: Partial<DecisionInput>): DecisionInput => ({
  lexiconHits: [],
  suspicion: 'low',
  directed: false,
  nonEnglish: false,
  ...patch,
});

describe('word-list hits', () => {
  it('flags strong hits regardless of account', () => {
    const verdict = decide(input({ lexiconHits: [hit('strong')] }), balanced);
    expect(verdict.flagged).toBe(true);
    expect(verdict.categories).toEqual(['insult']);
  });

  it('ignores hits in a category the preset switches off', () => {
    expect(decide(input({ lexiconHits: [hit('strong', 'obscene')] }), { ...balanced, thresholds: PRESETS.relaxed }).flagged).toBe(false);
  });

  it('needs corroboration for mild hits', () => {
    expect(decide(input({ lexiconHits: [hit('mild')] }), balanced).flagged).toBe(false);
    expect(decide(input({ lexiconHits: [hit('mild')], model: scores({ toxicity: 0.42 }) }), balanced).flagged).toBe(true);
    expect(decide(input({ lexiconHits: [hit('mild')], model: scores({ toxicity: 0.3 }) }), balanced).flagged).toBe(false);
    // Medium suspicion lowers the bar, but only for replies and mentions.
    const medium = { lexiconHits: [hit('mild')], model: scores({ toxicity: 0.3 }), suspicion: 'medium' as const };
    expect(decide(input({ ...medium, directed: true }), balanced).flagged).toBe(true);
    expect(decide(input(medium), balanced).flagged).toBe(false);
  });

  it('flags mild hits from highly suspicious accounts only when directed', () => {
    expect(decide(input({ lexiconHits: [hit('mild')], suspicion: 'high', directed: true }), balanced).flagged).toBe(true);
    expect(decide(input({ lexiconHits: [hit('mild')], suspicion: 'high', directed: false }), balanced).flagged).toBe(false);
  });
});

describe('model thresholds with suspicion (PLAN §5.3)', () => {
  it('reproduces the plan example: insult 0.55 flagged from a new account, not from an established one', () => {
    const reply = { model: scores({ insult: 0.55 }), directed: true };
    expect(decide(input({ ...reply, suspicion: 'high' }), balanced).flagged).toBe(true);
    expect(decide(input({ ...reply, suspicion: 'low' }), balanced).flagged).toBe(false);
  });

  it('never applies suspicion to standalone posts', () => {
    expect(decide(input({ model: scores({ insult: 0.55 }), suspicion: 'high', directed: false }), balanced).flagged).toBe(false);
  });

  it('never lowers identity_attack or obscene for suspicious accounts', () => {
    // "I'm a proud gay man…" scored identity_attack 0.49 in Phase 0.
    expect(decide(input({ model: scores({ identity_attack: 0.49 }), suspicion: 'high', directed: true }), balanced).flagged).toBe(false);
    expect(effectiveThreshold(0.85, 'obscene', 'high', false, balanced)).toBe(0.85);
  });

  it('applies the 0.45 floor, but never raises a preset that is already lower', () => {
    expect(effectiveThreshold(0.5, 'toxicity', 'high', true, strict)).toBe(0.45);
    expect(effectiveThreshold(0.25, 'threat', 'high', true, strict)).toBe(0.25);
    expect(effectiveThreshold(0.7, 'insult', 'high', false, balanced)).toBeCloseTo(0.5);
  });

  it('ignores suppressed categories', () => {
    expect(decide(input({ model: scores({ threat: 0.74 }), suppressed: ['threat'] }), balanced).flagged).toBe(false);
  });
});

describe('verdict shape', () => {
  it('marks threats as severe', () => {
    expect(decide(input({ lexiconHits: [hit('strong', 'threat')] }), balanced).severe).toBe(true);
    expect(decide(input({ lexiconHits: [hit('strong', 'insult')] }), balanced).severe).toBe(false);
  });

  it('flags copies of a flagged post without assigning a category', () => {
    const verdict = decide(input({ copyOfFlagged: true }), balanced);
    expect(verdict).toMatchObject({ flagged: true, categories: [], severe: false });
  });
});
