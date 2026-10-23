import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { activeThresholds, migrateSettings } from '@/core/config/migrate';
import { PRESETS } from '@/core/engine/presets';

describe('migrateSettings', () => {
  it('returns defaults for empty storage', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing keys and keeps valid ones', () => {
    const settings = migrateSettings({ enabled: false, scopes: { forYou: false } });
    expect(settings.enabled).toBe(false);
    expect(settings.scopes).toEqual({ ...DEFAULT_SETTINGS.scopes, forYou: false });
    expect(settings.coordination).toEqual(DEFAULT_SETTINGS.coordination);
  });

  it('replaces invalid values with defaults', () => {
    const settings = migrateSettings({
      preset: 'extreme',
      actions: { mild: 'explode' },
      strikes: { count: 'three', muteFor: 'a while' },
      allowlist: ['ok', 42],
    });
    expect(settings.preset).toBe('balanced');
    expect(settings.actions.mild).toBe('blur');
    expect(settings.strikes.count).toBe(3);
    expect(settings.strikes.muteFor).toBe('7d');
    expect(settings.allowlist).toEqual(['ok']);
  });

  it('keeps null thresholds ("off") in custom presets', () => {
    const settings = migrateSettings({ preset: 'custom', customThresholds: { obscene: null } });
    expect(activeThresholds(settings).obscene).toBeNull();
    expect(activeThresholds(settings).insult).toBe(PRESETS.balanced.insult);
  });
});
