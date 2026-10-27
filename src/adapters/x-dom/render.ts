import type { Action } from '@/core/config/schema';
import { X } from './selectors';

/** Buttons under a hidden post, besides "Show". */
export type PlaceholderAction = 'not-abusive' | 'mute' | 'unmute' | 'mute-on-x';
export type ClickedAction = PlaceholderAction | 'show';

export interface Treatment {
  action: Action;
  /** "Hidden by Abuse Shield" or "Muted @handle". */
  label: string;
  /** For the one-line panel on phones, e.g. "Hidden"; defaults to `label`. */
  short?: string;
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

type Shape = ['path', string] | ['circle', number, number, number];
/** Icons for the phone panel (24×24, stroked, after Feather icons, MIT). */
const ICONS: Record<ClickedAction, Shape[]> = {
  show: [['path', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'], ['circle', 12, 12, 3]],
  'not-abusive': [['path', 'M20 6 9 17l-5-5']],
  // A person with a minus: muted in this browser.
  mute: [['path', 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'], ['circle', 8.5, 7, 4], ['path', 'M23 11h-6']],
  // A silenced speaker, plus an "X" (CSS) for X's own mute.
  'mute-on-x': [['path', 'M11 5 6 9H2v6h4l5 4V5z'], ['path', 'M23 9l-6 6M17 9l6 6']],
  unmute: [['path', 'M11 5 6 9H2v6h4l5 4V5z'], ['path', 'M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07']],
};
const SVG_NS = 'http://www.w3.org/2000/svg';

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
.${PLACEHOLDER_CLASS} .xas-short, .${PLACEHOLDER_CLASS} button svg { display: none; }
/* Phones: a centred row of icon buttons, with the whole reason on the line below. */
@media (pointer: coarse) {
  .${PLACEHOLDER_CLASS} { flex-wrap: wrap; gap: 6px 8px; padding: 8px 12px 10px; font-size: 14px; }
  [${ATTR}="blur"] > .${PLACEHOLDER_CLASS} { inset: 50% 12px auto; }
  /* The two-row panel floats over the blurred post: keep even a one-line post tall enough to hold it. */
  [${ATTR}="blur"]:not([${REVEALED}]) { min-height: 128px; }
  .${PLACEHOLDER_CLASS} > span { flex: 1 1 100%; }
  .${PLACEHOLDER_CLASS} .xas-long { display: none; }
  .${PLACEHOLDER_CLASS} .xas-short { display: inline; }
  .${PLACEHOLDER_CLASS} small { display: inline; }
  .${PLACEHOLDER_CLASS} small::before { content: ' · '; }
  .${PLACEHOLDER_CLASS} .xas-buttons { order: -1; flex: 1 1 100%; flex-wrap: nowrap; justify-content: center; gap: 8px; }
  .${PLACEHOLDER_CLASS} button {
    position: relative; width: 40px; height: 40px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center; gap: 1px;
  }
  .${PLACEHOLDER_CLASS} button svg { display: block; flex: none; }
  .${PLACEHOLDER_CLASS} button .xas-label {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
  .${PLACEHOLDER_CLASS} button[${ACTION_ATTR}="mute-on-x"] { width: auto; padding: 0 10px; }
  .${PLACEHOLDER_CLASS} button[${ACTION_ATTR}="mute-on-x"]::after { content: 'X'; font-weight: 700; font-size: 13px; }
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
    const long = doc.createElement('strong');
    long.className = 'xas-long';
    const short = doc.createElement('strong');
    short.className = 'xas-short';
    text.append(long, short, doc.createElement('small'));
    const buttons = doc.createElement('div');
    buttons.className = 'xas-buttons';
    placeholder.append(text, buttons);
    target.prepend(placeholder);
  }
  const long = placeholder.querySelector('.xas-long')!;
  const short = placeholder.querySelector('.xas-short')!;
  const small = placeholder.querySelector('small')!;
  const shortLabel = treatment.short ?? treatment.label;
  if (long.textContent !== treatment.label) long.textContent = treatment.label;
  if (short.textContent !== shortLabel) short.textContent = shortLabel;
  if (small.textContent !== treatment.detail) small.textContent = treatment.detail;

  const buttons = placeholder.querySelector('.xas-buttons')!;
  const wanted: ClickedAction[] = ['show', ...treatment.actions];
  if (buttons.getAttribute('data-actions') !== wanted.join(' ')) {
    buttons.setAttribute('data-actions', wanted.join(' '));
    buttons.replaceChildren(
      ...wanted.map((act) => {
        const name = act === 'show' ? 'Show' : ACTION_LABELS[act];
        const button = doc.createElement('button');
        button.type = 'button';
        button.setAttribute(ACTION_ATTR, act);
        button.title = name;
        const label = doc.createElement('span');
        label.className = 'xas-label';
        label.textContent = name;
        button.append(icon(doc, act), label);
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
      const clicked = event.target as Element | null;
      // Tapping the panel's text mustn't open the post it hides.
      if (clicked?.closest?.(`.${PLACEHOLDER_CLASS} > span`)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const button = clicked?.closest?.(`[${ACTION_ATTR}]`);
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

function icon(doc: Document, act: ClickedAction): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(name, value);
  for (const shape of ICONS[act]) {
    const el = doc.createElementNS(SVG_NS, shape[0]);
    if (shape[0] === 'path') el.setAttribute('d', shape[1]);
    else ['cx', 'cy', 'r'].forEach((attr, i) => el.setAttribute(attr, String(shape[i + 1])));
    svg.append(el);
  }
  return svg;
}

function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
