import { migrateSettings } from '@/core/config/migrate';
import type { Settings } from '@/core/config/schema';
import type { MuteState } from '@/core/mute/mutes';

/**
 * chrome.storage.local layout. Content scripts only read; the background
 * service worker is the single writer for mutes, strikes and stats, so
 * concurrent tabs can't lose each other's updates.
 */
export const KEYS = { settings: 'settings', muteState: 'muteState', stats: 'stats' } as const;

export interface DailyStats {
  /** YYYY-MM-DD, local time. */
  day: string;
  flagged: number;
  muted: number;
}

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

export function toMuteState(value: unknown): MuteState {
  const state = value as Partial<MuteState> | undefined;
  return {
    mutes: Array.isArray(state?.mutes) ? state.mutes : [],
    strikes: Array.isArray(state?.strikes) ? state.strikes : [],
  };
}

export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
