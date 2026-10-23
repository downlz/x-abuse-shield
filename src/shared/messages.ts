import type { CategoryScores } from '@/core/engine/categories';
import type { Strike } from '@/core/mute/mutes';
import type { SpikeProgress, SpikeRunResult, SpikeSample } from '@/spike/types';
import type { SpikeVariant } from '@/spike/variants';
import type { TabHealth } from './health';
import type { ModelStatus } from './model-status';

/** Messages exchanged between extension contexts via runtime.sendMessage. */
export type Message =
  | { type: 'offscreen:ensure' }
  | { type: 'offscreen:close' }
  | { type: 'offscreen:ping' }
  | { type: 'spike:run'; samples: SpikeSample[]; label: string; variant: SpikeVariant }
  | { type: 'spike:progress'; progress: SpikeProgress }
  | { type: 'spike:done'; result: SpikeRunResult }
  | { type: 'spike:error'; error: string }
  /** Content script → background: a post was newly flagged. */
  | { type: 'post:flagged'; strike: Strike }
  /** Content script → background: tab health changed. */
  | { type: 'health'; health: TabHealth }
  /** Options page → background: remove a mute and its strikes. */
  | { type: 'unmute'; handle: string }
  /** Content script → background: score these texts (background checks settings, then asks the offscreen document). */
  | { type: 'model:score'; texts: string[] }
  /** Background → offscreen document. A different type from model:score, which the offscreen document also receives. */
  | { type: 'model:classify'; texts: string[] }
  /** Background → offscreen document: load now (e.g. right after the download is approved). */
  | { type: 'model:load' }
  /** Offscreen document → background. */
  | { type: 'model:status'; status: ModelStatus }
  /** Popup/options → background: load again after an error. */
  | { type: 'model:retry' };

export type Reply = { ok: true } | { ok: false; error: string };

/** 'off': the model is switched off or not approved — word lists only, don't ask again. */
export type ScoreReply = { ok: true; scores: CategoryScores[] } | { ok: false; error: string };

export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
