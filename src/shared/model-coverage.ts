import { MODEL_COVERAGE } from '@/adapters/inference/model';

/** Letters count; digits, punctuation, emoji and spaces don't. */
const LETTER = /\p{L}/u;
const scriptPatterns = new Map<string, RegExp>();
const scriptPattern = (scripts: string[]) => {
  const key = scripts.join(',');
  let pattern = scriptPatterns.get(key);
  if (!pattern) scriptPatterns.set(key, (pattern = new RegExp(`[${scripts.map((s) => `\\p{Script=${s}}`).join('')}]`, 'u')));
  return pattern;
};

/** Whether this model can read the post (MODEL_COVERAGE). Models without an entry read everything. */
export function modelReads(modelId: string, text: string, lang: string | undefined, hinglish: boolean): boolean {
  const coverage = MODEL_COVERAGE[modelId];
  if (!coverage) return true;
  if (lang && coverage.skipLangs.includes(lang.toLowerCase().split('-')[0]!) && !hinglish) return false;
  const covered = scriptPattern(coverage.scripts);
  let letters = 0;
  let inScripts = 0;
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    letters++;
    if (covered.test(char)) inScripts++;
  }
  // No letters (emoji, numbers): the model reads those as well as the full one does.
  return letters === 0 || inScripts / letters >= 0.5;
}
