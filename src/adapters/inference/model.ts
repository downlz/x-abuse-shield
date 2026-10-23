export const MODEL_ID = 'Horizon-Labs/multilingual-toxicity-small';

/** int8 weights: onnx/model_quantized.onnx (268 MB). */
export const MODEL_DTYPE = 'q8';

/** The model was trained on sequences of up to 256 tokens. */
export const MAX_TOKENS = 256;

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
