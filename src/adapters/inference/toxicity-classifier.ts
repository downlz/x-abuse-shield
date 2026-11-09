import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  type ProgressCallback,
} from '@huggingface/transformers';
import { CATEGORIES, type Category, type CategoryScores } from '@/core/engine/categories';
import { DISTILBERT_MODEL_ID, MAX_TOKENS, maxBatch, MODEL_DTYPE, MODEL_ID, MODEL_SOURCES, ORT_FILES } from './model';

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
  /** MODEL_ID (default) or DISTILBERT_MODEL_ID. */
  modelId?: string;
  /** ONNX Runtime session settings (memory arena, graph optimisation). */
  sessionOptions?: SessionOptions;
  onProgress?: ProgressCallback;
}

export interface ToxicityClassifier {
  classify(texts: string[]): Promise<CategoryScores[]>;
  dispose(): Promise<void>;
}

/** Points ONNX Runtime at the WebAssembly files shipped in the extension. */
export function configureWebRuntime(ortBaseUrl: string, numThreads?: number): void {
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = {
    mjs: ortBaseUrl + ORT_FILES.mjs,
    wasm: ortBaseUrl + ORT_FILES.wasm,
  };
  // The cached-WASM path re-imports the loader from a blob: URL, which the
  // extension CSP (script-src 'self') rejects. The files are local anyway.
  env.useWasmCache = false;
  if (numThreads) wasm.numThreads = numThreads;
}

export async function loadToxicityClassifier(options: ClassifierOptions = {}): Promise<ToxicityClassifier> {
  if (options.ortBaseUrl) {
    configureWebRuntime(options.ortBaseUrl, options.numThreads);
    env.allowLocalModels = false;
  }
  if (options.cacheDir) env.cacheDir = options.cacheDir;

  const modelId = options.modelId ?? MODEL_ID;
  const source = MODEL_SOURCES[modelId];
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(modelId, { progress_callback: options.onProgress }),
    AutoModelForSequenceClassification.from_pretrained(modelId, {
      dtype: source?.dtype ?? MODEL_DTYPE,
      ...(source && { subfolder: source.subfolder, model_file_name: source.fileName }),
      device: options.ortBaseUrl ? 'wasm' : 'cpu',
      session_options: options.sessionOptions,
      progress_callback: options.onProgress,
    }),
  ]);

  // PretrainedConfig's typings omit id2label, but config.json always has it for classifiers.
  const toScores = scoreMapper(model.config as unknown as ClassifierConfig);

  return {
    async classify(texts) {
      const rows: number[][] = [];
      for (const group of chunks(texts, maxBatch(modelId))) {
        const inputs = tokenizer(group, { padding: true, truncation: true, max_length: MAX_TOKENS });
        const { logits } = await model(inputs);
        rows.push(...(logits.tolist() as number[][]));
      }
      return rows.map(toScores);
    },
    async dispose() {
      await model.dispose();
    },
  };
}

/** The parts of a classifier's config.json that scoreMapper reads. */
export interface ClassifierConfig {
  id2label: Record<string, string>;
  /** single_label_classification: softmax across the outputs; otherwise each output is its own sigmoid. */
  problem_type?: string;
}

/**
 * Turns one row of the model's logits into the engine's categories, failing loudly if the labels drift.
 * - The toxicity model (MODEL_ID): its 7 labels are the categories, each an independent sigmoid.
 * - The DistilBERT model (DISTILBERT_MODEL_ID): `not-toxic` / `toxic`, a softmax. P(toxic) becomes the
 *   toxicity category; the other categories score 0, since that model doesn't say which kind of abuse.
 */
export function scoreMapper(config: ClassifierConfig): (logits: number[]) => CategoryScores {
  const { id2label } = config;
  const labels = Object.keys(id2label)
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => id2label[id]!);
  if (labels.length === CATEGORIES.length && labels.every((label) => CATEGORIES.includes(label as Category))) {
    return (row) => Object.fromEntries(labels.map((label, i) => [label, sigmoid(row[i]!)])) as CategoryScores;
  }
  const toxic = labels.indexOf('toxic');
  if (labels.length === 2 && toxic >= 0 && labels.includes('not-toxic')) {
    const clean = 1 - toxic;
    // Softmax of two: P(toxic) = sigmoid(toxic − not-toxic). A multi-label export would use its own sigmoid.
    return config.problem_type === 'single_label_classification'
      ? (row) => ({ ...NO_SCORES, toxicity: sigmoid(row[toxic]! - row[clean]!) })
      : (row) => ({ ...NO_SCORES, toxicity: sigmoid(row[toxic]!) });
  }
  throw new Error(`Unexpected model labels: ${labels.join(', ')} (${DISTILBERT_MODEL_ID} or ${MODEL_ID} expected)`);
}

/** Splits texts into model calls of at most `size` posts. */
export function chunks<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sigmoid(logit: number): number {
  return 1 / (1 + Math.exp(-logit));
}

const NO_SCORES = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as CategoryScores;
