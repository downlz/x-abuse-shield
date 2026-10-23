import { SUGGESTED_BIO_KEYWORDS } from '@/core/config/defaults';
import { activeThresholds } from '@/core/config/migrate';
import type { Action, MuteDuration, Settings } from '@/core/config/schema';
import type { Category } from '@/core/engine/categories';
import { PRESETS } from '@/core/engine/presets';
import { ModelCard } from '@/ui/ModelCard';
import type { MuteEntry } from '@/core/mute/mutes';
import type { Message } from '@/shared/messages';
import { Check, LinesField, NumberField, Segmented } from '@/ui/controls';
import { useMuteState, useSettings } from '@/ui/hooks';

type Update = (change: (s: Settings) => Settings) => void;

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'blur', label: 'Blur' },
  { value: 'collapse', label: 'Collapse' },
  { value: 'remove', label: 'Remove' },
];

export function App() {
  const [settings, update] = useSettings();
  if (!settings) return null;
  return (
    <main className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 4 }}>
        <h1>Abuse Shield settings</h1>
        <p className="muted">Changes save automatically and apply to open x.com tabs straight away.</p>
      </header>
      <General settings={settings} update={update} />
      <AiModel settings={settings} update={update} />
      <Scopes settings={settings} update={update} />
      <WordLists settings={settings} update={update} />
      <AccountChecks settings={settings} update={update} />
      <CopyPaste settings={settings} update={update} />
      <Strikes settings={settings} update={update} />
      <Muted />
    </main>
  );
}

