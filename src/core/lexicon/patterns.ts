import type { Category } from '../engine/categories';
import type { PhraseRule } from './types';

/*
 * Patterns run against `sentence(tokens)`: lowercase, leetspeak decoded,
 * apostrophes removed ("you're" → "youre", "I'll" → "ill"), single spaces.
 * JavaScript's \b only knows ASCII letters, so Devanagari rules don't use it.
 */

export const PHRASE_RULES: PhraseRule[] = [
  // English — threats and extortion with no bad words.
  { id: 'know-where-you-live', lang: 'en', category: 'threat', strength: 'strong', pattern: /\b(i|we) know where (you|u) live\b/ },
  {
    id: 'will-hurt-you',
    lang: 'en',
    category: 'threat',
    strength: 'strong',
    pattern: /\b(ill|i will|im gonna|i am gonna|im going to|i am going to|we will|gonna) (find|hunt|kill|hurt|beat|rape|shoot|stab|murder) (you|u|your family|ur family|your kids|ur kids)\b/,
  },
  {
    id: 'leak-your',
    lang: 'en',
    category: 'threat',
    strength: 'strong',
    pattern: /\b(leak|leaking|expose|exposing|release)\b.{0,20}\b(your|ur) (nudes?|pics?|photos?|pictures?|videos?|address|number|chats?)\b/,
  },
  { id: 'or-ill-leak', lang: 'en', category: 'threat', strength: 'strong', pattern: /\bor (ill|i will) (leak|post|share|expose|send|release)\b/ },
  {
    id: 'kill-yourself',
    lang: 'en',
    category: 'severe_toxicity',
    strength: 'strong',
    pattern: /\b(kill|hang|shoot|off) (yourself|urself|your self|ur self|yourselves)\b/,
  },
  {
    id: 'hope-you-die',
    lang: 'en',
    category: 'severe_toxicity',
    strength: 'strong',
    pattern: /\b(hope|wish) (you|u) (die|get cancer|rot)\b|\b(you|u) (should|deserve to) die\b/,
  },
  { id: 'watch-your-back', lang: 'en', category: 'threat', strength: 'mild', pattern: /\bwatch (out for )?(your|ur) back\b/ },
  { id: 'see-what-happens', lang: 'en', category: 'threat', strength: 'mild', pattern: /\bsee what happens( to (you|u))?\b/ },
  { id: 'youre-dead', lang: 'en', category: 'threat', strength: 'mild', pattern: /\b(youre|you are|ur|u r) (dead|finished|done for)\b/ },

  // Hinglish.
  {
    id: 'ghar-aake-maarunga',
    lang: 'hinglish',
    category: 'threat',
    strength: 'strong',
    pattern: /\b(ghar|gaon|office)\b.{0,25}\b(maar|maru|marunga|maarunga|maarenge|marenge|peet|peetunga|thok|thokunga)\w*/,
  },
  {
    id: 'tujhe-maar',
    lang: 'hinglish',
    category: 'threat',
    strength: 'strong',
    pattern: /\b(tujhe|tujhko|tereko|tumhe|tumko)\b.{0,15}\b(maar|maru|marunga|maarunga|thok|kaat|peet)\w*/,
  },
  { id: 'jaan-se-maar', lang: 'hinglish', category: 'threat', strength: 'strong', pattern: /\bjaan se maar\w*/ },
  { id: 'dekh-lunga', lang: 'hinglish', category: 'threat', strength: 'mild', pattern: /\bdekh (lunga|lenge|liyo|lena)\b/ },

  // Hindi (Devanagari, folded: no nukta, ँ → ं). Verbs must start a word:
  // "मार" also occurs inside हमारा ("ours").
  { id: 'ghar-aakar-marunga', lang: 'hi', category: 'threat', strength: 'strong', pattern: /(घर|गांव|ऑफिस).{0,25}(?:^|\s)(मार|पीट|ठोक)/ },
  {
    id: 'tujhe-marunga',
    lang: 'hi',
    category: 'threat',
    strength: 'strong',
    pattern: /(?:^|\s)(तुझे|तुझको|तुम्हें|तुमको|तेरे को)\s.{0,15}(?:^|\s)(मार|ठोक|काट|पीट)/,
  },
  { id: 'jaan-se-maarna', lang: 'hi', category: 'threat', strength: 'strong', pattern: /जान से मार/ },
  { id: 'dekh-lunga-hi', lang: 'hi', category: 'threat', strength: 'mild', pattern: /देख (लूंगा|लेंगे|लेना)/ },
];

/** Idioms that sound violent but aren't. When present, the model's threat score is ignored. */
const BENIGN_IDIOMS: RegExp[] = [
  /\b(kill|killing|killed|slay|slaying|slayed|nail|nailing|nailed|smash|smashing|crush|crushing) (it|this|that)\b/,
  /\bbreak a leg\b/,
  /\bknock (em|them) dead\b/,
  /\b(im|i am) dead\b/,
  /\b(dying|died|dead) (of|with|from) laugh/,
  /\bkill me now\b/,
  /\bdressed to kill\b/,
];

export function suppressedCategories(normalizedSentence: string): Category[] {
  return BENIGN_IDIOMS.some((idiom) => idiom.test(normalizedSentence)) ? ['threat'] : [];
}
