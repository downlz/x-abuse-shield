import type { Plugin } from 'vite';

/**
 * Two edits to onnxruntime-web's non-minified build (ort.webgpu.mjs). The build
 * fails if a new onnxruntime-web version changes either spot, rather than
 * shipping a model that reads freed memory.
 *
 * 1. Keep the model bytes for in-place sessions. onnxruntime-web frees the
 *    model bytes once a session exists. That's fine for `use_ort_model_bytes_directly`
 *    (it sets that on every session; the bytes are only needed during creation),
 *    but `use_ort_model_bytes_for_initializers` makes the session read its
 *    weights from those bytes for its whole life. For such sessions the free
 *    is skipped; the memory goes when the offscreen document closes.
 *
 * 2. Drop dead `new URL("…wasm", import.meta.url)` references inside an
 *    `if (false)` block, which would make Vite copy four unused WebAssembly
 *    builds (~82 MB) into the extension. The files come from env.wasmPaths.
 */
export const ORT_FREE_CALL = 'wasm2._free(modelDataOffset);';
const KEEP_FOR_INITIALIZERS = `if (options?.extra?.session?.use_ort_model_bytes_for_initializers !== "1") ${ORT_FREE_CALL}`;
const DEAD_WASM_URLS = /wasm: false \? new URL\("ort-wasm-simd-threaded\.jsep\.wasm", import\.meta\.url\)\.href : [^\n]*\n/g;

export function patchOrtSource(code: string): string {
  const fail = (what: string) => {
    throw new Error(`onnxruntime-web changed: ${what} (scripts/ort-in-place-plugin.ts)`);
  };
  if (!code.includes('createSession = async (modelData, options)') || code.split(ORT_FREE_CALL).length !== 2) {
    fail('the in-place model loading patch no longer applies');
  }
  if ((code.match(DEAD_WASM_URLS) ?? []).length !== 1) fail('the unused WebAssembly URL references moved');
  return code.replace(ORT_FREE_CALL, KEEP_FOR_INITIALIZERS).replace(DEAD_WASM_URLS, 'wasm: undefined\n');
}

export function ortInPlacePlugin(ortSourcePath: string): Plugin {
  const target = ortSourcePath.replaceAll('\\', '/');
  return {
    name: 'ort-in-place-model-bytes',
    enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/') !== target) return null;
      return { code: patchOrtSource(code), map: null };
    },
  };
}
