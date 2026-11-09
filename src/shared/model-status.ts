import { MODEL_IDS, PHONE_MODEL_IDS, type ModelChoice } from '@/adapters/inference/model';

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

/** Phones load the trimmed models when the build has them (wxt.config.ts). */
const LITE = __LITE_MODEL__ && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const IN_PLACE = __BUNDLED_MODEL__ || !!__MODEL_URL__;
/**
 * DistilBERT model in Chrome: not measured yet — scaled from Firefox, where it takes about half the toxicity
 * model's memory (below), and the toxicity model's +507 MB in Chrome.
 */
const DISTILBERT_CHROME_MB = 300;
/** Measured 2026-11-09 (scripts/memory-firefox.ts, Firefox 159, all processes): +348 MB; toxicity +656 MB the same day. */
const DISTILBERT_FIREFOX_MB = 350;
/** DistilBERT phone model: model.ort 70.5 MB + tokenizer 0.6 MB. */
const DISTILBERT_LITE_DOWNLOAD_MB = 71;
/**
 * Firefox with phone settings (memory-firefox.ts --phone), three runs: +140, +249, +254 MB; the toxicity phone
 * model's +193, +199, +354 MB on the same runs. Firefox varies by ±100 MB between identical runs; on one
 * runtime in Node the DistilBERT phone model takes ~160 MB, the toxicity one ~195 MB.
 */
const DISTILBERT_LITE_PHONE_MB = 250;

/** What each model catches and costs, for the model card and settings. */
export interface ModelInfo {
  name: string;
  catches: string;
  languages: string;
  /** Approximate one-time download, shown before asking for approval: model + tokenizer. */
  downloadMB: number;
  /** Memory while loaded, 60 s after scoring (scripts/memory-firefox.ts, docs/SPIKE-REPORT.md). */
  memoryMB: number;
}

/** The model the extension loads for this choice: on phones, its trimmed version (PHONE_MODEL_IDS), when the build has them. */
export function activeModelId(choice: ModelChoice): string {
  return (LITE ? PHONE_MODEL_IDS : MODEL_IDS)[choice];
}

export function modelInfo(choice: ModelChoice): ModelInfo {
  if (LITE && choice === 'distilbert') {
    return {
      name: 'Light DistilBERT (phones)',
      catches: 'toxic posts — insults, threats, obscenity and hate — as one toxicity score',
      languages: 'English, Hindi and Hinglish',
      downloadMB: DISTILBERT_LITE_DOWNLOAD_MB,
      memoryMB: DISTILBERT_LITE_PHONE_MB,
    };
  }
  if (LITE) {
    return {
      name: 'Light toxicity model (phones)',
      catches: 'insults without swear words, veiled threats and abuse',
      languages: 'English, Hindi, Hinglish, Urdu and Bengali',
      downloadMB: 90,
      memoryMB: 340,
    };
  }
  if (choice === 'distilbert') {
    return {
      name: 'DistilBERT',
      catches: 'toxic posts — insults, threats, obscenity and hate — as one toxicity score',
      languages: '15 languages including Hindi and Hinglish',
      downloadMB: 140,
      memoryMB: import.meta.env.FIREFOX ? DISTILBERT_FIREFOX_MB : DISTILBERT_CHROME_MB,
    };
  }
  // In-place .ort: Chrome +507 MB (extension process), Firefox +629 MB (all processes, single-threaded);
  // the .onnx from Hugging Face: +850 MB in Chrome.
  return {
    name: 'Toxicity',
    catches: 'insults without swear words, veiled threats and abuse',
    languages: '34 languages',
    downloadMB: 289,
    memoryMB: !IN_PLACE ? 850 : import.meta.env.FIREFOX ? 630 : 500,
  };
}

/** Where this build's model comes from: shipped inside it, a hosted copy's URL, or the original on Hugging Face. */
export const MODEL_SOURCE = __BUNDLED_MODEL__ ? 'bundled' : __MODEL_URL__ || 'huggingface';

/** What a "Download" approval covers: one model, from one place. Bundled models download nothing. */
export function approvalKey(choice: ModelChoice, source: string = MODEL_SOURCE): string {
  return source === 'bundled' ? 'bundled' : `${source}#${activeModelId(choice)}`;
}

/**
 * The user's "Turn on" or "Download" covers one model from one source. An update that would download a
 * model they haven't agreed to download (e.g. 0.2.0 shipped it, 0.2.1 downloads it; 0.3.0 makes DistilBERT
 * the default), or switching to the other model, asks again.
 */
export function approvalOutdated(
  model: { downloadApproved: boolean; approvedSource: string; choice: ModelChoice },
  key: string = approvalKey(model.choice),
): boolean {
  return model.downloadApproved && key !== 'bundled' && model.approvedSource !== key;
}

/** The user agreed to load (and, if needed, download) the model currently chosen. */
export function modelApproved(model: { downloadApproved: boolean; approvedSource: string; choice: ModelChoice }): boolean {
  return model.downloadApproved && !approvalOutdated(model);
}
