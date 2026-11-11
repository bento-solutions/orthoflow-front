import { extractFindings } from './clinical-lexicon';
import { Dentition, NUMBER_WORDS, QUANTITY_AFTER, allFdiCodes, parseNumber } from './tooth-lexicon';

/**
 * What a recogniser makes of a dentist's words next to a tooth number, put
 * back before anything decides whether the sentence is a command.
 *
 * In the consultation of 10 Nov 2026 three of eleven dictated findings were
 * lost this way, each a sentence the doctor said correctly:
 *
 * - "Donc vous avez **dans** 16 caries occlusales." — "dent" heard as "dans";
 *   "dans 16" reads as a quantity ("dans 16 jours"), so 16 was not a tooth.
 * - "C'est le schéma dentaire **dont** 11 caries occlusales." — the same with "dont".
 * - "38 **carré** occlusal." — "carie" heard as "carré", which is no finding.
 *
 * Two rules, applied in this order, each only beside a tooth number that
 * exists in the dentition, and never to the number itself (a fuzzy tooth
 * number is the one error that survives review looking correct):
 *
 * - **finding** — a word the recogniser makes of "carie" becomes "carie" when a
 *   tooth number stands within 4 words before it or 6 after;
 * - **tooth-word** — "dans", "dont", "temps"… immediately before a tooth number
 *   becomes "dent", when the number is not followed by a unit ("dans 15 jours",
 *   "dans 16 minutes") and a finding follows within 6 words.
 *
 * The list is evidence: a pair is added with the sentence it came from. "Donc"
 * is not in it — it is a filler, and "donc 45" already reads as tooth 45.
 */

export interface ConfusionRepair {
  text: string;
  repairs: { from: string; to: string; rule: 'tooth-word' | 'finding' }[];
}

/** What recognisers return for "carie" / "caries", heard in the 10 Nov session and its probes. */
const CARIES_CONFUSIONS: Readonly<Record<string, 'carie' | 'caries'>> = {
  carré: 'carie', carrée: 'carie', carre: 'carie', carree: 'carie',
  carrés: 'caries', carrées: 'caries', carres: 'caries', carrees: 'caries',
  carret: 'carie', cari: 'carie', caris: 'caries', carry: 'carie',
  karie: 'carie', karies: 'caries',
};

/** What recognisers return for "dent" right before its number. */
const TOOTH_WORD_CONFUSIONS = new Set(['dans', 'dan', 'den', "d'en", 'd’en', 'dont', 'temps', 'tant']);

/** How far from a tooth number a "carré" is still about it. */
const FINDING_REACH_BEFORE = 4;
const FINDING_REACH_AFTER = 6;
/** How soon after the number a finding must follow for "dans 16" to be "dent 16". */
const TOOTH_WORD_FINDING_REACH = 6;

interface Token {
  word: string;
  lower: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)].map(match => ({
    word: match[0],
    lower: match[0].toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/**
 * The tooth number starting at `index`, as the count of tokens it uses, or 0.
 * Digits ("16") or number words ("seize", "dix sept", "vingt et un").
 */
function toothNumberAt(text: string, tokens: Token[], index: number, teeth: ReadonlySet<string>): number {
  const first = tokens[index];
  if (!first) return 0;
  // "16 heures", "15 jours": a number with a unit after it is a quantity, not a tooth.
  const quantity = (last: Token) => QUANTITY_AFTER.test(text.slice(last.end));
  if (/^\d{2}$/.test(first.lower)) return teeth.has(first.lower) && !quantity(first) ? 1 : 0;
  if (!NUMBER_WORDS.has(first.lower)) return 0;
  for (let width = 3; width >= 1; width--) {
    const run = tokens.slice(index, index + width);
    if (run.length < width) continue;
    if (!run.every(token => NUMBER_WORDS.has(token.lower) || token.lower === 'et')) continue;
    if (run[run.length - 1].lower === 'et') continue;
    const value = parseNumber(run.map(token => token.word).join(' '));
    if (value !== null && teeth.has(String(value)) && !quantity(run[run.length - 1])) return width;
  }
  return 0;
}

function keepCase(original: string, replacement: string): string {
  return original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;
}

export function repairSttConfusions(text: string, dentition: Dentition = 'adult'): ConfusionRepair {
  const teeth = new Set(allFdiCodes(dentition));
  const repairs: ConfusionRepair['repairs'] = [];
  const edits: { start: number; end: number; to: string }[] = [];

  let tokens = tokenize(text);
  const isNumber = tokens.map((_, index) => toothNumberAt(text, tokens, index, teeth) > 0);

  // Finding: "38 carré occlusal" → "38 carie occlusal".
  tokens.forEach((token, index) => {
    const to = CARIES_CONFUSIONS[token.lower];
    if (!to) return;
    const near = isNumber.slice(Math.max(0, index - FINDING_REACH_BEFORE), index).some(Boolean)
      || isNumber.slice(index + 1, index + 1 + FINDING_REACH_AFTER).some(Boolean);
    if (!near) return;
    const replacement = keepCase(token.word, to);
    edits.push({ start: token.start, end: token.end, to: replacement });
    repairs.push({ from: token.word, to: replacement, rule: 'finding' });
  });
  let repaired = applyEdits(text, edits);

  // Tooth word: "dans 16 caries" → "dent 16 caries", read on the text the finding rule left.
  tokens = tokenize(repaired);
  const toothEdits: { start: number; end: number; to: string }[] = [];
  tokens.forEach((token, index) => {
    if (!TOOTH_WORD_CONFUSIONS.has(token.lower)) return;
    const width = toothNumberAt(repaired, tokens, index + 1, teeth);
    if (width === 0) return;
    const last = tokens[index + width];
    const rest = repaired.slice(last.end);
    if (QUANTITY_AFTER.test(rest)) return;
    const next = tokens.slice(index + 1 + width, index + 1 + width + TOOTH_WORD_FINDING_REACH);
    if (next.length === 0) return;
    const window = repaired.slice(next[0].start, next[next.length - 1].end);
    if (extractFindings(window).length === 0) return;
    const replacement = keepCase(token.word, 'dent');
    toothEdits.push({ start: token.start, end: token.end, to: replacement });
    repairs.push({ from: token.word, to: replacement, rule: 'tooth-word' });
  });
  repaired = applyEdits(repaired, toothEdits);

  return { text: repaired, repairs };
}

function applyEdits(text: string, edits: { start: number; end: number; to: string }[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.to + out.slice(edit.end);
  }
  return out;
}
