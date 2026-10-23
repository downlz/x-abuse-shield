import { PROFILE_HREF, STATUS_HREF, X } from './selectors';

const HANDLE_TEXT = /^@([A-Za-z0-9_]{1,15})$/;

export interface DomPost {
  id: string;
  /** As written on the page, without @. */
  handle: string;
  /** The post's own text, emoji included; empty for media-only posts. */
  text: string;
  /** Text of a quoted post, scored separately. */
  quotedText?: string;
  /** Author of a quoted post, without @. */
  quotedHandle?: string;
  /** Who reposted it into this timeline, without @. */
  repostedBy?: string;
  lang?: string;
  /** Epoch ms from the <time datetime>. */
  postedAt?: number;
  avatarUrl?: string;
  blueVerified: boolean;
}

/** Null when the article lacks an id or author (ads, "This post is unavailable"). */
export function extractPost(article: Element): DomPost | null {
  // On a post's own page the timestamp sits below any quoted post, so skip the quote's.
  const time = [...article.querySelectorAll(X.postTime)].find((t) => !insideQuote(t, article));
  const permalink = time?.closest('a');
  const id = permalink ? STATUS_HREF.exec(permalink.getAttribute('href') ?? '')?.[1] : undefined;
  const authorLink = article.querySelector(`${X.postAuthor} a[href^="/"]`);
  const handle = authorLink?.getAttribute('href')?.split('/')[1];
  if (!id || !handle) return null;

  const texts = [...article.querySelectorAll(X.postText)];
  const own = texts.find((el) => !insideQuote(el, article));
  const quoted = texts.find((el) => insideQuote(el, article));
  const datetime = time?.getAttribute('datetime');
  const postedAt = datetime ? Date.parse(datetime) : NaN;
  const authorBlock = authorLink?.closest(X.postAuthor);
  // A quote card's author line has no links (the whole card is one): read the "@handle" span.
  const quotedAuthor = [...(quoteCard(article)?.querySelectorAll(`${X.postAuthor} span`) ?? [])]
    .map((span) => HANDLE_TEXT.exec(span.textContent?.trim() ?? '')?.[1])
    .find(Boolean);

  return {
    id,
    handle,
    text: own ? readText(own) : '',
    quotedText: quoted ? readText(quoted) : undefined,
    quotedHandle: quotedAuthor,
    repostedBy: reposter(article),
    lang: own?.getAttribute('lang') ?? undefined,
    postedAt: Number.isNaN(postedAt) ? undefined : postedAt,
    avatarUrl: article.querySelector(X.postAvatar)?.getAttribute('src') ?? undefined,
    blueVerified: !!authorBlock?.querySelector(X.verifiedBadge),
  };
}

/** The card of a post quoted inside this one: the role="link" block that has its own author line. */
export function quoteCard(article: Element): Element | undefined {
  return [...article.querySelectorAll(X.quoteCard)].find((card) => card !== article && card.querySelector(X.postAuthor));
}

function insideQuote(el: Element, article: Element): boolean {
  const card = el.closest(X.quoteCard);
  return !!card && card !== article && article.contains(card);
}

function reposter(article: Element): string | undefined {
  const context = article.querySelector(X.socialContext);
  const link = context?.closest('a[href]') ?? context?.querySelector('a[href]');
  return PROFILE_HREF.exec(link?.getAttribute('href') ?? '')?.[1];
}

/** Text content with emoji images replaced by their alt text ("😂"). */
export function readText(el: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) out += node.nodeValue ?? '';
    else if (node.nodeType === 1) {
      const element = node as Element;
      if (element.tagName === 'IMG') out += element.getAttribute('alt') ?? '';
      else if (element.tagName === 'BR') out += '\n';
      else element.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  return out.trim();
}
