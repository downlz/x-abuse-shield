import { activeThresholds } from '@/core/config/migrate';
import type { Settings } from '@/core/config/schema';
import { CopyTracker } from '@/core/coordination/copy-tracker';
import { fingerprint } from '@/core/coordination/fingerprint';
import type { Category, CategoryScores } from '@/core/engine/categories';
import { decide, withoutMatchedWords, type ScoringConfig, type Verdict } from '@/core/engine/decide';
import { Lexicon } from '@/core/lexicon/match';
import { activeMute, type MuteEntry, type MuteState, type Strike } from '@/core/mute/mutes';
import type { ReviewEntry } from '@/core/review/log';
import { assessAccount, type AccountRecord, type Assessment } from '@/core/signals/suspicion';
import type { RecordsPayload } from '@/adapters/x-api/bridge';
import { isDefaultAvatarUrl, type PostRecord } from '@/adapters/x-api/fields';
import { detectPageContext, focalPostId, ownHandle, type PageContext } from '@/adapters/x-dom/context';
import { extractPost, quoteCard, type DomPost } from '@/adapters/x-dom/extract';
import { isOwnNode, render, syncTheme, type Treatment } from '@/adapters/x-dom/render';
import { X } from '@/adapters/x-dom/selectors';
import type { TabHealth } from '@/shared/health';

export interface PipelineDeps {
  doc: Document;
  path: () => string;
  now: () => number;
  /** A post was newly hidden. `strike` is set when it counts against its author. */
  onFlagged: (entry: ReviewEntry, strike?: Strike) => void;
  onHealth: (health: TabHealth) => void;
  /**
   * Scores texts with the AI model. Resolves to null when the model is off or
   * not approved; rejects on a transient failure.
   */
  classify?: (texts: string[]) => Promise<CategoryScores[] | null>;
}

