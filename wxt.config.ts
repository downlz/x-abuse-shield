import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { BUNDLED_MODEL_DIR, BUNDLED_MODEL_FILE, LITE_MODEL_ID, MODEL_ID } from './src/adapters/inference/model';
import { ortInPlacePlugin } from './scripts/ort-in-place-plugin';

/**
 * ONNX Runtime's non-minified WebGPU/WASM build, which loads its .mjs/.wasm
 * from env.wasmPaths (public/ort) instead of embedding them in our bundle,
 * and which ortInPlacePlugin can patch reliably.
 */
const ORT_SOURCE = resolve('node_modules/onnxruntime-web/dist/ort.webgpu.mjs');

/**
 * Where the in-place .ort model comes from (see docs/PLAN.md, "Model source"):
 * - bundled: `npm run model:build` output in public/models ships inside the extension (~331 MB);
 *   WXT_BUNDLE_MODEL=false leaves it out.
 * - hosted: WXT_MODEL_URL=https://…/ (a folder laid out like public/models) is downloaded on first use.
 * - otherwise the original .onnx is downloaded from Hugging Face (more memory).
 */
const BUNDLED_MODEL =
  process.env.WXT_BUNDLE_MODEL !== 'false' && existsSync(join('public', BUNDLED_MODEL_DIR, MODEL_ID, BUNDLED_MODEL_FILE));
const MODEL_URL = BUNDLED_MODEL ? '' : (process.env.WXT_MODEL_URL ?? '').replace(/(?<=.)\/?$/, '/');
/**
 * Phones (Firefox for Android) load the trimmed model, LITE_MODEL_ID (`npm run model:trim`): bundled when
 * public/models has it; hosted next to the full model (scripts/release.ts checks the host has both).
 */
const LITE_MODEL = BUNDLED_MODEL
  ? existsSync(join('public', BUNDLED_MODEL_DIR, LITE_MODEL_ID, BUNDLED_MODEL_FILE))
  : !!MODEL_URL && process.env.WXT_LITE_MODEL !== 'false';

const CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      alias: [{ find: /^onnxruntime-web\/webgpu$/, replacement: ORT_SOURCE }],
    },
    plugins: [ortInPlacePlugin(ORT_SOURCE)],
    define: {
      __BUNDLED_MODEL__: JSON.stringify(BUNDLED_MODEL),
      __MODEL_URL__: JSON.stringify(MODEL_URL),
      __LITE_MODEL__: JSON.stringify(LITE_MODEL),
    },
  }),
  zip: {
    // The sources zip (for AMO review) is rebuilt with `npm install` and `npm run model:build`. Like .gitignore,
    // it leaves out generated files and local-only data: real X screenshots, your labelled posts, test results.
    excludeSources: ['public/models/**', 'public/ort/**', 'spike/results/**', 'tests/fixtures/x/*.png', 'calibration/posts.jsonl'],
  },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      if (BUNDLED_MODEL) return;
      const models = `${BUNDLED_MODEL_DIR}`;
      files.splice(0, files.length, ...files.filter((file) => !file.relativeDest.replaceAll('\\', '/').startsWith(models)));
    },
  },
  manifest: ({ browser }) => {
    const common = {
      name: 'X Abuse Shield',
      description: 'On-device multilingual abuse filter for x.com',
    };
    if (browser === 'firefox') {
      // Manifest V2: a persistent background page hosts the model in a Web Worker
      // (Firefox has no offscreen documents). MAIN-world content scripts need Firefox 128.
      return {
        ...common,
        permissions: ['storage', 'unlimitedStorage', 'alarms'],
        content_security_policy: CSP,
        browser_specific_settings: {
          gecko: {
            id: 'x-abuse-shield@local',
            strict_min_version: '128.0',
            data_collection_permissions: { required: ['none'] },
          },
          // The same build runs in Firefox for Android (docs/ANDROID.md); AMO lists it for Android only with this key.
          gecko_android: { strict_min_version: '128.0' },
        },
      };
    }
    return {
      ...common,
      permissions: ['offscreen', 'storage', 'unlimitedStorage', 'alarms'],
      // MV3 forbids remote code: ONNX Runtime's .wasm/.mjs ship inside the
      // extension (public/ort). Model weights are data: shipped or fetched once.
      content_security_policy: { extension_pages: CSP },
      // Cross-origin isolation enables SharedArrayBuffer, which ONNX Runtime
      // needs for multi-threaded inference. (Firefox doesn't offer this to extensions.)
      cross_origin_embedder_policy: { value: 'require-corp' },
      cross_origin_opener_policy: { value: 'same-origin' },
    };
  },
});
