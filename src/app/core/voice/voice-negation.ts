import { unicodeBoundaries } from './voice-regex';

/**
 * Where a dictated sentence says a thing is *not* so.
 *
 * The lexicon finds the word "carie" in "pas de carie sur la seize" exactly as
 * it finds it in "carie sur la seize", and the two sentences mean opposite
 * things. Recording the first as a caries finding puts a diagnosis on the
 * record that the dentist explicitly ruled out; recording "le patient n'est
 * pas allergique à la pénicilline" as an allergy withholds a drug from a
 * patient who can take it. So a finding that a negation governs is never
 * staged as a finding. The caller keeps the dentist's own words as a note
 * instead, which is a true record of what was said.
 *
 * Deliberately conservative in one direction: when it is unclear whether a
 * cue reaches a finding, it is treated as reaching it. A negated finding
 * degrades to a note the dentist hears read back ("Note, dent 16 : …"), whereas
 * a missed negation writes the opposite of the truth.
 *
 * Framework-free, like the other lexicons, so it is testable without a
 * browser.
 */

interface Cue {
  pattern: RegExp;
  /**
   * Extra context check. Receives the whole utterance and the match, so a cue
   * can depend on where in the sentence it stands.
   */
  accept?: (text: string, match: RegExpMatchArray) => boolean;
}

/** "Non," and "no, actually" answer or correct; they do not negate the next word. */
const REPLY_TAIL = /^\s*(?:[,.;:!?]|(?:en\s+fait|plut[ôo]t|actually|in\s+fact|rather)\b)/iu;

const CUES: Cue[] = [
  // ── French ──────────────────────────────────────────────────────────
  { pattern: /\bpas\b/giu },
  { pattern: /\bsans\b/giu },
  { pattern: /\baucun(?:e|s|es)?\b/giu },
  { pattern: /\babsence\b/giu },
  { pattern: /\bjamais\b/giu },
  { pattern: /\bni\b/giu },
  { pattern: /\brien\s+de\b/giu },
  { pattern: /\b(?:exempte?s?|indemnes?)\s+de\b/giu },
  {
    // "non mobile", "non carié". As the first word it is a reply ("non, …"),
    // and French does not negate a finding by opening with "non".
    pattern: /\bnon\b/giu,
    accept: (text, match) => {
      const at = match.index ?? 0;
      if (text.slice(0, at).trim() === '') return false;
      return !REPLY_TAIL.test(text.slice(at + match[0].length));
    },
  },

  // ── English ─────────────────────────────────────────────────────────
  {
    pattern: /\bno\b/giu,
    accept: (text, match) => !REPLY_TAIL.test(text.slice((match.index ?? 0) + match[0].length)),
  },
  { pattern: /\bnot\b/giu },
  { pattern: /\bwithout\b/giu },
  { pattern: /\bnone\b/giu },
  { pattern: /\bnever\b/giu },
  { pattern: /\bnor\b/giu },
  { pattern: /\bneither\b/giu },
  { pattern: /\bfree\s+of\b/giu },
  { pattern: /\bnegative\s+for\b/giu },
  { pattern: /\bdenies\b/giu },
  { pattern: /n['’]t\b/giu },

  // ── Darija, transliterated and in Arabic script ─────────────────────
  { pattern: /\bmakayn\w*/giu },
  { pattern: /\bmafiha\w*/giu },
  { pattern: /\bbla\b/giu },
  { pattern: /\bmachi\b/giu },
  { pattern: /ماكاين\w*|ما\s+كاين\w*|مافيها\w*|ما\s+فيها\w*|بلا(?![\p{L}])|بدون/gu },
];

/** Words that end the reach of a negation: it does not carry across them. */
const CLAUSE_BREAK =
  /[,;.!?:]|\s(?:mais|but|however|puis|then|sauf|except|sinon|otherwise)\s|\salors\s+que\s/giu;

/**
 * How many words may sit between a cue and the finding it governs. "pas de
 * signe de carie" puts three between "pas" and "carie"; a fifth word is no
 * longer the same thought.
 */
const MAX_WORDS_BETWEEN = 4;

interface Located {
  start: number;
  end: number;
}

/** Every cue in `text`, in order of appearance. */
function cuesIn(text: string): Located[] {
  const found: Located[] = [];
  for (const cue of CUES) {
    const pattern = unicodeBoundaries(cue.pattern);
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      if (cue.accept && !cue.accept(text, match)) continue;
      found.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The clause of `text` that contains `index`. */
export function clauseBounds(text: string, index: number): Located {
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    if (match.index === undefined) continue;
    const breakEnd = match.index + match[0].length;
    if (breakEnd <= index) start = breakEnd;
    else if (match.index >= index) {
      end = match.index;
      break;
    }
  }
  return { start, end };
}

/** The words of the clause around `index`, for keeping as a note. */
export function clauseAround(text: string, index: number): string {
  const { start, end } = clauseBounds(text, index);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * True when a negation cue governs the word that starts at `index`: it stands
 * earlier in the same clause, with no more than a few words between.
 */
export function isNegatedAt(text: string, index: number): boolean {
  const { start } = clauseBounds(text, index);
  const nearest = cuesIn(text)
    .filter(cue => cue.start >= start && cue.end <= index)
    .pop();
  if (!nearest) return false;
  const between = text.slice(nearest.end, index).trim();
  const words = between === '' ? 0 : between.split(/\s+/).length;
  return words <= MAX_WORDS_BETWEEN;
}

/** Offset of the first negation cue, or -1 when there is none. */
export function firstNegationIndex(text: string): number {
  return cuesIn(text)[0]?.start ?? -1;
}

/** True when the utterance carries any negation cue at all. */
export function containsNegation(text: string): boolean {
  return cuesIn(text).length > 0;
}

/**
 * A label that is itself a negation — "aucun", "pas de médicaments", "none".
 * Recorded as an entry it would read as a real allergy, medication or history
 * item called "aucun".
 */
export function startsNegated(label: string): boolean {
  return /^\s*(?:aucun(?:e|s|es)?|pas|sans|rien|n[ée]ant|non|no|none|nothing|nil|not)(?![\p{L}\p{N}])/iu.test(label);
}
