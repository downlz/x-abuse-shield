import { cachedModelFileCount, MODEL_FILE_COUNT } from '@/adapters/inference/model';
import { ModelService } from '@/adapters/inference/model-service';
import { loadToxicityClassifier } from '@/adapters/inference/toxicity-classifier';
import { isMessage, type Message, type Reply, type ScoreReply } from '@/shared/messages';
import { runSpike } from '@/spike/run-spike';

const ortBaseUrl = new URL('/ort/', location.href).href;

function send(message: Message) {
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

const service = new ModelService(
  async (report) => {
    const downloading = (await cachedModelFileCount()) < MODEL_FILE_COUNT;
    report({ state: 'loading', downloading, progress: 0 });
    let reported = 0;
    return loadToxicityClassifier({
      ortBaseUrl,
      onProgress: (p) => {
        if (p.status !== 'progress_total') return;
        const progress = Math.floor(p.progress);
        if (progress - reported >= 5) {
          reported = progress;
          report({ state: 'loading', downloading, progress });
        }
      },
    });
  },
  (status) => send({ type: 'model:status', status }),
);

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isMessage(message)) return;

  switch (message.type) {
    case 'offscreen:ping':
      sendResponse({ ok: true } satisfies Reply);
      return;
    case 'model:load':
      service.ensureLoaded().catch(() => undefined);
      sendResponse({ ok: true } satisfies Reply);
      return;
    case 'model:classify':
      service.classify(message.texts).then(
        (scores) => sendResponse({ ok: true, scores } satisfies ScoreReply),
        (error: unknown) => sendResponse({ ok: false, error: errorText(error) } satisfies ScoreReply),
      );
      return true;
    case 'spike:run':
      sendResponse({ ok: true } satisfies Reply);
      runSpike(message.samples, message.label, message.variant, ortBaseUrl, (progress) => send({ type: 'spike:progress', progress }))
        .then((result) => send({ type: 'spike:done', result }))
        .catch((error: unknown) => send({ type: 'spike:error', error: errorText(error) }));
      return;
  }
});

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
}
