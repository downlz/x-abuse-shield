// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectPageContext, focalPostId, ownHandle } from '@/adapters/x-dom/context';
import { extractPost } from '@/adapters/x-dom/extract';
import { render } from '@/adapters/x-dom/render';
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
      blueVerified: true,
    });
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

describe('render', () => {
  beforeEach(() => loadFixture('synthetic-home-for-you.html'));

  it('blurs with a Show button, then clears without leftovers', () => {
    const article = articles()[1]!;
    render(article, '2002', { action: 'blur', label: 'Hidden by Abuse Shield', detail: 'insult · word list' }, false);
    expect(article.getAttribute('data-xas')).toBe('blur');
    expect(article.querySelector('.xas-placeholder strong')?.textContent).toBe('Hidden by Abuse Shield');
    expect(article.querySelector('[data-xas-show]')).not.toBeNull();

    render(article, '2002', { action: 'blur', label: 'Hidden by Abuse Shield', detail: 'insult · word list' }, false);
    expect(article.querySelectorAll('.xas-placeholder')).toHaveLength(1);

    render(article, '2002', null, false);
    expect(article.hasAttribute('data-xas')).toBe(false);
    expect(article.querySelector('.xas-placeholder')).toBeNull();
  });

  it('removes the whole timeline row, and restores it when revealed', () => {
    const article = articles()[1]!;
    const cell = article.closest(X.timelineCell)!;
    render(article, '2002', { action: 'remove', label: 'x', detail: 'y' }, false);
    expect(cell.getAttribute('data-xas-cell')).toBe('remove');
    render(article, '2002', { action: 'remove', label: 'x', detail: 'y' }, true);
    expect(cell.hasAttribute('data-xas-cell')).toBe(false);
    expect(article.hasAttribute('data-xas-revealed')).toBe(true);
  });
});
