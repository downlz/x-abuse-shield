import { parseMuteState, type MuteState } from '../mute/mutes';
import { migrateSettings } from './migrate';
import type { Settings } from './schema';

/** Settings + mutes as one JSON file, to move between browsers or devices. */
export interface Backup {
  app: 'x-abuse-shield';
  version: 1;
  exportedAt: string;
  settings: Settings;
  muteState: MuteState;
}

export function makeBackup(settings: Settings, muteState: MuteState, now: number): Backup {
  return { app: 'x-abuse-shield', version: 1, exportedAt: new Date(now).toISOString(), settings, muteState };
}

/** Validates an imported file. Unknown or invalid values fall back to defaults, as for stored settings. */
export function readBackup(text: string): { settings: Settings; muteState: MuteState } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'This file isn’t valid JSON.' };
  }
  const backup = data as Partial<Backup> | null;
  if (backup?.app !== 'x-abuse-shield') return { error: 'This isn’t an Abuse Shield backup.' };
  return { settings: migrateSettings(backup.settings), muteState: parseMuteState(backup.muteState) };
}
