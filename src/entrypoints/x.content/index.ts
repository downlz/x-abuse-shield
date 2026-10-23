import { KEYS, loadMuteState, loadSettings, toMuteState } from '@/adapters/storage/extension-storage';
import { onRecords, type RecordsPayload } from '@/adapters/x-api/bridge';
import { captureFixture, downloadFile } from '@/adapters/x-dom/capture-fixture';
import { injectStyles, onShowClick } from '@/adapters/x-dom/render';
import { migrateSettings } from '@/core/config/migrate';
import type { Message } from '@/shared/messages';
import { ContentPipeline } from './pipeline';

export default defineContentScript({
  matches: ['https://x.com/*'],
  // Early, so the record listener exists before X's first API response.
  runAt: 'document_start',
  async main() {
    let pipeline: ContentPipeline | null = null;
    const early: RecordsPayload[] = [];
    onRecords((payload) => (pipeline ? pipeline.addRecords(payload) : early.push(payload)));
    injectStyles();

    const [settings, muteState] = await Promise.all([loadSettings(), loadMuteState()]);
    pipeline = new ContentPipeline(
      {
        doc: document,
        path: () => location.pathname,
        now: Date.now,
        onFlagged: (strike) => send({ type: 'post:flagged', strike }),
        onHealth: (health) => send({ type: 'health', health }),
      },
      settings,
      muteState,
    );
    early.forEach((payload) => pipeline!.addRecords(payload));
    onShowClick((postId) => pipeline!.reveal(postId));
    pipeline.attach();

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const settingsChange = changes[KEYS.settings];
      const muteChange = changes[KEYS.muteState];
      if (settingsChange) pipeline!.updateSettings(migrateSettings(settingsChange.newValue));
      if (muteChange) pipeline!.updateMuteState(toMuteState(muteChange.newValue));
    });

    registerFixtureShortcut();
  },
});

function send(message: Message) {
  // Fails harmlessly when the extension was reloaded under an open tab.
  browser.runtime.sendMessage(message).catch(() => undefined);
}

/** Dev tool: Alt+Shift+S saves the visible timeline as a test fixture. */
function registerFixtureShortcut() {
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(event.altKey && event.shiftKey && event.code === 'KeyS')) return;
      event.preventDefault();
      const fixture = captureFixture();
      if (!fixture) return toast('Fixture capture: main column not found');
      downloadFile(fixture.filename, fixture.html);
      toast(`Saved ${fixture.filename} (${fixture.posts} posts)`);
    },
    { capture: true },
  );
}

function toast(text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'padding:10px 16px;border-radius:8px;background:#1d9bf0;color:#fff;font:14px system-ui,sans-serif;';
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}
