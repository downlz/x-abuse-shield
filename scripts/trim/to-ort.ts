// Converts a trimmed model to ONNX Runtime's .ort format (as scripts/build-model.ts does for the full
// model) and installs it as the phone model in public/models/<LITE_MODEL_ID>/.
//
//   npx tsx scripts/trim/to-ort.ts <folder from trim_vocab.py or quantize.py>
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { BUNDLED_MODEL_FILE, LITE_MODEL_ID, MODEL_ID } from '../../src/adapters/inference/model';

const source = process.argv[2];
if (!source) throw new Error('Pass the trimmed model folder');
const target = join(import.meta.dirname, '..', '..', 'public', 'models', LITE_MODEL_ID);
mkdirSync(target, { recursive: true });

await ort.InferenceSession.create(join(source, 'model_quantized.onnx'), {
  graphOptimizationLevel: 'basic',
  optimizedModelFilePath: join(target, BUNDLED_MODEL_FILE),
  extra: { session: { save_model_format: 'ORT' } },
});
for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) copyFileSync(join(source, file), join(target, file));
const trim = JSON.parse(readFileSync(join(source, 'TRIM.json'), 'utf8')) as { languages: string[]; tokens: number; int8Layers?: boolean };
writeFileSync(
  join(target, 'NOTICE.md'),
  `# ${LITE_MODEL_ID}\n\nFrom https://huggingface.co/${MODEL_ID}, Apache-2.0 licence.\n` +
    `Modified: vocabulary trimmed to ${trim.tokens.toLocaleString('en')} of 256,000 tokens (${trim.languages.join(', ')})` +
    `${trim.int8Layers ? '; transformer layers quantized to int8' : ''}; converted to ONNX Runtime format (${BUNDLED_MODEL_FILE}).\n`,
);
console.log(`Wrote ${target} (${(statSync(join(target, BUNDLED_MODEL_FILE)).size / 1e6).toFixed(0)} MB model)`);
