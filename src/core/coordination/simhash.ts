/**
 * 64-bit SimHash (as two 32-bit halves) over character 4-grams of a
 * fingerprint key. Near-identical texts get hashes a few bits apart.
 * Character shingles, not word 3-grams: in a 7-word reply, changing one word
 * changes most word 3-grams but only a small share of character 4-grams.
 */
export type SimHash = readonly [number, number];

const SHINGLE = 4;

export function simhash(key: string): SimHash {
  const weights = new Int32Array(64);
  const text = ` ${key} `;
  for (let i = 0; i + SHINGLE <= text.length; i++) {
    const base = fnv1a(text.slice(i, i + SHINGLE));
    const hi = fmix32(base ^ 0x9e3779b9);
    const lo = fmix32(base ^ 0x85ebca6b);
    for (let bit = 0; bit < 32; bit++) {
      weights[bit]! += (hi >>> bit) & 1 ? 1 : -1;
      weights[32 + bit]! += (lo >>> bit) & 1 ? 1 : -1;
    }
  }
  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (weights[bit]! > 0) hi |= 1 << bit;
    if (weights[32 + bit]! > 0) lo |= 1 << bit;
  }
  return [hi >>> 0, lo >>> 0];
}

export function hammingDistance(a: SimHash, b: SimHash): number {
  return popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]);
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** MurmurHash3's finaliser: spreads every input bit across the output. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}
