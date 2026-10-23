import { X } from './selectors';

export type MuteOnXResult = 'muted' | 'menu-open' | 'no-menu';

/**
 * Runs X's own "Mute @handle" for a post, on your click. It opens the post's
 * ⋯ menu and clicks Mute only when the item clearly names this @handle;
 * otherwise it leaves X's menu open for you to finish.
 */
export async function muteOnX(article: Element, handle: string, timeoutMs = 1500): Promise<MuteOnXResult> {
  const doc = article.ownerDocument;
  const button = article.querySelector<HTMLElement>(X.postMenuButton);
  if (!button) return 'no-menu';
  button.click();

  const menu = await waitFor(() => doc.querySelector(X.postMenu), timeoutMs);
  if (!menu) return 'no-menu';
  const item = findMuteItem(menu, handle);
  if (!item) return 'menu-open';
  item.click();
  return 'muted';
}

export function findMuteItem(menu: Element, handle: string): HTMLElement | null {
  // Must name this account, and must not be "Unmute @handle" (already muted on X).
  const names = (el: Element) => {
    const text = (el.textContent ?? '').toLowerCase();
    return text.includes(`@${handle.toLowerCase()}`) && !text.includes('unmute');
  };
  const byId = menu.querySelector<HTMLElement>(X.muteMenuItem);
  if (byId && names(byId)) return byId;
  const items = [...menu.querySelectorAll<HTMLElement>(X.menuItem)];
  const block = items.findIndex((item) => item.matches(X.blockMenuItem) || !!item.querySelector(X.blockMenuItem));
  const beforeBlock = block > 0 ? items[block - 1] : undefined;
  return beforeBlock && names(beforeBlock) ? beforeBlock : null;
}

function waitFor<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const found = find();
      if (found || Date.now() - start > timeoutMs) resolve(found);
      else setTimeout(poll, 50);
    };
    poll();
  });
}