/** Collects posts for ~one frame before asking the model, so a timeline page goes in one request. */
const MODEL_FLUSH_MS = 30;

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
  /** Waiting for model scores. */
  awaitingModel: boolean;
  /** For the review log, if hidden ("at" is filled in when reported). */
  entry: Omit<ReviewEntry, 'at'>;
  /** Another copy in the cluster changed, or scores arrived; recompute on next sight. */
  stale?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Posts you marked "not abusive". */
  private notAbusive = new Set<string>();
  private me: string | undefined;
  private observer: MutationObserver | null = null;
  private stats = { articles: 0, extracted: 0, evaluated: 0, withRecord: 0, users: 0, incompleteUsers: 0 };
  private lastHealth = '';
  /** Model scores by post text (the same text can appear under several post ids). */
  private readonly modelScores = new Map<string, CategoryScores>();
  private readonly postsByText = new Map<string, Set<string>>();
  private readonly modelPending = new Set<string>();
  private readonly modelFailed = new Set<string>();
  private modelQueue: string[] = [];
  private modelFlush: ReturnType<typeof setTimeout> | null = null;
  /** The model is off or not approved; stop asking until settings change. */
  private modelOff = false;

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
    this.modelOff = false;
    this.modelFailed.clear();
    this.processAll();
  }

  updateMuteState(state: MuteState): void {
    this.muteState = state;
    this.processAll();
  }

  addRecords(payload: RecordsPayload): void {
    // Your own posts are never filtered; on X's phone layout this is how we learn who you are.
    const viewer = payload.viewer?.toLowerCase();
    if (viewer && viewer !== this.me) {
      this.me = viewer;
      this.processAll();
    }
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
    // re-check posts that were scored on page-only signals, and quotes, which
    // can only be scored once X's data names the quoted post.
    const late = [...this.evaluations.entries()].filter(([, e]) => !e.hadRecord && arrived.has(e.handle)).map(([id]) => id);
    const quoting = payload.posts.filter((post) => post.quotedId && this.articles.has(post.id)).map((post) => post.id);
    if (late.length + quoting.length > 0) this.reevaluate([...new Set([...late, ...quoting])]);
  }

  reveal(postId: string): void {
    this.revealed.add(postId);
    const article = this.articles.get(postId);
    if (article) this.process([article]);
  }

  updateOverrides(notAbusive: Iterable<string>): void {
    this.notAbusive = new Set(notAbusive);
    this.processAll();
  }

  /** Shows the post straight away; the background records it and syncs other tabs. */
  markNotAbusive(postId: string): void {
    this.notAbusive.add(postId);
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
    syncTheme(this.deps.doc);
    for (const article of articles) this.processOne(article, context, focalId);
    this.reportHealth();
  }

  private processOne(article: Element, context: PageContext, focalId: string | undefined): void {
    this.stats.articles++;
    const post = extractPost(article);
    if (!post) return;
    this.stats.extracted++;
    this.articles.set(post.id, article);
    const active = this.settings.enabled && this.inScope(context, post.id === focalId);
    render(article, post.id, active ? this.treat(post, context, focalId, false) : null, this.revealed.has(post.id));

    const card = quoteCard(article);
    if (!card) return;
    const quoted = active ? this.quotedPost(post) : null;
    if (quoted) this.articles.set(quoted.id, article);
    render(card, quoted?.id ?? '', quoted && this.treat(quoted, context, focalId, true), !!quoted && this.revealed.has(quoted.id));
  }

  /** How to show a post, or a post quoted inside another; reports it if newly hidden. */
  private treat(post: DomPost, context: PageContext, focalId: string | undefined, quoted: boolean): Treatment | null {
    const handle = post.handle.toLowerCase();
    const now = this.deps.now();
    // X hides a muted account's reposts too, whoever wrote the post.
    const reposter = post.repostedBy?.toLowerCase();
    const reposterMute = reposter && reposter !== handle ? activeMute(this.muteState.mutes, reposter, now) : undefined;
    if (reposterMute) return this.mutedTreatment(post.repostedBy!, reposterMute.reason, 'reposted by a muted account');

    if (handle === this.me || this.allowlisted(handle) || (this.settings.exemptFollowing && this.accounts.get(handle)?.youFollow)) return null;
    const mute = activeMute(this.muteState.mutes, handle, now);
    if (mute) return this.mutedTreatment(post.handle, mute.reason, quoted ? 'quoted post' : undefined);
    if (this.notAbusive.has(post.id)) return null;

    const evaluation = this.evaluate(post, context, focalId, quoted);
    if (evaluation.verdict.flagged && !this.reported.has(post.id)) {
      this.reported.add(post.id);
      const strike = evaluation.strike ? { handle, postId: post.id, at: now, reasons: evaluation.verdict.reasons } : undefined;
      this.deps.onFlagged({ ...evaluation.entry, at: now }, strike);
    }
    return this.treatmentFor(evaluation, post.handle, quoted);
  }

  private mutedTreatment(handle: string, reason: MuteEntry['reason'], note?: string): Treatment {
    const why = reason === 'strikes' ? 'muted after repeated abuse' : 'muted by you';
    return { action: this.settings.actions.muted, label: `Muted @${handle}`, detail: note ? `${note} · ${why}` : why, actions: ['unmute'], handle };
  }

  /**
   * The post quoted inside this one, scored on its own as a post by its
   * author. Needs its id from X's data (the card on the page has no link);
   * without it the quote is left alone.
   */
  private quotedPost(post: DomPost): DomPost | null {
    const id = this.apiPosts.get(post.id)?.quotedId;
    const record = id ? this.apiPosts.get(id) : undefined;
    const handle = record?.authorHandle ?? post.quotedHandle;
    const text = record?.text ?? post.quotedText;
    if (!id || !handle || !text) return null;
    return { id, handle, text, lang: record?.lang, postedAt: record?.createdAt, blueVerified: false };
  }

  private evaluate(post: DomPost, context: PageContext, focalId: string | undefined, quoted = false): Evaluation {
    const apiPost = this.apiPosts.get(post.id);
    const text = apiPost?.text ?? post.text;
    const previous = this.evaluations.get(post.id);
    if (previous && !previous.stale && previous.text === text) return previous;

    const handle = post.handle.toLowerCase();
    const match = this.lexicon.match(text);
    // A quoted post is aimed at someone only if it was itself a reply; where it's shown doesn't matter.
    const directed = quoted
      ? !!apiPost?.inReplyToStatusId
      : context === 'notifications' || (context === 'thread' && post.id !== focalId) || !!apiPost?.inReplyToStatusId;
    const lang = apiPost?.lang ?? post.lang;
    const nonEnglish = match.hinglish || (!!lang && lang !== 'en' && !NEUTRAL_LANGS.has(lang));

    const record = this.accounts.get(handle);
    const account = record ?? this.domRecord(post);
    const assessment = this.settings.signals.enabled ? assessAccount(account, this.settings.signals, this.deps.now()) : LOW;

    let cluster: string[] = [];
    const postedAt = apiPost?.createdAt ?? post.postedAt;
    if (this.settings.coordination.enabled && postedAt !== undefined) {
      const key = fingerprint(text);
      if (key) cluster = this.tracker.add(key, { postId: post.id, author: handle, postedAt });
    }
    const copyOfFlagged = cluster.some((id) => id !== post.id && this.evaluations.get(id)?.ownFlag);
    const model = this.modelScores.get(text);

    const verdict = decide(
      {
        lexiconHits: match.hits,
        model,
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

    // Posts the word lists already settled don't need the model.
    const awaitingModel = !model && !ownFlag && this.requestModel(text, post.id);

    const entry: Omit<ReviewEntry, 'at'> = {
      postId: post.id,
      handle: post.handle,
      text,
      url: `https://x.com/${post.handle}/status/${post.id}`,
      postedAt,
      context,
      directed,
      lang,
      hinglish: match.hinglish,
      categories: verdict.categories,
      severe: verdict.severe,
      reasons: verdict.reasons,
      model,
      wordHits: match.hits.map(({ term, matched, strength, category }) => ({ term, matched, strength, category })),
      account: {
        ageDays: account.createdAt === undefined ? undefined : Math.floor((this.deps.now() - account.createdAt) / DAY_MS),
        followers: account.followers,
        following: account.following,
        defaultAvatar: account.defaultAvatar,
        blueVerified: account.blueVerified,
        source: account.source,
        level: assessment.level,
        reasons: assessment.reasons,
      },
      cluster:
        cluster.length > 0
          ? { size: cluster.length, handles: [...new Set(cluster.map((id) => (id === post.id ? handle : this.evaluations.get(id)?.handle)))].filter((h): h is string => !!h) }
          : undefined,
    };

    const evaluation: Evaluation = {
      handle,
      hadRecord: !!record,
      text,
      verdict,
      ownFlag,
      strike,
      clusterSize: cluster.length,
      awaitingModel,
      entry,
    };
    this.evaluations.set(post.id, evaluation);
    // Health counts the posts on the page, not the ones quoted inside them.
    if (!previous && !quoted) {
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

  private treatmentFor(evaluation: Evaluation, handle: string, quoted: boolean): Treatment | null {
    const { verdict } = evaluation;
    if (!verdict.flagged) {
      return evaluation.awaitingModel && this.settings.model.preBlur
        ? { action: 'blur', label: 'Checking…', detail: 'Abuse Shield is scoring this post', actions: [] }
        : null;
    }
    const what = verdict.categories.map((c) => CATEGORY_LABELS[c]).join(', ') || 'copy-paste reply';
    const reason = verdict.reasons[0];
    const shown = reason && !this.settings.display.showMatchedWords ? withoutMatchedWords(reason) : reason;
    return {
      action: verdict.severe ? this.settings.actions.severe : this.settings.actions.mild,
      label: quoted ? 'Quoted post hidden by Abuse Shield' : 'Hidden by Abuse Shield',
      short: quoted ? 'Quote hidden' : 'Hidden',
      detail: shown ? `${what} · ${shown}` : what,
      // X's ⋯ menu belongs to the quoting post, so "Mute on X" can't reach a quoted author.
      actions: quoted ? ['not-abusive', 'mute'] : ['not-abusive', 'mute', 'mute-on-x'],
      handle,
    };
  }

  /** Queues a text for the model. Returns whether scores are on their way. */
  private requestModel(text: string, postId: string): boolean {
    const { model } = this.settings;
    if (!this.deps.classify || !model.enabled || !model.downloadApproved || this.modelOff) return false;
    if (text.trim().length < 2 || this.modelFailed.has(text)) return false;
    let posts = this.postsByText.get(text);
    if (!posts) this.postsByText.set(text, (posts = new Set()));
    posts.add(postId);
    if (!this.modelPending.has(text)) {
      this.modelPending.add(text);
      this.modelQueue.push(text);
      this.modelFlush ??= setTimeout(() => this.flushModel(), MODEL_FLUSH_MS);
    }
    return true;
  }

  private flushModel(): void {
    this.modelFlush = null;
    const texts = this.modelQueue.splice(0);
    if (texts.length === 0 || !this.deps.classify) return;
    const done = () => {
      texts.forEach((text) => this.modelPending.delete(text));
      this.reevaluate(texts.flatMap((text) => [...(this.postsByText.get(text) ?? [])]));
    };
    this.deps.classify(texts).then(
      (scores) => {
        if (scores) texts.forEach((text, i) => this.modelScores.set(text, scores[i]!));
        else this.modelOff = true;
        done();
      },
      () => {
        // Don't retry these texts in a loop; they're re-requested after a settings change.
        texts.forEach((text) => this.modelFailed.add(text));
        done();
      },
    );
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
        languages: { en: settings.lexicon.en, hi: settings.lexicon.hi, hinglish: settings.lexicon.hinglish, emoji: settings.lexicon.emoji },
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
