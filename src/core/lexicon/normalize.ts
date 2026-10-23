/**
 * Turns post text into comparable tokens, undoing common disguises:
 * stylised Unicode letters (NFKC), zero-width characters, leetspeak
 * ("sh1t"), separators inside words ("f.u.c.k"), stretched letters
 * ("fuuuck"), and Devanagari spelling variants (nukta, chandrabindu).
 * Masked letters ("f*ck", "fuc#ing") are kept as wildcards for the matcher.
 */
export interface Token {
  /** As written, minus surrounding punctuation. */
  raw: string;
  /** Lowercase, decoded, separators removed. Mask characters (* # %) kept. */
  exact: string;
  /** `exact` with repeated Latin letters collapsed: "fuuuck" → "fuck". */
  loose: string;
  latin: boolean;
  devanagari: boolean;
  /** Contains mask characters standing in for letters. */
  masked: boolean;
}

/** Zero-width and soft-hyphen characters, plus bidi controls (RLM, overrides, isolates) that can hide inside a word. */
const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
const MENTION_OR_URL = /https?:\/\/\S+|www\.\S+|@\w+/giu;
const TOKEN = /[\p{L}\p{M}\p{N}*#%@$!._'’-]+/gu;
const EDGE_PUNCTUATION = /^[!._'’-]+|[!._'’-]+$/g;
const SEPARATORS = /[._'’-]/g;
const MASK = /[*#%]/;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
const LATIN = /\p{Script=Latin}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const NUKTA = /़/g;
const CHANDRABINDU = /ँ/g;
const ANUSVARA = 'ं';

export function tokenize(text: string): Token[] {
  const prepared = text.normalize('NFKC').replace(ZERO_WIDTH, '').replace(MENTION_OR_URL, ' ').toLowerCase();
  const tokens: Token[] = [];
  for (const match of prepared.matchAll(TOKEN)) {
    const raw = match[0].replace(EDGE_PUNCTUATION, '');
    if (!raw) continue;
    const latin = LATIN.test(raw);
    const devanagari = DEVANAGARI.test(raw);
    const exact = devanagari ? foldDevanagari(raw) : latin ? decodeLatin(raw) : raw.replace(SEPARATORS, '');
    if (!exact) continue;
    tokens.push({
      raw,
      exact,
      loose: latin ? collapseRuns(exact) : exact,
      latin,
      devanagari,
      masked: latin && MASK.test(exact),
    });
  }
  return tokens;
}

/** Tokens joined by single spaces — the form PhraseRule patterns are written against. */
export function sentence(tokens: Token[]): string {
  return tokens.map((t) => t.exact).join(' ');
}

function decodeLatin(token: string): string {
  const unaccented = token.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  return [...unaccented.replace(SEPARATORS, '')].map((ch) => LEET[ch] ?? ch).join('');
}

function foldDevanagari(token: string): string {
  return token.replace(NUKTA, '').replace(CHANDRABINDU, ANUSVARA).replace(SEPARATORS, '');
}

function collapseRuns(token: string): string {
  return token.replace(/(\p{L})\1+/gu, '$1');
}
