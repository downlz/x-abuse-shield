import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBytes } from '@/adapters/inference/read-bytes';

/** A response that streams `body` in small chunks and claims `declared` bytes. */
function serve(body: Uint8Array, declared: number) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < body.length; i += 7) controller.enqueue(body.slice(i, i + 7));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', async () => new Response(stream, { headers: { 'content-length': String(declared) } }));
}

const file = Uint8Array.from({ length: 100 }, (_, i) => i);

describe('readBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads a file whose declared size is its compressed size (Firefox reading a packed .xpi)', async () => {
    serve(file, 60);
    const progress: number[] = [];
    const bytes = await readBytes('moz-extension://x/model.ort', (p) => progress.push(p));
    expect([...bytes]).toEqual([...file]);
    expect(Math.max(...progress)).toBe(99);
  });

  it('reads a file shorter than declared, and one that matches', async () => {
    serve(file, 150);
    expect([...(await readBytes('https://host/model.ort', () => undefined))]).toEqual([...file]);
    serve(file, 100);
    const progress: number[] = [];
    expect((await readBytes('https://host/model.ort', (p) => progress.push(p))).byteLength).toBe(100);
    expect(progress.at(-1)).toBe(99);
  });
});
