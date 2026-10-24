// End-to-end smoke test with the built extension, in Chrome for Testing or,
// with --firefox, in the installed Firefox (FIREFOX_PATH to override).
//
//   npm run test:e2e            npm run test:e2e:firefox
//   npm run test:e2e:hosted     npm run test:e2e:hosted -- --firefox
//   npx tsx scripts/e2e-smoke.ts --firefox --extension=.output/release/x-abuse-shield-<version>.xpi
//   npm run test:e2e:mobile     Firefox emulating a phone (docs/ANDROID.md)
//
// x.com is faked with request interception: each page boots like X does —
// fetch the API data (via fetch() or XHR), then render the posts — using the
// synthetic fixtures. Checks run in requestAnimationFrame, i.e. before the
// browser paints, so a post that is hidden there never flashes.
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, sep } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const root = join(import.meta.dirname, '..');
/**
 * --mobile: Firefox emulating Firefox for Android on a phone — Android user agent, a touch-only pointer, a
 * 412×915 window — on x.com's phone layout (no sidebar profile link; the account comes from X's Viewer query).
 */
const mobile = process.argv.includes('--mobile');
const firefox = mobile || process.argv.includes('--firefox');
const ANDROID_UA = 'Mozilla/5.0 (Android 15; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0';
const PHONE = { width: 412, height: 915 };
/** --extension=<folder, or .xpi for Firefox>: test a release download instead of the build folder. */
const extensionArg = process.argv.find((arg) => arg.startsWith('--extension='))?.slice('--extension='.length);
const extensionPath = extensionArg ?? join(root, '.output', firefox ? 'firefox-mv2' : 'chrome-mv3');
const profileDir = join(root, '.e2e-profile');
const shotsDir = join(root, 'spike', 'results', mobile ? 'e2e-mobile' : firefox ? 'e2e-firefox' : 'e2e');
/** Firefox gives each install a random moz-extension:// host; a pref pins it so the test can open extension pages. */
const FIREFOX_UUID = '5b0d6c1e-3f2a-4c8e-9a71-0e4b2d9c6f13';
/** The extension API as seen from an extension page (Firefox's chrome.* has no promises in Manifest V2). */
const api = firefox ? 'browser' : 'chrome';
const fixtures = join(root, 'tests', 'fixtures');

/**
 * --hosted: builds the extension without the model, as with WXT_MODEL_URL
 * pointing at a real host, and serves public/models from a local "model
 * host". The extension downloads the model on first use.
 */
const hosted = process.argv.includes('--hosted');
const MODEL_HOST_PORT = 8787;
const modelsDir = join(root, 'public', 'models');
/** Paths the model host was asked for. */
const modelRequests: string[] = [];
if (hosted) {
  execSync(`npx wxt build${firefox ? ' -b firefox' : ''}`, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WXT_BUNDLE_MODEL: 'false', WXT_MODEL_URL: `http://localhost:${MODEL_HOST_PORT}/` },
  });
  if (existsSync(join(extensionPath, 'models'))) throw new Error('The hosted build still contains the model');
}
const modelHost = hosted
  ? createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      modelRequests.push(path);
      const file = join(modelsDir, path);
      // Extension pages fetch it cross-origin, as from Hugging Face.
      const cors = { 'access-control-allow-origin': '*' };
      if (!file.startsWith(modelsDir) || !existsSync(file) || !statSync(file).isFile()) return void response.writeHead(404, cors).end();
      response.writeHead(200, { ...cors, 'content-length': statSync(file).size });
      createReadStream(file).pipe(response);
    }).listen(MODEL_HOST_PORT)
  : null;

type Frame = Record<string, string | null>;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Gives every post an X-style ⋯ button whose menu lists Follow / Mute / Block
 * (Block carries data-testid="block", as on x.com). Clicks are recorded in
 * window.__xMenuClicks.
 */
