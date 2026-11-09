import { describe, expect, it } from 'vitest';
import { DISTILBERT_LITE_MODEL_ID, DISTILBERT_MODEL_ID, LITE_MODEL_ID, maxBatch, MODEL_ID } from '@/adapters/inference/model';
import { CopyTracker, MAX_COPIES_PER_GROUP, MAX_GROUPS } from '@/core/coordination/copy-tracker';
import { BoundedMap, BoundedSet } from '@/shared/bounded';
import { modelReads } from '@/shared/model-coverage';

describe('BoundedMap and BoundedSet', () => {
  it('forget the oldest entries past the limit, and writing an entry again makes it the newest', () => {
    const map = new BoundedMap<string, number>(3);
    ['a', 'b', 'c'].forEach((k, i) => map.set(k, i));
    map.set('a', 9); // a is now the newest
    map.set('d', 3);
    expect([...map.keys()]).toEqual(['c', 'a', 'd']);
    expect(map.get('a')).toBe(9);

    const set = new BoundedSet<number>(2);
    [1, 2, 3].forEach((n) => set.add(n));
    expect([...set]).toEqual([2, 3]);
  });
});

describe('CopyTracker limits', () => {
  const at = Date.parse('2026-11-09T10:00:00Z');

  it('keeps at most MAX_GROUPS groups, and still finds a brigade afterwards', () => {
    const tracker = new CopyTracker({ windowMinutes: 10, minAuthors: 3 });
    for (let i = 0; i < MAX_GROUPS + 500; i++) tracker.add(`unique text number ${i} ${i * 7919}`, { postId: `p${i}`, author: `a${i}`, postedAt: at });
    expect(tracker.groupCount()).toBeLessThanOrEqual(MAX_GROUPS);

    const key = 'you are a disgrace to this country';
    ['x1', 'x2', 'x3'].forEach((id, i) => tracker.add(key, { postId: id, author: `troll${i}`, postedAt: at + i * 1000 }));
    expect(tracker.clusterOf('x3').sort()).toEqual(['x1', 'x2', 'x3']);
  });

  it('keeps the newest MAX_COPIES_PER_GROUP copies of a group', () => {
    const tracker = new CopyTracker({ windowMinutes: 10, minAuthors: 3 });
    for (let i = 0; i < MAX_COPIES_PER_GROUP + 50; i++) tracker.add('same text', { postId: `c${i}`, author: `a${i}`, postedAt: at + i });
    expect(tracker.clusterOf('c0')).toEqual([]);
    expect(tracker.clusterOf(`c${MAX_COPIES_PER_GROUP + 49}`)).toHaveLength(MAX_COPIES_PER_GROUP);
  });
});

describe('modelReads (what the DistilBERT phone model can read)', () => {
  const lite = DISTILBERT_LITE_MODEL_ID;

  it('reads English, Hindi and Hinglish', () => {
    expect(modelReads(lite, "You're a worthless idiot and everyone here knows it.", 'en', false)).toBe(true);
    expect(modelReads(lite, 'तू एक नंबर का बेवकूफ और नालायक इंसान है।', 'hi', false)).toBe(true);
    expect(modelReads(lite, 'Abe gadhe, kuch bhi bakwas karta rehta hai.', 'in', false)).toBe(true);
    expect(modelReads(lite, 'Abe gadhe, kuch bhi bakwas karta rehta hai.', undefined, false)).toBe(true);
    expect(modelReads(lite, '🤡🤡🤡', undefined, false)).toBe(true);
  });

  it('leaves other scripts and X-tagged Latin-script languages to the word lists', () => {
    expect(modelReads(lite, 'Ты идиот, замолчи уже.', 'ru', false)).toBe(false);
    expect(modelReads(lite, 'Ты идиот, замолчи уже.', undefined, false)).toBe(false);
    expect(modelReads(lite, 'أنت غبي وحقير، اسكت.', 'ar', false)).toBe(false);
    expect(modelReads(lite, 'তুই একটা গাধা, চুপ কর।', 'bn', false)).toBe(false);
    expect(modelReads(lite, 'Ferme ta gueule, espèce de connard.', 'fr', false)).toBe(false);
    expect(modelReads(lite, 'Halt die Klappe, du Vollidiot.', 'de-DE', false)).toBe(false);
  });

  it('reads a post X mislabels when the word lists see Hinglish', () => {
    expect(modelReads(lite, 'Kya bakwas hai yaar, pagal ho gaya hai', 'es', true)).toBe(true);
  });

  it('has no limits for the full models and the toxicity phone model', () => {
    for (const id of [DISTILBERT_MODEL_ID, MODEL_ID, LITE_MODEL_ID]) expect(modelReads(id, 'Ты идиот', 'ru', false)).toBe(true);
  });

  it('scores DistilBERT models one post per call (batch of 1 in the export)', () => {
    expect(maxBatch(DISTILBERT_MODEL_ID)).toBe(1);
    expect(maxBatch(DISTILBERT_LITE_MODEL_ID)).toBe(1);
    expect(maxBatch(LITE_MODEL_ID)).toBe(Infinity);
  });
});
