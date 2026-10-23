import type { Category } from '../engine/categories';

/** A built-in list. 'emoji' holds insulting emoji, used in every language. */
export type LexiconLang = 'en' | 'hi' | 'hinglish' | 'emoji';

/**
 * strong: flags on its own (slurs, targeted insults, "fuck you").
 * mild: only counts with corroboration — model toxicity, or a highly
 * suspicious account replying (PLAN §5.3). Words often used without abuse
 * ("fucking amazing", "pagal", "bc") are mild.
 */
export type Strength = 'strong' | 'mild';

export interface LexiconEntry {
  /** A word or space-separated phrase, written plainly. */
  term: string;
  category: Category;
  strength: Strength;
  /** Also match words starting with the term: "fuck" → "fucking", "fucker". */
  prefix?: boolean;
  /**
   * The word is ordinary elsewhere ("bc" = because, "Randi" = a name, "lund"
   * = a Swedish city), so it only counts in a post that reads as Hinglish.
   */
  hinglishOnly?: boolean;
}

/** Regex rules for threats and extortion that need no bad words ("I know where you live"). */
export interface PhraseRule {
  id: string;
  lang: LexiconLang;
  pattern: RegExp;
  category: Category;
  strength: Strength;
}

export interface LexiconHit {
  /** The built-in term, custom word or rule id that matched. */
  term: string;
  /** The text as written in the post. */
  matched: string;
  category: Category;
  strength: Strength;
  source: LexiconLang | 'custom';
}
