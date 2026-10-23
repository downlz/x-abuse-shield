import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KEYS,
  loadMuteState,
  loadSettings,
  loadStats,
  localDay,
  saveSettings,
  toMuteState,
  type DailyStats,
} from '@/adapters/storage/extension-storage';
import { migrateSettings } from '@/core/config/migrate';
import type { Settings } from '@/core/config/schema';
import type { MuteState } from '@/core/mute/mutes';

/** Settings from storage, kept live; `update` saves immediately. */
export function useSettings(): [Settings | null, (change: (s: Settings) => Settings) => void] {
  const [settings, setSettings] = useState<Settings | null>(null);
  const current = useRef<Settings | null>(null);
  const show = useCallback((value: Settings) => {
    current.current = value;
    setSettings(value);
  }, []);
  useEffect(() => {
    void loadSettings().then(show);
    return onLocalChange((changes) => {
      const change = changes[KEYS.settings];
      if (change) show(migrateSettings(change.newValue));
    });
  }, [show]);
  const update = useCallback(
    (change: (s: Settings) => Settings) => {
      if (!current.current) return;
      const next = change(structuredClone(current.current));
      show(next);
      void saveSettings(next);
    },
    [show],
  );
  return [settings, update];
}

export function useMuteState(): MuteState | null {
  const [state, setState] = useState<MuteState | null>(null);
  useEffect(() => {
    void loadMuteState().then(setState);
    return onLocalChange((changes) => {
      const change = changes[KEYS.muteState];
      if (change) setState(toMuteState(change.newValue));
    });
  }, []);
  return state;
}

export function useTodayStats(): DailyStats | null {
  const [stats, setStats] = useState<DailyStats | null>(null);
  useEffect(() => {
    const load = () => void loadStats(localDay()).then(setStats);
    load();
    return onLocalChange((changes) => {
      if (changes[KEYS.stats]) load();
    });
  }, []);
  return stats;
}

type Changes = Record<string, { newValue?: unknown }>;

function onLocalChange(listener: (changes: Changes) => void): () => void {
  const handler = (changes: Changes, area: string) => {
    if (area === 'local') listener(changes);
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
