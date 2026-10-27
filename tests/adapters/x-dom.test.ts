// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectPageContext, focalPostId, ownHandle } from '@/adapters/x-dom/context';
import { extractPost, quoteCard } from '@/adapters/x-dom/extract';
import { findMuteItem, muteOnX } from '@/adapters/x-dom/mute-on-x';
import { onPlaceholderAction, render, syncTheme } from '@/adapters/x-dom/render';
import { X } from '@/adapters/x-dom/selectors';
import { loadHtmlFixture as loadFixture } from '../helpers';

const articles = () => [...document.querySelectorAll(X.post)];

describe('home timeline (synthetic)', () => {
  beforeEach(() => loadFixture('synthetic-home-for-you.html'));

  it('detects For you by tab position and the logged-in handle', () => {
    expect(detectPageContext(document, '/home')).toBe('for-you');
    document.querySelectorAll('[role="tab"]').forEach((tab, i) => tab.setAttribute('aria-selected', String(i === 1)));
    expect(detectPageContext(document, '/home')).toBe('following');
    expect(ownHandle(document)).toBe('downlz');
  });

  it('extracts id, handle, text with emoji, language, time and avatar', () => {
    const [clean, abusive] = articles().map(extractPost);
    expect(clean).toMatchObject({
      id: '2001',
      handle: 'priya_runs',
      text: 'Just finished my morning run, feeling great! 🏃',
      lang: 'en',
      postedAt: Date.parse('2026-10-23T14:00:00.000Z'),
      blueVerified: false,
    });
    expect(abusive).toMatchObject({ id: '2002', handle: 'Srihars47664037', text: 'Chutiya fellow posting useless', lang: 'hi' });
    expect(abusive?.avatarUrl).toContain('/default_profile_images/');
  });

  it('keeps a quoted post separate from the post’s own text', () => {
    const quote = extractPost(articles()[2]!);
    expect(quote).toMatchObject({
      id: '2003',
      handle: 'newsdesk',
      text: 'This is the kind of reply people get. Not okay.',
      quotedText: 'shut the fuck up, nobody asked',
      quotedHandle: 'troll_acct',
      blueVerified: true,
    });
    expect(quoteCard(articles()[2]!)?.textContent).toContain('@troll_acct');
    expect(quoteCard(articles()[0]!)).toBeUndefined();
  });

  it('reads who reposted a post from the line above it', () => {
    const article = articles()[0]!;
    const context = (html: string) => {
      article.querySelector('[data-testid="socialContext"]')?.closest('div.context')?.remove();
      article.insertAdjacentHTML('afterbegin', `<div class="context">${html}</div>`);
      return extractPost(article)?.repostedBy;
    };
    expect(context('<a href="/Loud_Reposter" role="link"><span data-testid="socialContext">Loud reposted</span></a>')).toBe('Loud_Reposter');
    expect(context('<span data-testid="socialContext"><a href="/other1">Other reposted</a></span>')).toBe('other1');
    // "Pinned" has no link; community posts link to the community.
    expect(context('<span data-testid="socialContext">Pinned</span>')).toBeUndefined();
    expect(context('<a href="/i/communities/123"><span data-testid="socialContext">Cricket</span></a>')).toBeUndefined();
  });

  it('skips articles without a permalink (ads)', () => {
    expect(extractPost(articles()[4]!)).toBeNull();
  });
});

describe('thread page (synthetic)', () => {
  beforeEach(() => loadFixture('synthetic-thread.html'));

  it('finds the focal post from the URL and its timestamp below the text', () => {
    expect(detectPageContext(document, '/LakotaMan1/status/3000')).toBe('thread');
    expect(focalPostId('/LakotaMan1/status/3000')).toBe('3000');
    expect(extractPost(articles()[0]!)).toMatchObject({ id: '3000', handle: 'LakotaMan1' });
  });
});

