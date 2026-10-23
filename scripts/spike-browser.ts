// Runs the spike page in Chrome for Testing with the built extension loaded.
//
// Default: session 1 starts from an empty profile (model download, then a
// fresh offscreen document loading from cache); session 2 relaunches the
// browser on the same profile to prove the cache survives a restart.
//
// --variant=<name> [--runs=N]: N cached-profile sessions with the named ONNX
// Runtime session options (see src/spike/variants.ts), for memory comparisons.
//
// Memory is read 5 s and 60 s after loading and after unloading: V8 frees the
// large load-time buffers lazily, so 5 s readings swing by more than 1 GB
// between runs, while 60 s readings show the steady state.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import type { SpikeRunResult } from '../src/spike/types';
import { isSpikeVariant, type SpikeVariant } from '../src/spike/variants';

const root = join(import.meta.dirname, '..');
const extensionPath = join(root, '.output', 'chrome-mv3');
const profileDir = join(root, '.spike-profile');
const resultsDir = join(root, 'spike', 'results');
const RUN_TIMEOUT_MS = 30 * 60_000;
const SETTLE_MS = 5000;
const IDLE_MS = 60_000;

/** Private bytes per Chrome process type, e.g. { browser, gpu, extension, renderer, 'utility:network' }. */
export type MemorySnapshot = Record<string, number>;

export interface SessionResult {
  runs: SpikeRunResult[];
  /** Windows only. */
  processMemory?: {
    baseline: MemorySnapshot;
    loaded: MemorySnapshot;
    loadedIdle: MemorySnapshot;
    unloaded: MemorySnapshot;
    unloadedIdle: MemorySnapshot;
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSession(labels: string[], variant: SpikeVariant): Promise<SessionResult & { chromeVersion: string }> {
  const browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: true, userDataDir: profileDir });
  try {
    const extensionId = await browser.installExtension(extensionPath);
    const page = await browser.newPage();
    page.on('console', (message) => console.log(`  ${message.text()}`));
    await page.goto(`chrome-extension://${extensionId}/spike.html?labels=${labels.join(',')}&variant=${variant}`);
    await wait(SETTLE_MS);
    const baseline = memorySnapshot(browser);

    await page.click('#run');
    await page.waitForFunction(() => ['done', 'error'].includes(window.__spike.status), {
      timeout: RUN_TIMEOUT_MS,
      polling: 1000,
    });
    const state = await page.evaluate(() => window.__spike);
    if (state.status !== 'done') throw new Error(state.status === 'error' ? state.error : `Unexpected state ${state.status}`);
    await wait(SETTLE_MS);
    const loaded = memorySnapshot(browser);
    await wait(IDLE_MS - SETTLE_MS);
    const loadedIdle = memorySnapshot(browser);

    // Evaluated in the extension page, where the API global is `chrome`.
    await page.evaluate("chrome.runtime.sendMessage({ type: 'offscreen:close' })");
    await wait(SETTLE_MS);
    const unloaded = memorySnapshot(browser);
    await wait(IDLE_MS - SETTLE_MS);
    const unloadedIdle = memorySnapshot(browser);

    const processMemory =
      baseline && loaded && loadedIdle && unloaded && unloadedIdle
        ? { baseline, loaded, loadedIdle, unloaded, unloadedIdle }
        : undefined;
    return { runs: state.runs, processMemory, chromeVersion: await browser.version() };
  } finally {
    await browser.close();
  }
}

interface ProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  PrivatePageCount: number;
  CommandLine: string | null;
}

function memorySnapshot(browser: Browser): MemorySnapshot | undefined {
  const rootPid = browser.process()?.pid;
  if (process.platform !== 'win32' || !rootPid) return undefined;
  const json = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,PrivatePageCount,CommandLine | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const processes = JSON.parse(json) as ProcessRow[];
  const tree = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of processes) {
      if (tree.has(p.ParentProcessId) && !tree.has(p.ProcessId)) {
        tree.add(p.ProcessId);
        grew = true;
      }
    }
  }
  const snapshot: MemorySnapshot = {};
  for (const p of processes.filter((row) => tree.has(row.ProcessId))) {
    const kind = processKind(p.CommandLine ?? '');
    snapshot[kind] = (snapshot[kind] ?? 0) + p.PrivatePageCount;
  }
  return snapshot;
}

function processKind(commandLine: string): string {
  const type = /--type=([\w-]+)/.exec(commandLine)?.[1];
  if (!type) return 'browser';
  if (type === 'renderer') return commandLine.includes('--extension-process') ? 'extension' : 'renderer';
  if (type === 'utility') return `utility:${/--utility-sub-type=([\w.]+)/.exec(commandLine)?.[1]?.split('.')[0] ?? '?'}`;
  return type;
}

mkdirSync(resultsDir, { recursive: true });
const variantArg = process.argv.find((arg) => arg.startsWith('--variant='))?.split('=')[1];

if (variantArg) {
  if (!isSpikeVariant(variantArg)) throw new Error(`Unknown variant ${variantArg}`);
  const runCount = Number(process.argv.find((arg) => arg.startsWith('--runs='))?.split('=')[1] ?? 1);
  const sessions: SessionResult[] = [];
  for (let i = 1; i <= runCount; i++) {
    console.log(`Variant ${variantArg}, run ${i}/${runCount} (cached profile)`);
    sessions.push(await runSession([variantArg], variantArg));
  }
  writeFileSync(join(resultsDir, `memory-${variantArg}.json`), JSON.stringify(sessions, null, 2));
  console.log(`Wrote spike/results/memory-${variantArg}.json`);
} else {
  if (!process.argv.includes('--keep-profile')) rmSync(profileDir, { recursive: true, force: true });
  console.log('Session 1: first load + fresh offscreen document');
  const first = await runSession(['first-load', 'fresh-document'], 'default');
  console.log('Session 2: after browser restart');
  const second = await runSession(['after-restart'], 'default');
  writeFileSync(
    join(resultsDir, 'browser.json'),
    JSON.stringify({ chromeVersion: first.chromeVersion, sessions: [first, second] }, null, 2),
  );
  console.log('Wrote spike/results/browser.json');
}
