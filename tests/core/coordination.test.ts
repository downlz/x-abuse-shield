import { describe, expect, it } from 'vitest';
import { CopyTracker } from '@/core/coordination/copy-tracker';
import { fingerprint } from '@/core/coordination/fingerprint';

const T0 = Date.parse('2026-10-23T14:00:00Z');
const MIN = 60_000;

describe('fingerprint', () => {
  it('ignores case, punctuation, emoji, mentions, URLs and stretched letters', () => {
    const a = fingerprint('@LakotaMan1 You are a disgrace to this country!! 😡 https://t.co/abc');
    expect(a).toBe('you are a disgrace to this country');
    expect(fingerprint('you are a DISGRACE to this countryyy...')).toBe(a);
  });

  it('skips texts too short to mean anything', () => {
    expect(fingerprint('lol')).toBeNull();
    expect(fingerprint('so true 😂😂')).toBeNull();
    expect(fingerprint('a b c d e')).toBeNull();
  });
});

describe('CopyTracker', () => {
  const options = { windowMinutes: 10, minAuthors: 3 };

  it('clusters 3 authors posting the same text within 10 minutes', () => {
    const tracker = new CopyTracker(options);
    expect(tracker.add('k', { postId: '1', author: 'a', postedAt: T0 })).toEqual([]);
    expect(tracker.add('k', { postId: '2', author: 'b', postedAt: T0 + 3 * MIN })).toEqual([]);
    expect(tracker.add('k', { postId: '3', author: 'c', postedAt: T0 + 6 * MIN }).sort()).toEqual(['1', '2', '3']);
    expect(tracker.clusterOf('1').sort()).toEqual(['1', '2', '3']);
  });

  it('needs distinct authors', () => {
    const tracker = new CopyTracker(options);
    ['1', '2', '3'].forEach((id, i) => tracker.add('k', { postId: id, author: 'same', postedAt: T0 + i * MIN }));
    expect(tracker.clusterOf('3')).toEqual([]);
  });

  it('uses posting time, not arrival order', () => {
    const tracker = new CopyTracker(options);
    tracker.add('k', { postId: '1', author: 'a', postedAt: T0 });
    tracker.add('k', { postId: '2', author: 'b', postedAt: T0 + 25 * MIN });
    expect(tracker.add('k', { postId: '3', author: 'c', postedAt: T0 + 50 * MIN })).toEqual([]);
    // A late arrival that was posted between them doesn't bridge a 50-minute gap either.
    expect(tracker.add('k', { postId: '4', author: 'd', postedAt: T0 + 12 * MIN })).toEqual([]);
  });
});
