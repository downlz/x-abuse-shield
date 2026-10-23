import { migrateSettings } from '@/core/config/migrate';
import type { Settings } from '@/core/config/schema';
import { parseMuteState, type MuteState } from '@/core/mute/mutes';
import type { ReviewEntry } from '@/core/review/log';

/**
 * chrome.storage.local layout. Content scripts only read; the background
 * service worker is the single writer for mutes, strikes, stats, the review
 * log and overrides, so concurrent tabs can't lose each other's updates.
 */
export const KEYS = {
  settings: 'settings',
  muteState: 'muteState',
  stats: 'stats',
  reviewLog: 'reviewLog',
  overrides: 'overrides',
} as const;

export interface DailyStats {
  /** YYYY-MM-DD, local time. */
  day: string;
  flagged: number;
  muted: number;
}

/** Your corrections: posts marked "not abusive" stay visible. */
export interface Overrides {
  notAbusive: string[];
}

const OVERRIDES_LIMIT = 2000;

export const EMPTY_MUTE_STATE: MuteState = { mutes: [], strikes: [] };

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEYS.settings);
  return migrateSettings(stored[KEYS.settings]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEYS.settings]: settings });
}

export async function loadMuteState(): Promise<MuteState> {
  const stored = await browser.storage.local.get(KEYS.muteState);
  return toMuteState(stored[KEYS.muteState]);
}

export async function saveMuteState(state: MuteState): Promise<void> {
  await browser.storage.local.set({ [KEYS.muteState]: state });
}

export async function loadStats(today: string): Promise<DailyStats> {
  const stored = (await browser.storage.local.get(KEYS.stats))[KEYS.stats] as DailyStats | undefined;
  return stored?.day === today ? stored : { day: today, flagged: 0, muted: 0 };
}

export async function saveStats(stats: DailyStats): Promise<void> {
  await browser.storage.local.set({ [KEYS.stats]: stats });
}

export async function loadReviewLog(): Promise<ReviewEntry[]> {
  const stored = (await browser.storage.local.get(KEYS.reviewLog))[KEYS.reviewLog];
  return Array.isArray(stored) ? (stored as ReviewEntry[]) : [];
}

export async function saveReviewLog(log: ReviewEntry[]): Promise<void> {
  await browser.storage.local.set({ [KEYS.reviewLog]: log });
}

export async function loadOverrides(): Promise<Overrides> {
  return toOverrides((await browser.storage.local.get(KEYS.overrides))[KEYS.overrides]);
}

export async function saveOverrides(overrides: Overrides): Promise<void> {
  await browser.storage.local.set({ [KEYS.overrides]: { notAbusive: overrides.notAbusive.slice(-OVERRIDES_LIMIT) } });
}

export function toOverrides(value: unknown): Overrides {
  const notAbusive = (value as Partial<Overrides> | undefined)?.notAbusive;
  return { notAbusive: Array.isArray(notAbusive) ? notAbusive.filter((id) => typeof id === 'string') : [] };
}

export function toMuteState(value: unknown): MuteState {
  return parseMuteState(value);
}

export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
