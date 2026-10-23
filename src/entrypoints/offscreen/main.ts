import { isMessage, type Message, type Reply } from '@/shared/messages';
import { runSpike } from '@/spike/run-spike';

const ortBaseUrl = new URL('/ort/', location.href).href;

function send(message: Message) {
  void browser.runtime.sendMessage(message);
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isMessage(message)) return;

  if (message.type === 'offscreen:ping') {
    sendResponse({ ok: true } satisfies Reply);
    return;
  }

  if (message.type === 'spike:run') {
    sendResponse({ ok: true } satisfies Reply);
    runSpike(message.samples, message.label, message.variant, ortBaseUrl, (progress) =>
      send({ type: 'spike:progress', progress }),
    )
      .then((result) => send({ type: 'spike:done', result }))
      .catch((error: unknown) => send({ type: 'spike:error', error: errorText(error) }));
  }
});

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
}