describe('notifications (synthetic)', () => {
  beforeEach(() => loadFixture('synthetic-notifications.html'));

  it('reads mention posts and ignores like/follow items', () => {
    expect(detectPageContext(document, '/notifications/mentions')).toBe('notifications');
    expect(detectPageContext(document, '/notifications')).toBe('notifications');
    expect(articles().map((a) => extractPost(a)?.handle)).toEqual(['kattar_x', 'old_friend', 'kattar_x']);
  });
});

describe('Mute on X (synthetic menu)', () => {
  beforeEach(() => loadFixture('synthetic-home-for-you.html'));

  /** X-style menu: Follow, Mute, Block (with data-testid="block"). */
  function installMenu(items: string[], onClick: (text: string) => void) {
    const article = articles()[1]!;
    const caret = document.createElement('button');
    caret.setAttribute('data-testid', 'caret');
    caret.addEventListener('click', () => {
      const layers = document.getElementById('layers') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'layers' }));
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.innerHTML = `<div data-testid="Dropdown">${items
        .map((text) => `<div role="menuitem"${text.startsWith('Block') ? ' data-testid="block"' : ''}><span>${text}</span></div>`)
        .join('')}</div>`;
      menu.querySelectorAll('[role="menuitem"]').forEach((item) => item.addEventListener('click', () => onClick(item.textContent!)));
      layers.append(menu);
    });
    article.querySelector('[data-testid="User-Name"]')!.append(caret);
    return article;
  }

  it('clicks "Mute @handle", the item right before Block', async () => {
    const clicked: string[] = [];
    const article = installMenu(['Follow @Srihars47664037', 'Mute @Srihars47664037', 'Block @Srihars47664037', 'Report post'], (t) => clicked.push(t));
    await expect(muteOnX(article, 'Srihars47664037')).resolves.toBe('muted');
    expect(clicked).toEqual(['Mute @Srihars47664037']);
  });

  it('leaves the menu open when it can’t be sure (already muted, or another account)', async () => {
    const clicked: string[] = [];
    const article = installMenu(['Unmute @Srihars47664037', 'Block @Srihars47664037'], (t) => clicked.push(t));
    await expect(muteOnX(article, 'Srihars47664037')).resolves.toBe('menu-open');
    expect(clicked).toEqual([]);
    const menu = document.querySelector('#layers [data-testid="Dropdown"]')!;
    expect(findMuteItem(menu, 'someone_else')).toBeNull();
  });

  it('reports when the post has no menu button', async () => {
    await expect(muteOnX(articles()[0]!, 'priya_runs', 100)).resolves.toBe('no-menu');
  });
});

