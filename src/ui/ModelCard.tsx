import { useEffect, useState } from 'react';
import type { Settings } from '@/core/config/schema';
import type { Message } from '@/shared/messages';
import { MODEL_DOWNLOAD_MB, MODEL_MEMORY_MB, MODEL_STATUS_KEY, type ModelStatus } from '@/shared/model-status';

export function useModelStatus(): ModelStatus | null {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  useEffect(() => {
    void browser.storage.session.get(MODEL_STATUS_KEY).then((stored) => setStatus((stored[MODEL_STATUS_KEY] as ModelStatus) ?? null));
    const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const change = changes[MODEL_STATUS_KEY];
      if (area === 'session' && change) setStatus((change.newValue as ModelStatus) ?? null);
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }, []);
  return status;
}

const lowMemory = ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** AI model status with the actions that make sense in each state. */
export function ModelCard(props: {
  settings: Settings;
  update: (change: (s: Settings) => Settings) => void;
  compact?: boolean;
  /** Heading inside the card; the options page already titles the section "AI model". */
  heading?: string;
}) {
  const status = useModelStatus();
  const { settings, update } = props;
  const setModel = (patch: Partial<Settings['model']>) => update((s) => ({ ...s, model: { ...s.model, ...patch } }));
  const state = !settings.model.enabled ? 'off' : !settings.model.downloadApproved ? 'needs-download' : (status?.state ?? 'unloaded');

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <strong>{props.heading ?? 'AI model'}</strong>
        <span className={state === 'ready' ? 'ok' : state === 'error' ? 'danger' : 'muted'}>{label(state, status)}</span>
      </div>

      {state === 'off' && (
        <>
          <p className="muted">Word lists only. The model also catches insults without swear words and veiled threats.</p>
          <div>
            <button type="button" onClick={() => setModel({ enabled: true })}>
              Turn on
            </button>
          </div>
        </>
      )}

      {state === 'needs-download' && (
        <>
          <p className="muted">
            Catches insults without swear words, veiled threats and abuse in 34 languages, on your device.{' '}
            {__BUNDLED_MODEL__ ? 'Included with the extension; ' : `One-time download of ${MODEL_DOWNLOAD_MB} MB; `}
            uses about {MODEL_MEMORY_MB} MB of memory while x.com is open
            {props.compact ? '.' : `, and unloads after ${settings.model.idleMinutes} idle minutes.`}
          </p>
          {lowMemory && <p className="danger">This device reports 4 GB of memory or less — the model may slow it down.</p>}
          <div className="row">
            <button type="button" className="primary" onClick={() => setModel({ downloadApproved: true })}>
              {__BUNDLED_MODEL__ ? 'Turn on' : `Download (${MODEL_DOWNLOAD_MB} MB)`}
            </button>
            {!props.compact && (
              <button type="button" onClick={() => setModel({ enabled: false })}>
                Use word lists only
              </button>
            )}
          </div>
        </>
      )}

      {state === 'loading' && status?.state === 'loading' && (
        <progress max={100} value={status.progress} aria-label="Model progress" style={{ width: '100%' }} />
      )}

      {state === 'unloaded' && (
        <p className="muted">Loads when you open x.com; unloads after {settings.model.idleMinutes} idle minutes.</p>
      )}

      {state === 'error' && status?.state === 'error' && (
        <>
          <p className="danger">{status.message.split('\n')[0]}</p>
          <div>
            <button type="button" onClick={() => void browser.runtime.sendMessage({ type: 'model:retry' } satisfies Message)}>
              Try again
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function label(state: ModelStatus['state'], status: ModelStatus | null): string {
  switch (state) {
    case 'off':
      return 'Off';
    case 'needs-download':
      return __BUNDLED_MODEL__ ? 'Not turned on' : 'Not downloaded';
    case 'unloaded':
      return 'Not loaded';
    case 'loading':
      return status?.state === 'loading' ? `${status.downloading ? 'Downloading' : 'Loading'} ${status.progress}%` : 'Loading';
    case 'ready':
      return 'On';
    case 'error':
      return 'Error';
  }
}
