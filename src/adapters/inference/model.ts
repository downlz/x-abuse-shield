/** The toxicity model: 7 categories (toxicity, insult, threat …), mmBERT-small. */
export const MODEL_ID = 'Horizon-Labs/multilingual-toxicity-small';

/**
 * The DistilBERT model: one toxic / not-toxic verdict (softmax over 2 outputs), distilbert-base-multilingual-cased
 * fine-tuned on textdetox, 15 languages incl. Hindi and Hinglish. Its `toxic` probability drives the engine's
 * toxicity category (scoreMapper); the other categories score 0. OpenRAIL++ licence.
 */
export const DISTILBERT_MODEL_ID = 'gravitee-io/distilbert-multilingual-toxicity-classifier';

/** The model the user picked in Settings (the default is 'distilbert'). Phones use LITE_MODEL_ID whatever the choice. */
export type ModelChoice = 'distilbert' | 'toxicity';
export const MODEL_IDS: Record<ModelChoice, string> = { distilbert: DISTILBERT_MODEL_ID, toxicity: MODEL_ID };

export interface ModelSource {
  subfolder: string;
  fileName: string;
  dtype: 'q8' | 'fp32';
  licence: string;
  /** Most posts per model call. */
  maxBatch: number;
}

/**
 * Where each model's int8 ONNX file sits in its Hugging Face repo, and its licence. Transformers.js looks for
 * `<subfolder>/<name><dtype suffix>.onnx`; the DistilBERT repo keeps its quantized model at the root.
 * DistilBERT's model.quant.onnx was exported with a batch of 1 baked into its reshapes (batches of 2+ fail
 * in ONNX Runtime), so it scores one post per call; re-exporting from model.safetensors would lift that.
 */
export const MODEL_SOURCES: Record<string, ModelSource> = {
  [MODEL_ID]: { subfolder: 'onnx', fileName: 'model', dtype: 'q8', licence: 'Apache-2.0', maxBatch: Infinity },
  [DISTILBERT_MODEL_ID]: { subfolder: '', fileName: 'model.quant', dtype: 'fp32', licence: 'OpenRAIL++', maxBatch: 1 },
};

/** Most posts per call for this model (the phone model, built from MODEL_ID, batches freely). */
export function maxBatch(modelId: string): number {
  return MODEL_SOURCES[modelId]?.maxBatch ?? Infinity;
}

/** The ONNX file Transformers.js downloads for a model, relative to its repo (e.g. onnx/model_quantized.onnx). */
export function sourceOnnxPath(modelId: string): string {
  const source = MODEL_SOURCES[modelId] ?? MODEL_SOURCES[MODEL_ID]!;
  const name = `${source.fileName}${source.dtype === 'q8' ? '_quantized' : ''}.onnx`;
  return source.subfolder ? `${source.subfolder}/${name}` : name;
}

/**
 * The phone model (Firefox for Android): MODEL_ID with its vocabulary trimmed to English, Hindi,
 * Hinglish, Urdu and Bengali (scripts/trim, `npm run model:trim`). Same folder layout as MODEL_ID's,
 * under this path, bundled or hosted next to it.
 */
export const LITE_MODEL_ID = 'x-abuse-shield/multilingual-toxicity-lite';

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
