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

/** Approximate one-time download, shown before asking for approval. */
export const MODEL_DOWNLOAD_MB = 289;

/**
 * Memory while loaded, measured in Chrome (extension process, 60 s idle):
 * +507 MB for the shipped in-place .ort model, +850 MB for the downloaded .onnx.
 */
export const MODEL_MEMORY_MB = __BUNDLED_MODEL__ ? 500 : 850;
