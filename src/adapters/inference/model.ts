/** The toxicity model: 7 categories (toxicity, insult, threat …), mmBERT-small. */
export const MODEL_ID = 'Horizon-Labs/multilingual-toxicity-small';

/**
 * The DistilBERT model: one toxic / not-toxic verdict (softmax over 2 outputs), distilbert-base-multilingual-cased
 * fine-tuned on textdetox, 15 languages incl. Hindi and Hinglish. Its `toxic` probability drives the engine's
 * toxicity category (scoreMapper); the other categories score 0. OpenRAIL++ licence.
 */
export const DISTILBERT_MODEL_ID = 'gravitee-io/distilbert-multilingual-toxicity-classifier';

/** The model the user picked in Settings (the default is 'distilbert'). Phones load its PHONE_MODEL_IDS version. */
export type ModelChoice = 'distilbert' | 'toxicity';
export const MODEL_IDS: Record<ModelChoice, string> = { distilbert: DISTILBERT_MODEL_ID, toxicity: MODEL_ID };

/**
 * The toxicity phone model (Firefox for Android): MODEL_ID with its vocabulary trimmed to English, Hindi,
 * Hinglish, Urdu and Bengali and its layers stored as int8 (scripts/trim, `npm run model:trim`). Same folder
 * layout as MODEL_ID's, under this path, bundled or hosted next to it.
 */
export const LITE_MODEL_ID = 'x-abuse-shield/multilingual-toxicity-lite';

/**
 * The DistilBERT phone model: DISTILBERT_MODEL_ID with its vocabulary trimmed to English, Hindi and Hinglish
 * (34,671 of 119,547 tokens; scripts/trim/trim_wordpiece.py, `npm run model:trim -- distilbert`): 71 MB
 * instead of 129 MB, identical scores on text in those languages. Other text is left to the word lists
 * (MODEL_COVERAGE).
 */
export const DISTILBERT_LITE_MODEL_ID = 'x-abuse-shield/distilbert-toxicity-lite';

/** What phones load for each choice, when the build has phone models (wxt.config.ts). */
export const PHONE_MODEL_IDS: Record<ModelChoice, string> = { distilbert: DISTILBERT_LITE_MODEL_ID, toxicity: LITE_MODEL_ID };

export interface ModelSource {
  subfolder: string;
  fileName: string;
  dtype: 'q8' | 'fp32';
  licence: string;
}

/**
 * Where each model's int8 ONNX file sits in its Hugging Face repo, and its licence. Transformers.js looks for
 * `<subfolder>/<name><dtype suffix>.onnx`; the DistilBERT repo keeps its quantized model at the root.
 */
export const MODEL_SOURCES: Record<string, ModelSource> = {
  [MODEL_ID]: { subfolder: 'onnx', fileName: 'model', dtype: 'q8', licence: 'Apache-2.0' },
  [DISTILBERT_MODEL_ID]: { subfolder: '', fileName: 'model.quant', dtype: 'fp32', licence: 'OpenRAIL++' },
};

/**
 * DistilBERT's model.quant.onnx was exported with a batch of 1 baked into its reshapes (batches of 2+ fail in
 * ONNX Runtime), so it and its phone version score one post per call; re-exporting from model.safetensors
 * would lift that. One post per call also means no padding, which suits a phone's single core.
 */
const ONE_POST_PER_CALL = new Set([DISTILBERT_MODEL_ID, DISTILBERT_LITE_MODEL_ID]);

/** Most posts per call for this model. */
export function maxBatch(modelId: string): number {
  return ONE_POST_PER_CALL.has(modelId) ? 1 : Infinity;
}

/** The ONNX file Transformers.js downloads for a model, relative to its repo (e.g. onnx/model_quantized.onnx). */
export function sourceOnnxPath(modelId: string): string {
  const source = MODEL_SOURCES[modelId] ?? MODEL_SOURCES[MODEL_ID]!;
  const name = `${source.fileName}${source.dtype === 'q8' ? '_quantized' : ''}.onnx`;
  return source.subfolder ? `${source.subfolder}/${name}` : name;
}

