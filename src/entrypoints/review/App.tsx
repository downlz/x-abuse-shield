import { useMemo, useState } from 'react';
import type { Category } from '@/core/engine/categories';
import { Lexicon } from '@/core/lexicon/match';
import { activeMute } from '@/core/mute/mutes';
import { LOG_DAYS, LOG_LIMIT, reviewStats, toCalibrationPost, type ReviewEntry, type ReviewLabel } from '@/core/review/log';
import type { Message } from '@/shared/messages';
import { Check, Segmented } from '@/ui/controls';
import { useMuteState, useReviewLog } from '@/ui/hooks';

type Filter = 'all' | 'to-review' | 'not-abusive' | 'abusive';

const CONTEXT_LABELS: Record<string, string> = {
  'for-you': 'For you',
  following: 'Following',
  thread: 'Replies',
  notifications: 'Notifications',
  manual: 'Added by you',
};

const CATEGORY_LABELS: Record<Category, string> = {
  toxicity: 'toxic',
  severe_toxicity: 'severe abuse',
  obscene: 'obscene',
  threat: 'threat',
  insult: 'insult',
  identity_attack: 'identity attack',
  sexual_explicit: 'sexual',
};

const send = (message: Message) => browser.runtime.sendMessage(message);

export function App() {
  const log = useReviewLog();
  const muteState = useMuteState();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [blurText, setBlurText] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (log ?? []).filter((e) => {
      if (filter === 'to-review' && e.label) return false;
      if (filter === 'not-abusive' && e.label !== 'not-abusive') return false;
      if (filter === 'abusive' && e.label !== 'abusive') return false;
      return !q || e.handle.toLowerCase().includes(q.replace(/^@/, '')) || e.text.toLowerCase().includes(q);
    });
  }, [log, filter, query]);

  if (!log) return null;
  const stats = reviewStats(log);
  const labelled = log.filter((e) => e.label);

  return (
    <main className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 4 }}>
        <h1>Hidden posts</h1>
        <p className="muted">
          The last {LOG_DAYS} days (up to {LOG_LIMIT} posts), stored only in this browser. Marking a post “Not abusive”
          shows it again everywhere and removes its strike.
        </p>
      </header>

      <Summary stats={stats} />

      <div className="toolbar">
        <Segmented
          label="Filter"
          value={filter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'to-review', label: 'To review' },
            { value: 'abusive', label: 'Abusive' },
            { value: 'not-abusive', label: 'Not abusive' },
          ]}
          onChange={setFilter}
        />
        <input type="search" placeholder="Search @handle or text" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Check checked={blurText} onChange={setBlurText}>
          Blur post text
        </Check>
      </div>

      <div className="toolbar">
        <button type="button" disabled={labelled.length === 0} onClick={() => exportCalibration(labelled)}>
          Export labelled posts ({labelled.length})
        </button>
        <AddMissed />
        <button
          type="button"
          disabled={log.length === 0}
          onClick={() => {
            if (confirm('Clear the whole review log? Mutes and “not abusive” corrections are kept.')) void send({ type: 'review:clear' });
          }}
        >
          Clear log
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="muted">{log.length === 0 ? 'Nothing hidden yet.' : 'No posts match.'}</p>
      ) : (
        <div className={`stack${blurText ? ' blurred' : ''}`}>
          {visible.map((entry) => (
            <EntryCard key={entry.postId} entry={entry} muted={!!entry.handle && !!activeMute(muteState?.mutes ?? [], entry.handle, Date.now())} />
          ))}
        </div>
      )}
    </main>
  );
}

function Summary({ stats }: { stats: ReturnType<typeof reviewStats> }) {
  return (
    <section className="summary" aria-label="Summary">
      <div className="card">
        <div className="stat">{stats.hidden}</div>
        <div className="muted">posts hidden</div>
      </div>
      <div className="card">
        <div className="stat">{stats.labelled}</div>
        <div className="muted">reviewed</div>
      </div>
      <div className="card">
        <div className="stat">{stats.notAbusive}</div>
        <div className="muted">marked not abusive</div>
      </div>
      <div className="card">
        <div className="muted">Most common</div>
        <div>{stats.byCategory.slice(0, 3).map(([c, n]) => `${CATEGORY_LABELS[c]} ${n}`).join(' · ') || '—'}</div>
      </div>
      <div className="card">
        <div className="muted">Most hidden accounts</div>
        <div>{stats.topAccounts.slice(0, 3).map(([h, n]) => `@${h} ${n}`).join(' · ') || '—'}</div>
      </div>
    </section>
  );
}

