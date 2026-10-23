import { describe, expect, it } from 'vitest';
import { activeMute, recordStrike, unmute, type MuteState } from '@/core/mute/mutes';

const NOW = Date.parse('2026-10-23T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const options = { count: 3, windowDays: 7, muteFor: '7d' as const };
const empty: MuteState = { mutes: [], strikes: [] };
const strike = (postId: string, at = NOW, handle = '@Troll') => ({ handle, postId, at, reasons: [] });

describe('recordStrike', () => {
  it('mutes after 3 strikes in 7 days', () => {
    let state = empty;
    for (const id of ['1', '2']) {
      const result = recordStrike(state, strike(id), options, NOW);
      expect(result.newMute).toBeNull();
      state = result.state;
    }
    const { state: final, newMute } = recordStrike(state, strike('3'), options, NOW);
    expect(newMute).toMatchObject({ handle: 'troll', reason: 'strikes', expiresAt: NOW + 7 * DAY, evidence: ['1', '2', '3'] });
    expect(activeMute(final.mutes, 'TROLL', NOW + DAY)).toBeDefined();
    expect(activeMute(final.mutes, 'troll', NOW + 8 * DAY)).toBeUndefined();
  });

  it('counts each post once and forgets strikes older than the window', () => {
    let state = recordStrike(empty, strike('1', NOW - 10 * DAY), options, NOW - 10 * DAY).state;
    state = recordStrike(state, strike('2'), options, NOW).state;
    const { state: final, newMute } = recordStrike(state, strike('2'), options, NOW);
    expect(newMute).toBeNull();
    expect(final.strikes.map((s) => s.postId)).toEqual(['2']);
  });

  it('supports muting forever', () => {
    let state = empty;
    let mute = null;
    for (const id of ['1', '2', '3']) ({ state, newMute: mute } = recordStrike(state, strike(id), { ...options, muteFor: 'forever' }, NOW));
    expect(mute?.expiresAt).toBeNull();
    expect(activeMute(state.mutes, 'troll', NOW + 1000 * DAY)).toBeDefined();
  });
});

describe('unmute', () => {
  it('clears the mute and the strikes behind it', () => {
    let state = empty;
    for (const id of ['1', '2', '3']) state = recordStrike(state, strike(id), options, NOW).state;
    const after = unmute(state, '@troll');
    expect(after).toEqual({ mutes: [], strikes: [] });
  });
});
