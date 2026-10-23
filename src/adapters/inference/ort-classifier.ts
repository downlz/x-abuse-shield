/**
 * The in-place .ort model, run by ONNX Runtime (browser only). The tokenizer
 * still comes from Transformers.js; only the model session is ours, because
 * Transformers.js loads .onnx files and copies their weights.
 */
import { AutoTokenizer, env, type Tensor } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import type { CategoryScores } from '@/core/engine/categories';
import { BUNDLED_MODEL_FILE, IN_PLACE_SESSION_OPTIONS, MAX_TOKENS, MODEL_ID } from './model';
import { configureWebRuntime, labelOrder, type ToxicityClassifier } from './toxicity-classifier';

/** Cache API bucket for a hosted .ort model (the tokenizer goes in Transformers.js's own cache). */
export const IN_PLACE_CACHE = 'x-abuse-shield-model';

export interface InPlaceOptions {
  /**
   * Folder holding `<model id>/model.ort` and the tokenizer files:
   * `chrome-extension://<id>/models/` when bundled, or a hosted `https://…/`.
   */
  modelBaseUrl: string;
  /** Hosted: download once and keep in the Cache API. Bundled: read from the extension. */
  remote: boolean;
  /** Where ONNX Runtime's .mjs/.wasm are, e.g. `chrome-extension://<id>/ort/`. */
  ortBaseUrl: string;
  /** 0–100 while reading or downloading the model file. */
  onProgress?: (percent: number) => void;
}

export async function loadInPlaceClassifier(options: InPlaceOptions): Promise<ToxicityClassifier> {
  configureWebRuntime(options.ortBaseUrl);
  if (options.remote) {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    env.remoteHost = options.modelBaseUrl;
    env.remotePathTemplate = '{model}/';
  } else {
    // Tokenizer files come from the extension, never the network, and aren't copied into the Cache API.
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    env.localModelPath = options.modelBaseUrl;
  }

  const base = `${options.modelBaseUrl}${MODEL_ID}/`;
  const read = (file: string, onProgress?: (percent: number) => void) =>
    options.remote ? readCached(`${base}${file}`, onProgress) : readBytes(`${base}${file}`, onProgress);
  const [tokenizer, config, session] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    read('config.json').then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as { id2label: Record<string, string> }),
    // The JS copy of the bytes is dropped once ONNX Runtime has them in WebAssembly memory.
    read(BUNDLED_MODEL_FILE, options.onProgress).then((bytes) => ort.InferenceSession.create(bytes, IN_PLACE_SESSION_OPTIONS)),
  ]);
  const order = labelOrder(config.id2label);

  return {
    async classify(texts) {
      if (texts.length === 0) return [];
      const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: MAX_TOKENS });
      const { logits } = await session.run({
        input_ids: toOrt(inputs.input_ids as Tensor),
        attention_mask: toOrt(inputs.attention_mask as Tensor),
      });
      const data = logits!.data as Float32Array;
      const width = Number(logits!.dims[1]);
      return texts.map((_, row) => {
        const scores = {} as CategoryScores;
        order.forEach((category, i) => (scores[category] = 1 / (1 + Math.exp(-data[row * width + i]!))));
        return scores;
      });
    },
    async dispose() {
      await session.release();
    },
  };
}

/** Whether a hosted model has already been downloaded. */
export async function hostedModelCached(modelBaseUrl: string): Promise<boolean> {
  const cache = await caches.open(IN_PLACE_CACHE);
  return !!(await cache.match(`${modelBaseUrl}${MODEL_ID}/${BUNDLED_MODEL_FILE}`));
}

function toOrt(tensor: Tensor): ort.Tensor {
  return new ort.Tensor('int64', tensor.data as BigInt64Array, tensor.dims);
}

/** From the Cache API if downloaded before; otherwise downloads it and keeps a copy. */
async function readCached(url: string, onProgress?: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await caches.open(IN_PLACE_CACHE);
  const cached = await cache.match(url);
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const bytes = await readBytes(url, onProgress);
  await cache.put(url, new Response(bytes));
  return bytes;
}

async function readBytes(url: string, onProgress?: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't read the model (${response.status})`);
  const total = Number(response.headers.get('content-length'));
  if (!response.body || !total || !onProgress) return new Uint8Array(await response.arrayBuffer());
  const bytes = new Uint8Array(total);
  const reader = response.body.getReader();
  let loaded = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    if (loaded + chunk.value.byteLength > total) throw new Error('The model file is larger than its declared size');
    bytes.set(chunk.value, loaded);
    loaded += chunk.value.byteLength;
    onProgress(Math.floor((loaded / total) * 100));
  }
  return bytes;
}
