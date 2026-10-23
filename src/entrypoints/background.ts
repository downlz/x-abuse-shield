import {
  IDLE_ALARM,
  modelAllowed,
  preload,
  restingStatus,
  scoreTexts,
  setModelStatus,
  unload,
  unloadIfIdle,
} from '@/adapters/inference/model-host';
import { closeOffscreenDocument, ensureOffscreenDocument } from '@/adapters/inference/offscreen-host';
import {
  KEYS,
  loadMuteState,
  loadSettings,
  loadStats,
  localDay,
  saveMuteState,
  saveSettings,
  saveStats,
} from '@/adapters/storage/extension-storage';
import { migrateSettings } from '@/core/config/migrate';
import { recordStrike, unmute, type Strike } from '@/core/mute/mutes';
import { healthKey, type TabHealth } from '@/shared/health';
import { isMessage, type Reply, type ScoreReply } from '@/shared/messages';
import { MODEL_STATUS_KEY, type ModelStatus } from '@/shared/model-status';

/** Below this, the ~850 MB model is off by default (word lists only). */
const LOW_MEMORY_GB = 4;

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

  browser.runtime.onInstalled.addListener(({ reason }) => {
    void serial(async () => {
      const settings = await loadSettings();
      const memory = (navigator as { deviceMemory?: number }).deviceMemory;
      if (reason === 'install' && memory !== undefined && memory <= LOW_MEMORY_GB) settings.model.enabled = false;
      // Writes defaults on first install and fills new keys after an update.
      await saveSettings(settings);
      await setModelStatus(restingStatus(settings));
    });
  });
  browser.runtime.onStartup.addListener(() => {
    void loadSettings().then((settings) => setModelStatus(restingStatus(settings)));
  });

  void browser.alarms.create(IDLE_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === IDLE_ALARM) void loadSettings().then((settings) => unloadIfIdle(settings, Date.now()));
  });

  browser.storage.onChanged.addListener((changes, area) => {
    const change = changes[KEYS.settings];
    if (area !== 'local' || !change) return;
    const before = migrateSettings(change.oldValue);
    const after = migrateSettings(change.newValue);
    if (modelAllowed(after) && !modelAllowed(before)) void preload().catch((error: unknown) => console.error(error));
    if (!modelAllowed(after) && modelAllowed(before)) void unload(after);
    if (!modelAllowed(after)) void setModelStatus(restingStatus(after));
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
      case 'model:score':
        loadSettings()
          .then((settings) => scoreTexts(message.texts, settings))
          .then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) } satisfies ScoreReply));
        return true;
      case 'model:status':
        void onModelStatus(message.status);
        return;
      case 'model:retry':
        return reply(preload());
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(healthKey(tabId));
  });
});

async function onModelStatus(status: ModelStatus): Promise<void> {
  // A late "loading" report must not overwrite "off" after the user switched the model off.
  const settings = await loadSettings();
  if (!modelAllowed(settings)) return;
  await browser.storage.session.set({ [MODEL_STATUS_KEY]: status });
}

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
