/**
 * Firefox: the model runs in a Web Worker owned by the background page.
 * Firefox has no offscreen documents, and its Manifest V2 background page
 * stays alive, so the worker does too until it's terminated, which frees all
 * of its memory at once.
 */
import type { ScoreReply } from '@/shared/messages';
import type { ModelRunner, WorkerReply, WorkerRequest } from './model-runner';
import type { ServiceStatus } from './model-service';

const WORKER_PATH = '/model-worker.js';

export function createWorkerRunner(onStatus: (status: ServiceStatus) => void): ModelRunner {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, (reply: ScoreReply) => void>();

  const terminate = (error: string) => {
    worker?.terminate();
    worker = null;
    for (const resolve of pending.values()) resolve({ ok: false, error });
    pending.clear();
  };

  const send = (request: WorkerRequest) => {
    if (!worker) {
      worker = new Worker(browser.runtime.getURL(WORKER_PATH));
      worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.type === 'status') return onStatus(data.status);
        pending.get(data.id)?.(data.reply);
        pending.delete(data.id);
      };
      // The script failed to load, or something threw outside the model service's own error handling.
      worker.onerror = (event) => {
        const message = event.message || "The model couldn't start";
        terminate(message);
        onStatus({ state: 'error', message });
      };
    }
    worker.postMessage(request);
  };

  return {
    classify(texts) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        send({ type: 'classify', id, texts });
      });
    },
    async load() {
      send({ type: 'load' });
    },
    async close() {
      terminate('The model was unloaded');
    },
    async isOpen() {
      return worker !== null;
    },
  };
}
