import { LITE_MODEL_ID, MODEL_ID, MODEL_IDS, type ModelChoice } from '@/adapters/inference/model';

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
/**
 * DistilBERT model: NOT MEASURED YET — an estimate from its 135 MB of int8 weights, scaled like the toxicity
 * model's (268 MB of weights → +507 MB in Chrome). Measure with scripts/memory-firefox.ts before a release.
 */
const DISTILBERT_CHROME_MB = 300;
const DISTILBERT_FIREFOX_MB = 380;

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

/**
 * The model the extension loads for this choice: phones use the light toxicity model (LITE_MODEL_ID)
 * whatever the setting, when the build has it.
 */
export function activeModelId(choice: ModelChoice): string {
  return LITE ? LITE_MODEL_ID : MODEL_IDS[choice];
}

export function modelInfo(choice: ModelChoice): ModelInfo {
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
 * model they haven't agreed to download (e.g. 0.2.0 shipped it, 0.2.1 downloads it), or switching to the
 * other model, asks again. Up to 0.2.6 an approval named only the source and covered the toxicity model
 * (the lite one on phones), so it still covers those two: updating to 0.3.0 doesn't ask phones again.
 */
export function approvalOutdated(
  model: { downloadApproved: boolean; approvedSource: string; choice: ModelChoice },
  key: string = approvalKey(model.choice),
): boolean {
  if (!model.downloadApproved || key === 'bundled' || model.approvedSource === key) return false;
  const legacy = [MODEL_ID, LITE_MODEL_ID].some((id) => model.approvedSource !== '' && key === `${model.approvedSource}#${id}`);
  return !legacy;
}

/** The user agreed to load (and, if needed, download) the model currently chosen. */
export function modelApproved(model: { downloadApproved: boolean; approvedSource: string; choice: ModelChoice }): boolean {
  return model.downloadApproved && !approvalOutdated(model);
}
