import { activeThresholds } from '@/core/config/migrate';
import type { Settings } from '@/core/config/schema';
import { CopyTracker } from '@/core/coordination/copy-tracker';
import { fingerprint } from '@/core/coordination/fingerprint';
import type { Category } from '@/core/engine/categories';
import { decide, type ScoringConfig, type Verdict } from '@/core/engine/decide';
import { Lexicon } from '@/core/lexicon/match';
import { activeMute, type MuteState, type Strike } from '@/core/mute/mutes';
import { assessAccount, type AccountRecord, type Assessment } from '@/core/signals/suspicion';
import type { RecordsPayload } from '@/adapters/x-api/bridge';
import { isDefaultAvatarUrl, type PostRecord } from '@/adapters/x-api/fields';
import { detectPageContext, focalPostId, ownHandle, type PageContext } from '@/adapters/x-dom/context';
import { extractPost, type DomPost } from '@/adapters/x-dom/extract';
import { isOwnNode, render, type Treatment } from '@/adapters/x-dom/render';
import { X } from '@/adapters/x-dom/selectors';
import type { TabHealth } from '@/shared/health';

export interface PipelineDeps {
  doc: Document;
  path: () => string;
  now: () => number;
  onFlagged: (strike: Strike) => void;
  onHealth: (health: TabHealth) => void;
}

interface Evaluation {
  /** Lowercase author handle. */
  handle: string;
  /** Scored with an account record from X's data (rather than page-only signals). */
  hadRecord: boolean;
  text: string;
  verdict: Verdict;
  /** Flagged on its own merits, not only as a copy of another post. */
  ownFlag: boolean;
  /** Counts as a strike against the author (not for clean copy-paste clusters). */
  strike: boolean;
  clusterSize: number;
  /** Another copy in the cluster changed; recompute on next sight. */
  stale?: boolean;
}

/** X's codes for posts without a real language: undetermined, no text, emoji-only, hashtags-only, art. */
const NEUTRAL_LANGS = new Set(['und', 'zxx', 'qme', 'qht', 'qam', 'art']);

const CATEGORY_LABELS: Record<Category, string> = {
  toxicity: 'toxic',
  severe_toxicity: 'severe abuse',
  obscene: 'obscene',
  threat: 'threat',
  insult: 'insult',
  identity_attack: 'identity attack',
  sexual_explicit: 'sexual',
};

/** Used when account signals are switched off. */
const LOW: Assessment = { score: 0, level: 'low', reasons: [] };

export class ContentPipeline {
  private settings!: Settings;
  private scoring!: ScoringConfig;
  private lexicon!: Lexicon;
  private lexiconKey = '';
  private muteState: MuteState;
  private readonly tracker: CopyTracker;
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly apiPosts = new Map<string, PostRecord>();
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly articles = new Map<string, Element>();
  private readonly revealed = new Set<string>();
  private readonly reported = new Set<string>();
  private me: string | undefined;
  private observer: MutationObserver | null = null;
  private stats = { articles: 0, extracted: 0, evaluated: 0, withRecord: 0, users: 0, incompleteUsers: 0 };
  private lastHealth = '';

  constructor(
    private readonly deps: PipelineDeps,
    settings: Settings,
    muteState: MuteState,
  ) {
    this.muteState = muteState;
    this.tracker = new CopyTracker(settings.coordination);
    this.applySettings(settings);
  }