const FAKE_X_MENU = `
  for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
    const handle = article.querySelector('[data-testid="User-Name"] a')?.getAttribute('href')?.slice(1);
    const caret = document.createElement('button');
    caret.setAttribute('data-testid', 'caret');
    caret.textContent = '⋯';
    caret.addEventListener('click', () => {
      const layers = document.getElementById('layers') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'layers' }));
      const items = ['Follow @' + handle, 'Mute @' + handle, 'Block @' + handle];
      layers.innerHTML = '<div role="menu"><div data-testid="Dropdown">' + items.map((t) =>
        '<div role="menuitem"' + (t.startsWith('Block') ? ' data-testid="block"' : '') + '><span>' + t + '</span></div>').join('') + '</div></div>';
      layers.querySelectorAll('[role="menuitem"]').forEach((item) => item.addEventListener('click', () => {
        window.__xMenuClicks = (window.__xMenuClicks || []).concat(item.textContent);
        layers.innerHTML = '';
      }));
    });
    article.querySelector('[data-testid="User-Name"]')?.append(caret);
  }`;

/** Turns a fixture into a page that loads its data, then renders the posts like X's app. */
function fakePage(fixture: string, api: { url: string; via: 'fetch' | 'xhr' }, extraArticles = ''): string {
  let html = readFileSync(join(fixtures, 'x', fixture), 'utf8');
  if (extraArticles) html = html.replace('</div></div></section>', `${extraArticles}</div></div></section>`);
  // X's phone layout: no sidebar (so no profile link), a bottom tab bar instead.
  if (mobile) html = html.replace(/<header>[\s\S]*?<\/header>/, '').replace('</main>', '</main><nav data-testid="BottomBar"><a href="/home" data-testid="AppTabBar_Home_Link">Home</a></nav>');
  html = html.replace('<main>', '<template id="app"><main>').replace('</main>', '</main></template>');
  const viewer = mobile ? `await (await fetch(${JSON.stringify(API.viewer.url)})).json();` : '';
  const load =
    viewer +
    (api.via === 'fetch'
      ? `await (await fetch(${JSON.stringify(api.url)})).json();`
      : `await new Promise((resolve) => { const x = new XMLHttpRequest(); x.open('GET', ${JSON.stringify(api.url)}); x.onload = () => { JSON.parse(x.responseText); resolve(); }; x.send(); });`);
  const script = `<script>
    setTimeout(async () => {
      ${load}
      document.body.append(document.getElementById('app').content.cloneNode(true));
      ${FAKE_X_MENU}
      requestAnimationFrame(() => {
        const posts = [...document.querySelectorAll('article[data-testid="tweet"]')].map((a) => {
          const href = a.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') ?? '';
          return [(/status\\/(\\d+)/.exec(href) ?? [])[1] ?? 'ad', a.getAttribute('data-xas')];
        });
        // Quoted posts hidden inside another post, as "quote:<id>".
        const quotes = [...document.querySelectorAll('article [data-xas-post]:not(article)')].map((q) => ['quote:' + q.getAttribute('data-xas-post'), q.getAttribute('data-xas')]);
        window.__frame = Object.fromEntries([...posts, ...quotes]);
      });
    }, 400);
  </script>`;
  return html.replace('</body>', `${script}</body>`);
}

