import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { BUNDLED_MODEL_DIR, BUNDLED_MODEL_FILE, MODEL_ID } from './src/adapters/inference/model';
import { ortInPlacePlugin } from './scripts/ort-in-place-plugin';

/**
 * ONNX Runtime's non-minified WebGPU/WASM build, which loads its .mjs/.wasm
 * from env.wasmPaths (public/ort) instead of embedding them in our bundle,
 * and which ortInPlacePlugin can patch reliably.
 */
const ORT_SOURCE = resolve('node_modules/onnxruntime-web/dist/ort.webgpu.mjs');

/** `npm run model:build` puts the .ort model here; without it the extension downloads the .onnx instead. */
const BUNDLED_MODEL = existsSync(join('public', BUNDLED_MODEL_DIR, MODEL_ID, BUNDLED_MODEL_FILE));

export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: ORT_SOURCE }],
    },
    plugins: [ortInPlacePlugin(ORT_SOURCE)],
    define: { __BUNDLED_MODEL__: JSON.stringify(BUNDLED_MODEL) },
  }),
  manifest: {
    name: 'X Abuse Shield',
    description: 'On-device multilingual abuse filter for x.com',
    permissions: ['offscreen', 'storage', 'unlimitedStorage', 'alarms'],
    // MV3 forbids remote code: ONNX Runtime's .wasm/.mjs ship inside the
    // extension (public/ort). Model weights are data: shipped or fetched once.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Cross-origin isolation enables SharedArrayBuffer, which ONNX Runtime
    // needs for multi-threaded inference.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  },
});
