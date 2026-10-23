import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  type ProgressCallback,
} from '@huggingface/transformers';
import { CATEGORIES, type Category, type CategoryScores } from '@/core/engine/categories';
import { MAX_TOKENS, MODEL_DTYPE, MODEL_ID, ORT_FILES } from './model';

export type SessionOptions = NonNullable<
  NonNullable<Parameters<typeof AutoModelForSequenceClassification.from_pretrained>[1]>['session_options']
>;

export interface ClassifierOptions {
  /**
   * Base URL of the bundled ONNX Runtime files (browser only), e.g.
   * `chrome-extension://<id>/ort/`. Omit in Node, which uses onnxruntime-node.
   */
  ortBaseUrl?: string;
  /** WASM threads. ONNX Runtime falls back to 1 when not cross-origin isolated. */
  numThreads?: number;
  /** Node only: where downloaded model files are cached. */
  cacheDir?: string;
  /** ONNX Runtime session settings (memory arena, graph optimisation). */
  sessionOptions?: SessionOptions;
  onProgress?: ProgressCallback;
}

export interface ToxicityClassifier {
  classify(texts: string[]): Promise<CategoryScores[]>;
  dispose(): Promise<void>;
}

export async function loadToxicityClassifier(options: ClassifierOptions = {}): Promise<ToxicityClassifier> {
  if (options.ortBaseUrl) {
    const wasm = env.backends.onnx.wasm!;
    wasm.wasmPaths = {
      mjs: options.ortBaseUrl + ORT_FILES.mjs,
      wasm: options.ortBaseUrl + ORT_FILES.wasm,
    };
    // The cached-WASM path re-imports the loader from a blob: URL, which the
    // extension CSP (script-src 'self') rejects. The files are local anyway.
    env.useWasmCache = false;
    env.allowLocalModels = false;
    if (options.numThreads) wasm.numThreads = options.numThreads;
  }
  if (options.cacheDir) env.cacheDir = options.cacheDir;

  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: options.onProgress }),
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: options.ortBaseUrl ? 'wasm' : 'cpu',
      session_options: options.sessionOptions,
      progress_callback: options.onProgress,
    }),
  ]);

  // PretrainedConfig's typings omit id2label, but config.json always has it for classifiers.
  const { id2label } = model.config as unknown as { id2label: Record<string, string> };
  const outputOrder = labelOrder(id2label);

  return {
    async classify(texts) {
      if (texts.length === 0) return [];
      const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: MAX_TOKENS });
      const { logits } = await model(inputs);
      const rows = logits.sigmoid().tolist() as number[][];
      return rows.map((row) => {
        const scores = {} as CategoryScores;
        outputOrder.forEach((category, i) => (scores[category] = row[i]!));
        return scores;
      });
    },
    async dispose() {
      await model.dispose();
    },
  };
}

/** Maps output index → category, failing loudly if the model's labels drift. */
function labelOrder(id2label: Record<string, string>): Category[] {
  const order = Object.keys(id2label)
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => id2label[id] as Category);
  const unknown = order.filter((label) => !CATEGORIES.includes(label));
  if (unknown.length || order.length !== CATEGORIES.length) {
    throw new Error(`Unexpected model labels: ${order.join(', ')}`);
  }
  return order;
}
