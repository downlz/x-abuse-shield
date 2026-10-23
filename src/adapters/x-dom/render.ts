import type { Action } from '@/core/config/schema';
import { X } from './selectors';

/** Buttons under a hidden post, besides "Show". */
export type PlaceholderAction = 'not-abusive' | 'mute' | 'unmute' | 'mute-on-x';
export type ClickedAction = PlaceholderAction | 'show';

export interface Treatment {
  action: Action;
  /** "Hidden by Abuse Shield" or "Muted @handle". */
  label: string;
  /** Short reason, e.g. "insult · word list". */
  detail: string;
  actions: PlaceholderAction[];
}

const ACTION_LABELS: Record<PlaceholderAction, string> = {
  'not-abusive': 'Not abusive',
  mute: 'Mute here',
  unmute: 'Unmute',
  'mute-on-x': 'Mute on X',
};

const ATTR = 'data-xas';
const REVEALED = 'data-xas-revealed';
const POST = 'data-xas-post';
const CELL = 'data-xas-cell';
export const PLACEHOLDER_CLASS = 'xas-placeholder';
const ACTION_ATTR = 'data-xas-act';

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
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 16px;
  font: 14px/1.4 system-ui, sans-serif; color: inherit;
  background: color-mix(in srgb, currentColor 7%, transparent);
  border-radius: 8px; margin: 8px 16px;
}
article[${ATTR}="blur"] > .${PLACEHOLDER_CLASS} {
  position: absolute; inset: 50% 16px auto; transform: translateY(-50%); z-index: 1; margin: 0;
  background: color-mix(in srgb, Canvas 85%, transparent); backdrop-filter: blur(2px);
}
.${PLACEHOLDER_CLASS} > span { flex: 1 1 220px; min-width: 0; }
.${PLACEHOLDER_CLASS} small { display: block; opacity: 0.7; }
.${PLACEHOLDER_CLASS} .xas-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.${PLACEHOLDER_CLASS} button {
  font: inherit; font-size: 13px; padding: 3px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit;
}
.${PLACEHOLDER_CLASS} button[${ACTION_ATTR}="show"] { font-weight: 600; }
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

  // Built node by node: X's CSP may enforce Trusted Types for innerHTML.
  const doc = article.ownerDocument;
  if (!placeholder) {
    placeholder = doc.createElement('div');
    placeholder.className = PLACEHOLDER_CLASS;
    const text = doc.createElement('span');
    text.append(doc.createElement('strong'), doc.createElement('small'));
    const buttons = doc.createElement('div');
    buttons.className = 'xas-buttons';
    placeholder.append(text, buttons);
    article.prepend(placeholder);
  }
  const strong = placeholder.querySelector('strong')!;
  const small = placeholder.querySelector('small')!;
  if (strong.textContent !== treatment.label) strong.textContent = treatment.label;
  if (small.textContent !== treatment.detail) small.textContent = treatment.detail;

  const buttons = placeholder.querySelector('.xas-buttons')!;
  const wanted: ClickedAction[] = ['show', ...treatment.actions];
  if (buttons.getAttribute('data-actions') !== wanted.join(' ')) {
    buttons.setAttribute('data-actions', wanted.join(' '));
    buttons.replaceChildren(
      ...wanted.map((act) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.setAttribute(ACTION_ATTR, act);
        button.textContent = act === 'show' ? 'Show' : ACTION_LABELS[act];
        return button;
      }),
    );
  }
}

/**
 * Handles placeholder buttons in the capture phase at the document, before
 * X's own click handler would open the post.
 */
export function onPlaceholderAction(handler: (action: ClickedAction, postId: string, article: Element) => void, doc: Document = document): void {
  doc.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element | null)?.closest?.(`[${ACTION_ATTR}]`);
      const article = button?.closest(`article[${POST}]`);
      if (!button || !article) return;
      event.preventDefault();
      event.stopPropagation();
      handler(button.getAttribute(ACTION_ATTR) as ClickedAction, article.getAttribute(POST)!, article);
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
