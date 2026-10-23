export const MODEL_ID = 'Horizon-Labs/multilingual-toxicity-small';

/** int8 weights: onnx/model_quantized.onnx (268 MB). */
export const MODEL_DTYPE = 'q8';

/** The model was trained on sequences of up to 256 tokens. */
export const MAX_TOKENS = 256;

/** ONNX Runtime build that onnxruntime-web/webgpu (used by Transformers.js) expects. */
export const ORT_FILES = {
  mjs: 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
} as const;
