import { describe, expect, it } from 'vitest';
import { CopyTracker, MAX_COPIES_PER_GROUP, MAX_GROUPS } from '@/core/coordination/copy-tracker';
import { BoundedMap, BoundedSet } from '@/shared/bounded';

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
