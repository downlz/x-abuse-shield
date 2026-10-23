import type { Strike } from '@/core/mute/mutes';
import type { SpikeProgress, SpikeRunResult, SpikeSample } from '@/spike/types';
import type { SpikeVariant } from '@/spike/variants';
import type { TabHealth } from './health';

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
  | { type: 'unmute'; handle: string };

export type Reply = { ok: true } | { ok: false; error: string };

export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
