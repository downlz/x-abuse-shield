import { KEYS, loadMuteState, loadOverrides, loadSettings, toMuteState, toOverrides } from '@/adapters/storage/extension-storage';
import { onRecords, type RecordsPayload } from '@/adapters/x-api/bridge';
import { captureFixture, downloadFile } from '@/adapters/x-dom/capture-fixture';
import { muteOnX } from '@/adapters/x-dom/mute-on-x';
import { injectStyles, onPlaceholderAction } from '@/adapters/x-dom/render';
import { X } from '@/adapters/x-dom/selectors';
import { migrateSettings } from '@/core/config/migrate';
import type { Message, ScoreReply } from '@/shared/messages';
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

    const [settings, muteState, overrides] = await Promise.all([loadSettings(), loadMuteState(), loadOverrides()]);
    pipeline = new ContentPipeline(
      {
        doc: document,
        path: () => location.pathname,
        now: Date.now,
        onFlagged: (entry, strike) => send({ type: 'post:flagged', entry, strike }),
        onHealth: (health) => send({ type: 'health', health }),
        classify: async (texts) => {
          const reply = (await browser.runtime.sendMessage({ type: 'model:score', texts } satisfies Message)) as
            | ScoreReply
            | undefined;
          if (reply?.ok) return reply.scores;
          if (reply?.error === 'off') return null;
          throw new Error(reply?.error ?? 'No reply from the background');
        },
      },
      settings,
      muteState,
    );
    early.forEach((payload) => pipeline!.addRecords(payload));
    pipeline.updateOverrides(overrides.notAbusive);

    // `handle` is the account the placeholder is about: the author, a quoted author, or a muted reposter.
    onPlaceholderAction((action, postId, target, handle) => {
      switch (action) {
        case 'show':
          return pipeline!.reveal(postId);
        case 'not-abusive':
          pipeline!.markNotAbusive(postId);
          return send({ type: 'review:label', postId, label: 'not-abusive' });
        case 'mute':
          if (handle) send({ type: 'mute:add', handle });
          return;
        case 'unmute':
          if (handle) send({ type: 'unmute', handle });
          return;
        case 'mute-on-x': {
          const article = target.closest(X.post);
          if (handle && article) void runMuteOnX(article, handle);
          return;
        }
      }
    });
    pipeline.attach();

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const settingsChange = changes[KEYS.settings];
      const muteChange = changes[KEYS.muteState];
      const overridesChange = changes[KEYS.overrides];
      if (settingsChange) pipeline!.updateSettings(migrateSettings(settingsChange.newValue));
      if (muteChange) pipeline!.updateMuteState(toMuteState(muteChange.newValue));
      if (overridesChange) pipeline!.updateOverrides(toOverrides(overridesChange.newValue).notAbusive);
    });

    registerFixtureShortcut();
  },
});

function send(message: Message) {
  // Fails harmlessly when the extension was reloaded under an open tab.
  browser.runtime.sendMessage(message).catch(() => undefined);
}

/** X's own mute, on your click; also mutes here so the posts hide straight away. */
async function runMuteOnX(article: Element, handle: string) {
  const result = await muteOnX(article, handle);
  if (result === 'muted') {
    send({ type: 'mute:add', handle });
    toast(`Muted @${handle} on X`);
  } else if (result === 'menu-open') {
    toast(`Choose “Mute @${handle}” in X’s menu`);
  } else {
    toast(`Couldn’t open X’s menu for this post — use “Mute here” instead`);
  }
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
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'padding:10px 16px;border-radius:8px;background:#1d9bf0;color:#fff;font:14px system-ui,sans-serif;';
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}