/**
 * Text a trimmed model can't read. WordPiece has no byte fallback: words in a dropped language fall apart into
 * [UNK] and single letters, and the DistilBERT phone model then calls far too many harmless posts toxic
 * (French, German, Spanish 24–29% of posts, Russian 89%; scripts/trim/trim_wordpiece.py compare). So such
 * posts skip the model and are judged by the word lists, account checks and copy-paste detection alone:
 * - `scripts`: most of the post's letters must be in these scripts (catches Arabic, Cyrillic, CJK, Bengali…).
 * - `skipLangs`: X's language tag for Latin-script languages the model dropped. Skipped unless the word lists
 *   see Hinglish, since X sometimes tags romanised Hindi as another language. Tags X often gives Hinglish
 *   (in, tl, et, ht, cy…) aren't listed.
 * The toxicity phone model keeps BPE's byte fallback and degrades gently instead (1.3–6% of verdicts change,
 * docs/ANDROID.md), so it has no entry.
 */
export interface ModelCoverage {
  scripts: string[];
  skipLangs: string[];
}

export const MODEL_COVERAGE: Record<string, ModelCoverage> = {
  [DISTILBERT_LITE_MODEL_ID]: {
    scripts: ['Latin', 'Devanagari'],
    skipLangs: ['fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 'is', 'pl', 'cs', 'sk', 'sl', 'hr', 'ro', 'hu', 'tr', 'vi', 'lv'],
  },
};

/** int8 weights: onnx/model_quantized.onnx (toxicity 268 MB); DistilBERT's is model.quant.onnx (135 MB, MODEL_SOURCES). */
export const MODEL_DTYPE = 'q8';

/** The model was trained on sequences of up to 256 tokens. */
export const MAX_TOKENS = 256;

/**
 * The same model in ONNX Runtime's .ort format, built by `npm run model:build`
 * into public/models/<MODEL_ID>/ and shipped with the extension. It runs in
 * place: ~294 MB instead of ~657 MB for the .onnx (measured on the same runtime).
 */
export const BUNDLED_MODEL_FILE = 'model.ort';
export const BUNDLED_MODEL_DIR = 'models/';

/**
 * A public copy of public/models that release builds download on first use
 * (scripts/release.ts), so the extension itself stays small.
 */
export const HOSTED_MODEL_URL = 'https://huggingface.co/downlz/x-abuse-shield-model/resolve/main/';

/**
 * Run the weights straight from the .ort bytes (no second copy) and don't
 * keep re-laid-out copies for matrix multiplies (no pre-packing). Measured on
 * the WebAssembly runtime in Node: +294 MB vs +657 MB for the .onnx; scores
 * within 7e-6. `use_ort_model_bytes_for_initializers` needs the ONNX Runtime
 * patch in scripts/ort-in-place-plugin.ts, which keeps those bytes alive.
 */
export const IN_PLACE_SESSION_OPTIONS = {
  extra: {
    session: {
      use_ort_model_bytes_directly: '1',
      use_ort_model_bytes_for_initializers: '1',
      disable_prepacking: '1',
    },
  },
};

/** Transformers.js's default Cache API bucket (env.cacheKey). Read here without importing the library. */
export const MODEL_CACHE_NAME = 'transformers-cache';

/** config.json, tokenizer.json, tokenizer_config.json, onnx/model_quantized.onnx. */
export const MODEL_FILE_COUNT = 4;

/** Model files already downloaded into the Cache API (works in pages and the service worker). */
export async function cachedModelFileCount(modelId = MODEL_ID): Promise<number> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const keys = await cache.keys();
  return keys.filter((request) => request.url.includes(modelId)).length;
}

/** ONNX Runtime build that onnxruntime-web/webgpu (used by Transformers.js) expects. */
export const ORT_FILES = {
  mjs: 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
} as const;
