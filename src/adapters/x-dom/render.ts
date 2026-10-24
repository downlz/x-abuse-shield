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
  /** The account the buttons act on: the author, or the muted reposter. */
  handle?: string;
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
const HANDLE = 'data-xas-handle';
const CELL = 'data-xas-cell';
export const PLACEHOLDER_CLASS = 'xas-placeholder';
const ACTION_ATTR = 'data-xas-act';

const STYLE_ID = 'xabuseshield-style';
const THEME_ID = 'xabuseshield-theme';
// [data-xas] is a post's <article>, or the card of a post quoted inside one.
// --xas-fg / --xas-bg follow X's theme (syncTheme); without them the page's own colours apply.
const CSS = `
[${ATTR}] { position: relative; }
[${ATTR}="blur"]:not([${REVEALED}]) > :not(.${PLACEHOLDER_CLASS}) {
  filter: blur(12px); pointer-events: none; user-select: none;
}
[${ATTR}="collapse"]:not([${REVEALED}]) > :not(.${PLACEHOLDER_CLASS}) { display: none !important; }
[${CELL}="remove"] { display: none !important; }
[${REVEALED}] > .${PLACEHOLDER_CLASS} { display: none; }
.${PLACEHOLDER_CLASS} {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 16px;
  font: 14px/1.4 system-ui, sans-serif; color: var(--xas-fg, inherit);
  background: color-mix(in srgb, currentColor 7%, transparent);
  border-radius: 8px; margin: 8px 16px;
}
[${ATTR}="blur"] > .${PLACEHOLDER_CLASS} {
  position: absolute; inset: 50% 16px auto; transform: translateY(-50%); z-index: 1; margin: 0;
  background: color-mix(in srgb, var(--xas-bg, Canvas) 85%, transparent); backdrop-filter: blur(2px);
}
@media (pointer: coarse) {
  .${PLACEHOLDER_CLASS} { font-size: 15px; }
  .${PLACEHOLDER_CLASS} .xas-buttons { gap: 8px; }
  .${PLACEHOLDER_CLASS} button { min-height: 40px; padding: 6px 16px; font-size: 14px; }
  /* On a narrow screen the buttons wrap, so a floating panel can outgrow a short post: put it above the post instead. */
  [${ATTR}="blur"] > .${PLACEHOLDER_CLASS} { position: static; transform: none; margin: 8px 12px; }
}
:not(article)[${ATTR}] > .${PLACEHOLDER_CLASS} { margin: 8px; padding: 6px 12px; }
:not(article)[${ATTR}="blur"] > .${PLACEHOLDER_CLASS} { inset: 50% 8px auto; }
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
 * Follows X's theme (Default, Dim, Lights out), which X applies as the body's
 * background colour. Reads only the inline style, so it's cheap enough to
 * call on every batch of posts.
 */
export function syncTheme(doc: Document = document): void {
  const background = doc.body?.style.backgroundColor;
  const rgb = background ? /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(background) : null;
  let style = doc.getElementById(THEME_ID);
  if (!background || !rgb || style?.dataset.background === background) return;
  const [r, g, b] = rgb.slice(1).map(Number) as [number, number, number];
  // X's own text colours for its light and dark themes.
  const foreground = 0.299 * r + 0.587 * g + 0.114 * b < 128 ? '#e7e9ea' : '#0f1419';
  if (!style) {
    style = doc.createElement('style');
    style.id = THEME_ID;
    (doc.head ?? doc.documentElement).append(style);
  }
  style.dataset.background = background;
  style.textContent = `:root { --xas-bg: ${background}; --xas-fg: ${foreground}; }`;
}

/**
 * Applies or clears a treatment on a post's <article>, or on the card of a
 * quoted post. Idempotent and write-free when nothing changed, so it can run
 * on every mutation without feedback loops.
 */
export function render(target: Element, postId: string, treatment: Treatment | null, revealed: boolean): void {
  // Only a whole post can go with its timeline row; a quote card is collapsed instead.
  const cell = target.matches(X.post) ? target.closest(X.timelineCell) : null;
  let placeholder = [...target.children].find((c) => c.classList.contains(PLACEHOLDER_CLASS));

  if (!treatment) {
    if (target.hasAttribute(ATTR)) {
      target.removeAttribute(ATTR);
      target.removeAttribute(REVEALED);
      target.removeAttribute(POST);
      target.removeAttribute(HANDLE);
    }
    placeholder?.remove();
    if (cell?.hasAttribute(CELL)) cell.removeAttribute(CELL);
    return;
  }

  // "remove" needs a timeline row to hide; anything else is collapsed instead.
  const action: Action = treatment.action === 'remove' && !cell ? 'collapse' : treatment.action;
  setAttr(target, ATTR, action);
  setAttr(target, POST, postId);
  if (treatment.handle) setAttr(target, HANDLE, treatment.handle);
  else if (target.hasAttribute(HANDLE)) target.removeAttribute(HANDLE);
  if (revealed) setAttr(target, REVEALED, '');
  else if (target.hasAttribute(REVEALED)) target.removeAttribute(REVEALED);
  if (cell) {
    if (action === 'remove' && !revealed) setAttr(cell, CELL, 'remove');
    else if (cell.hasAttribute(CELL)) cell.removeAttribute(CELL);
  }

  // Built node by node: X's CSP may enforce Trusted Types for innerHTML.
  const doc = target.ownerDocument;
  if (!placeholder) {
    placeholder = doc.createElement('div');
    placeholder.className = PLACEHOLDER_CLASS;
    const text = doc.createElement('span');
    // Matched words may be in a right-to-left script, or the page may be.
    text.dir = 'auto';
    text.append(doc.createElement('strong'), doc.createElement('small'));
    const buttons = doc.createElement('div');
    buttons.className = 'xas-buttons';
    placeholder.append(text, buttons);
    target.prepend(placeholder);
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
 * X's own click handler would open the post. `target` is the post's
 * <article>, or the quote card the placeholder sits in.
 */
export function onPlaceholderAction(
  handler: (action: ClickedAction, postId: string, target: Element, handle: string | undefined) => void,
  doc: Document = document,
): void {
  doc.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element | null)?.closest?.(`[${ACTION_ATTR}]`);
      const target = button?.closest(`[${POST}]`);
      if (!button || !target) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = target.getAttribute(HANDLE) ?? undefined;
      handler(button.getAttribute(ACTION_ATTR) as ClickedAction, target.getAttribute(POST)!, target, handle);
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
