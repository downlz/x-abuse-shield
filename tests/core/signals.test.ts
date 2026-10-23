import { describe, expect, it } from 'vitest';
import { assessAccount, DEFAULT_SIGNAL_WEIGHTS, GENERATED_HANDLE, type AccountRecord } from '@/core/signals/suspicion';

const NOW = Date.parse('2026-10-23T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const options = { weights: DEFAULT_SIGNAL_WEIGHTS, bioKeywords: ['follow back'] };

describe('assessAccount', () => {
  it('rates a 9-day-old, 12-follower account with a default avatar as high', () => {
    const account: AccountRecord = { handle: 'troll_x', createdAt: NOW - 9 * DAY, followers: 12, following: 40, defaultAvatar: true, source: 'api' };
    const result = assessAccount(account, options, NOW);
    expect(result.level).toBe('high');
    expect(result.score).toBe(0.7);
    expect(result.reasons).toEqual(['account 9 days old', '12 followers', 'default avatar']);
  });

  it('rates an established account as low', () => {
    const account: AccountRecord = { handle: 'priya_runs', createdAt: NOW - 3000 * DAY, followers: 3400, following: 500, source: 'api' };
    expect(assessAccount(account, options, NOW)).toMatchObject({ level: 'low', score: 0, reasons: [] });
  });

  it('counts follow ratio and bio keywords', () => {
    const account: AccountRecord = {
      handle: 'spam',
      createdAt: NOW - 400 * DAY,
      followers: 60,
      following: 1200,
      bio: 'Follow back guaranteed',
      source: 'api',
    };
    const result = assessAccount(account, options, NOW);
    expect(result.reasons).toEqual(['follows 20× more accounts than follow it', 'bio mentions “follow back”']);
    expect(result.level).toBe('medium');
  });

  it('caps page-only records at medium', () => {
    const account: AccountRecord = { handle: 'rahul48213977', defaultAvatar: true, source: 'dom' };
    expect(assessAccount(account, { ...options, weights: { ...DEFAULT_SIGNAL_WEIGHTS, defaultAvatar: 0.5 } }, NOW).level).toBe('medium');
  });
});

describe('GENERATED_HANDLE', () => {
  it.each([
    ['Srihars47664037', true],
    ['Craig78510930', true],
    ['rahul48213977', true],
    ['Sirius_091283', false],
    ['Harshsingh6191', false],
    ['BrotherWest1', false],
    ['priya_runs', false],
  ])('%s → %s', (handle, expected) => {
    expect(GENERATED_HANDLE.test(handle)).toBe(expected);
  });
});