describe('render', () => {
  beforeEach(() => loadFixture('synthetic-home-for-you.html'));

  it('blurs with Show and action buttons, then clears without leftovers', () => {
    const article = articles()[1]!;
    const treatment = { action: 'blur', label: 'Hidden by Abuse Shield', detail: 'insult · word list', actions: ['not-abusive', 'mute', 'mute-on-x'] } as const;
    render(article, '2002', { ...treatment, actions: [...treatment.actions] }, false);
    expect(article.getAttribute('data-xas')).toBe('blur');
    expect(article.querySelector('.xas-placeholder strong')?.textContent).toBe('Hidden by Abuse Shield');
    expect([...article.querySelectorAll('[data-xas-act]')].map((b) => b.textContent)).toEqual(['Show', 'Not abusive', 'Mute here', 'Mute on X']);

    render(article, '2002', { ...treatment, actions: [...treatment.actions] }, false);
    expect(article.querySelectorAll('.xas-placeholder')).toHaveLength(1);
    expect(article.querySelectorAll('[data-xas-act]')).toHaveLength(4);

    render(article, '2002', null, false);
    expect(article.hasAttribute('data-xas')).toBe(false);
    expect(article.querySelector('.xas-placeholder')).toBeNull();
  });

  it('reports placeholder clicks with the post id and account, without letting X see them', () => {
    const article = articles()[1]!;
    render(article, '2002', { action: 'collapse', label: 'x', detail: 'y', actions: ['not-abusive'], handle: 'Srihars47664037' }, false);
    const clicks: string[] = [];
    let xSawIt = false;
    article.addEventListener('click', () => (xSawIt = true));
    onPlaceholderAction((action, postId, _target, handle) => clicks.push(`${action}:${postId}:${handle}`));
    (article.querySelector('[data-xas-act="not-abusive"]') as HTMLElement).click();
    expect(clicks).toEqual(['not-abusive:2002:Srihars47664037']);
    expect(xSawIt).toBe(false);
  });

  it('gives every button an icon and a name (phones show only the icon), and a short label for phones', () => {
    const article = articles()[1]!;
    render(article, '2002', { action: 'blur', label: 'Hidden by Abuse Shield', short: 'Hidden', detail: 'insult', actions: ['not-abusive', 'mute', 'mute-on-x'] }, false);
    const buttons = [...article.querySelectorAll('[data-xas-act]')];
    expect(buttons.map((b) => [b.querySelector('svg') !== null, b.getAttribute('title')])).toEqual([
      [true, 'Show'],
      [true, 'Not abusive'],
      [true, 'Mute here'],
      [true, 'Mute on X'],
    ]);
    expect(article.querySelector('.xas-short')?.textContent).toBe('Hidden');
  });

  it('keeps a tap on the panel text from opening the post', () => {
    const article = articles()[1]!;
    render(article, '2002', { action: 'blur', label: 'x', detail: 'insult · word list + model toxicity 0.67', actions: [] }, false);
    let xSawIt = false;
    article.addEventListener('click', () => (xSawIt = true));
    onPlaceholderAction(() => undefined);
    article.querySelector<HTMLElement>('.xas-placeholder small')!.click();
    expect(xSawIt).toBe(false);
  });

  it('hides just a quote card, which collapses instead of removing the row', () => {
    const article = articles()[2]!;
    const card = quoteCard(article)!;
    render(card, '1990', { action: 'remove', label: 'Quoted post hidden', detail: 'insult', actions: ['mute'], handle: 'troll_acct' }, false);
    expect(card.getAttribute('data-xas')).toBe('collapse');
    expect(article.hasAttribute('data-xas')).toBe(false);
    expect(article.closest(X.timelineCell)!.hasAttribute('data-xas-cell')).toBe(false);
    const clicks: string[] = [];
    onPlaceholderAction((action, postId, target, handle) => clicks.push(`${action}:${postId}:${handle}:${target === card}`));
    (card.querySelector('[data-xas-act="mute"]') as HTMLElement).click();
    expect(clicks).toEqual(['mute:1990:troll_acct:true']);
  });

  it('follows X’s theme colours, and writes nothing until they change', () => {
    document.body.style.backgroundColor = 'rgb(21, 32, 43)';
    syncTheme(document);
    const theme = () => document.getElementById('xabuseshield-theme')?.textContent;
    expect(theme()).toBe(':root { --xas-bg: rgb(21, 32, 43); --xas-fg: #e7e9ea; }');
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    syncTheme(document);
    expect(theme()).toContain('--xas-fg: #0f1419');
    expect(document.querySelectorAll('#xabuseshield-theme')).toHaveLength(1);
  });

  it('lets placeholder text pick its own direction (right-to-left scripts)', () => {
    const article = articles()[1]!;
    render(article, '2002', { action: 'blur', label: 'x', detail: 'insult · word list: “کتا”', actions: [] }, false);
    expect(article.querySelector<HTMLElement>('.xas-placeholder > span')?.dir).toBe('auto');
  });

  it('removes the whole timeline row, and restores it when revealed', () => {
    const article = articles()[1]!;
    const cell = article.closest(X.timelineCell)!;
    render(article, '2002', { action: 'remove', label: 'x', detail: 'y', actions: [] }, false);
    expect(cell.getAttribute('data-xas-cell')).toBe('remove');
    render(article, '2002', { action: 'remove', label: 'x', detail: 'y', actions: [] }, true);
    expect(cell.hasAttribute('data-xas-cell')).toBe(false);
    expect(article.hasAttribute('data-xas-revealed')).toBe(true);
  });
});
