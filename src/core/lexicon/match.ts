import { EN } from './lists/en';
import { HI } from './lists/hi';
import { HINGLISH, HINGLISH_MARKERS } from './lists/hinglish';
import { sentence, tokenize, type Token } from './normalize';
import { PHRASE_RULES, suppressedCategories } from './patterns';
import type { LexiconEntry, LexiconHit, LexiconLang } from './types';
import type { Category } from '../engine/categories';

export interface LexiconOptions {
  languages: Record<LexiconLang, boolean>;
  customBlock: string[];
  customAllow: string[];
}

export interface LexiconResult {
  hits: LexiconHit[];
  /** Categories whose model score should be ignored (benign idioms like "kill it"). */
  suppressed: Category[];
  /** Two or more Hindi function words, a Hindi/Hinglish hit, or Devanagari text. */
  hinglish: boolean;
}

/**
 * Words of three letters or fewer are matched exactly; longer ones loosely
 * (stretched letters collapsed), otherwise "ass" would match "as".
 */
const LOOSE_MIN_LENGTH = 4;

interface CompiledEntry {
  entry: LexiconEntry;
  source: LexiconLang | 'custom';
  /** One key per word of the term. */
  words: { exact: string; key: string; loose: boolean }[];
}

const LISTS: Record<LexiconLang, LexiconEntry[]> = { en: EN, hi: HI, hinglish: HINGLISH };

export class Lexicon {
  private readonly byExact = new Map<string, CompiledEntry[]>();
  private readonly byLoose = new Map<string, CompiledEntry[]>();
  private readonly prefixed: CompiledEntry[] = [];
  private readonly all: CompiledEntry[] = [];
  private readonly allowed: Set<string>;
  private readonly rules = PHRASE_RULES;

  constructor(private readonly options: LexiconOptions) {
    for (const lang of Object.keys(LISTS) as LexiconLang[]) {
      if (options.languages[lang]) LISTS[lang].forEach((entry) => this.add(entry, lang));
    }
    for (const term of options.customBlock) {
      if (term.trim()) this.add({ term: term.trim(), category: 'insult', strength: 'strong' }, 'custom');
    }
    this.allowed = new Set(options.customAllow.map(phraseKey).filter(Boolean));
    this.rules = PHRASE_RULES.filter((rule) => options.languages[rule.lang]);
  }

  match(text: string): LexiconResult {
    const tokens = tokenize(text);
    const hits: (LexiconHit & { hinglishOnly: boolean })[] = [];

    for (let i = 0; i < tokens.length; ) {
      const found = this.longestAt(tokens, i);
      if (!found) {
        i++;
        continue;
      }
      const span = tokens.slice(i, i + found.words.length);
      if (!this.allowed.has(phraseKey(found.entry.term)) && !this.allowed.has(span.map((t) => t.exact).join(' '))) {
        hits.push({
          term: found.entry.term,
          matched: span.map((t) => t.raw).join(' '),
          category: found.entry.category,
          strength: found.entry.strength,
          source: found.source,
          hinglishOnly: !!found.entry.hinglishOnly,
        });
      }
      i += found.words.length;
    }

    const normalized = sentence(tokens);
    for (const rule of this.rules) {
      const m = rule.pattern.exec(normalized);
      if (m && !this.allowed.has(phraseKey(m[0]))) {
        hits.push({ term: rule.id, matched: m[0], category: rule.category, strength: rule.strength, source: rule.lang, hinglishOnly: false });
      }
    }

    const hinglish =
      tokens.some((t) => t.devanagari) ||
      new Set(tokens.filter((t) => HINGLISH_MARKERS.has(t.exact)).map((t) => t.exact)).size >= 2 ||
      hits.some((h) => !h.hinglishOnly && (h.source === 'hinglish' || h.source === 'hi'));

    return {
      hits: hits.filter((h) => hinglish || !h.hinglishOnly).map(({ hinglishOnly: _, ...hit }) => hit),
      suppressed: suppressedCategories(normalized),
      hinglish,
    };
  }

  private add(entry: LexiconEntry, source: CompiledEntry['source']) {
    const words = tokenize(entry.term).map((t) => {
      const loose = t.exact.length >= LOOSE_MIN_LENGTH;
      return { exact: t.exact, key: loose ? t.loose : t.exact, loose };
    });
    if (words.length === 0) return;
    const compiled: CompiledEntry = { entry, source, words };
    this.all.push(compiled);
    if (entry.prefix && words.length === 1) this.prefixed.push(compiled);
    const first = words[0]!;
    const index = first.loose ? this.byLoose : this.byExact;
    index.set(first.key, [...(index.get(first.key) ?? []), compiled]);
  }

  private longestAt(tokens: Token[], i: number): CompiledEntry | null {
    const token = tokens[i]!;
    const candidates = new Set<CompiledEntry>([
      ...(this.byExact.get(token.exact) ?? []),
      ...(this.byLoose.get(token.loose) ?? []),
      ...this.prefixed.filter((c) => prefixMatches(token, c.words[0]!)),
      ...(token.masked ? this.all.filter((c) => wordMatches(token, c.words[0]!)) : []),
    ]);
    let best: CompiledEntry | null = null;
    for (const candidate of candidates) {
      if (best && candidate.words.length <= best.words.length) continue;
      const fits = candidate.words.every((word, k) => {
        const t = tokens[i + k];
        if (!t) return false;
        if (k === 0 && candidate.entry.prefix && candidate.words.length === 1) return prefixMatches(t, word);
        return wordMatches(t, word);
      });
      if (fits) best = candidate;
    }
    return best;
  }
}

function wordMatches(token: Token, word: CompiledEntry['words'][number]): boolean {
  if (token.masked) return wildcardEquals(token.exact, word.exact);
  return word.loose ? token.loose === word.key : token.exact === word.key;
}

function prefixMatches(token: Token, word: CompiledEntry['words'][number]): boolean {
  if (token.masked) return wildcardEquals(token.exact.slice(0, word.exact.length), word.exact);
  return word.loose ? token.loose.startsWith(word.key) : token.exact.startsWith(word.key);
}

/** "f*ck" = "fuck": masks stand in for single letters; the first letter must be real. */
function wildcardEquals(masked: string, plain: string): boolean {
  if (masked.length !== plain.length || masked[0] !== plain[0]) return false;
  let masks = 0;
  for (let k = 0; k < masked.length; k++) {
    if ('*#%'.includes(masked[k]!)) masks++;
    else if (masked[k] !== plain[k]) return false;
  }
  return masks > 0 && masks <= masked.length / 2;
}

function phraseKey(text: string): string {
  return tokenize(text)
    .map((t) => t.exact)
    .join(' ');
}
