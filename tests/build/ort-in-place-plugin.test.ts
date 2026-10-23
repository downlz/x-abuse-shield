import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { patchOrtSource } from '../../scripts/ort-in-place-plugin';

const source = readFileSync(resolve('node_modules/onnxruntime-web/dist/ort.webgpu.mjs'), 'utf8');

describe('ONNX Runtime in-place patch', () => {
  it('applies to the pinned onnxruntime-web build', () => {
    const patched = patchOrtSource(source);
    expect(patched).toContain('if (options?.extra?.session?.use_ort_model_bytes_for_initializers !== "1") wasm2._free(modelDataOffset);');
    expect(patched).not.toMatch(/new URL\("ort-wasm-simd-threaded[^"]*\.wasm", import\.meta\.url\)/);
  });

  it('fails loudly when onnxruntime-web changes', () => {
    expect(() => patchOrtSource(source.replace('wasm2._free(modelDataOffset);', 'wasm3.free(x);'))).toThrow(/onnxruntime-web changed/);
    expect(() => patchOrtSource('export {}')).toThrow(/onnxruntime-web changed/);
  });
});