function General({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <section className="card">
      <h2>General</h2>
      <Check checked={settings.enabled} onChange={(enabled) => update((s) => ({ ...s, enabled }))}>
        Filter posts on x.com
      </Check>
      <div className="field">
        <span>Sensitivity</span>
        <Segmented
          label="Sensitivity"
          value={settings.preset}
          options={[
            { value: 'relaxed', label: 'Relaxed' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'strict', label: 'Strict' },
            ...(settings.preset === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
          ]}
          onChange={(preset) => update((s) => ({ ...s, preset }))}
        />
      </div>
      <ActionField label="Insults, obscenity, slurs" value={settings.actions.mild} onChange={(mild) => update((s) => ({ ...s, actions: { ...s.actions, mild } }))} />
      <ActionField label="Threats and severe abuse" value={settings.actions.severe} onChange={(severe) => update((s) => ({ ...s, actions: { ...s.actions, severe } }))} />
      <ActionField label="Posts by muted accounts" value={settings.actions.muted} onChange={(muted) => update((s) => ({ ...s, actions: { ...s.actions, muted } }))} />
      <p className="hint">Blur and Collapse keep a “Show” button. Remove hides the post completely.</p>
    </section>
  );
}

const CATEGORY_INFO: { key: Category; name: string; hint: string }[] = [
  { key: 'insult', name: 'Insults', hint: 'demeaning someone' },
  { key: 'toxicity', name: 'Toxic', hint: 'rude, hostile, disrespectful' },
  { key: 'threat', name: 'Threats', hint: 'violence or harm' },
  { key: 'severe_toxicity', name: 'Severe abuse', hint: 'very hateful, aggressive' },
  { key: 'identity_attack', name: 'Identity attacks', hint: 'religion, caste, gender, sexuality, ethnicity' },
  { key: 'obscene', name: 'Obscenity', hint: 'swearing, vulgarity' },
  { key: 'sexual_explicit', name: 'Sexual content', hint: 'sexually explicit language' },
];

function AiModel({ settings, update }: { settings: Settings; update: Update }) {
  const thresholds = activeThresholds(settings);
  const setModel = (patch: Partial<Settings['model']>) => update((s) => ({ ...s, model: { ...s.model, ...patch } }));
  const setThreshold = (key: Category, value: number | null) =>
    update((s) => ({ ...s, preset: 'custom', customThresholds: { ...activeThresholds(s), [key]: value } }));
  return (
    <section className="card">
      <h2>AI model</h2>
      <ModelCard settings={settings} update={update} heading="Status" />
      <Check checked={settings.model.enabled} onChange={(enabled) => setModel({ enabled })}>
        Use the AI model
      </Check>
      <Check checked={settings.model.preBlur} onChange={(preBlur) => setModel({ preBlur })} hint="about a third of a second per screen of posts">
        Blur posts until the model has checked them, so abuse never flashes
      </Check>
      <div className="field">
        <span>Unload after (idle minutes)</span>
        <NumberField label="Idle minutes" min={1} max={120} value={settings.model.idleMinutes} onChange={(idleMinutes) => setModel({ idleMinutes })} />
      </div>

      <h3 style={{ marginTop: 8 }}>When to hide</h3>
      <p className="hint">
        The model scores each post from 0 to 1 per category. A post is hidden when a score reaches the threshold — lower
        hides more. Moving a slider switches the preset to Custom.
      </p>
      {CATEGORY_INFO.map(({ key, name, hint }) => {
        const value = thresholds[key];
        return (
          <div className="slider-row" key={key}>
            <span>
              {name} <span className="hint">· {hint}</span>
            </span>
            <input
              type="range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={value ?? 0.95}
              disabled={value === null}
              aria-label={`${name} threshold`}
              onChange={(e) => setThreshold(key, Number(e.target.value))}
            />
            <span style={{ minWidth: 36 }}>{value === null ? '—' : value.toFixed(2)}</span>
            <Check checked={value === null} onChange={(off) => setThreshold(key, off ? null : (PRESETS.balanced[key] ?? 0.85))}>
              Off
            </Check>
          </div>
        );
      })}
      <div className="slider-row">
        <span>
          Non-English posts <span className="hint">· the model scores them lower</span>
        </span>
        <input
          type="range"
          min={0}
          max={0.3}
          step={0.05}
          value={settings.scoring.nonEnglishOffset}
          aria-label="Non-English threshold offset"
          onChange={(e) => update((s) => ({ ...s, scoring: { ...s.scoring, nonEnglishOffset: Number(e.target.value) } }))}
        />
        <span>−{settings.scoring.nonEnglishOffset.toFixed(2)}</span>
      </div>
    </section>
  );
}

function ActionField(props: { label: string; value: Action; onChange: (value: Action) => void }) {
  return (
    <div className="field">
      <span>{props.label}</span>
      <Segmented label={props.label} value={props.value} options={ACTIONS} onChange={props.onChange} />
    </div>
  );
}

function Scopes({ settings, update }: { settings: Settings; update: Update }) {
  const set = (key: keyof Settings['scopes']) => (value: boolean) =>
    update((s) => ({ ...s, scopes: { ...s.scopes, [key]: value } }));
  return (
    <section className="card">
      <h2>Where to filter</h2>
      <Check checked={settings.scopes.forYou} onChange={set('forYou')}>Home · For you</Check>
      <Check checked={settings.scopes.following} onChange={set('following')}>Home · Following</Check>
      <Check checked={settings.scopes.replies} onChange={set('replies')}>Replies when you open a post</Check>
      <Check checked={settings.scopes.notifications} onChange={set('notifications')}>Notifications</Check>
      <Check checked={settings.scopes.focalPost} onChange={set('focalPost')} hint="you clicked on it, so it's shown by default">
        The opened post itself
      </Check>
      <p className="hint">Your own posts and accounts on your allowlist are never filtered.</p>
    </section>
  );
}

function WordLists({ settings, update }: { settings: Settings; update: Update }) {
  const set = (patch: Partial<Settings['lexicon']>) => update((s) => ({ ...s, lexicon: { ...s.lexicon, ...patch } }));
  return (
    <section className="card">
      <h2>Word lists</h2>
      <Check checked={settings.lexicon.en} onChange={(en) => set({ en })}>English</Check>
      <Check checked={settings.lexicon.hi} onChange={(hi) => set({ hi })}>Hindi (Devanagari)</Check>
      <Check checked={settings.lexicon.hinglish} onChange={(hinglish) => set({ hinglish })}>Hinglish</Check>
      <p className="hint">
        Slurs and abuse aimed at someone hide a post on their own. Milder words (“pagal”, “idiot”) only count together
        with other evidence, so friendly teasing passes.
      </p>
      <Check
        checked={settings.scoring.mildWordsRepliesOnly}
        onChange={(mildWordsRepliesOnly) => update((s) => ({ ...s, scoring: { ...s.scoring, mildWordsRepliesOnly } }))}
        hint="recommended: avoids hiding “this is fucking amazing”"
      >
        Count milder words only in replies and mentions
      </Check>
      <div className="stack" style={{ gap: 6 }}>
        <span>Always hide posts containing (one per line)</span>
        <LinesField label="Blocked words" value={settings.lexicon.customBlock} onChange={(customBlock) => set({ customBlock })} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span>Never count these words (one per line)</span>
        <LinesField label="Allowed words" value={settings.lexicon.customAllow} onChange={(customAllow) => set({ customAllow })} />
      </div>
    </section>
  );
}

function AccountChecks({ settings, update }: { settings: Settings; update: Update }) {
  const signals = settings.signals;
  const set = (patch: Partial<Settings['signals']>) => update((s) => ({ ...s, signals: { ...s.signals, ...patch } }));
  const missing = SUGGESTED_BIO_KEYWORDS.filter((k) => !signals.bioKeywords.includes(k));
  return (
    <section className="card">
      <h2>Account checks</h2>
      <Check checked={signals.enabled} onChange={(enabled) => set({ enabled })}>
        Be stricter with replies and mentions from new or throwaway-looking accounts
      </Check>
      <p className="hint">
        Uses account age, followers, follow ratio, default avatar and auto-generated handles. These signals never hide a
        clean post on their own, and don't apply to posts that aren't replies or mentions.
      </p>
      <div className="stack" style={{ gap: 6 }}>
        <span>Bio keywords that make an account more suspicious (one per line)</span>
        <LinesField label="Bio keywords" value={signals.bioKeywords} onChange={(bioKeywords) => set({ bioKeywords })} />
        {missing.length > 0 && (
          <div className="row">
            <button type="button" onClick={() => set({ bioKeywords: [...signals.bioKeywords, ...missing] })}>
              Add spam suggestions
            </button>
            <span className="hint">{missing.join(', ')}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function CopyPaste({ settings, update }: { settings: Settings; update: Update }) {
  const c = settings.coordination;
  const set = (patch: Partial<Settings['coordination']>) => update((s) => ({ ...s, coordination: { ...s.coordination, ...patch } }));
  return (
    <section className="card">
      <h2>Copy-paste replies</h2>
      <Check checked={c.enabled} onChange={(enabled) => set({ enabled })}>
        Detect the same reply posted by several accounts
      </Check>
      <div className="field">
        <span>Accounts needed</span>
        <NumberField label="Accounts needed" min={2} max={20} value={c.minAuthors} onChange={(minAuthors) => set({ minAuthors })} />
      </div>
      <div className="field">
        <span>Within (minutes)</span>
        <NumberField label="Within minutes" min={1} max={120} value={c.windowMinutes} onChange={(windowMinutes) => set({ windowMinutes })} />
      </div>
      <Check checked={c.hideCleanClusters} onChange={(hideCleanClusters) => set({ hideCleanClusters })} hint="off by default">
        Hide copy-paste replies even when none of them is abusive
      </Check>
      <p className="hint">If one copy is abusive, every copy is hidden and each author gets a strike.</p>
    </section>
  );
}

const DURATIONS: { value: MuteDuration; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'forever', label: 'Forever' },
];

function Strikes({ settings, update }: { settings: Settings; update: Update }) {
  const st = settings.strikes;
  const set = (patch: Partial<Settings['strikes']>) => update((s) => ({ ...s, strikes: { ...s.strikes, ...patch } }));
  return (
    <section className="card">
      <h2>Repeat offenders</h2>
      <Check checked={st.enabled} onChange={(enabled) => set({ enabled })}>
        Mute accounts automatically after repeated abuse
      </Check>
      <div className="field">
        <span>Hidden posts before muting</span>
        <NumberField label="Strikes" min={1} max={20} value={st.count} onChange={(count) => set({ count })} />
      </div>
      <div className="field">
        <span>Within (days)</span>
        <NumberField label="Window days" min={1} max={90} value={st.windowDays} onChange={(windowDays) => set({ windowDays })} />
      </div>
      <div className="field">
        <span>Mute for</span>
        <Segmented label="Mute for" value={st.muteFor} options={DURATIONS} onChange={(muteFor) => set({ muteFor })} />
      </div>
      <p className="hint">Muting is local to this browser. Nothing is muted or blocked on your X account.</p>
      <div className="stack" style={{ gap: 6 }}>
        <span>Allowlist: never filter these accounts (one handle per line)</span>
        <LinesField
          label="Allowlist"
          placeholder="@handle"
          value={settings.allowlist}
          onChange={(allowlist) => update((s) => ({ ...s, allowlist: allowlist.map((h) => h.replace(/^@/, '')) }))}
        />
      </div>
    </section>
  );
}

function Muted() {
  const state = useMuteState();
  const now = Date.now();
  const active = (state?.mutes ?? []).filter((m) => m.expiresAt === null || m.expiresAt > now);
  return (
    <section className="card">
      <h2>Muted accounts</h2>
      {active.length === 0 ? (
        <p className="muted">No one is muted.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Until</th>
              <th>Why</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((mute) => (
              <MutedRow key={mute.handle} mute={mute} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function MutedRow({ mute }: { mute: MuteEntry }) {
  const until = mute.expiresAt === null ? 'Forever' : new Date(mute.expiresAt).toLocaleString();
  const why = mute.reason === 'strikes' ? `${mute.evidence.length} hidden posts` : 'Muted by you';
  return (
    <tr>
      <td>
        <a href={`https://x.com/${mute.handle}`} target="_blank" rel="noreferrer">
          @{mute.handle}
        </a>
      </td>
      <td>{until}</td>
      <td>{why}</td>
      <td>
        <button type="button" onClick={() => void browser.runtime.sendMessage({ type: 'unmute', handle: mute.handle } satisfies Message)}>
          Unmute
        </button>
      </td>
    </tr>
  );
}
