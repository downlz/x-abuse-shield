import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { activeThresholds, migrateSettings } from '@/core/config/migrate';
import { PRESETS } from '@/core/engine/presets';
import { approvalKey, approvalOutdated } from '@/shared/model-status';

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

describe('model approval', () => {
  const hosted = 'https://huggingface.co/downlz/x-abuse-shield-model/resolve/main/';
  const model = (downloadApproved: boolean, approvedSource: string, choice: 'distilbert' | 'toxicity' = 'distilbert') => ({ downloadApproved, approvedSource, choice });

  it('asks again when an update or a switch would download a model the user did not agree to', () => {
    // 0.2.0 shipped the model: "Turn on" there downloaded nothing.
    expect(approvalOutdated(model(true, ''), approvalKey('distilbert', hosted))).toBe(true);
    expect(approvalOutdated(model(true, 'bundled'), approvalKey('distilbert', hosted))).toBe(true);
    // Up to 0.2.6 an approval named only the source (the toxicity model); the DistilBERT model is a new download.
    expect(approvalOutdated(model(true, hosted), approvalKey('distilbert', hosted))).toBe(true);
    // Switching models.
    expect(approvalOutdated(model(true, approvalKey('toxicity', hosted)), approvalKey('distilbert', hosted))).toBe(true);
    // Up to 0.2.6 an approval named only the source; every model is a new approval since.
    expect(approvalOutdated(model(true, hosted, 'toxicity'), approvalKey('toxicity', hosted))).toBe(true);
  });

  it('keeps an approval for the same model and source, any approval when nothing is downloaded, and no approval as is', () => {
    expect(approvalKey('distilbert', hosted)).toBe(`${hosted}#gravitee-io/distilbert-multilingual-toxicity-classifier`);
    expect(approvalOutdated(model(true, approvalKey('distilbert', hosted)), approvalKey('distilbert', hosted))).toBe(false);
    expect(approvalOutdated(model(true, ''), approvalKey('distilbert', 'bundled'))).toBe(false);
    expect(approvalOutdated(model(false, ''), approvalKey('distilbert', hosted))).toBe(false);
  });

  it('defaults to the DistilBERT model and repairs unknown choices', () => {
    expect(DEFAULT_SETTINGS.model.choice).toBe('distilbert');
    expect(migrateSettings({ model: { choice: 'hate' } }).model.choice).toBe('distilbert');
    expect(migrateSettings({ model: { choice: 'toxicity' } }).model.choice).toBe('toxicity');
  });
});
