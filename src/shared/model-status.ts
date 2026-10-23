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
