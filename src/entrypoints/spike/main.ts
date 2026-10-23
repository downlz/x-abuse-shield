import samples from '@@/spike/samples.json';
import { isMessage, type Message, type Reply } from '@/shared/messages';
import type { SpikeRunResult, SpikeSample } from '@/spike/types';
import { isSpikeVariant, type SpikeVariant } from '@/spike/variants';

/** Polled by scripts/spike-browser.ts. */
type SpikeState =
  | { status: 'idle' | 'running' }
  | { status: 'done'; runs: SpikeRunResult[] }
  | { status: 'error'; error: string };

declare global {
  interface Window {
    __spike: SpikeState;
  }
}

const logEl = document.querySelector('#log')!;
const resultEl = document.querySelector('#result')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const params = new URLSearchParams(location.search);
const labels = (params.get('labels') ?? 'first-load,fresh-document').split(',');
const variantParam = params.get('variant') ?? 'default';
const variant: SpikeVariant = isSpikeVariant(variantParam) ? variantParam : 'default';

window.__spike = { status: 'idle' };

function log(line: string) {
  logEl.textContent += `[${new Date().toLocaleTimeString()}] ${line}\n`;
  console.log(line);
}

async function request(message: Message): Promise<void> {
  const reply = (await browser.runtime.sendMessage(message)) as Reply | undefined;
  if (reply && !reply.ok) throw new Error(reply.error);
}

async function waitForOffscreen(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const reply = (await browser.runtime.sendMessage({ type: 'offscreen:ping' } satisfies Message)) as Reply | undefined;
      if (reply?.ok) return;
    } catch {
      // No listener has registered yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Offscreen document did not respond');
}

function runOnce(label: string): Promise<SpikeRunResult> {
  return new Promise((resolve, reject) => {
    const listener = (message: unknown) => {
      if (!isMessage(message)) return;
      if (message.type === 'spike:progress') log(`${label} · ${message.progress.stage} · ${message.progress.message}`);
      if (message.type === 'spike:done' && message.result.label === label) {
        browser.runtime.onMessage.removeListener(listener);
        resolve(message.result);
      }
      if (message.type === 'spike:error') {
        browser.runtime.onMessage.removeListener(listener);
        reject(new Error(message.error));
      }
    };
    browser.runtime.onMessage.addListener(listener);
    void request({ type: 'spike:run', samples: samples as SpikeSample[], label, variant });
  });
}

async function run() {
  runButton.disabled = true;
  window.__spike = { status: 'running' };
  const runs: SpikeRunResult[] = [];
  try {
    for (const label of labels) {
      // A fresh offscreen document per run, so later runs measure a cache load
      // into a clean JS context — the same thing that happens after a restart.
      await request({ type: 'offscreen:close' });
      await request({ type: 'offscreen:ensure' });
      await waitForOffscreen();
      log(`${label} · started`);
      const result = await runOnce(label);
      log(`${label} · load ${Math.round(result.load.ms)} ms, batch ${result.batch.perPostMs.toFixed(1)} ms/post`);
      runs.push(result);
    }
    resultEl.textContent = JSON.stringify(runs, null, 2);
    window.__spike = { status: 'done', runs };
  } catch (error) {
    log(`ERROR ${String(error)}`);
    window.__spike = { status: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', () => void run());
if (params.has('auto')) void run();
