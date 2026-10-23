import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/** Replaces the test document with a saved x.com page (happy-dom environment). */
export function loadHtmlFixture(name: string): void {
  const html = readFileSync(join(FIXTURES, 'x', name), 'utf8');
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '');
}

export function loadJsonFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, 'x-api', name), 'utf8'));
}
