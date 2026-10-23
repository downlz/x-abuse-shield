/**
 * Background side of the AI model: decides whether it may run, routes score
 * requests to the offscreen document, and unloads it when idle.
 */
import type { Settings } from '@/core/config/schema';
import type { ScoreReply } from '@/shared/messages';
import { MODEL_LAST_USED_KEY, MODEL_STATUS_KEY, type ModelStatus } from '@/shared/model-status';
import { closeOffscreenDocument, ensureOffscreenReady, hasOffscreenDocument } from './offscreen-host';

export const IDLE_ALARM = 'model-idle';

export async function setModelStatus(status: ModelStatus): Promise<void> {
  await browser.storage.session.set({ [MODEL_STATUS_KEY]: status });
}

/** Status while the model isn't in memory. */
export function restingStatus(settings: Settings): ModelStatus {
  if (!settings.model.enabled) return { state: 'off' };
  if (!settings.model.downloadApproved) return { state: 'needs-download' };
  return { state: 'unloaded' };
}

export function modelAllowed(settings: Settings): boolean {
  return settings.model.enabled && settings.model.downloadApproved;
}

export async function scoreTexts(texts: string[], settings: Settings): Promise<ScoreReply> {
  if (!modelAllowed(settings)) return { ok: false, error: 'off' };
  await touch();
  await ensureOffscreenReady();
  const reply = (await browser.runtime.sendMessage({ type: 'model:classify', texts })) as ScoreReply | undefined;
  await touch();
  return reply ?? { ok: false, error: 'No reply from the model' };
}

/** Starts loading (or downloading) now, e.g. right after the user approves the download. */
export async function preload(): Promise<void> {
  await touch();
  await ensureOffscreenReady();
  await browser.runtime.sendMessage({ type: 'model:load' });
}

export async function unload(settings: Settings): Promise<void> {
  await closeOffscreenDocument();
  await setModelStatus(restingStatus(settings));
}

/** Frees ~850 MB once no tab has asked for a score in `idleMinutes`. */
export async function unloadIfIdle(settings: Settings, now: number): Promise<void> {
  if (!(await hasOffscreenDocument())) return;
  const lastUsed = (await browser.storage.session.get(MODEL_LAST_USED_KEY))[MODEL_LAST_USED_KEY] as number | undefined;
  if (lastUsed !== undefined && now - lastUsed < settings.model.idleMinutes * 60_000) return;
  await unload(settings);
}

async function touch(): Promise<void> {
  await browser.storage.session.set({ [MODEL_LAST_USED_KEY]: Date.now() });
}
