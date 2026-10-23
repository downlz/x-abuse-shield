import type { MuteDuration } from '../config/schema';

export interface MuteEntry {
  /** Lowercase handle without @. */
  handle: string;
  mutedAt: number;
  /** Null = forever. */
  expiresAt: number | null;
  reason: 'strikes' | 'manual';
  /** Flagged post ids that led to the mute. */
  evidence: string[];
}

export interface Strike {
  handle: string;
  postId: string;
  at: number;
  reasons: string[];
}

export interface MuteState {
  mutes: MuteEntry[];
  strikes: Strike[];
}

export interface StrikeOptions {
  count: number;
  windowDays: number;
  muteFor: MuteDuration;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATION_MS: Record<MuteDuration, number | null> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  forever: null,
};

/** Accepts stored or imported data; malformed entries are dropped. */
export function parseMuteState(value: unknown): MuteState {
  const state = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof MuteState, unknown>>;
  const mutes = Array.isArray(state.mutes) ? state.mutes.filter(isMuteEntry) : [];
  const strikes = Array.isArray(state.strikes) ? state.strikes.filter(isStrike) : [];
  return { mutes, strikes };
}

function isMuteEntry(value: unknown): value is MuteEntry {
  const m = value as MuteEntry;
  return (
    typeof m?.handle === 'string' &&
    typeof m.mutedAt === 'number' &&
    (m.expiresAt === null || typeof m.expiresAt === 'number') &&
    (m.reason === 'strikes' || m.reason === 'manual') &&
    Array.isArray(m.evidence)
  );
}

function isStrike(value: unknown): value is Strike {
  const s = value as Strike;
  return typeof s?.handle === 'string' && typeof s.postId === 'string' && typeof s.at === 'number' && Array.isArray(s.reasons);
}

export function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}

export function activeMute(mutes: MuteEntry[], handle: string, now: number): MuteEntry | undefined {
  const key = normalizeHandle(handle);
  return mutes.find((m) => m.handle === key && (m.expiresAt === null || m.expiresAt > now));
}

/**
 * Adds a strike (one per post) and mutes the author once they reach
 * `count` strikes within `windowDays`. Expired mutes and old strikes are pruned.
 */
export function recordStrike(
  state: MuteState,
  strike: Strike,
  options: StrikeOptions,
  now: number,
): { state: MuteState; newMute: MuteEntry | null } {
  const handle = normalizeHandle(strike.handle);
  const windowStart = now - options.windowDays * DAY_MS;
  const strikes = state.strikes.filter((s) => s.at >= windowStart);
  if (!strikes.some((s) => s.postId === strike.postId)) strikes.push({ ...strike, handle });
  const mutes = state.mutes.filter((m) => m.expiresAt === null || m.expiresAt > now);

  const own = strikes.filter((s) => s.handle === handle);
  if (own.length < options.count || activeMute(mutes, handle, now)) {
    return { state: { mutes, strikes }, newMute: null };
  }
  const duration = DURATION_MS[options.muteFor];
  const newMute: MuteEntry = {
    handle,
    mutedAt: now,
    expiresAt: duration === null ? null : now + duration,
    reason: 'strikes',
    evidence: own.map((s) => s.postId),
  };
  return { state: { mutes: [...mutes, newMute], strikes }, newMute };
}

/** A mute you asked for (from a hidden post or the "Mute on X" button). */
export function addManualMute(state: MuteState, handle: string, muteFor: MuteDuration, now: number): MuteState {
  const key = normalizeHandle(handle);
  const duration = DURATION_MS[muteFor];
  const mute: MuteEntry = { handle: key, mutedAt: now, expiresAt: duration === null ? null : now + duration, reason: 'manual', evidence: [] };
  return { mutes: [...state.mutes.filter((m) => m.handle !== key), mute], strikes: state.strikes };
}

/**
 * You marked a hidden post "not abusive": its strike goes, and an automatic
 * mute that now has fewer than `count` strikes behind it is lifted.
 */
export function withdrawStrike(state: MuteState, postId: string, options: Pick<StrikeOptions, 'count'>): MuteState {
  const strike = state.strikes.find((s) => s.postId === postId);
  if (!strike) return state;
  const strikes = state.strikes.filter((s) => s.postId !== postId);
  const remaining = strikes.filter((s) => s.handle === strike.handle).length;
  const mutes = state.mutes.filter((m) => !(m.handle === strike.handle && m.reason === 'strikes' && remaining < options.count));
  return { mutes, strikes };
}

export function unmute(state: MuteState, handle: string): MuteState {
  const key = normalizeHandle(handle);
  return {
    mutes: state.mutes.filter((m) => m.handle !== key),
    // Clear strikes too, or the next flagged post would mute them straight back.
    strikes: state.strikes.filter((s) => s.handle !== key),
  };
}
