/**
 * Owns the offscreen document that runs the model. MV3 service workers can't
 * spawn the workers ONNX Runtime needs and are killed when idle; an offscreen
 * document lives until we close it.
 */
const OFFSCREEN_PATH = '/offscreen.html';

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

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}
