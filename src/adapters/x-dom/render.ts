import type { Action } from '@/core/config/schema';
import { X } from './selectors';

export interface Treatment {
  action: Action;
  /** "Hidden by Abuse Shield" or "Muted @handle". */
  label: string;
  /** Short reason, e.g. "insult · word list". */
  detail: string;
}

const ATTR = 'data-xas';
const REVEALED = 'data-xas-revealed';
const POST = 'data-xas-post';
const CELL = 'data-xas-cell';
export const PLACEHOLDER_CLASS = 'xas-placeholder';
const SHOW_BUTTON = 'data-xas-show';

const STYLE_ID = 'xabuseshield-style';
const CSS = `
article[${ATTR}] { position: relative; }
article[${ATTR}="blur"]:not([${REVEALED}]) > :not(.${PLACEHOLDER_CLASS}) {
  filter: blur(12px); pointer-events: none; user-select: none;
}
article[${ATTR}="collapse"]:not([${REVEALED}]) > :not(.${PLACEHOLDER_CLASS}) { display: none !important; }
[${CELL}="remove"] { display: none !important; }
article[${REVEALED}] > .${PLACEHOLDER_CLASS} { display: none; }
.${PLACEHOLDER_CLASS} {
  display: flex; align-items: center; gap: 12px; padding: 10px 16px;
  font: 14px/1.4 system-ui, sans-serif; color: inherit;
  background: color-mix(in srgb, currentColor 7%, transparent);
  border-radius: 8px; margin: 8px 16px;
}
article[${ATTR}="blur"] > .${PLACEHOLDER_CLASS} {
  position: absolute; inset: 50% 16px auto; transform: translateY(-50%); z-index: 1; margin: 0;
  background: color-mix(in srgb, Canvas 85%, transparent); backdrop-filter: blur(2px);
}
.${PLACEHOLDER_CLASS} span { flex: 1; min-width: 0; }
.${PLACEHOLDER_CLASS} small { display: block; opacity: 0.7; }
.${PLACEHOLDER_CLASS} button {
  font: inherit; font-weight: 600; padding: 4px 14px; border-radius: 999px; cursor: pointer;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit;
}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
}

/**
 * Applies or clears a treatment. Idempotent and write-free when nothing
 * changed, so it can run on every mutation without feedback loops.
 */
export function render(article: Element, postId: string, treatment: Treatment | null, revealed: boolean): void {
  const cell = article.closest(X.timelineCell);
  let placeholder = [...article.children].find((c) => c.classList.contains(PLACEHOLDER_CLASS));

  if (!treatment) {
    if (article.hasAttribute(ATTR)) {
      article.removeAttribute(ATTR);
      article.removeAttribute(REVEALED);
      article.removeAttribute(POST);
    }
    placeholder?.remove();
    if (cell?.hasAttribute(CELL)) cell.removeAttribute(CELL);
    return;
  }

  // "remove" needs a timeline row to hide; a post outside one is collapsed instead.
  const action: Action = treatment.action === 'remove' && !cell ? 'collapse' : treatment.action;
  setAttr(article, ATTR, action);
  setAttr(article, POST, postId);
  if (revealed) setAttr(article, REVEALED, '');
  else if (article.hasAttribute(REVEALED)) article.removeAttribute(REVEALED);
  if (cell) {
    if (action === 'remove' && !revealed) setAttr(cell, CELL, 'remove');
    else if (cell.hasAttribute(CELL)) cell.removeAttribute(CELL);
  }

  if (!placeholder) {
    // Built node by node: X's CSP may enforce Trusted Types for innerHTML.
    const doc = article.ownerDocument;
    placeholder = doc.createElement('div');
    placeholder.className = PLACEHOLDER_CLASS;
    const text = doc.createElement('span');
    text.append(doc.createElement('strong'), doc.createElement('small'));
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute(SHOW_BUTTON, '');
    button.textContent = 'Show';
    placeholder.append(text, button);
    article.prepend(placeholder);
  }
  const strong = placeholder.querySelector('strong')!;
  const small = placeholder.querySelector('small')!;
  if (strong.textContent !== treatment.label) strong.textContent = treatment.label;
  if (small.textContent !== treatment.detail) small.textContent = treatment.detail;
}

/**
 * Handles "Show" clicks in the capture phase at the document, before X's
 * own click handler would open the post.
 */
export function onShowClick(handler: (postId: string, article: Element) => void, doc: Document = document): void {
  doc.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element | null)?.closest?.(`[${SHOW_BUTTON}]`);
      const article = button?.closest(`article[${POST}]`);
      if (!button || !article) return;
      event.preventDefault();
      event.stopPropagation();
      handler(article.getAttribute(POST)!, article);
    },
    true,
  );
}

export function isOwnNode(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).classList.contains(PLACEHOLDER_CLASS);
}

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
