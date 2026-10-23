// Builds the model the extension ships: Horizon-Labs/multilingual-toxicity-small,
// int8, converted to ONNX Runtime's .ort format so it can run in place (the
// weights aren't copied a second time). Writes public/models/<model id>/.
//
//   npm run model:build
//
// The .ort is saved with "basic" graph optimisation so it only uses operators
// the WebAssembly runtime has.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { BUNDLED_MODEL_FILE, MODEL_ID } from '../src/adapters/inference/model';
import { loadToxicityClassifier } from '../src/adapters/inference/toxicity-classifier';

const root = join(import.meta.dirname, '..');
const cacheDir = join(root, '.cache', 'models');
const source = join(cacheDir, MODEL_ID);
const target = join(root, 'public', 'models', MODEL_ID);

if (!existsSync(join(source, 'onnx', 'model_quantized.onnx'))) {
  console.log('Downloading the model from Hugging Face (~300 MB)…');
  await (await loadToxicityClassifier({ cacheDir })).dispose();
}

mkdirSync(target, { recursive: true });
const output = join(target, BUNDLED_MODEL_FILE);
await ort.InferenceSession.create(join(source, 'onnx', 'model_quantized.onnx'), {
  graphOptimizationLevel: 'basic',
  optimizedModelFilePath: output,
  extra: { session: { save_model_format: 'ORT' } },
});
for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) copyFileSync(join(source, file), join(target, file));
writeFileSync(
  join(target, 'NOTICE.md'),
  `# ${MODEL_ID}\n\nFrom https://huggingface.co/${MODEL_ID}, Apache-2.0 licence.\n` +
    `Modified: converted to ONNX Runtime format (${BUNDLED_MODEL_FILE}) from onnx/model_quantized.onnx.\n`,
);
console.log(`Wrote ${output} (${Math.round(statSync(output).size / 1024 / 1024)} MB) and tokenizer files.`);
