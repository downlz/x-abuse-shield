/** How well the extension can read the current x.com tab, shown in the popup and as a badge. */
export interface TabHealth {
  /** 'broken': posts are on screen but none could be read — X's markup has probably changed. */
  dom: 'ok' | 'broken' | 'idle';
  /** 'missing': no account data from X's responses; 'degraded': records lack fields. Account checks fall back to the page. */
  api: 'ok' | 'degraded' | 'missing' | 'idle';
  /** Share of posts read with an account record from X's data (0–1). */
  coverage: number;
  postsSeen: number;
}

export const IDLE_HEALTH: TabHealth = { dom: 'idle', api: 'idle', coverage: 0, postsSeen: 0 };

export function healthKey(tabId: number): string {
  return `health:${tabId}`;
}