const API = {
  home: { url: '/i/api/graphql/aaa/HomeTimeline?variables=%7B%7D', file: 'home-timeline.graphql.json' },
  thread: { url: '/i/api/graphql/bbb/TweetDetail?variables=%7B%7D', file: 'tweet-detail.legacy-shape.json' },
  notifications: { url: '/i/api/2/notifications/mentions.json', file: 'notifications.rest.json' },
  viewer: { url: '/i/api/graphql/ddd/Viewer?variables=%7B%7D', file: 'viewer.graphql.json' },
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
// service worker for an extension re-installed over CDP. (Firefox gets a temporary profile.)
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(shotsDir, { recursive: true });
const browser = firefox
  ? await puppeteer.launch({
      browser: 'firefox',
      executablePath: process.env.FIREFOX_PATH ?? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      headless: true,
      // Lets WebDriver BiDi open moz-extension:// pages.
      args: ['--remote-allow-system-access', ...(mobile ? [`--width=${PHONE.width}`, `--height=${PHONE.height}`] : [])],
      defaultViewport: mobile ? PHONE : undefined,
      extraPrefsFirefox: {
        'extensions.webextensions.uuids': JSON.stringify({ 'x-abuse-shield@local': FIREFOX_UUID }),
        // A phone: Android user agent everywhere (pages, extension pages, the model worker) and a touch-only pointer.
        ...(mobile ? { 'general.useragent.override': ANDROID_UA, 'ui.primaryPointerCapabilities': 1, 'ui.allPointerCapabilities': 1 } : {}),
      },
    })
  : await puppeteer.launch({ headless: true, pipe: true, enableExtensions: true, userDataDir: profileDir });
try {
  const extensionId = await browser.installExtension(extensionPath);
  const extensionUrl = (path: string) => (firefox ? `moz-extension://${FIREFOX_UUID}/${path}` : `chrome-extension://${extensionId}/${path}`);
  /** Firefox: Puppeteer misses the load event of moz-extension:// pages (they load in another process), so poll instead. */
  const openExtensionPage = async (page: Page, path: string) => {
    const url = extensionUrl(path);
    if (!firefox) return void (await page.goto(url));
    void page.goto(url, { timeout: 0 }).catch(() => undefined);
    for (const start = Date.now(); Date.now() - start < 15_000; await new Promise((resolve) => setTimeout(resolve, 100))) {
      const loaded = await page.evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`).catch(() => false);
      if (loaded) return;
    }
    throw new Error(`${path} didn't load`);
  };
  /** Polls the model's status until it's ready or failed, logging each change. */
  const waitForModel = async (page: Page) => {
    const start = Date.now();
    let status: { state: string; message?: string } | undefined;
    let lastLogged = '';
    while (Date.now() - start < 6 * 60_000) {
      status = (await page.evaluate(`${api}.storage.session.get('modelStatus').then(({ modelStatus }) => modelStatus)`)) as typeof status;
      const line = JSON.stringify(status ?? null);
      if (line !== lastLogged) console.log(`  model status after ${Math.round((Date.now() - start) / 1000)} s: ${(lastLogged = line)}`);
      if (status?.state === 'ready' || status?.state === 'error') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    status ??= { state: 'none' };
    return `${status.state} in ${((Date.now() - start) / 1000).toFixed(1)} s${status.message ? ` — ${status.message}` : ''}`;
  };
  // Let the service worker write default settings.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  pages = {
    '/home': fakePage('synthetic-home-for-you.html', { url: API.home.url, via: 'fetch' }),
    // In X's "Dim" theme, which X sets as the body's background colour.
    '/LakotaMan1/status/3000': fakePage('synthetic-thread.html', { url: API.thread.url, via: 'fetch' }).replace(
      '<body>',
      '<body style="background-color: rgb(21, 32, 43);">',
    ),
    '/notifications/mentions': fakePage('synthetic-notifications.html', { url: API.notifications.url, via: 'xhr' }),
  };

  const home = await visit(browser, '/home');
  if (mobile) {
    const button = await home.page.$eval('article[data-xas-post="2002"] [data-xas-act="show"]', (b) => b.getBoundingClientRect().height);
    check('phone: placeholder buttons are finger-sized (≥ 40 px)', button >= 40, `${button} px`);
    const inside = await home.page.$eval('article[data-xas-post="2002"]', (article) => {
      const panel = article.querySelector('.xas-placeholder')!.getBoundingClientRect();
      const post = article.getBoundingClientRect();
      return { panelBottom: Math.round(panel.bottom), postBottom: Math.round(post.bottom) };
    });
    check('phone: the hidden-post panel stays inside its post (no overlap with the next one)', inside.panelBottom <= inside.postBottom, JSON.stringify(inside));
  }
  check(
    'home: word-list abuse hidden before paint, others untouched; an abusive quoted post hidden inside a clean one',
    same(home.frame, { '2001': null, '2002': 'blur', '2003': null, '2004': null, ad: null, 'quote:1990': 'blur' }),
    JSON.stringify(home.frame),
  );
  await home.page.screenshot({ path: join(shotsDir, 'home.png'), fullPage: true });

  const thread = await visit(browser, '/LakotaMan1/status/3000');
  check(
    'thread: brigade + new-account insult hidden before paint (records crossed worlds via fetch hook)',
    same(thread.frame, { '3000': null, '3004': 'blur', '3005': 'blur', '3006': 'blur', '3007': 'blur' }),
    JSON.stringify(thread.frame),
  );
  await thread.page.screenshot({ path: join(shotsDir, 'thread.png'), fullPage: true });
  const placeholderColor = await thread.page.$eval('article[data-xas-post="3004"] .xas-placeholder', (el) => getComputedStyle(el).color);
  check('dark theme: placeholder text follows X’s theme', placeholderColor === 'rgb(231, 233, 234)', placeholderColor);

  const notifications = await visit(browser, '/notifications/mentions');
  check(
    'notifications: threat collapsed, teasing kept, new account’s mild insult hidden (records via XHR hook)',
    same(notifications.frame, { '4001': 'collapse', '4002': null, '4003': 'blur' }),
    JSON.stringify(notifications.frame),
  );

  // Show button: reveals without opening the post.
  await notifications.page.click('article[data-xas-post="4001"] [data-xas-act="show"]');
  const revealed = await notifications.page.$eval('article[data-xas-post="4001"]', (a) => a.hasAttribute('data-xas-revealed'));
  check('Show button reveals the post', revealed && notifications.page.url().endsWith('/notifications/mentions'));

  // Corrections from the page: "Not abusive" brings the post back and is recorded.
  const attrOf = (page: Page, id: string) =>
    page.evaluate((postId) => document.querySelector(`a[href$="/status/${postId}"]`)?.closest('article')?.getAttribute('data-xas') ?? null, id);
  await notifications.page.evaluate(() => (document.querySelector('article[data-xas-post="4003"] [data-xas-act="not-abusive"]') as HTMLElement).click());
  await new Promise((resolve) => setTimeout(resolve, 800));
  const store = async () => {
    const page = await browser.newPage();
    await openExtensionPage(page, 'popup.html');
    const data = (await page.evaluate(`${api}.storage.local.get(null)`)) as {
      reviewLog?: { postId: string; label?: string; reasons: string[] }[];
      overrides?: { notAbusive: string[] };
      muteState?: { mutes: { handle: string; reason: string }[] };
    };
    await page.close();
    return data;
  };
  let stored3 = await store();
  check(
    '"Not abusive" shows the post again and is recorded',
    (await attrOf(notifications.page, '4003')) === null &&
      stored3.reviewLog?.find((e) => e.postId === '4003')?.label === 'not-abusive' &&
      stored3.overrides?.notAbusive.includes('4003') === true,
    `review entries: ${stored3.reviewLog?.length}`,
  );

  // "Mute on X" clicks X's own "Mute @handle" and mutes here too.
  await notifications.page.evaluate(() => (document.querySelector('article[data-xas-post="4001"] [data-xas-act="mute-on-x"]') as HTMLElement).click());
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const menuClicks = await notifications.page.evaluate(() => (window as unknown as { __xMenuClicks?: string[] }).__xMenuClicks ?? []);
  stored3 = await store();
  check(
    '"Mute on X" clicks X’s Mute item and mutes locally',
    same(menuClicks, ['Mute @kattar_x']) && stored3.muteState?.mutes.some((m) => m.handle === 'kattar_x' && m.reason === 'manual') === true,
    JSON.stringify(menuClicks),
  );

  const review = await browser.newPage();
  await review.setViewport({ width: 900, height: 900 });
  await openExtensionPage(review, 'review.html');
  await review.waitForSelector('article.entry', { timeout: 5000 });
  const reviewed = await review.evaluate(() => ({
    entries: document.querySelectorAll('article.entry').length,
    exportLabel: [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Export labelled'))?.textContent,
  }));
  check('review page lists hidden posts with reasons', reviewed.entries >= 5 && reviewed.exportLabel === 'Export labelled posts (1)', JSON.stringify(reviewed));
  // Firefox's WebDriver BiDi can't capture extension pages.
  if (!firefox) await review.screenshot({ path: join(shotsDir, 'review.png'), fullPage: true });
  await review.close();

  // Repeat offender → automatic mute → hidden everywhere as muted.
  pages['/home'] = fakePage('synthetic-home-for-you.html', { url: API.home.url, via: 'fetch' }, repeatOffenderArticles());
  await visit(browser, '/home');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const ext = await browser.newPage();
  await openExtensionPage(ext, 'popup.html');
  const stored = (await ext.evaluate(`${api}.storage.local.get(null)`)) as {
    muteState?: { mutes: { handle: string }[]; strikes: unknown[] };
    stats?: { flagged: number; muted: number };
  };
  check('3 strikes mute the author', stored.muteState?.mutes.some((m) => m.handle === 'srihars47664037') === true, JSON.stringify(stored.muteState?.mutes));
  // 2002, quoted 1990 · 3004–3007 · 4001, 4003 · 2101–2103 (2002 again on the second visit isn't counted twice).
  check('stats count hidden posts once each', stored.stats?.flagged === 11 && stored.stats.muted === 1, JSON.stringify(stored.stats));

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
  await openExtensionPage(control, 'popup.html');
  await control.evaluate(`${api}.storage.local.set({ settings: { model: { enabled: true, downloadApproved: true, idleMinutes: 5, preBlur: false } } })`);
  const worker = firefox ? null : await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extensionId))).worker();
  worker?.on('console', (message) => console.log(`  [service worker] ${message.text()}`));
  const loaded = await waitForModel(control);
  check('model downloads/loads after approval', loaded.startsWith('ready'), loaded);
  if (hosted) {
    const downloads = modelRequests.filter((path) => path.endsWith('/model.ort')).length;
    check('hosted: model downloaded once from the model host', downloads === 1, modelRequests.join(', '));
    // Switching the model off unloads it; switched on again, it must load from the cached copy.
    const before = modelRequests.length;
    const setEnabled = (enabled: boolean) =>
      control.evaluate(`${api}.storage.local.set({ settings: { model: { enabled: ${enabled}, downloadApproved: true, idleMinutes: 5, preBlur: false } } })`);
    await setEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await setEnabled(true);
    const reloaded = await waitForModel(control);
    check('hosted: loading again uses the cached copy, no new download', reloaded.startsWith('ready') && modelRequests.length === before, `${reloaded}, ${modelRequests.length - before} new requests`);
  }
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
  // Firefox runs the model on one thread: extension pages can't be cross-origin isolated there.
  const latencyLimit = firefox ? 1000 : 300;
  check(`model verdict within ~${latencyLimit} ms of the post appearing (model loaded)`, latency < latencyLimit, `${Math.round(latency)} ms`);
  await modelPage.page.screenshot({ path: join(shotsDir, 'home-model.png'), fullPage: true });

  // Optional (slow): the model unloads after the idle time. --idle sets it to 1 minute.
  if (process.argv.includes('--idle')) {
    for (const open of await browser.pages()) if (open.url().startsWith('https://x.com')) await open.close();
    const idle = await browser.newPage();
    await openExtensionPage(idle, 'popup.html');
    await idle.evaluate(`${api}.storage.local.set({ settings: { model: { enabled: true, downloadApproved: true, idleMinutes: 1, preBlur: false } } })`);
    const idleStart = Date.now();
    let state = '';
    while (Date.now() - idleStart < 4 * 60_000 && state !== 'unloaded') {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      state = (await idle.evaluate(`${api}.storage.session.get('modelStatus').then(({ modelStatus }) => modelStatus?.state)`)) as string;
    }
    // Firefox's model worker is private to the background page; only its status is visible here.
    const offscreen = worker ? ((await worker.evaluate(`chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)`)) as number) : 0;
    check('model unloads after the idle time', state === 'unloaded' && offscreen === 0, `${state} after ${Math.round((Date.now() - idleStart) / 1000)} s, ${offscreen} offscreen documents`);
    await idle.close();
  }

  // UI renders without errors.
  for (const name of mobile ? ['popup', 'options', 'review'] : ['popup', 'options']) {
    const ui = await browser.newPage();
    const errors: string[] = [];
    ui.on('pageerror', (e) => errors.push(String(e)));
    ui.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await ui.setViewport(mobile ? PHONE : { width: name === 'popup' ? 360 : 900, height: 900 });
    await openExtensionPage(ui, `${name}.html`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (!firefox) await ui.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true });
    check(`${name} page renders without errors`, errors.length === 0, errors.join(' | '));
    if (mobile) {
      const fit = (await ui.evaluate(
        '({ width: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.getBoundingClientRect().width, coarse: matchMedia("(pointer: coarse)").matches, smallest: Math.min(...[...document.querySelectorAll("button")].map((b) => b.getBoundingClientRect().height).filter((h) => h > 0)) })',
      )) as { width: number; scroll: number; body: number; coarse: boolean; smallest: number };
      check(
        `phone: ${name} page fills the screen without sideways scrolling, with finger-sized buttons`,
        fit.coarse && fit.scroll <= fit.width && fit.body >= fit.width - 1 && fit.smallest >= 40,
        JSON.stringify(fit),
      );
    }
  }
} finally {
  await browser.close();
  modelHost?.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${relative(root, shotsDir).replaceAll(sep, '/')}/`);
process.exitCode = failed.length > 0 ? 1 : 0;
