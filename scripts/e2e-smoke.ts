// End-to-end smoke test in Chrome for Testing with the built extension.
//
// x.com is faked with request interception: each page boots like X does —
// fetch the API data (via fetch() or XHR), then render the posts — using the
// synthetic fixtures. Checks run in requestAnimationFrame, i.e. before the
// browser paints, so a post that is hidden there never flashes.
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const root = join(import.meta.dirname, '..');
const extensionPath = join(root, '.output', 'chrome-mv3');
const profileDir = join(root, '.e2e-profile');
const shotsDir = join(root, 'spike', 'results', 'e2e');
const fixtures = join(root, 'tests', 'fixtures');

type Frame = Record<string, string | null>;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Turns a fixture into a page that loads its data, then renders the posts like X's app. */
function fakePage(fixture: string, api: { url: string; via: 'fetch' | 'xhr' }, extraArticles = ''): string {
  let html = readFileSync(join(fixtures, 'x', fixture), 'utf8');
  if (extraArticles) html = html.replace('</div></div></section>', `${extraArticles}</div></div></section>`);
  html = html.replace('<main>', '<template id="app"><main>').replace('</main>', '</main></template>');
  const load =
    api.via === 'fetch'
      ? `await (await fetch(${JSON.stringify(api.url)})).json();`
      : `await new Promise((resolve) => { const x = new XMLHttpRequest(); x.open('GET', ${JSON.stringify(api.url)}); x.onload = () => { JSON.parse(x.responseText); resolve(); }; x.send(); });`;
  const script = `<script>
    setTimeout(async () => {
      ${load}
      document.body.append(document.getElementById('app').content.cloneNode(true));
      requestAnimationFrame(() => {
        window.__frame = Object.fromEntries([...document.querySelectorAll('article[data-testid="tweet"]')].map((a) => {
          const href = a.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') ?? '';
          return [(/status\\/(\\d+)/.exec(href) ?? [])[1] ?? 'ad', a.getAttribute('data-xas')];
        }));
      });
    }, 400);
  </script>`;
  return html.replace('</body>', `${script}</body>`);
}

const API = {
  home: { url: '/i/api/graphql/aaa/HomeTimeline?variables=%7B%7D', file: 'home-timeline.graphql.json' },
  thread: { url: '/i/api/graphql/bbb/TweetDetail?variables=%7B%7D', file: 'tweet-detail.legacy-shape.json' },
  notifications: { url: '/i/api/2/notifications/mentions.json', file: 'notifications.rest.json' },
};

let pages: Record<string, string> = {};

async function route(page: Page) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'x.com' && url.pathname.startsWith('/i/api/')) {
      const api = Object.values(API).find((a) => url.pathname === a.url.split('?')[0]);
      if (!api) return void request.respond({ status: 404, body: '' });
      return void request.respond({ status: 200, contentType: 'application/json', body: readFileSync(join(fixtures, 'x-api', api.file), 'utf8') });
    }
    if (url.hostname === 'x.com' && pages[url.pathname]) {
      return void request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: pages[url.pathname]! });
    }
    if (url.hostname.endsWith('twimg.com')) return void request.respond({ status: 204, body: '' });
    void request.continue();
  });
}

