// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectRecords } from '@/adapters/x-api/collect';
import { quoteCard } from '@/adapters/x-dom/extract';
import { X } from '@/adapters/x-dom/selectors';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import type { Settings } from '@/core/config/schema';
import type { CategoryScores } from '@/core/engine/categories';
import type { MuteState, Strike } from '@/core/mute/mutes';
import type { ReviewEntry } from '@/core/review/log';
import { ContentPipeline } from '@/entrypoints/x.content/pipeline';
import type { TabHealth } from '@/shared/health';
import { loadHtmlFixture, loadJsonFixture } from '../helpers';

const NOW = Date.parse('2026-10-23T15:00:00Z');

// Attached pipelines watch the whole document; detach them so one test's
// pipeline can't react to the next test's page.
const created: ContentPipeline[] = [];
afterEach(() => created.splice(0).forEach((pipeline) => pipeline.detach()));

function setup(
  path: string,
  options: {
    settings?: Partial<Settings>;
    muteState?: MuteState;
    classify?: (texts: string[]) => Promise<CategoryScores[] | null>;
  } = {},
) {
  const strikes: Strike[] = [];
  const entries: ReviewEntry[] = [];
  const health: TabHealth[] = [];
  const pipeline = new ContentPipeline(
    {
      doc: document,
      path: () => path,
      now: () => NOW,
      onFlagged: (entry, strike) => {
        entries.push(entry);
        if (strike) strikes.push(strike);
      },
      onHealth: (h) => health.push(h),
      classify: options.classify,
    },
    { ...structuredClone(DEFAULT_SETTINGS), ...options.settings },
    options.muteState ?? { mutes: [], strikes: [] },
  );
  created.push(pipeline);
  return { pipeline, strikes, entries, health };
}

const scores = (partial: Partial<CategoryScores> = {}): CategoryScores => ({
  toxicity: 0.02,
  severe_toxicity: 0,
  obscene: 0,
  threat: 0,
  insult: 0.01,
  identity_attack: 0,
  sexual_explicit: 0,
  ...partial,
});

