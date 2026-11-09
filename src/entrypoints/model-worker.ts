import { createModelService } from '@/adapters/inference/model-runtime';
import type { WorkerReply, WorkerRequest } from '@/adapters/inference/model-runner';

/** The parts of a dedicated worker's global scope used here (the project's types are for pages). */
interface WorkerScope {
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

/**
 * Firefox only: the model service in a Web Worker, started by the background
 * page (adapters/inference/worker-host.ts). Chrome runs the same service in
 * its offscreen document.
 */
export default defineUnlistedScript({
  include: ['firefox'],
  main() {
    const scope = self as unknown as WorkerScope;
    const service = createModelService(location.href, (status) => scope.postMessage({ type: 'status', status }));
    scope.onmessage = ({ data }) => {
      if (data.type === 'load') {
        service.ensureLoaded().catch(() => undefined);
        return;
      }
      service.classify(data.texts).then(
        (scores) => scope.postMessage({ type: 'scores', id: data.id, reply: { ok: true, scores } }),
        (error: unknown) =>
          scope.postMessage({ type: 'scores', id: data.id, reply: { ok: false, error: error instanceof Error ? error.message : String(error) } }),
      );
    };
  },
});
