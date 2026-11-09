/**
 * Chrome: owns the offscreen document that runs the model. MV3 service
 * workers can't spawn the workers ONNX Runtime needs and are killed when
 * idle; an offscreen document lives until we close it.
 */
import type { ScoreReply } from '@/shared/messages';
import type { ModelRunner } from './model-runner';

const OFFSCREEN_PATH = '/offscreen.html';

export const offscreenRunner: ModelRunner = {
  async classify(texts) {
    await ensureOffscreenReady();
    const reply = (await browser.runtime.sendMessage({ type: 'model:classify', texts })) as ScoreReply | undefined;
    return reply ?? { ok: false, error: 'No reply from the model' };
  },
  async load() {
    await ensureOffscreenReady();
    await browser.runtime.sendMessage({ type: 'model:load' });
  },
  close: closeOffscreenDocument,
  isOpen: hasOffscreenDocument,
};

let creating: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS'],
      justification: 'Runs the on-device abuse detection model',
    })
    .finally(() => (creating = null));
  await creating;
}

export async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) await browser.offscreen.closeDocument();
}

/** Creates the document if needed and waits until its message listener is up (its module takes a moment to load). */
export async function ensureOffscreenReady(): Promise<void> {
  await ensureOffscreenDocument();
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const reply = (await browser.runtime.sendMessage({ type: 'offscreen:ping' })) as { ok?: boolean } | undefined;
      if (reply?.ok) return;
    } catch {
      // Listener not registered yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Offscreen document did not respond');
}

export async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}
