import type { Category, CategoryScores } from '../engine/categories';
import type { Strength } from '../lexicon/types';
import type { SuspicionLevel } from '../signals/suspicion';

export type ReviewLabel = 'abusive' | 'not-abusive';

/** Why one post was hidden — everything the review log shows and calibration needs. */
export interface ReviewEntry {
  postId: string;
  /** As written on X, without @. */
  handle: string;
  text: string;
  url: string;
  /** When it was hidden. */
  at: number;
  postedAt?: number;
  /** Where it was seen: for-you, following, thread, notifications; 'manual' for posts you added. */
  context: string;
  directed: boolean;
  lang?: string;
  hinglish: boolean;
  categories: Category[];
  severe: boolean;
  reasons: string[];
  model?: CategoryScores;
  wordHits: { term: string; matched: string; strength: Strength; category: Category }[];
  account?: {
    ageDays?: number;
    followers?: number;
    following?: number;
    defaultAvatar?: boolean;
    blueVerified?: boolean;
    source: 'api' | 'dom';
    level: SuspicionLevel;
    reasons: string[];
  };
  /** Other authors posting the same text. */
  cluster?: { size: number; handles: string[] };
  label?: ReviewLabel;
  labelledAt?: number;
}

export const LOG_LIMIT = 500;
export const LOG_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT_LIMIT = 2000;

/** Newest first. Re-flagging a post updates it but keeps your label. */
export function appendEntry(log: ReviewEntry[], entry: ReviewEntry, now: number): ReviewEntry[] {
  const previous = log.find((e) => e.postId === entry.postId);
  const merged: ReviewEntry = {
    ...entry,
    text: entry.text.slice(0, TEXT_LIMIT),
    label: previous?.label ?? entry.label,
    labelledAt: previous?.labelledAt ?? entry.labelledAt,
  };
  return prune([merged, ...log.filter((e) => e.postId !== entry.postId)], now);
}

export function labelEntry(log: ReviewEntry[], postId: string, label: ReviewLabel | undefined, now: number): ReviewEntry[] {
  return log.map((e) => (e.postId === postId ? { ...e, label, labelledAt: label ? now : undefined } : e));
}

/** Drops entries older than LOG_DAYS (labelled ones too) and keeps at most LOG_LIMIT. */
export function prune(log: ReviewEntry[], now: number): ReviewEntry[] {
  return log.filter((e) => now - e.at <= LOG_DAYS * DAY_MS).slice(0, LOG_LIMIT);
}

/** One line of calibration/posts.jsonl (format: calibration/README.md). Handles are left out. */
export interface CalibrationPost {
  id: string;
  text: string;
  expected: 'abusive' | 'clean';
  lang?: string;
  directed?: boolean;
  note?: string;
  account?: { ageDays?: number; followers?: number; following?: number; defaultAvatar?: boolean; handle?: string; bio?: string };
}

export function toCalibrationPost(entry: ReviewEntry): CalibrationPost | null {
  if (!entry.label) return null;
  const devanagari = /\p{Script=Devanagari}/u.test(entry.text);
  const lang = devanagari ? 'hi' : entry.hinglish ? 'hinglish' : entry.lang;
  const account = entry.account?.source === 'api' ? entry.account : undefined;
  return {
    id: entry.postId,
    text: entry.text,
    expected: entry.label === 'abusive' ? 'abusive' : 'clean',
    lang,
    directed: entry.directed,
    ...(account
      ? { account: { ageDays: account.ageDays, followers: account.followers, following: account.following, defaultAvatar: account.defaultAvatar } }
      : {}),
  };
}

export interface ReviewStats {
  hidden: number;
  labelled: number;
  notAbusive: number;
  byCategory: [Category, number][];
  byContext: [string, number][];
  topAccounts: [string, number][];
}

export function reviewStats(log: ReviewEntry[]): ReviewStats {
  const hidden = log.filter((e) => e.context !== 'manual');
  const tally = <K>(keys: K[]) => {
    const counts = new Map<K, number>();
    keys.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    hidden: hidden.length,
    labelled: hidden.filter((e) => e.label).length,
    notAbusive: hidden.filter((e) => e.label === 'not-abusive').length,
    byCategory: tally(hidden.flatMap((e) => e.categories)),
    byContext: tally(hidden.map((e) => e.context)),
    topAccounts: tally(hidden.map((e) => e.handle.toLowerCase())).slice(0, 5),
  };
}
