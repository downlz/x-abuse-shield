export const MODEL_ID = 'Horizon-Labs/multilingual-toxicity-small';

/**
 * The phone model (Firefox for Android): MODEL_ID with its vocabulary trimmed to English, Hindi,
 * Hinglish, Urdu and Bengali (scripts/trim, `npm run model:trim`). Same folder layout as MODEL_ID's,
 * under this path, bundled or hosted next to it.
 */
export const LITE_MODEL_ID = 'x-abuse-shield/multilingual-toxicity-lite';

/** int8 weights: onnx/model_quantized.onnx (268 MB). */
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
export async function cachedModelFileCount(): Promise<number> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const keys = await cache.keys();
  return keys.filter((request) => request.url.includes(MODEL_ID)).length;
}

/** ONNX Runtime build that onnxruntime-web/webgpu (used by Transformers.js) expects. */
export const ORT_FILES = {
  mjs: 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
} as const;