/** A fake model whose answers are released by the test. */
function deferredModel(score: (text: string) => CategoryScores | null) {
  const requests: string[][] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const classify = async (texts: string[]) => {
    requests.push(texts);
    await gate;
    const results = texts.map(score);
    return results.some((r) => r === null) ? null : (results as CategoryScores[]);
  };
  return { classify, requests, release };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const modelOn = { model: { ...DEFAULT_SETTINGS.model, downloadApproved: true } };

/** postId → data-xas action, or null when untouched. */
function treatments(): Record<string, string | null> {
  return Object.fromEntries(
    [...document.querySelectorAll(X.post)].map((article) => {
      const id = /\/status\/(\d+)/.exec(article.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') ?? '')?.[1];
      return [id ?? 'ad', article.getAttribute('data-xas')];
    }),
  );
}

const placeholderText = (postId: string) =>
  document.querySelector(`article[data-xas-post="${postId}"] .xas-placeholder`)?.textContent ?? '';

describe('home · For you', () => {
  beforeEach(() => loadHtmlFixture('synthetic-home-for-you.html'));

  it('blurs word-list abuse before paint and reports a strike', () => {
    const { pipeline, strikes } = setup('/home');
    pipeline.attach();
    expect(treatments()).toEqual({ '2001': null, '2002': 'blur', '2003': null, '2004': null, ad: null });
    expect(placeholderText('2002')).toContain('insult');
    expect(strikes.map((s) => [s.handle, s.postId])).toEqual([['srihars47664037', '2002']]);
  });

  it('quotes the matched word on hidden posts only when the setting is on', () => {
    setup('/home').pipeline.attach();
    expect(placeholderText('2002')).toContain('insult · word list');
    expect(placeholderText('2002').toLowerCase()).not.toContain('chutiya');

    loadHtmlFixture('synthetic-home-for-you.html');
    setup('/home', { settings: { display: { showMatchedWords: true } } }).pipeline.attach();
    expect(placeholderText('2002')).toContain('insult · word list: “chutiya”');
  });

  it('never filters the logged-in user’s own posts', () => {
    setup('/home').pipeline.attach();
    expect(treatments()['2004']).toBeNull();
  });

  it('does nothing outside the enabled scopes', () => {
    setup('/explore').pipeline.attach();
    expect(Object.values(treatments()).every((t) => t === null)).toBe(true);

    loadHtmlFixture('synthetic-home-for-you.html');
    setup('/home', { settings: { scopes: { ...DEFAULT_SETTINGS.scopes, forYou: false } } }).pipeline.attach();
    expect(treatments()['2002']).toBeNull();
  });

  it('filters the Following tab under its own switch', () => {
    document.querySelectorAll('[role="tab"]').forEach((tab, i) => tab.setAttribute('aria-selected', String(i === 1)));
    setup('/home').pipeline.attach();
    expect(treatments()['2002']).toBe('blur');

    loadHtmlFixture('synthetic-home-for-you.html');
    document.querySelectorAll('[role="tab"]').forEach((tab, i) => tab.setAttribute('aria-selected', String(i === 1)));
    setup('/home', { settings: { scopes: { ...DEFAULT_SETTINGS.scopes, following: false } } }).pipeline.attach();
    expect(treatments()['2002']).toBeNull();
  });

  it('hides muted authors everywhere with their own label', () => {
    const muteState: MuteState = {
      mutes: [{ handle: 'priya_runs', mutedAt: NOW - 1000, expiresAt: null, reason: 'manual', evidence: [] }],
      strikes: [],
    };
    setup('/home', { muteState }).pipeline.attach();
    expect(treatments()['2001']).toBe('collapse');
    expect(placeholderText('2001')).toContain('Muted @priya_runs');
  });

  it('processes posts X adds later, and reveals on request', async () => {
    const { pipeline } = setup('/home');
    pipeline.attach();
    const timeline = document.querySelector('[aria-label="Timeline: Your Home Timeline"] > div')!;
    const cell = document.querySelector(X.timelineCell)!.cloneNode(true) as Element;
    cell.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', a.getAttribute('href')!.replace('2001', '2099')));
    cell.querySelector(X.postText)!.textContent = 'Madarchod, apni shakal dekh pehle.';
    timeline.append(cell);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(treatments()['2099']).toBe('blur');

    pipeline.reveal('2099');
    expect(document.querySelector('article[data-xas-post="2099"]')?.hasAttribute('data-xas-revealed')).toBe(true);
  });

  it('re-applies when settings change', () => {
    const { pipeline } = setup('/home');
    pipeline.attach();
    pipeline.updateSettings({ ...structuredClone(DEFAULT_SETTINGS), actions: { ...DEFAULT_SETTINGS.actions, mild: 'remove' } });
    expect(treatments()['2002']).toBe('remove');
    expect(document.querySelector('[data-xas-cell="remove"]')).not.toBeNull();
  });
});

describe('thread replies', () => {
  beforeEach(() => loadHtmlFixture('synthetic-thread.html'));
  const path = '/LakotaMan1/status/3000';

  it('leaves the opened post alone by default', () => {
    setup(path).pipeline.attach();
    expect(treatments()['3000']).toBeNull();
  });

  it('hides a 3-account copy-paste brigade and strikes each author', () => {
    const { pipeline, strikes } = setup(path);
    pipeline.attach();
    expect(treatments()).toMatchObject({ '3004': 'blur', '3005': 'blur', '3006': 'blur' });
    expect(placeholderText('3005')).toContain('insult · word list from a highly suspicious account');
    expect(placeholderText('3005')).not.toContain('pagal');
    expect(new Set(strikes.map((s) => s.handle))).toEqual(new Set(['brigade_one', 'brigade_two', 'brigade_three']));
  });

  it('ignores the brigade when copy-paste detection is off', () => {
    setup(path, { settings: { coordination: { ...DEFAULT_SETTINGS.coordination, enabled: false } } }).pipeline.attach();
    expect(treatments()).toMatchObject({ '3004': null, '3005': null, '3006': null });
  });

  it('is stricter with a new account’s mild insult only once X’s account data is known', () => {
    const { pipeline } = setup(path);
    pipeline.attach();
    // Page-only signals (generated handle + default avatar) cap at medium: mild words need model corroboration.
    expect(treatments()['3007']).toBeNull();

    // X's data says 9 days old, 12 followers → high → the mild insult now counts. Late records trigger a re-check.
    pipeline.addRecords({ ...collectRecords(loadJsonFixture('tweet-detail.legacy-shape.json')), operation: 'TweetDetail' });
    expect(treatments()['3007']).toBe('blur');
    expect(placeholderText('3007')).toContain('suspicious');
  });
});

describe('notifications', () => {
  beforeEach(() => loadHtmlFixture('synthetic-notifications.html'));

  it('collapses threats and lets friendly teasing through', () => {
    const { pipeline } = setup('/notifications/mentions');
    pipeline.attach();
    expect(treatments()).toEqual({ '4001': 'collapse', '4002': null, '4003': null });
    expect(placeholderText('4001')).toContain('threat');
  });

  it('hides a mild insult from a 3-day-old account once X’s data arrives', () => {
    const { pipeline } = setup('/notifications/mentions');
    pipeline.addRecords({ ...collectRecords(loadJsonFixture('notifications.rest.json')), operation: 'mentions' });
    pipeline.attach();
    expect(treatments()).toEqual({ '4001': 'collapse', '4002': null, '4003': 'blur' });
  });
});

describe('review log and corrections', () => {
  it('reports why a post was hidden, with account and copy-paste details', () => {
    loadHtmlFixture('synthetic-thread.html');
    const { pipeline, entries } = setup('/LakotaMan1/status/3000');
    pipeline.addRecords({ ...collectRecords(loadJsonFixture('tweet-detail.legacy-shape.json')), operation: 'TweetDetail' });
    pipeline.attach();

    const reply = entries.find((e) => e.postId === '3007')!;
    expect(reply).toMatchObject({
      handle: 'rahul48213977',
      url: 'https://x.com/rahul48213977/status/3007',
      context: 'thread',
      directed: true,
      categories: ['insult'],
      at: NOW,
      account: { ageDays: 9, followers: 12, defaultAvatar: true, source: 'api', level: 'high' },
    });
    expect(reply.wordHits.map((h) => h.term)).toEqual(expect.arrayContaining(['pathetic', 'loser']));

    const copy = entries.find((e) => e.postId === '3005')!;
    expect(copy.cluster?.size).toBe(3);
    expect(new Set(copy.cluster?.handles)).toEqual(new Set(['brigade_one', 'brigade_two', 'brigade_three']));
  });

  it('shows posts marked "not abusive", here and after an override sync', () => {
    loadHtmlFixture('synthetic-home-for-you.html');
    const { pipeline } = setup('/home');
    pipeline.attach();
    expect(treatments()['2002']).toBe('blur');
    pipeline.markNotAbusive('2002');
    expect(treatments()['2002']).toBeNull();

    loadHtmlFixture('synthetic-home-for-you.html');
    const other = setup('/home');
    other.pipeline.updateOverrides(['2002']);
    other.pipeline.attach();
    expect(treatments()['2002']).toBeNull();
  });

  it('offers Unmute on muted posts and Not abusive / Mute on hidden ones', () => {
    loadHtmlFixture('synthetic-home-for-you.html');
    const muteState: MuteState = {
      mutes: [{ handle: 'priya_runs', mutedAt: NOW - 1000, expiresAt: null, reason: 'manual', evidence: [] }],
      strikes: [],
    };
    setup('/home', { muteState }).pipeline.attach();
    const actions = (id: string) =>
      [...document.querySelectorAll(`article[data-xas-post="${id}"] [data-xas-act]`)].map((b) => b.getAttribute('data-xas-act'));
    expect(actions('2001')).toEqual(['show', 'unmute']);
    expect(actions('2002')).toEqual(['show', 'not-abusive', 'mute', 'mute-on-x']);
  });
});

describe('AI model tier', () => {
  beforeEach(() => loadHtmlFixture('synthetic-home-for-you.html'));

  it('sends only unsettled posts, then hides what the model flags', async () => {
    const model = deferredModel((text) => (text.includes('Not okay') ? scores({ toxicity: 0.81, insult: 0.78 }) : scores()));
    const { pipeline, strikes } = setup('/home', { settings: modelOn, classify: model.classify });
    pipeline.attach();
    await settle();
    // 2002 is settled by the word list; 2004 is the user's own post.
    expect(model.requests.flat().sort()).toEqual([
      'Just finished my morning run, feeling great! 🏃',
      'This is the kind of reply people get. Not okay.',
    ]);
    expect(treatments()['2003']).toBeNull();

    model.release();
    await settle();
    expect(treatments()).toMatchObject({ '2001': null, '2002': 'blur', '2003': 'blur' });
    expect(placeholderText('2003')).toContain('model: toxicity 0.81');
    expect(strikes.map((s) => s.postId).sort()).toEqual(['2002', '2003']);
  });

  it('blurs posts while they wait, when pre-blur is on', async () => {
    const model = deferredModel(() => scores());
    const { pipeline } = setup('/home', { settings: { model: { ...modelOn.model, preBlur: true } }, classify: model.classify });
    pipeline.attach();
    expect(treatments()['2001']).toBe('blur');
    expect(placeholderText('2001')).toContain('Checking');
    model.release();
    await settle();
    expect(treatments()['2001']).toBeNull();
  });

  it('asks nothing until the download is approved, and stops asking when the model is off', async () => {
    const unapproved = deferredModel(() => scores());
    setup('/home', { classify: unapproved.classify }).pipeline.attach();
    await settle();
    expect(unapproved.requests).toEqual([]);

    loadHtmlFixture('synthetic-home-for-you.html');
    const off = deferredModel(() => null);
    const { pipeline } = setup('/home', { settings: { model: { ...modelOn.model, preBlur: true } }, classify: off.classify });
    pipeline.attach();
    off.release();
    await settle();
    expect(treatments()['2001']).toBeNull();
    pipeline.processAll();
    await settle();
    expect(off.requests).toHaveLength(1);
  });

  it('counts a mild word once the model corroborates it (thread reply, page-only signals)', async () => {
    loadHtmlFixture('synthetic-thread.html');
    const model = deferredModel((text) => (text.includes('loser') ? scores({ toxicity: 0.31 }) : scores()));
    const { pipeline } = setup('/LakotaMan1/status/3000', { settings: modelOn, classify: model.classify });
    pipeline.attach();
    model.release();
    await settle();
    // Generated handle + default avatar = medium suspicion: a reply's mild word needs toxicity ≥ 0.25.
    expect(treatments()['3007']).toBe('blur');
  });
});

/** Copies a post's timeline row under a new id with new text (and optional extra markup), as X would add it. */
function addPost(sourceId: string, id: string, text: string, prepend = ''): Element {
  const source = document.querySelector(`a[href$="/status/${sourceId}"]`)!.closest(X.timelineCell)!;
  const cell = source.cloneNode(true) as Element;
  cell.querySelectorAll('a[href*="/status/"]').forEach((a) => a.setAttribute('href', a.getAttribute('href')!.replace(sourceId, id)));
  cell.querySelector(X.postText)!.textContent = text;
  if (prepend) cell.querySelector(X.post)!.insertAdjacentHTML('afterbegin', prepend);
  source.parentElement!.append(cell);
  return cell.querySelector(X.post)!;
}

const homeRecords = () => ({ ...collectRecords(loadJsonFixture('home-timeline.graphql.json')), operation: 'HomeTimeline' });
const buttons = (el: Element) => [...el.querySelectorAll(':scope > .xas-placeholder [data-xas-act]')].map((b) => b.getAttribute('data-xas-act'));

describe('edge cases', () => {
  beforeEach(() => loadHtmlFixture('synthetic-home-for-you.html'));

  it('reads the full text of a long post that the page cuts off behind "Show more"', () => {
    addPost('2001', '2005', 'A long post that the page cuts off behind Show more. The full text only arrives…');
    const { pipeline } = setup('/home');
    pipeline.addRecords(homeRecords());
    pipeline.attach();
    expect(treatments()['2005']).toBe('blur');
  });

  it('hides reposts by a muted account, whoever wrote the post', () => {
    const repost = addPost('2001', '2006', 'Lovely sunset today', '<a href="/Loud_Reposter" role="link"><span data-testid="socialContext">Loud reposted</span></a>');
    const muteState: MuteState = {
      mutes: [{ handle: 'loud_reposter', mutedAt: NOW - 1000, expiresAt: null, reason: 'manual', evidence: [] }],
      strikes: [],
    };
    setup('/home', { muteState }).pipeline.attach();
    expect(treatments()).toMatchObject({ '2001': null, '2006': 'collapse' });
    expect(placeholderText('2006')).toContain('Muted @Loud_Reposter');
    expect(placeholderText('2006')).toContain('reposted by a muted account');
    // Unmute acts on the reposter, not the author.
    expect(repost.getAttribute('data-xas-handle')).toBe('Loud_Reposter');
    expect(buttons(repost)).toEqual(['show', 'unmute']);
  });

  it('scores a quoted post on its own and hides just the quote card', () => {
    const { pipeline, strikes, entries } = setup('/home');
    pipeline.attach();
    const article = document.querySelector('a[href$="/status/2003"]')!.closest(X.post)!;
    const card = quoteCard(article)!;
    // Without X's data the quoted post has no id, so it's left alone.
    expect(card.hasAttribute('data-xas')).toBe(false);

    pipeline.addRecords(homeRecords());
    expect(treatments()['2003']).toBeNull();
    expect(card.getAttribute('data-xas')).toBe('blur');
    expect(card.querySelector('.xas-placeholder')?.textContent).toContain('Quoted post hidden by Abuse Shield');
    expect(buttons(card)).toEqual(['show', 'not-abusive', 'mute']);
    expect(card.getAttribute('data-xas-handle')).toBe('troll_acct');
    expect(strikes).toContainEqual(expect.objectContaining({ handle: 'troll_acct', postId: '1990' }));
    // Quoted in a timeline post, it's judged as the standalone post it was.
    expect(entries.find((e) => e.postId === '1990')).toMatchObject({ url: 'https://x.com/troll_acct/status/1990', directed: false });

    pipeline.reveal('1990');
    expect(card.hasAttribute('data-xas-revealed')).toBe(true);
    pipeline.markNotAbusive('1990');
    expect(card.hasAttribute('data-xas')).toBe(false);
  });

  it('collapses a quote by a muted account', () => {
    const muteState: MuteState = {
      mutes: [{ handle: 'troll_acct', mutedAt: NOW - 1000, expiresAt: null, reason: 'strikes', evidence: [] }],
      strikes: [],
    };
    const { pipeline } = setup('/home', { muteState });
    pipeline.addRecords(homeRecords());
    pipeline.attach();
    const card = quoteCard(document.querySelector('a[href$="/status/2003"]')!.closest(X.post)!)!;
    expect(card.getAttribute('data-xas')).toBe('collapse');
    expect(card.textContent).toContain('quoted post · muted after repeated abuse');
  });

  it('learns who you are from X’s data when the page has no profile link (phone layout)', () => {
    document.querySelector(X.ownProfileLink)?.remove();
    addPost('2001', '2009', 'Some bitch keeps replying to me');
    document.querySelector('a[href$="/status/2009"]')!.closest(X.post)!.querySelectorAll('a[href="/priya_runs"]').forEach((a) => a.setAttribute('href', '/downlz'));
    const { pipeline } = setup('/home');
    pipeline.attach();
    expect(treatments()['2009']).toBe('blur');
    pipeline.addRecords({ users: [], posts: [], operation: 'Viewer', viewer: 'downlz' });
    expect(treatments()['2009']).toBeNull();
  });

  it('can leave accounts you follow alone (off by default)', () => {
    const records = homeRecords();
    records.users.find((u) => u.handle === 'Srihars47664037')!.youFollow = true;
    let { pipeline } = setup('/home');
    pipeline.addRecords(records);
    pipeline.attach();
    expect(treatments()['2002']).toBe('blur');

    loadHtmlFixture('synthetic-home-for-you.html');
    ({ pipeline } = setup('/home', { settings: { exemptFollowing: true } }));
    pipeline.addRecords(records);
    pipeline.attach();
    expect(treatments()['2002']).toBeNull();
  });

  it('reads emoji-only posts: 🖕 anywhere, 🤡 only in replies from suspicious accounts', () => {
    addPost('2001', '2007', '🖕🖕');
    addPost('2001', '2008', '🤡🤡🤡');
    setup('/home').pipeline.attach();
    expect(treatments()).toMatchObject({ '2007': 'blur', '2008': null });

    loadHtmlFixture('synthetic-thread.html');
    addPost('3007', '3099', '🤡🤡🤡');
    const { pipeline } = setup('/LakotaMan1/status/3000');
    pipeline.addRecords({ ...collectRecords(loadJsonFixture('tweet-detail.legacy-shape.json')), operation: 'TweetDetail' });
    pipeline.attach();
    expect(treatments()['3099']).toBe('blur');
  });
});

describe('health', () => {
  beforeEach(() => loadHtmlFixture('synthetic-home-for-you.html'));

  it('reports reading posts and account-data coverage', () => {
    const { pipeline, health } = setup('/home');
    pipeline.addRecords({ ...collectRecords(loadJsonFixture('home-timeline.graphql.json')), operation: 'HomeTimeline' });
    pipeline.attach();
    expect(health.at(-1)).toMatchObject({ dom: 'ok', api: 'ok', postsSeen: 4 });
    // 2001 and 2002 have records; the quote poster and own post don't (own posts aren't scored).
    expect(health.at(-1)!.coverage).toBeCloseTo(2 / 3);
  });
});
