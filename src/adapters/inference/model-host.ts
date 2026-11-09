/**
 * Background side of the AI model: decides whether it may run, routes score
 * requests to where it runs (Chrome's offscreen document, Firefox's worker),
 * and unloads it when idle.
 */
import { loadSettings } from '@/adapters/storage/extension-storage';
import type { Settings } from '@/core/config/schema';
import type { ScoreReply } from '@/shared/messages';
import { activeModelId, MODEL_LAST_USED_KEY, MODEL_STATUS_KEY, modelApproved, type ModelStatus } from '@/shared/model-status';
import type { ModelRunner } from './model-runner';
import { offscreenRunner } from './offscreen-host';
import { createWorkerRunner } from './worker-host';

export const IDLE_ALARM = 'model-idle';

const runner: ModelRunner = import.meta.env.FIREFOX ? createWorkerRunner((status) => void reportStatus(status)) : offscreenRunner;

export async function setModelStatus(status: ModelStatus): Promise<void> {
  await browser.storage.session.set({ [MODEL_STATUS_KEY]: status });
}

/** A status from the model itself. A late "loading" must not overwrite "off" after the user switched the model off. */
export async function reportStatus(status: ModelStatus): Promise<void> {
  if (!modelAllowed(await loadSettings())) return;
  await setModelStatus(status);
}

/** Status while the model isn't in memory. */
export function restingStatus(settings: Settings): ModelStatus {
  if (!settings.model.enabled) return { state: 'off' };
  if (!modelApproved(settings.model)) return { state: 'needs-download' };
  return { state: 'unloaded' };
}

export function modelAllowed(settings: Settings): boolean {
  return settings.model.enabled && modelApproved(settings.model);
}

export async function scoreTexts(texts: string[], settings: Settings): Promise<ScoreReply> {
  if (!modelAllowed(settings)) return { ok: false, error: 'off' };
  await touch();
  const reply = await runner.classify(texts, activeModelId(settings.model.choice));
  await touch();
  return reply;
}

/** Starts loading (or downloading) now, e.g. right after the user approves the download. */
export async function preload(settings: Settings): Promise<void> {
  await touch();
  await runner.load(activeModelId(settings.model.choice));
}

export async function unload(settings: Settings): Promise<void> {
  await runner.close();
  await setModelStatus(restingStatus(settings));
}

/** Frees the model's memory once no tab has asked for a score in `idleMinutes`. */
export async function unloadIfIdle(settings: Settings, now: number): Promise<void> {
  if (!(await runner.isOpen())) return;
  const lastUsed = (await browser.storage.session.get(MODEL_LAST_USED_KEY))[MODEL_LAST_USED_KEY] as number | undefined;
  if (lastUsed !== undefined && now - lastUsed < settings.model.idleMinutes * 60_000) return;
  await unload(settings);
}

async function touch(): Promise<void> {
  await browser.storage.session.set({ [MODEL_LAST_USED_KEY]: Date.now() });
}
