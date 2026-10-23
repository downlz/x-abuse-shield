import type { PresetName, Thresholds } from '../engine/presets';
import type { SignalWeights } from '../signals/suspicion';

export type Action = 'blur' | 'collapse' | 'remove';
export type MuteDuration = '24h' | '7d' | '30d' | 'forever';

export interface Settings {
  version: 1;
  enabled: boolean;
  preset: PresetName | 'custom';
  /** Used when preset is 'custom'. */
  customThresholds: Thresholds;
  actions: {
    /** Insults, obscenity, identity attacks, sexual content. */
    mild: Action;
    /** Threats and severe toxicity. */
    severe: Action;
    /** Posts by muted authors. */
    muted: Action;
  };
  scopes: {
    forYou: boolean;
    following: boolean;
    replies: boolean;
    notifications: boolean;
    /** The post opened on its own page. */
    focalPost: boolean;
  };
  lexicon: {
    en: boolean;
    hi: boolean;
    hinglish: boolean;
    /** Extra words or phrases, treated as strong insults. */
    customBlock: string[];
    /** Words or phrases that never count, even if built in. */
    customAllow: string[];
  };
  /** Handles (without @) that are never filtered. */
  allowlist: string[];
  strikes: {
    enabled: boolean;
    count: number;
    windowDays: number;
    muteFor: MuteDuration;
  };
  signals: {
    enabled: boolean;
    weights: SignalWeights;
    bioKeywords: string[];
  };
  coordination: {
    enabled: boolean;
    windowMinutes: number;
    minAuthors: number;
    /** Collapse copy-paste clusters even when no copy is abusive. */
    hideCleanClusters: boolean;
  };
  model: {
    /** Score posts with the on-device AI model. */
    enabled: boolean;
    /** The user agreed to the one-time model download (~289 MB). */
    downloadApproved: boolean;
    /** Unload the model after this many idle minutes, freeing ~850 MB. */
    idleMinutes: number;
    /** Blur posts until the model has scored them, so nothing flashes. */
    preBlur: boolean;
  };
  scoring: {
    nonEnglishOffset: number;
    suspicionOffsets: { medium: number; high: number };
    /** Offsets never take a threshold below this (or the preset's own value, if lower). */
    floor: number;
    /** Model toxicity needed before a mild word-list term counts, per suspicion level. */
    corroboration: { low: number; medium: number };
    /**
     * Mild words count only in replies and mentions. Calibration (68 posts):
     * removed 3 of 5 false alarms (friendly swearing, quoting an insult) for 2 misses.
     */
    mildWordsRepliesOnly: boolean;
  };
}
