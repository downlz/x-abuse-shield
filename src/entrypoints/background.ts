import {
  IDLE_ALARM,
  modelAllowed,
  preload,
  reportStatus,
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
  loadOverrides,
  loadReviewLog,
  loadSettings,
  loadStats,
  localDay,
  saveMuteState,
  saveOverrides,
  saveReviewLog,
  saveSettings,
  saveStats,
} from '@/adapters/storage/extension-storage';
import { migrateSettings } from '@/core/config/migrate';
import { addManualMute, normalizeHandle, recordStrike, unmute, withdrawStrike, type Strike } from '@/core/mute/mutes';
import { appendEntry, labelEntry, type ReviewEntry, type ReviewLabel } from '@/core/review/log';
import { healthKey, type TabHealth } from '@/shared/health';
import { isMessage, type Reply, type ScoreReply } from '@/shared/messages';
import { approvalOutdated } from '@/shared/model-status';

/** Below this, the ~500 MB model is off by default (word lists only). */
const LOW_MEMORY_GB = 4;

// Firefox (Manifest V2): a persistent background page, which owns the model's worker.
export default defineBackground({ persistent: true, main });

function main() {
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
      // Don't start a download the user never agreed to (e.g. updating from a build that shipped the model).
      if (approvalOutdated(settings.model)) settings.model.downloadApproved = false;
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
        void serial(() => onFlagged(message.entry, message.strike, counted));
        return;
      case 'review:label':
        return reply(serial(() => onLabel(message.postId, message.label)));
      case 'review:add-missed':
        return reply(serial(() => onMissed(message.text, message.directed, message.hinglish)));
      case 'review:clear':
        return reply(serial(() => saveReviewLog([])));
      case 'mute:add':
        return reply(
          serial(async () => {
            const settings = await loadSettings();
            await saveMuteState(addManualMute(await loadMuteState(), message.handle, settings.strikes.muteFor, Date.now()));
          }),
        );
      case 'allow:add':
        return reply(
          serial(async () => {
            const settings = await loadSettings();
            const handle = normalizeHandle(message.handle);
            if (!settings.allowlist.some((h) => normalizeHandle(h) === handle)) settings.allowlist.push(handle);
            await saveSettings(settings);
          }),
        );
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
        void reportStatus(message.status);
        return;
      case 'model:retry':
        return reply(preload());
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(healthKey(tabId));
  });
}

async function onFlagged(entry: ReviewEntry, strike: Strike | undefined, counted: Set<string>): Promise<void> {
  const settings = await loadSettings();
  const stats = await loadStats(localDay());
  if (!counted.has(entry.postId)) {
    counted.add(entry.postId);
    stats.flagged++;
  }
  if (strike && settings.strikes.enabled) {
    const { state, newMute } = recordStrike(await loadMuteState(), strike, settings.strikes, Date.now());
    await saveMuteState(state);
    if (newMute) stats.muted++;
  }
  await saveStats(stats);
  await saveReviewLog(appendEntry(await loadReviewLog(), entry, Date.now()));
}

/**
 * "Not abusive" keeps the post visible everywhere, withdraws its strike and
 * lifts an automatic mute that no longer has enough strikes behind it.
 * Changing your mind back to "abusive" hides it again.
 */
async function onLabel(postId: string, label: ReviewLabel | null): Promise<void> {
  const now = Date.now();
  await saveReviewLog(labelEntry(await loadReviewLog(), postId, label ?? undefined, now));
  const overrides = await loadOverrides();
  const notAbusive = overrides.notAbusive.filter((id) => id !== postId);
  if (label === 'not-abusive') {
    notAbusive.push(postId);
    const settings = await loadSettings();
    await saveMuteState(withdrawStrike(await loadMuteState(), postId, settings.strikes));
  }
  await saveOverrides({ notAbusive });
}

/** A post that should have been hidden, so calibration sees misses too. */
async function onMissed(text: string, directed: boolean, hinglish: boolean): Promise<void> {
  const now = Date.now();
  const entry: ReviewEntry = {
    postId: `manual-${now}`,
    handle: '',
    text,
    url: '',
    at: now,
    context: 'manual',
    directed,
    hinglish,
    categories: [],
    severe: false,
    reasons: ['added by you: should have been hidden'],
    wordHits: [],
    label: 'abusive',
    labelledAt: now,
  };
  await saveReviewLog(appendEntry(await loadReviewLog(), entry, now));
}

async function onHealth(tabId: number, health: TabHealth): Promise<void> {
  await browser.storage.session.set({ [healthKey(tabId)]: health });
  const broken = health.dom === 'broken';
  // Manifest V2 (Firefox) calls the toolbar button browserAction.
  const action = browser.action ?? browser.browserAction;
  await action.setBadgeText({ tabId, text: broken ? '!' : '' });
  if (broken) {
    await action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
    await action.setTitle({ tabId, title: "X Abuse Shield can't read posts here — X may have changed its layout" });
  }
}
