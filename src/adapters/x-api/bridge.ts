import type { Records } from './collect';

/**
 * The MAIN-world reader hands records to the content script with a DOM event:
 * dispatchEvent is synchronous across worlds, so the records arrive before
 * X's own code renders the posts. Objects don't cross worlds in
 * CustomEvent.detail, so the payload is a JSON string.
 */
export const RECORDS_EVENT = 'xabuseshield:records';

export interface RecordsPayload extends Records {
  /** GraphQL operation name, e.g. "HomeTimeline", or the REST path. */
  operation: string;
  /** The logged-in user's handle, when this response says. */
  viewer?: string;
}

export function dispatchRecords(payload: RecordsPayload, target: EventTarget = document): void {
  target.dispatchEvent(new CustomEvent(RECORDS_EVENT, { detail: JSON.stringify(payload) }));
}

export function onRecords(listener: (payload: RecordsPayload) => void, target: EventTarget = document): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    try {
      listener(JSON.parse(detail) as RecordsPayload);
    } catch {
      // Not ours, or malformed.
    }
  };
  target.addEventListener(RECORDS_EVENT, handler);
  return () => target.removeEventListener(RECORDS_EVENT, handler);
}
