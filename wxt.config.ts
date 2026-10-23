import { defaultClientConditions } from 'vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      // Use ONNX Runtime's build that loads its .mjs/.wasm from env.wasmPaths
      // (public/ort) instead of embedding them in our bundle. The standalone
      // .mjs is also what its worker threads load.
      conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
    },
  }),
  manifest: {
    name: 'X Abuse Shield',
    description: 'On-device multilingual abuse filter for x.com',
    permissions: ['offscreen', 'storage', 'unlimitedStorage', 'alarms'],
    // MV3 forbids remote code: ONNX Runtime's .wasm/.mjs ship inside the
    // extension (public/ort). Model weights are data and are fetched once.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Cross-origin isolation enables SharedArrayBuffer, which ONNX Runtime
    // needs for multi-threaded inference.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  },
});
