import { tokenize } from '../lexicon/normalize';

/** Shorter texts ("lol", "true", "😂😂") match each other naturally, so they never form clusters. */
const MIN_WORDS = 5;
const MIN_CHARS = 20;

/**
 * A key that is equal for copy-pasted replies despite case, @mentions, URLs,
 * punctuation, stretched letters and leetspeak. Null when the text is too
 * short to fingerprint.
 */
export function fingerprint(text: string): string | null {
  const words = tokenize(text).map((t) => t.loose);
  const key = words.join(' ');
  return words.length >= MIN_WORDS && key.length >= MIN_CHARS ? key : null;
}