function EntryCard({ entry, muted }: { entry: ReviewEntry; muted: boolean }) {
  const label = (value: ReviewLabel | null) => void send({ type: 'review:label', postId: entry.postId, label: value });
  const suspicious = entry.account && entry.account.level !== 'low';
  return (
    <article className="card entry">
      <header>
        {entry.handle ? (
          <a href={`https://x.com/${entry.handle}`} target="_blank" rel="noreferrer">
            @{entry.handle}
          </a>
        ) : (
          <strong>Missed post</strong>
        )}
        <span className="muted">
          {timeAgo(entry.at)} · {CONTEXT_LABELS[entry.context] ?? entry.context}
          {entry.directed && entry.context !== 'notifications' && entry.context !== 'thread' ? ' · reply' : ''}
        </span>
        {entry.url && (
          <a href={entry.url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
            Open on X
          </a>
        )}
      </header>

      {entry.categories.length > 0 && (
        <div className="chips">
          {entry.categories.map((c) => (
            <span key={c} className={`chip${c === 'threat' || c === 'severe_toxicity' ? ' severe' : ''}`}>
              {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>
      )}

      <p className="post-text" tabIndex={0}>
        {entry.text || '(no text)'}
      </p>

      {entry.reasons.length > 0 && (
        <ul className="reasons">
          {entry.reasons.slice(0, 5).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <Details entry={entry} />

      <div className="actions">
        <Segmented<ReviewLabel>
          label="Label"
          value={entry.label ?? null}
          options={[
            { value: 'abusive', label: 'Abusive' },
            { value: 'not-abusive', label: 'Not abusive' },
          ]}
          onChange={(value) => label(value === entry.label ? null : value)}
        />
        {entry.handle &&
          (muted ? (
            <button type="button" onClick={() => void send({ type: 'unmute', handle: entry.handle })}>
              Unmute @{entry.handle}
            </button>
          ) : (
            <button type="button" onClick={() => void send({ type: 'mute:add', handle: entry.handle })}>
              Mute @{entry.handle}
            </button>
          ))}
        {entry.handle && (entry.label === 'not-abusive' || suspicious) && (
          <button type="button" onClick={() => void send({ type: 'allow:add', handle: entry.handle })}>
            Always allow @{entry.handle}
          </button>
        )}
      </div>
      {entry.label === 'not-abusive' && suspicious && (
        <p className="muted" style={{ fontSize: 13 }}>
          This account was treated as suspicious ({entry.account!.reasons.join(', ') || entry.account!.level}). Allow it if
          you know it’s genuine.
        </p>
      )}
    </article>
  );
}

function Details({ entry }: { entry: ReviewEntry }) {
  const top = entry.model
    ? (Object.entries(entry.model) as [Category, number][]).sort((a, b) => b[1] - a[1]).slice(0, 4)
    : [];
  const account = entry.account;
  if (!entry.model && entry.wordHits.length === 0 && !account && !entry.cluster) return null;
  return (
    <details>
      <summary>Details</summary>
      <table>
        <tbody>
          {entry.wordHits.length > 0 && (
            <tr>
              <th>Word lists</th>
              <td>{entry.wordHits.map((h) => `“${h.matched}” (${h.strength})`).join(', ')}</td>
            </tr>
          )}
          {top.length > 0 && (
            <tr>
              <th>AI model</th>
              <td>{top.map(([c, s]) => `${CATEGORY_LABELS[c]} ${s.toFixed(2)}`).join(' · ')}</td>
            </tr>
          )}
          {account && (
            <tr>
              <th>Account</th>
              <td>
                {[
                  account.ageDays !== undefined ? `${account.ageDays} days old` : null,
                  account.followers !== undefined ? `${account.followers} followers` : null,
                  account.following !== undefined ? `follows ${account.following}` : null,
                  account.defaultAvatar ? 'default avatar' : null,
                  account.blueVerified ? 'subscriber badge' : null,
                  `suspicion: ${account.level}`,
                  account.source === 'dom' ? '(from the page only)' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
            </tr>
          )}
          {entry.cluster && (
            <tr>
              <th>Copy-paste</th>
              <td>
                {entry.cluster.size} accounts: {entry.cluster.handles.map((h) => `@${h}`).join(', ')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </details>
  );
}

const hinglishDetector = new Lexicon({ languages: { en: false, hi: true, hinglish: true, emoji: false }, customBlock: [], customAllow: [] });

function AddMissed() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [directed, setDirected] = useState(true);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Add a missed post
      </button>
    );
  }
  return (
    <div className="card stack" style={{ gap: 8, flexBasis: '100%' }}>
      <span>Paste the text of a post that should have been hidden. It’s saved as “abusive” for calibration.</span>
      <textarea aria-label="Missed post text" value={text} onChange={(e) => setText(e.target.value)} />
      <Check checked={directed} onChange={setDirected}>
        It was a reply or mention
      </Check>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!text.trim()}
          onClick={() => {
            void send({ type: 'review:add-missed', text: text.trim(), directed, hinglish: hinglishDetector.match(text).hinglish });
            setText('');
            setOpen(false);
          }}
        >
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function exportCalibration(entries: ReviewEntry[]) {
  const lines = entries.flatMap((e) => {
    const post = toCalibrationPost(e);
    return post ? [JSON.stringify(post)] : [];
  });
  const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'application/x-ndjson' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'posts.jsonl' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function timeAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), 'hour');
  return format.format(-Math.round(minutes / (60 * 24)), 'day');
}
