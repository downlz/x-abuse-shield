import { describe, expect, it } from 'vitest';
import { NEAR_DUPLICATE_BITS } from '@/core/coordination/copy-tracker';
import { fingerprint } from '@/core/coordination/fingerprint';
import { hammingDistance, simhash } from '@/core/coordination/simhash';

const distance = (a: string, b: string) => hammingDistance(simhash(fingerprint(a)!), simhash(fingerprint(b)!));

describe('simhash', () => {
  it('is stable and 64-bit', () => {
    const hash = simhash('you are a disgrace to this country');
    expect(simhash('you are a disgrace to this country')).toEqual(hash);
    expect(hammingDistance(hash, hash)).toBe(0);
    expect(hash.every((half) => Number.isInteger(half) && half >= 0 && half <= 0xffffffff)).toBe(true);
  });

  it.each([
    ['You are a disgrace to this country, pagal', 'You are a total disgrace to this country, pagal'],
    ['Go back to Pakistan you traitor, nobody wants you here', 'Go back to Pakistan traitor, nobody wants you here'],
    ['Bhai tu toh pura bik chuka hai, paise lekar tweet karta hai', 'Bhai tu toh pura bik gaya hai, paise lekar tweet karta hai'],
  ])('near-duplicates are within the threshold: %s', (a, b) => {
    expect(distance(a, b)).toBeLessThanOrEqual(NEAR_DUPLICATE_BITS);
  });

  it.each([
    ['You are a disgrace to this country, pagal', 'This country deserves better leaders than these clowns'],
    ['Go back to Pakistan you traitor, nobody wants you here', 'Nobody wants a war with Pakistan, peace is the way'],
    ['Congratulations on the win, well deserved team', 'Congratulations to the whole team, what a match'],
  ])('unrelated texts on the same topic are not: %s', (a, b) => {
    expect(distance(a, b)).toBeGreaterThan(NEAR_DUPLICATE_BITS);
  });
});
