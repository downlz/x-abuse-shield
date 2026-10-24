// How much memory the AI model costs in Firefox, for each model variant, on the same build and
// the same single-threaded runtime Firefox for Android uses. Windows only (reads process memory
// with PowerShell).
//
//   npx tsx scripts/memory-firefox.ts <variant folder>...
//   e.g. public/models/Horizon-Labs/multilingual-toxicity-small .cache/trim/south-asia .cache/trim/south-asia-int8
//
// Each variant folder needs model.ort, tokenizer.json, tokenizer_config.json and config.json. The
// extension is built in hosted mode against a local server that serves the variant under the
// usual path; Firefox starts with a fresh profile per variant; memory is the private bytes of all
// of that Firefox's processes, before turning the model on and after it has loaded, scored posts,
// and sat idle for 60 s (as in docs/SPIKE-REPORT.md for Chrome).
import { execFileSync, execSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { MODEL_ID } from '../src/adapters/inference/model';

const root = join(import.meta.dirname, '..');
const variants = process.argv.slice(2).filter((arg) => !arg.startsWith('--')).map((dir) => resolve(dir));
const phone = process.argv.includes('--phone');
const PORT = 8788;
const UUID = '5b0d6c1e-3f2a-4c8e-9a71-0e4b2d9c6f13';
const MB = 1024 * 1024;
if (variants.length === 0) throw new Error('Pass one or more model folders');

let current = '';
const server = createServer((request, response) => {
  const name = basename(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
  const file = join(current, name);
  const cors = { 'access-control-allow-origin': '*' };
  if (!existsSync(file)) return void response.writeHead(404, cors).end();
  response.writeHead(200, { ...cors, 'content-length': statSync(file).size });
  createReadStream(file).pipe(response);
}).listen(PORT);

execSync('npx wxt build -b firefox', {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, WXT_BUNDLE_MODEL: 'false', WXT_MODEL_URL: `http://localhost:${PORT}/` },
});

/** Private bytes of a process and all its descendants. */
function treeMemory(pid: number): number {
  const script = `$all = Get-CimInstance Win32_Process; $ids = @(${pid}); $added = $true
while ($added) { $added = $false; foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $added = $true } } }
($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property PrivatePageCount -Sum).Sum`;
  return Number(execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows: string[] = [];
for (const variant of variants) {
  current = variant;
  const size = ['model.ort', 'tokenizer.json'].map((f) => statSync(join(variant, f)).size / MB);
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: process.env.FIREFOX_PATH ?? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    headless: true,
    args: ['--remote-allow-system-access'],
    extraPrefsFirefox: {
      'extensions.webextensions.uuids': JSON.stringify({ 'x-abuse-shield@downlz.github.io': UUID }),
      ...(phone ? { 'general.useragent.override': 'Mozilla/5.0 (Android 15; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0' } : {}),
    },
  });
  try {
    await browser.installExtension(join(root, '.output', 'firefox-mv2'));
    const pid = browser.process()!.pid!;
    const page = await browser.newPage();
    void page.goto(`moz-extension://${UUID}/popup.html`, { timeout: 0 }).catch(() => undefined);
    await sleep(3000);
    await sleep(20_000); // let start-up settle
    const before = treeMemory(pid);
    const started = Date.now();
    await page.evaluate(`browser.storage.local.set({ settings: { model: { enabled: true, downloadApproved: true, idleMinutes: 30, preBlur: false } } })`);
    let state = '';
    while (Date.now() - started < 5 * 60_000 && state !== 'ready' && state !== 'error') {
      await sleep(500);
      state = (await page.evaluate(`browser.storage.session.get('modelStatus').then(({ modelStatus }) => modelStatus?.state)`)) as string;
    }
    const loadSeconds = (Date.now() - started) / 1000;
    if (state !== 'ready') throw new Error(`${basename(variant)}: model ${state}`);
    // Score a page's worth of posts through the real path, so working memory is included.
    const texts = JSON.parse(readFileSync(join(root, 'spike', 'samples.json'), 'utf8')) as { text: string }[];
    const scoreStart = Date.now();
    await page.evaluate(`browser.runtime.sendMessage({ type: 'model:score', texts: ${JSON.stringify(texts.slice(0, 24).map((t) => t.text))} })`);
    const scoreMs = Date.now() - scoreStart;
    await sleep(60_000);
    const after = treeMemory(pid);
    rows.push(
      `${basename(variant).padEnd(34)} files ${size[0]!.toFixed(0).padStart(4)} + ${size[1]!.toFixed(0).padStart(3)} MB   ` +
        `+${((after - before) / MB).toFixed(0).padStart(4)} MB while loaded   load ${loadSeconds.toFixed(1)} s   24 posts ${scoreMs} ms`,
    );
    console.log(rows.at(-1));
  } finally {
    await browser.close();
  }
}
server.close();
console.log(`\nFirefox ${phone ? '(Android user agent: batches of 4)' : '(desktop)'}, single-threaded model, memory = private bytes of all Firefox processes, 60 s after scoring.`);
for (const row of rows) console.log(row);
