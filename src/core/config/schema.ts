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
  scoring: {
    nonEnglishOffset: number;
    suspicionOffsets: { medium: number; high: number };
    /** Offsets never take a threshold below this (or the preset's own value, if lower). */
    floor: number;
    /** Model toxicity needed before a mild word-list term counts, per suspicion level. */
    corroboration: { low: number; medium: number };
  };
}
