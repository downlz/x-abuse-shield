import { describe, expect, it } from 'vitest';
import { makeBackup, readBackup } from '@/core/config/backup';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { addManualMute, parseMuteState, recordStrike, withdrawStrike, type MuteState } from '@/core/mute/mutes';
import { appendEntry, labelEntry, LOG_LIMIT, reviewStats, toCalibrationPost, type ReviewEntry } from '@/core/review/log';

const NOW = Date.parse('2026-10-23T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const entry = (postId: string, patch: Partial<ReviewEntry> = {}): ReviewEntry => ({
  postId,
  handle: 'troll_x',
  text: 'Chup kar bsdk',
  url: `https://x.com/troll_x/status/${postId}`,
  at: NOW,
  context: 'thread',
  directed: true,
  lang: 'hi',
  hinglish: true,
  categories: ['obscene'],
  severe: false,
  reasons: ['word list: “bsdk”'],
  wordHits: [{ term: 'bsdk', matched: 'bsdk', strength: 'strong', category: 'obscene' }],
  account: { ageDays: 3, followers: 4, following: 900, defaultAvatar: true, source: 'api', level: 'high', reasons: ['account 3 days old'] },
  ...patch,
});

describe('review log', () => {
  it('keeps newest first, replaces re-flagged posts but keeps the label', () => {
    let log = appendEntry([], entry('1'), NOW);
    log = appendEntry(log, entry('2'), NOW);
    log = labelEntry(log, '1', 'not-abusive', NOW);
    log = appendEntry(log, entry('1', { reasons: ['updated'] }), NOW);
    expect(log.map((e) => e.postId)).toEqual(['1', '2']);
    expect(log[0]).toMatchObject({ reasons: ['updated'], label: 'not-abusive' });
  });

  it('drops entries older than 30 days and caps the size', () => {
    let log = appendEntry([], entry('old', { at: NOW - 31 * DAY }), NOW);
    log = appendEntry(log, entry('new'), NOW);
    expect(log.map((e) => e.postId)).toEqual(['new']);
    for (let i = 0; i < LOG_LIMIT + 10; i++) log = appendEntry(log, entry(`p${i}`), NOW);
    expect(log).toHaveLength(LOG_LIMIT);
  });

  it('exports only labelled posts, without handles, with Hinglish detected', () => {
    expect(toCalibrationPost(entry('1'))).toBeNull();
    expect(toCalibrationPost(entry('1', { label: 'not-abusive' }))).toEqual({
      id: '1',
      text: 'Chup kar bsdk',
      expected: 'clean',
      lang: 'hinglish',
      directed: true,
      account: { ageDays: 3, followers: 4, following: 900, defaultAvatar: true },
    });
    expect(toCalibrationPost(entry('2', { label: 'abusive', text: 'चुप कर', hinglish: true }))?.lang).toBe('hi');
  });

  it('summarises categories, contexts and accounts', () => {
    const log = [entry('1', { label: 'not-abusive' }), entry('2', { categories: ['threat'], handle: 'Other' }), entry('3', { context: 'manual' })];
    expect(reviewStats(log)).toMatchObject({
      hidden: 2,
      labelled: 1,
      notAbusive: 1,
      byCategory: [
        ['obscene', 1],
        ['threat', 1],
      ],
      topAccounts: [
        ['troll_x', 1],
        ['other', 1],
      ],
    });
  });
});

describe('mutes from corrections', () => {
  const options = { count: 3, windowDays: 7, muteFor: '7d' as const };

  it('withdrawing a strike lifts an automatic mute that falls below the count', () => {
    let state: MuteState = { mutes: [], strikes: [] };
    for (const id of ['1', '2', '3']) state = recordStrike(state, { handle: 'troll', postId: id, at: NOW, reasons: [] }, options, NOW).state;
    expect(state.mutes).toHaveLength(1);
    const after = withdrawStrike(state, '2', options);
    expect(after.strikes.map((s) => s.postId)).toEqual(['1', '3']);
    expect(after.mutes).toEqual([]);
  });

  it('keeps manual mutes when a strike is withdrawn', () => {
    let state = addManualMute({ mutes: [], strikes: [] }, '@Troll', 'forever', NOW);
    state = recordStrike(state, { handle: 'troll', postId: '1', at: NOW, reasons: [] }, options, NOW).state;
    const after = withdrawStrike(state, '1', options);
    expect(after.mutes).toMatchObject([{ handle: 'troll', reason: 'manual', expiresAt: null }]);
  });

  it('drops malformed imported entries', () => {
    expect(parseMuteState({ mutes: [{ handle: 'ok', mutedAt: 1, expiresAt: null, reason: 'manual', evidence: [] }, { handle: 42 }], strikes: 'x' })).toEqual({
      mutes: [{ handle: 'ok', mutedAt: 1, expiresAt: null, reason: 'manual', evidence: [] }],
      strikes: [],
    });
  });
});

describe('backup', () => {
  it('round-trips settings and mutes', () => {
    const muteState = addManualMute({ mutes: [], strikes: [] }, 'troll', '30d', NOW);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), allowlist: ['friend'] };
    const result = readBackup(JSON.stringify(makeBackup(settings, muteState, NOW)));
    expect(result).toEqual({ settings, muteState });
  });

  it('rejects files that are not backups', () => {
    expect(readBackup('not json')).toEqual({ error: 'This file isn’t valid JSON.' });
    expect(readBackup('{"settings":{}}')).toEqual({ error: 'This isn’t an Abuse Shield backup.' });
  });
});
