import { PRESETS } from '../engine/presets';
import { DEFAULT_SIGNAL_WEIGHTS } from '../signals/suspicion';
import type { Settings } from './schema';

/** Neutral spam markers only — never parties, religions or identities (PLAN §5.1). */
export const SUGGESTED_BIO_KEYWORDS = ['follow back', 'f4f', 'dm for promo', 'dm for paid promotion', 'paid promotion'];

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  enabled: true,
  preset: 'balanced',
  customThresholds: { ...PRESETS.balanced },
  actions: { mild: 'blur', severe: 'collapse', muted: 'collapse' },
  display: { showMatchedWords: false },
  scopes: { forYou: true, following: true, replies: true, notifications: true, focalPost: false },
  lexicon: { en: true, hi: true, hinglish: true, emoji: true, customBlock: [], customAllow: [] },
  allowlist: [],
  exemptFollowing: false,
  strikes: { enabled: true, count: 3, windowDays: 7, muteFor: '7d' },
  signals: { enabled: true, weights: { ...DEFAULT_SIGNAL_WEIGHTS }, bioKeywords: [] },
  coordination: { enabled: true, windowMinutes: 10, minAuthors: 3, hideCleanClusters: false },
  model: { enabled: true, downloadApproved: false, idleMinutes: 5, preBlur: false },
  scoring: {
    nonEnglishOffset: 0.1,
    suspicionOffsets: { medium: 0.1, high: 0.2 },
    floor: 0.45,
    corroboration: { low: 0.4, medium: 0.25 },
    mildWordsRepliesOnly: true,
  },
};
