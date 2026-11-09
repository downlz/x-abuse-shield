// npm run model:trim — builds a phone model end to end:
//   Python environment (.venv-trim) → corpora (.cache/trim) → trim the vocabulary (checked: kept text
//   tokenizes exactly as before) → [int8 layers] → .ort → public/models/<phone model id>/
//
//   npm run model:trim                          the toxicity phone model (LITE_MODEL_ID)
//   npm run model:trim -- analyze               tokens and coverage per language set
//   npm run model:trim -- distilbert            the DistilBERT phone model (DISTILBERT_LITE_MODEL_ID)
//   npm run model:trim -- distilbert analyze    … its tokens and coverage
//   npm run model:trim -- distilbert compare    … its scores against the original, kept and dropped languages
//
// Needs `npm run model:build` first (it downloads the original models into .cache/models) and Python 3.
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(import.meta.dirname, '..', '..');
const venv = join(root, '.venv-trim');
const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const data = join(root, '.cache', 'trim');
/** Languages kept in the toxicity phone model (analyze: Urdu and Bengali add only ~3,000 tokens). */
const LANGUAGES = 'english,hindi,hinglish,urdu,bengali';
/** Languages kept in the DistilBERT phone model; other text skips it (MODEL_COVERAGE in src/adapters/inference/model.ts). */
const DISTILBERT_LANGUAGES = 'english,hindi,hinglish';
const distilbert = process.argv[2] === 'distilbert';
const step = distilbert ? process.argv[3] : process.argv[2];
/** The transformer layers are quantized to int8 too (docs/ANDROID.md, "Phone model"). */
const INT8_LAYERS = true;
const CORPORA = {
  'civil-comments-multilingual.parquet': 'https://huggingface.co/datasets/Horizon-Labs/civil-comments-multilingual/resolve/main/train.parquet',
  'english-to-hinglish.json': 'https://huggingface.co/datasets/findnitai/english-to-hinglish/resolve/main/hinglish_upload_v1.json',
  'cmu-hinglish-dog.parquet': 'https://huggingface.co/datasets/festvox/cmu_hinglish_dog/resolve/main/data/train-00000-of-00001.parquet',
};

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    // npx is a .cmd script on Windows, which only runs through the shell.
    shell: cmd === 'npx' && process.platform === 'win32',
  });

const original = distilbert
  ? join(root, '.cache', 'models', 'gravitee-io', 'distilbert-multilingual-toxicity-classifier', 'model.quant.onnx')
  : join(root, '.cache', 'models', 'Horizon-Labs', 'multilingual-toxicity-small', 'onnx', 'model_quantized.onnx');
if (!existsSync(original)) {
  throw new Error(`Run \`npm run model:build${distilbert ? ' -- distilbert' : ''}\` first: it downloads the original model.`);
}
if (!existsSync(python)) {
  console.log('Creating .venv-trim…');
  run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv]);
  run(python, ['-m', 'pip', 'install', '-q', '-r', join('scripts', 'trim', 'requirements.txt')]);
}
mkdirSync(data, { recursive: true });
for (const [file, url] of Object.entries(CORPORA)) {
  if (existsSync(join(data, file))) continue;
  console.log(`Downloading ${file}…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(join(data, file)));
}

if (distilbert) {
  const script = join('scripts', 'trim', 'trim_wordpiece.py');
  const trimmed = join(data, 'distilbert-lite');
  if (step === 'analyze') run(python, ['-I', script, 'analyze']);
  else if (step === 'compare') run(python, ['-I', script, 'compare', trimmed]);
  else {
    run('npx', ['tsx', join('scripts', 'trim', 'extra-texts.ts')]);
    // The layers are int8 already (MatMulInteger), so there's no quantize step.
    run(python, ['-I', script, 'build', '--languages', DISTILBERT_LANGUAGES, '--extra', join(data, 'extra.txt'), '--out', trimmed]);
    run('npx', ['tsx', join('scripts', 'trim', 'to-ort.ts'), trimmed]);
  }
} else if (step === 'analyze') {
  run(python, ['-I', join('scripts', 'trim', 'trim_vocab.py'), 'analyze']);
} else {
  run('npx', ['tsx', join('scripts', 'trim', 'extra-texts.ts')]);
  const trimmed = join(data, 'lite');
  run(python, ['-I', join('scripts', 'trim', 'trim_vocab.py'), 'build', '--languages', LANGUAGES, '--extra', join(data, 'extra.txt'), '--out', trimmed]);
  let final = trimmed;
  if (INT8_LAYERS) {
    final = join(data, 'lite-int8');
    run(python, ['-I', join('scripts', 'trim', 'quantize.py'), trimmed, final]);
  }
  run('npx', ['tsx', join('scripts', 'trim', 'to-ort.ts'), final]);
}
