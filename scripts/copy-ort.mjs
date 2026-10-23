// Copies the ONNX Runtime WebAssembly build that Transformers.js uses into
// public/ort so it ships inside the extension (MV3 bans loading remote code).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm'));
const outDir = join(import.meta.dirname, '..', 'public', 'ort');

mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(ortDist, file), join(outDir, file));
  console.log(`copied ${file}`);
}
