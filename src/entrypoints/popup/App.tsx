import { useEffect, useState } from 'react';
import type { Settings } from '@/core/config/schema';
import { healthKey, type TabHealth } from '@/shared/health';
import { Check, Segmented } from '@/ui/controls';
import { useSettings, useTodayStats } from '@/ui/hooks';
import { ModelCard } from '@/ui/ModelCard';

const PRESETS: { value: Settings['preset']; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'strict', label: 'Strict' },
];

export function App() {
  const [settings, update] = useSettings();
  const stats = useTodayStats();
  const tab = useActiveTabHealth();

  if (!settings) return null;
  return (
    <main className="stack">
      <div className="row between">
        <h1>X Abuse Shield</h1>
        <Check checked={settings.enabled} onChange={(enabled) => update((s) => ({ ...s, enabled }))}>
          On
        </Check>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="muted">Sensitivity</span>
        <Segmented
          label="Sensitivity"
          value={settings.preset}
          options={settings.preset === 'custom' ? [...PRESETS, { value: 'custom', label: 'Custom' }] : PRESETS}
          onChange={(preset) => update((s) => ({ ...s, preset }))}
        />
      </div>

      <div className="stats">
        <div className="card">
          <div className="stat">{stats?.flagged ?? 0}</div>
          <div className="muted">posts hidden today</div>
        </div>
        <div className="card">
          <div className="stat">{stats?.muted ?? 0}</div>
          <div className="muted">accounts muted today</div>
        </div>
      </div>

      <ModelCard settings={settings} update={update} compact />

      <TabStatus tab={tab} />

      <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>
        Settings
      </button>
    </main>
  );
}

function TabStatus({ tab }: { tab: { onX: boolean; health: TabHealth | null } }) {
  if (!tab.onX) return <p className="muted">Open x.com to filter posts.</p>;
  const health = tab.health;
  if (!health || health.dom === 'idle') return <p className="muted">Waiting for posts on this page…</p>;
  return (
    <div className="card stack" style={{ gap: 4 }}>
      {health.dom === 'broken' ? (
        <p className="danger">Can't read posts on this page, so nothing is being filtered. X may have changed its layout.</p>
      ) : (
        <p className="ok">Reading posts on this page ({health.postsSeen} so far).</p>
      )}
      {health.api === 'ok' && <p className="muted">Account details for {Math.round(health.coverage * 100)}% of posts.</p>}
      {health.api === 'missing' && <p className="muted">No account details from X yet — account checks use what's on screen.</p>}
      {health.api === 'degraded' && <p className="muted">X's account details look incomplete — account checks are limited.</p>}
    </div>
  );
}

function useActiveTabHealth(): { onX: boolean; health: TabHealth | null } {
  const [state, setState] = useState<{ onX: boolean; health: TabHealth | null }>({ onX: false, health: null });
  useEffect(() => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      // Without the "tabs" permission tab.url is hidden, so ask storage instead: only x.com tabs report health.
      if (tab?.id === undefined) return;
      const key = healthKey(tab.id);
      const stored = (await browser.storage.session.get(key))[key] as TabHealth | undefined;
      setState({ onX: stored !== undefined, health: stored ?? null });
    })();
  }, []);
  return state;
}
