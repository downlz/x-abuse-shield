import { PRESETS, type Thresholds } from '../engine/presets';
import { DEFAULT_SETTINGS } from './defaults';
import type { Settings } from './schema';

/**
 * Turns whatever is in storage (nothing, an older version, a hand-edited
 * import) into a complete Settings object. Unknown keys are dropped; missing
 * keys take their defaults.
 */
export function migrateSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  const settings = mergeDefaults(DEFAULT_SETTINGS, stored) as Settings;
  if (!PRESET_VALUES.includes(settings.preset)) settings.preset = DEFAULT_SETTINGS.preset;
  for (const key of ['mild', 'severe', 'muted'] as const) {
    if (!ACTION_VALUES.includes(settings.actions[key])) settings.actions[key] = DEFAULT_SETTINGS.actions[key];
  }
  if (!MUTE_VALUES.includes(settings.strikes.muteFor)) settings.strikes.muteFor = DEFAULT_SETTINGS.strikes.muteFor;
  return settings;
}

const PRESET_VALUES: Settings['preset'][] = ['relaxed', 'balanced', 'strict', 'custom'];
const ACTION_VALUES: Settings['actions']['mild'][] = ['blur', 'collapse', 'remove'];
const MUTE_VALUES: Settings['strikes']['muteFor'][] = ['24h', '7d', '30d', 'forever'];

export function activeThresholds(settings: Settings): Thresholds {
  return settings.preset === 'custom' ? settings.customThresholds : PRESETS[settings.preset];
}

function mergeDefaults(defaults: unknown, value: unknown): unknown {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [...defaults];
  if (isRecord(defaults)) {
    const source = isRecord(value) ? value : {};
    return Object.fromEntries(Object.entries(defaults).map(([key, d]) => [key, mergeDefaults(d, source[key])]));
  }
  // Thresholds may be null ("off"); everything else must match the default's type.
  if (defaults === null || typeof defaults === 'number') {
    return value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : defaults;
  }
  return typeof value === typeof defaults ? value : defaults;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
