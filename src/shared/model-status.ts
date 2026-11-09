/** Where the AI model stands, kept in storage.session for the popup and options page. */
export type ModelStatus =
  /** Switched off in settings (word lists only). */
  | { state: 'off' }
  /** On, but the user hasn't approved the download yet. */
  | { state: 'needs-download' }
  /** Downloaded and cached; loads when an x.com tab needs it. */
  | { state: 'unloaded' }
  | { state: 'loading'; downloading: boolean; progress: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

export const MODEL_STATUS_KEY = 'modelStatus';
/** Epoch ms of the last classify request, for the idle unload. */
export const MODEL_LAST_USED_KEY = 'modelLastUsed';

/** Phones load the trimmed model when the build has it (adapters/inference/model-runtime.ts usesLiteModel). */
const LITE = __LITE_MODEL__ && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const IN_PLACE = __BUNDLED_MODEL__ || !!__MODEL_URL__;

/** What the model covers, for the model card. */
export const MODEL_LANGUAGES = LITE ? 'English, Hindi, Hinglish, Urdu and Bengali' : '34 languages';

/** Approximate one-time download, shown before asking for approval: model + tokenizer. */
export const MODEL_DOWNLOAD_MB = LITE ? 90 : 289;

/**
 * Memory while loaded, 60 s after scoring. In-place .ort model: Chrome +507 MB (extension process),
 * Firefox +629 MB (all processes, single-threaded), phone model in Firefox +334 MB
 * (scripts/memory-firefox.ts). The .onnx from Hugging Face: +850 MB in Chrome.
 */
export const MODEL_MEMORY_MB = LITE ? 340 : !IN_PLACE ? 850 : import.meta.env.FIREFOX ? 630 : 500;

/** Where this build's model comes from: shipped inside it, a hosted copy's URL, or the original on Hugging Face. */
export const MODEL_SOURCE = __BUNDLED_MODEL__ ? 'bundled' : __MODEL_URL__ || 'huggingface';

/**
 * The user's "Turn on" or "Download" covers one model source. After an update
 * that would download a model they haven't agreed to download (e.g. 0.2.0
 * shipped it, 0.2.1 downloads it), they're asked again.
 */
export function approvalOutdated(model: { downloadApproved: boolean; approvedSource: string }, source: string = MODEL_SOURCE): boolean {
  return model.downloadApproved && source !== 'bundled' && model.approvedSource !== source;
}
