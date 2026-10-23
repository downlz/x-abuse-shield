import type { LexiconEntry } from '../types';
import { entries } from './helpers';

/**
 * Emoji used as insults, in any language. The model barely reacts to them
 * (🖕 alone scores toxicity 0.05, "@name 🖕" 0.17), so only this list sees
 * them. 🤡 and 💩 are everyday emoji too: as mild terms they count only in
 * replies and mentions from suspicious accounts (PLAN §5.3).
 */
export const EMOJI: LexiconEntry[] = [...entries('insult', 'strong', ['🖕']), ...entries('insult', 'mild', ['🤡', '💩'])];