  /** Watches the page and processes posts as X adds them, before the browser paints. */
  attach(): void {
    const View = this.deps.doc.defaultView!;
    this.observer = new View.MutationObserver((mutations) => {
      const found = new Set<Element>();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1 || isOwnNode(node)) continue;
          const el = node as Element;
          const parent = el.closest(X.post);
          if (parent) found.add(parent);
          el.querySelectorAll(X.post).forEach((article) => found.add(article));
        }
      }
      if (found.size > 0) this.process(found);
    });
    this.observer.observe(this.deps.doc.documentElement, { childList: true, subtree: true });
    this.processAll();
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  updateSettings(settings: Settings): void {
    this.applySettings(settings);
    this.evaluations.clear();
    this.processAll();
  }

  updateMuteState(state: MuteState): void {
    this.muteState = state;
    this.processAll();
  }

  addRecords(payload: RecordsPayload): void {
    const arrived = new Set<string>();
    for (const user of payload.users) {
      const handle = user.handle.toLowerCase();
      this.accounts.set(handle, user);
      arrived.add(handle);
      this.stats.users++;
      if (user.followers === undefined || user.createdAt === undefined) this.stats.incompleteUsers++;
    }
    for (const post of payload.posts) this.apiPosts.set(post.id, post);

    // Records normally arrive before X renders the posts. If they came late,
    // re-check posts that were scored on page-only signals.
    const late = [...this.evaluations.entries()].filter(([, e]) => !e.hadRecord && arrived.has(e.handle)).map(([id]) => id);
    if (late.length > 0) this.reevaluate(late);
  }

  reveal(postId: string): void {
    this.revealed.add(postId);
    const article = this.articles.get(postId);
    if (article) this.process([article]);
  }

  processAll(): void {
    this.process(this.deps.doc.querySelectorAll(X.post));
  }

  process(articles: Iterable<Element>): void {
    const context = detectPageContext(this.deps.doc, this.deps.path());
    const focalId = context === 'thread' ? focalPostId(this.deps.path()) : undefined;
    this.me ??= ownHandle(this.deps.doc);
    for (const article of articles) this.processOne(article, context, focalId);
    this.reportHealth();
  }

  private processOne(article: Element, context: PageContext, focalId: string | undefined): void {
    this.stats.articles++;
    const post = extractPost(article);
    if (!post) return;
    this.stats.extracted++;
    this.articles.set(post.id, article);
    const revealed = this.revealed.has(post.id);
    const handle = post.handle.toLowerCase();

    if (!this.settings.enabled || !this.inScope(context, post.id === focalId) || handle === this.me || this.allowlisted(handle)) {
      render(article, post.id, null, revealed);
      return;
    }

    const mute = activeMute(this.muteState.mutes, handle, this.deps.now());
    if (mute) {
      const detail = mute.reason === 'strikes' ? 'muted after repeated abuse' : 'muted by you';
      render(article, post.id, { action: this.settings.actions.muted, label: `Muted @${post.handle}`, detail }, revealed);
      return;
    }

    const evaluation = this.evaluate(post, context, focalId);
    render(article, post.id, evaluation.verdict.flagged ? this.treatment(evaluation.verdict) : null, revealed);

    if (evaluation.strike && !this.reported.has(post.id)) {
      this.reported.add(post.id);
      this.deps.onFlagged({ handle, postId: post.id, at: this.deps.now(), reasons: evaluation.verdict.reasons });
    }
  }

  private evaluate(post: DomPost, context: PageContext, focalId: string | undefined): Evaluation {
    const apiPost = this.apiPosts.get(post.id);
    const text = apiPost?.text ?? post.text;
    const previous = this.evaluations.get(post.id);
    if (previous && !previous.stale && previous.text === text) return previous;

    const handle = post.handle.toLowerCase();
    const match = this.lexicon.match(text);
    const directed = context === 'notifications' || (context === 'thread' && post.id !== focalId) || !!apiPost?.inReplyToStatusId;
    const lang = apiPost?.lang ?? post.lang;
    const nonEnglish = match.hinglish || (!!lang && lang !== 'en' && !NEUTRAL_LANGS.has(lang));

    const record = this.accounts.get(handle);
    const assessment = this.settings.signals.enabled
      ? assessAccount(record ?? this.domRecord(post), this.settings.signals, this.deps.now())
      : LOW;

    let cluster: string[] = [];
    const postedAt = apiPost?.createdAt ?? post.postedAt;
    if (this.settings.coordination.enabled && postedAt !== undefined) {
      const key = fingerprint(text);
      if (key) cluster = this.tracker.add(key, { postId: post.id, author: handle, postedAt });
    }
    const copyOfFlagged = cluster.some((id) => id !== post.id && this.evaluations.get(id)?.ownFlag);

    const verdict = decide(
      {
        lexiconHits: match.hits,
        suppressed: match.suppressed,
        // Every author in a copy-paste cluster is treated as highly suspicious for that post.
        suspicion: cluster.length > 0 ? 'high' : assessment.level,
        directed,
        nonEnglish,
        copyOfFlagged,
      },
      this.scoring,
    );
    const ownFlag = verdict.categories.length > 0;
    const strike = verdict.flagged;
    if (cluster.length > 0) {
      verdict.reasons.push(`same text as ${cluster.length - 1} other ${cluster.length === 2 ? 'account' : 'accounts'}`);
      if (!verdict.flagged && this.settings.coordination.hideCleanClusters) {
        verdict.flagged = true;
        verdict.reasons.unshift('copy-paste reply');
      }
    }
    if (verdict.flagged && directed && assessment.level !== 'low') verdict.reasons.push(...assessment.reasons);

    const evaluation: Evaluation = { handle, hadRecord: !!record, text, verdict, ownFlag, strike, clusterSize: cluster.length };
    this.evaluations.set(post.id, evaluation);
    if (!previous) {
      this.stats.evaluated++;
      if (record) this.stats.withRecord++;
    }

    // A new cluster member, or a copy that became flagged or clean, changes every
    // other copy's verdict. Each copy only re-checks the others when its own
    // result changed, so the cascade ends after one round.
    const changed = !previous || previous.ownFlag !== ownFlag || previous.clusterSize !== cluster.length;
    if (cluster.length > 0 && changed) this.reevaluate(cluster.filter((id) => id !== post.id));
    return evaluation;
  }

  private reevaluate(postIds: string[]): void {
    const articles = postIds.flatMap((id) => {
      const evaluation = this.evaluations.get(id);
      if (evaluation) evaluation.stale = true;
      const article = this.articles.get(id);
      return article?.isConnected ? [article] : [];
    });
    if (articles.length > 0) this.process(articles);
  }

  private treatment(verdict: Verdict): Treatment {
    const what = verdict.categories.map((c) => CATEGORY_LABELS[c]).join(', ') || 'copy-paste reply';
    return {
      action: verdict.severe ? this.settings.actions.severe : this.settings.actions.mild,
      label: 'Hidden by Abuse Shield',
      detail: verdict.reasons[0] ? `${what} · ${verdict.reasons[0]}` : what,
    };
  }

  private domRecord(post: DomPost): AccountRecord {
    return {
      handle: post.handle,
      defaultAvatar: post.avatarUrl ? isDefaultAvatarUrl(post.avatarUrl) : undefined,
      blueVerified: post.blueVerified,
      source: 'dom',
    };
  }

  private inScope(context: PageContext, isFocal: boolean): boolean {
    const scopes = this.settings.scopes;
    switch (context) {
      case 'for-you':
        return scopes.forYou;
      case 'following':
        return scopes.following;
      case 'thread':
        return isFocal ? scopes.focalPost : scopes.replies;
      case 'notifications':
        return scopes.notifications;
      default:
        return false;
    }
  }

  private allowlisted(handle: string): boolean {
    return this.settings.allowlist.some((h) => h.replace(/^@/, '').toLowerCase() === handle);
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    this.scoring = { ...settings.scoring, thresholds: activeThresholds(settings) };
    this.tracker.setOptions(settings.coordination);
    const key = JSON.stringify(settings.lexicon);
    if (key !== this.lexiconKey) {
      this.lexiconKey = key;
      this.lexicon = new Lexicon({
        languages: { en: settings.lexicon.en, hi: settings.lexicon.hi, hinglish: settings.lexicon.hinglish },
        customBlock: settings.lexicon.customBlock,
        customAllow: settings.lexicon.customAllow,
      });
    }
  }

  health(): TabHealth {
    const { articles, extracted, evaluated, withRecord, users, incompleteUsers } = this.stats;
    const dom: TabHealth['dom'] =
      articles === 0 ? 'idle' : articles >= 10 && extracted / articles < 0.2 ? 'broken' : 'ok';
    const api: TabHealth['api'] =
      users === 0 ? (evaluated >= 10 ? 'missing' : 'idle') : incompleteUsers / users > 0.5 ? 'degraded' : 'ok';
    return { dom, api, coverage: evaluated ? withRecord / evaluated : 0, postsSeen: extracted };
  }

  private reportHealth(): void {
    const health = this.health();
    const key = `${health.dom}|${health.api}|${Math.round(health.coverage * 20)}`;
    if (key === this.lastHealth) return;
    this.lastHealth = key;
    this.deps.onHealth(health);
  }
}
