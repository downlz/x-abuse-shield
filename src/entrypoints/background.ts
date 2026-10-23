import { closeOffscreenDocument, ensureOffscreenDocument } from '@/adapters/inference/offscreen-host';
import {
  loadMuteState,
  loadSettings,
  loadStats,
  localDay,
  saveMuteState,
  saveSettings,
  saveStats,
} from '@/adapters/storage/extension-storage';
import { recordStrike, unmute, type Strike } from '@/core/mute/mutes';
import { healthKey, type TabHealth } from '@/shared/health';
import { isMessage, type Reply } from '@/shared/messages';

export default defineBackground(() => {
  // Single writer: strikes and stats from every tab are applied one at a time,
  // so concurrent tabs can't overwrite each other's updates.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task);
    queue = run.catch((error: unknown) => console.error('X Abuse Shield:', error));
    return run;
  };
  // A post flagged in two tabs counts once in today's stats.
  const counted = new Set<string>();

  browser.runtime.onInstalled.addListener(() => {
    // Writes defaults on first install and fills new keys after an update.
    void serial(async () => saveSettings(await loadSettings()));
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isMessage(message)) return;
    const reply = (task: Promise<void>) => {
      task.then(
        () => sendResponse({ ok: true } satisfies Reply),
        (error: unknown) => sendResponse({ ok: false, error: String(error) } satisfies Reply),
      );
      return true;
    };

    switch (message.type) {
      case 'offscreen:ensure':
        return reply(ensureOffscreenDocument());
      case 'offscreen:close':
        return reply(closeOffscreenDocument());
      case 'post:flagged':
        void serial(() => onFlagged(message.strike, counted));
        return;
      case 'health':
        if (sender.tab?.id !== undefined) void onHealth(sender.tab.id, message.health);
        return;
      case 'unmute':
        return reply(serial(async () => saveMuteState(unmute(await loadMuteState(), message.handle))));
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(healthKey(tabId));
  });
});

async function onFlagged(strike: Strike, counted: Set<string>): Promise<void> {
  const settings = await loadSettings();
  const stats = await loadStats(localDay());
  if (!counted.has(strike.postId)) {
    counted.add(strike.postId);
    stats.flagged++;
  }
  if (settings.strikes.enabled) {
    const { state, newMute } = recordStrike(await loadMuteState(), strike, settings.strikes, Date.now());
    await saveMuteState(state);
    if (newMute) stats.muted++;
  }
  await saveStats(stats);
}

async function onHealth(tabId: number, health: TabHealth): Promise<void> {
  await browser.storage.session.set({ [healthKey(tabId)]: health });
  const broken = health.dom === 'broken';
  await browser.action.setBadgeText({ tabId, text: broken ? '!' : '' });
  if (broken) {
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
    await browser.action.setTitle({ tabId, title: "X Abuse Shield can't read posts here — X may have changed its layout" });
  }
}
