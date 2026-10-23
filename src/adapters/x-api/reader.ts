/**
 * Runs in the page's MAIN world. Reads the JSON that X's own code fetched
 * from /i/api/ — it never makes a request or changes one. Hooks sit on the
 * response-reading methods rather than on fetch()/send(), so our handler
 * runs before X's code gets the data, whichever API X uses.
 */
const API_PATH = /\/i\/api\//;

export type JsonListener = (url: string, json: unknown) => void;

export function installApiReader(win: typeof globalThis, listener: JsonListener): void {
  const notify = (url: string, read: () => unknown) => {
    if (!API_PATH.test(url)) return;
    try {
      listener(url, read());
    } catch {
      // Never let our parsing break X.
    }
  };

  // fetch(): X awaits response.json() / response.text().
  const responseProto = win.Response.prototype;
  const originalJson = responseProto.json;
  responseProto.json = async function json(this: Response) {
    const data: unknown = await originalJson.call(this);
    notify(this.url, () => data);
    return data;
  };
  const originalText = responseProto.text;
  responseProto.text = async function text(this: Response) {
    const body = await originalText.call(this);
    notify(this.url, () => JSON.parse(body));
    return body;
  };

  // XMLHttpRequest: X reads xhr.response / xhr.responseText once the request is done.
  const xhrProto = win.XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const seen = new WeakSet<XMLHttpRequest>();
  const originalOpen = xhrProto.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
  xhrProto.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]));
    return originalOpen.apply(this, args);
  } as XMLHttpRequest['open'];

  for (const property of ['response', 'responseText'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(xhrProto, property);
    const getter = descriptor?.get;
    if (!descriptor || !getter) continue;
    Object.defineProperty(xhrProto, property, {
      ...descriptor,
      get(this: XMLHttpRequest) {
        const value: unknown = getter.call(this);
        const url = urls.get(this);
        if (url && this.readyState === 4 && !seen.has(this)) {
          seen.add(this);
          notify(url, () => (typeof value === 'string' ? JSON.parse(value) : value));
        }
        return value;
      },
    });
  }
}

/** "…/graphql/abc123/HomeTimeline?variables=…" → "HomeTimeline"; REST paths are returned as-is. */
export function operationName(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? '';
  return /\/graphql\/[^/]+\/([^/]+)/.exec(path)?.[1] ?? path;
}
