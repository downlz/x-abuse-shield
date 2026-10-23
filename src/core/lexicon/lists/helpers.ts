import type { Category } from '../../engine/categories';
import type { LexiconEntry, Strength } from '../types';

export function entries(
  category: Category,
  strength: Strength,
  terms: string[],
  options: Pick<LexiconEntry, 'prefix' | 'hinglishOnly'> = {},
): LexiconEntry[] {
  return terms.map((term) => ({ term, category, strength, ...options }));
}
