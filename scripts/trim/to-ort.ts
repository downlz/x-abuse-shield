// Converts a trimmed model to ONNX Runtime's .ort format (as scripts/build-model.ts does for the full
// models) and installs it as a phone model in public/models/<target>/. The target comes from the folder's
// TRIM.json: LITE_MODEL_ID (trim_vocab.py, the toxicity model) unless it names another
// (trim_wordpiece.py: DISTILBERT_LITE_MODEL_ID).
//
//   npx tsx scripts/trim/to-ort.ts <folder from trim_vocab.py, quantize.py or trim_wordpiece.py>
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { BUNDLED_MODEL_FILE, LITE_MODEL_ID, MODEL_ID } from '../../src/adapters/inference/model';

const source = process.argv[2];
if (!source) throw new Error('Pass the trimmed model folder');
const trim = JSON.parse(readFileSync(join(source, 'TRIM.json'), 'utf8')) as {
  base?: string;
  target?: string;
  licence?: string;
  baseTokens?: number;
  languages: string[];
  tokens: number;
  int8Layers?: boolean;
};
const base = trim.base ?? MODEL_ID;
const target = trim.target ?? LITE_MODEL_ID;
const licence = trim.licence ?? 'Apache-2.0';
const onnxFile = existsSync(join(source, 'model_quantized.onnx')) ? 'model_quantized.onnx' : 'model.onnx';
const targetDir = join(import.meta.dirname, '..', '..', 'public', 'models', target);
mkdirSync(targetDir, { recursive: true });

await ort.InferenceSession.create(join(source, onnxFile), {
  graphOptimizationLevel: 'basic',
  optimizedModelFilePath: join(targetDir, BUNDLED_MODEL_FILE),
  extra: { session: { save_model_format: 'ORT' } },
});
for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) copyFileSync(join(source, file), join(targetDir, file));
if (existsSync(join(source, 'LICENSE'))) copyFileSync(join(source, 'LICENSE'), join(targetDir, 'LICENSE'));
writeFileSync(
  join(targetDir, 'NOTICE.md'),
  `# ${target}\n\nFrom https://huggingface.co/${base}, ${licence} licence${licence === 'Apache-2.0' ? '' : ' (see LICENSE)'}.\n` +
    `Modified: vocabulary trimmed to ${trim.tokens.toLocaleString('en')} of ${(trim.baseTokens ?? 256_000).toLocaleString('en')} tokens (${trim.languages.join(', ')})` +
    `${trim.int8Layers ? '; transformer layers quantized to int8' : ''}; converted to ONNX Runtime format (${BUNDLED_MODEL_FILE}).\n`,
);
console.log(`Wrote ${targetDir} (${(statSync(join(targetDir, BUNDLED_MODEL_FILE)).size / 1e6).toFixed(0)} MB model)`);
