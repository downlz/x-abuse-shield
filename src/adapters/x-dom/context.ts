import { NOTIFICATIONS_PATH, THREAD_PATH, X } from './selectors';

export type PageContext = 'for-you' | 'following' | 'thread' | 'notifications' | 'other';

export function detectPageContext(doc: Document = document, path: string = location.pathname): PageContext {
  if (THREAD_PATH.test(path)) return 'thread';
  if (NOTIFICATIONS_PATH.test(path)) return 'notifications';
  if (path === '/home') {
    const tabs = [...doc.querySelectorAll(X.homeTabs)];
    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    if (selected === 0) return 'for-you';
    if (selected === 1) return 'following';
  }
  return 'other';
}

/** The id of the post opened on a thread page. */
export function focalPostId(path: string = location.pathname): string | undefined {
  return THREAD_PATH.exec(path)?.[1];
}

export function ownHandle(doc: Document = document): string | undefined {
  const href = doc.querySelector<HTMLAnchorElement>(X.ownProfileLink)?.getAttribute('href');
  return href?.split('/')[1]?.toLowerCase() || undefined;
}
