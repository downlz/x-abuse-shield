import { STATUS_HREF, X } from './selectors';

export interface DomPost {
  id: string;
  /** As written on the page, without @. */
  handle: string;
  /** The post's own text, emoji included; empty for media-only posts. */
  text: string;
  /** Text of a quoted post, scored separately (Phase 4). */
  quotedText?: string;
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

  return {
    id,
    handle,
    text: own ? readText(own) : '',
    quotedText: quoted ? readText(quoted) : undefined,
    lang: own?.getAttribute('lang') ?? undefined,
    postedAt: Number.isNaN(postedAt) ? undefined : postedAt,
    avatarUrl: article.querySelector(X.postAvatar)?.getAttribute('src') ?? undefined,
    blueVerified: !!authorBlock?.querySelector(X.verifiedBadge),
  };
}

function insideQuote(el: Element, article: Element): boolean {
  const card = el.closest(X.quoteCard);
  return !!card && card !== article && article.contains(card);
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
