/**
 * The shipped .ort model, run in place by ONNX Runtime (browser only). The
 * tokenizer still comes from Transformers.js; only the model session is ours,
 * because Transformers.js loads .onnx files and copies their weights.
 */
import { AutoTokenizer, env, type Tensor } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import type { CategoryScores } from '@/core/engine/categories';
import { BUNDLED_MODEL_FILE, IN_PLACE_SESSION_OPTIONS, MAX_TOKENS, MODEL_ID } from './model';
import { configureWebRuntime, labelOrder, type ToxicityClassifier } from './toxicity-classifier';

export interface BundledOptions {
  /** Where the model folders are, e.g. `chrome-extension://<id>/models/`. */
  modelBaseUrl: string;
  /** Where ONNX Runtime's .mjs/.wasm are, e.g. `chrome-extension://<id>/ort/`. */
  ortBaseUrl: string;
  /** 0–100 while reading the model file. */
  onProgress?: (percent: number) => void;
}

export async function loadBundledClassifier(options: BundledOptions): Promise<ToxicityClassifier> {
  configureWebRuntime(options.ortBaseUrl);
  // Tokenizer files come from the extension, never the network, and aren't copied into the Cache API.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.localModelPath = options.modelBaseUrl;

  const base = `${options.modelBaseUrl}${MODEL_ID}/`;
  const [tokenizer, config, session] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    fetch(`${base}config.json`).then((r) => r.json() as Promise<{ id2label: Record<string, string> }>),
    // The JS copy of the bytes is dropped once ONNX Runtime has them in WebAssembly memory.
    readBytes(`${base}${BUNDLED_MODEL_FILE}`, options.onProgress).then((bytes) =>
      ort.InferenceSession.create(bytes, IN_PLACE_SESSION_OPTIONS),
    ),
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

function toOrt(tensor: Tensor): ort.Tensor {
  return new ort.Tensor('int64', tensor.data as BigInt64Array, tensor.dims);
}

async function readBytes(url: string, onProgress?: (percent: number) => void): Promise<Uint8Array> {
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
