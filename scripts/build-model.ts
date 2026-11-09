// Builds the models the extension runs: gravitee-io/distilbert-multilingual-toxicity-classifier (the default)
// and Horizon-Labs/multilingual-toxicity-small, int8, converted to ONNX Runtime's .ort format so they can run
// in place (the weights aren't copied a second time). Writes public/models/<model id>/.
//
//   npm run model:build                       both
//   npm run model:build -- distilbert         one (distilbert | toxicity)
//
// The .ort is saved with "basic" graph optimisation so it only uses operators
// the WebAssembly runtime has.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { BUNDLED_MODEL_FILE, MODEL_IDS, MODEL_SOURCES, sourceOnnxPath, type ModelChoice } from '../src/adapters/inference/model';
import { loadToxicityClassifier } from '../src/adapters/inference/toxicity-classifier';

const root = join(import.meta.dirname, '..');
const cacheDir = join(root, '.cache', 'models');
const requested = process.argv.slice(2).filter((arg): arg is ModelChoice => arg in MODEL_IDS);
const choices: ModelChoice[] = requested.length > 0 ? requested : ['distilbert', 'toxicity'];

for (const choice of choices) {
  const modelId = MODEL_IDS[choice];
  const source = join(cacheDir, modelId);
  const target = join(root, 'public', 'models', modelId);
  const onnxPath = sourceOnnxPath(modelId);
  const { licence } = MODEL_SOURCES[modelId]!;

  if (!existsSync(join(source, onnxPath))) {
    console.log(`Downloading ${modelId} from Hugging Face…`);
    await (await loadToxicityClassifier({ cacheDir, modelId })).dispose();
  }

  mkdirSync(target, { recursive: true });
  const output = join(target, BUNDLED_MODEL_FILE);
  await ort.InferenceSession.create(join(source, onnxPath), {
    graphOptimizationLevel: 'basic',
    optimizedModelFilePath: output,
    extra: { session: { save_model_format: 'ORT' } },
  });
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) copyFileSync(join(source, file), join(target, file));
  if (licence !== 'Apache-2.0') {
    // OpenRAIL++ asks anyone passing the model on to include its text (and use restrictions).
    const response = await fetch(`https://huggingface.co/${modelId}/resolve/main/LICENSE`);
    if (!response.ok) throw new Error(`Couldn't fetch ${modelId}'s LICENSE (${response.status})`);
    writeFileSync(join(target, 'LICENSE'), Buffer.from(await response.arrayBuffer()));
  }
  writeFileSync(
    join(target, 'NOTICE.md'),
    `# ${modelId}\n\nFrom https://huggingface.co/${modelId}, ${licence} licence${licence === 'Apache-2.0' ? '' : ' (see LICENSE)'}.\n` +
      `Modified: converted to ONNX Runtime format (${BUNDLED_MODEL_FILE}) from ${onnxPath}.\n`,
  );
  console.log(`Wrote ${output} (${Math.round(statSync(output).size / 1024 / 1024)} MB) and tokenizer files.`);
}