async function visit(browser: Browser, path: string): Promise<{ frame: Frame; page: Page }> {
  const page = await browser.newPage();
  await route(page);
  page.on('pageerror', (error) => check(`no page errors on ${path}`, false, String(error)));
  await page.goto(`https://x.com${path}`);
  await page.waitForFunction(() => (window as unknown as { __frame?: unknown }).__frame !== undefined, { timeout: 15_000 });
  const frame = await page.evaluate(() => (window as unknown as { __frame: Frame }).__frame);
  return { frame, page };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Post 2002's timeline cell from the home fixture, as a template. */
function repeatOffenderCell(): string {
  const html = readFileSync(join(fixtures, 'x', 'synthetic-home-for-you.html'), 'utf8');
  return /<!-- 2\. [\s\S]*?(<div data-testid="cellInnerDiv"[\s\S]*?<\/article>\s*<\/div><\/div><\/div>)/.exec(html)![1]!;
}

/** Three abusive posts by one author, to trigger an automatic mute. */
function repeatOffenderArticles(): string {
  const cell = repeatOffenderCell();
  return ['2101', '2102', '2103']
    .map((id, i) => cell.replaceAll('2002', id).replace('Chutiya fellow posting useless', ['Madarchod', 'bsdk chup kar', 'tu chutiya hai'][i]!))
    .join('\n');
}

// A fresh profile every run. Reusing one is unreliable: Chrome keeps running the previous build's
// service worker for an extension re-installed over CDP. The cost is one model download (~1 min).
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(shotsDir, { recursive: true });
const browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: true, userDataDir: profileDir });
try {
  const extensionId = await browser.installExtension(extensionPath);
  // Let the service worker write default settings.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  pages = {
    '/home': fakePage('synthetic-home-for-you.html', { url: API.home.url, via: 'fetch' }),
    '/LakotaMan1/status/3000': fakePage('synthetic-thread.html', { url: API.thread.url, via: 'fetch' }),
    '/notifications/mentions': fakePage('synthetic-notifications.html', { url: API.notifications.url, via: 'xhr' }),
  };

  const home = await visit(browser, '/home');
  check('home: word-list abuse hidden before paint, others untouched', same(home.frame, { '2001': null, '2002': 'blur', '2003': null, '2004': null, ad: null }), JSON.stringify(home.frame));
  await home.page.screenshot({ path: join(shotsDir, 'home.png'), fullPage: true });

  const thread = await visit(browser, '/LakotaMan1/status/3000');
  check(
    'thread: brigade + new-account insult hidden before paint (records crossed worlds via fetch hook)',
    same(thread.frame, { '3000': null, '3004': 'blur', '3005': 'blur', '3006': 'blur', '3007': 'blur' }),
    JSON.stringify(thread.frame),
  );
  await thread.page.screenshot({ path: join(shotsDir, 'thread.png'), fullPage: true });

  const notifications = await visit(browser, '/notifications/mentions');
  check(
    'notifications: threat collapsed, teasing kept, new account’s mild insult hidden (records via XHR hook)',
    same(notifications.frame, { '4001': 'collapse', '4002': null, '4003': 'blur' }),
    JSON.stringify(notifications.frame),
  );

  // Show button: reveals without opening the post.
  await notifications.page.click('article[data-xas-post="4001"] [data-xas-show]');
  const revealed = await notifications.page.$eval('article[data-xas-post="4001"]', (a) => a.hasAttribute('data-xas-revealed'));
  check('Show button reveals the post', revealed && notifications.page.url().endsWith('/notifications/mentions'));

  // Repeat offender → automatic mute → hidden everywhere as muted.
  pages['/home'] = fakePage('synthetic-home-for-you.html', { url: API.home.url, via: 'fetch' }, repeatOffenderArticles());
  await visit(browser, '/home');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup.html`);
  const stored = (await ext.evaluate('chrome.storage.local.get(null)')) as {
    muteState?: { mutes: { handle: string }[]; strikes: unknown[] };
    stats?: { flagged: number; muted: number };
  };
  check('3 strikes mute the author', stored.muteState?.mutes.some((m) => m.handle === 'srihars47664037') === true, JSON.stringify(stored.muteState?.mutes));
  // 2002 · 3004–3007 · 4001, 4003 · 2101–2103 (2002 again on the second visit isn't counted twice).
  check('stats count hidden posts once each', stored.stats?.flagged === 10 && stored.stats.muted === 1, JSON.stringify(stored.stats));

  pages['/home'] = fakePage('synthetic-home-for-you.html', { url: API.home.url, via: 'fetch' });
  const after = await visit(browser, '/home');
  const label = await after.page.$eval('article[data-xas-post="2002"] .xas-placeholder strong', (el) => el.textContent);
  check('muted author collapsed with a "Muted" label', after.frame['2002'] === 'collapse' && label === 'Muted @Srihars47664037', `${after.frame['2002']} · ${label}`);

  // Cost per post (last: it adds hundreds of strikes). X renders posts in
  // batches; time one batch of 300 new posts, including the content script's
  // MutationObserver work, which finishes before the microtask queued after it.
  const perf = await visit(browser, '/home');
  const perPostMs = await perf.page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    const container = cells[0]!.parentElement!;
    const batch = document.createDocumentFragment();
    let n = 0;
    for (let round = 0; round < 60; round++) {
      for (const cell of cells) {
        const clone = cell.cloneNode(true) as Element;
        n++;
        clone.querySelectorAll('a[href*="/status/"]').forEach((a) => a.setAttribute('href', a.getAttribute('href')!.replace(/status\/\d+/, `status/${900000 + n}`)));
        batch.append(clone);
      }
    }
    return new Promise<number>((resolve) => {
      const t0 = performance.now();
      container.append(batch);
      queueMicrotask(() => resolve((performance.now() - t0) / n));
    });
  });
  check('content-script work under 2 ms per post (300-post batch, incl. DOM insertion)', perPostMs < 2, `${perPostMs.toFixed(3)} ms/post`);

  // AI model tier: approve the download, wait for the model, then show posts only the model catches.
  // Close earlier x.com tabs first: on approval they'd all ask the model to score their posts.
  for (const open of await browser.pages()) if (open.url().startsWith('https://x.com')) await open.close();
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  await control.evaluate(`chrome.storage.local.set({ settings: { model: { enabled: true, downloadApproved: true, idleMinutes: 5, preBlur: false } } })`);
  const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extensionId))).worker();
  worker?.on('console', (message) => console.log(`  [service worker] ${message.text()}`));
  const loadStart = Date.now();
  let modelStatus: { state: string; message?: string; progress?: number } | undefined;
  let lastLogged = '';
  while (Date.now() - loadStart < 6 * 60_000) {
    modelStatus = (await control.evaluate(`chrome.storage.session.get('modelStatus').then(({ modelStatus }) => modelStatus)`)) as typeof modelStatus;
    const line = JSON.stringify(modelStatus ?? null);
    if (line !== lastLogged) console.log(`  model status after ${Math.round((Date.now() - loadStart) / 1000)} s: ${(lastLogged = line)}`);
    if (modelStatus?.state === 'ready' || modelStatus?.state === 'error') break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  modelStatus ??= { state: 'none' };
  check('model downloads/loads after approval', modelStatus.state === 'ready', `${modelStatus.state} in ${((Date.now() - loadStart) / 1000).toFixed(1)} s${modelStatus.message ? ` — ${modelStatus.message}` : ''}`);
  await control.close();

  const modelOnly = ['2201', '2202']
    .map((id, i) => repeatOffenderCell().replaceAll('2002', id).replaceAll('Srihars47664037', `model_test_${i}`).replace(
      'Chutiya fellow posting useless',
      ["You're a worthless idiot and everyone here knows it.", 'Just had the best biryani of my life, highly recommend this place'][i]!,
    ))
    .join('\n');
  pages['/home'] = fakePage('synthetic-home-for-you.html', { url: API.home.url, via: 'fetch' }, modelOnly).replace(
    'requestAnimationFrame(() => {',
    `const rendered = performance.now();
      new MutationObserver((_, observer) => {
        const target = document.querySelector('article[data-xas-post="2201"]');
        if (target) { window.__modelLatency = performance.now() - rendered; observer.disconnect(); }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-xas'] });
      requestAnimationFrame(() => {`,
  );
  const modelPage = await visit(browser, '/home');
  await modelPage.page.waitForFunction(() => (window as unknown as { __modelLatency?: number }).__modelLatency !== undefined, { timeout: 30_000 });
  const latency = await modelPage.page.evaluate(() => (window as unknown as { __modelLatency: number }).__modelLatency);
  const afterModel = await modelPage.page.evaluate(() =>
    Object.fromEntries(['2201', '2202'].map((id) => [id, document.querySelector(`a[href$="/status/${id}"]`)?.closest('article')?.getAttribute('data-xas') ?? null])),
  );
  check('model hides an insult with no word-list hit, keeps a clean post', same(afterModel, { '2201': 'blur', '2202': null }), JSON.stringify(afterModel));
  check('model verdict within ~300 ms of the post appearing (model loaded)', latency < 300, `${Math.round(latency)} ms`);
  await modelPage.page.screenshot({ path: join(shotsDir, 'home-model.png'), fullPage: true });

  // Optional (slow): the model unloads after the idle time. --idle sets it to 1 minute.
  if (process.argv.includes('--idle')) {
    for (const open of await browser.pages()) if (open.url().startsWith('https://x.com')) await open.close();
    const idle = await browser.newPage();
    await idle.goto(`chrome-extension://${extensionId}/popup.html`);
    await idle.evaluate(`chrome.storage.local.set({ settings: { model: { enabled: true, downloadApproved: true, idleMinutes: 1, preBlur: false } } })`);
    const idleStart = Date.now();
    let state = '';
    while (Date.now() - idleStart < 4 * 60_000 && state !== 'unloaded') {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      state = (await idle.evaluate(`chrome.storage.session.get('modelStatus').then(({ modelStatus }) => modelStatus?.state)`)) as string;
    }
    const offscreen = (await worker!.evaluate(`chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`)) as number;
    check('model unloads after the idle time', state === 'unloaded' && offscreen === 0, `${state} after ${Math.round((Date.now() - idleStart) / 1000)} s, ${offscreen} offscreen documents`);
    await idle.close();
  }

  // UI renders without errors.
  for (const name of ['popup', 'options']) {
    const ui = await browser.newPage();
    const errors: string[] = [];
    ui.on('pageerror', (e) => errors.push(String(e)));
    ui.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await ui.setViewport({ width: name === 'popup' ? 360 : 900, height: 900 });
    await ui.goto(`chrome-extension://${extensionId}/${name}.html`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await ui.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true });
    check(`${name} page renders without errors`, errors.length === 0, errors.join(' | '));
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: spike/results/e2e/`);
process.exitCode = failed.length > 0 ? 1 : 0;
