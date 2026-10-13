import { FINDINGS } from './clinical-lexicon';
import { NUMBER_WORDS } from './tooth-lexicon';

/**
 * Repairs near-miss clinical terms so the deterministic grammar gets a chance
 * to match them.
 *
 * ── The problem this solves ─────────────────────────────────────────────
 *
 * The grammar is regex, and regex is exact. A dentist says "upper right first
 * molar recurrence caries", the recogniser hears it faithfully, and
 * `/\bcarie\s+r[ée]currente/` and its English twin both decline — because the
 * word was "recurrence", not "recurrent". The command is lost, and to the
 * dentist it looks as though the system simply did not hear them.
 *
 * Widening the patterns is not the answer: they would have to anticipate every
 * inflection and mishearing in three languages, and every widening makes some
 * other finding easier to match by accident. Sending every miss to an LLM is
 * not the answer either — it works, but it costs a network round trip on an
 * utterance that was 95% right, and the dentist waits.
 *
 * So this sits between the two. It corrects individual words against the
 * vocabulary the lexicon already contains, in about a millisecond, and hands
 * the repaired sentence back to the same grammar. What it cannot repair still
 * falls through to the LLM.
 *
 * ── What it will not touch ──────────────────────────────────────────────
 *
 * Numbers. Never. "Seize" is one edit from "sept" and two from "treize", and
 * a fuzzy match there moves a finding to a different tooth — which is the one
 * error class that survives review, because the resulting record reads as
 * entirely ordinary. Digits, number words in all three languages, and any
 * token containing a digit are excluded before matching, and the threshold is
 * set high enough that ordinary words are not rewritten either.
 */

/**
 * Jaro-Winkler similarity below which two words are treated as unrelated.
 *
 * Jaro-Winkler rather than plain edit distance because mishearings and
 * inflections overwhelmingly preserve the start of a word — "recurrence" for
 * "recurrent", "caries" for "carie" — while genuinely different clinical
 * terms tend to diverge early. Normalised Levenshtein scores
 * "recurrence"/"recurrent" at 0.80, below any threshold that is also safe,
 * which is precisely the repair this module exists to make.
 *
 * 0.92 was chosen against the real lexicon:
 *
 *     recurrence → recurrent    0.938   accepted
 *     caries     → carie        0.967   accepted
 *     obturation → obturations  0.982   accepted
 *     gingivale  → gingivite    0.911   REJECTED
 *     seize      → treize       0.822   rejected
 *     carie      → couronne     0.693   rejected
 *
 * The gingivale/gingivite pair is why it sits at 0.92 and not lower: gingival
 * recession and gingivitis are different findings, and the right behaviour
 * when the system cannot tell which was said is to decline and let the
 * utterance fall through to the LLM — not to pick one.
 */
const SIMILARITY_FLOOR = 0.92;

/** Shorter words are too easy to turn into a different word entirely. */
const MIN_LENGTH = 5;

/**
 * Words that appear inside lexicon patterns but carry no clinical meaning —
 * correcting a word *to* one of these gains nothing and risks destroying the
 * word that was actually said.
 */
const STOPWORDS = new Set([
  'dans', 'avec', 'pour', 'este', 'cette', 'cette', 'leur', 'sont', 'plus',
  'that', 'this', 'with', 'from', 'have', 'been', 'they', 'their', 'needs',
  'need', 'requires', 'require', 'doit', 'faut', 'être', 'etre', 'elle',
]);

/**
 * Strips accents and lowercases, so "récurrente" and "recurrente" are one
 * word. Moroccan clinicians type and recognisers transcribe accents
 * inconsistently, and an accent is never the difference between two clinical
 * terms.
 */
export function foldAccents(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC');
}

/**
 * Splits French elisions so the word underneath can be matched.
 *
 * "L'obturation" is one token to a tokeniser and an unknown word to the
 * vocabulary; "l obturation" is a stopword and a term the lexicon knows.
 * Recognisers also render the apostrophe half a dozen ways, hence the class.
 */
export function expandElisions(text: string): string {
  return text.replace(/\b([cdjlmnst]|qu|jusqu|lorsqu|puisqu)['’‘`´]/giu, '$1 ');
}

/** How many spellings one pattern may expand to — a guard, the lexicon's own groups are small. */
const MAX_EXPANSIONS = 64;

/**
 * Writes out every choice in a regex's non-capturing groups: `infect(?:ion|ed)`
 * becomes `infection` and `infected`, `couronne(?:s)?` becomes both with and
 * without. Innermost groups first, so nesting works; anything it cannot read is
 * left as it is.
 */
export function expandAlternations(source: string): string[] {
  const group = /\(\?:([^()]*)\)(\?)?/.exec(source);
  if (!group) return [source];
  const head = source.slice(0, group.index);
  const tail = source.slice(group.index + group[0].length);
  const choices = group[1].split('|');
  if (group[2]) choices.push('');

  const out: string[] = [];
  for (const choice of choices) {
    for (const rest of expandAlternations(head + choice + tail)) {
      out.push(rest);
      if (out.length >= MAX_EXPANSIONS) return out;
    }
  }
  return out;
}

/**
 * Every literal word the clinical lexicon's patterns can match, harvested
 * from the regex sources themselves.
 *
 * Deriving the vocabulary rather than maintaining a second list is what keeps
 * the two from drifting: a finding added to `clinical-lexicon.ts` with French
 * patterns is fuzzy-matchable the moment it is added, with nothing else to
 * remember. The cost is that regex metacharacters have to be stripped out,
 * which is what the character class below does — it keeps runs of letters and
 * discards everything else.
 */
let vocabularyCache: Set<string> | null = null;

export function clinicalVocabulary(): ReadonlySet<string> {
  if (vocabularyCache) return vocabularyCache;

  const words = new Set<string>();
  for (const finding of FINDINGS) {
    for (const pattern of finding.patterns) {
      // A group of alternatives — `infect(?:ion|ed)` — has to be written out
      // before the letters are read, or "infection" is never a word at all and
      // "infectione" has nothing to be repaired to: stripping the group's
      // punctuation leaves "infect" and two stray syllables.
      for (const source of expandAlternations(pattern.source)) {
        // Regex syntax has to be reduced to letters without breaking words
        // apart. The subtle one is the character class: the lexicon writes
        // `r[ée]currente`, so deleting `[ée]` would yield "r" and "currente"
        // and the word "recurrente" would never enter the vocabulary at all —
        // which is precisely the word this whole module exists to match.
        // Collapsing the class to its first alternative keeps it whole.
        const literal = source
          // `\b` is zero-width: it marks a boundary, it does not separate one.
          .replace(/\\b/g, '')
          .replace(/\[\^?([^\]])[^\]]*\]/g, '$1')
          // `\s`, `\w`, `\d` and friends genuinely do separate words.
          .replace(/\\[a-zA-Z]/g, ' ')
          .replace(/\{[^}]*\}/g, ' ')
          // Alternation and grouping separate alternatives, not letters.
          .replace(/[(){}|?*+.^$\\\/]/g, ' ');

        for (const match of literal.matchAll(/[a-zà-öø-ÿ]+/giu)) {
          const word = foldAccents(match[0]);
          if (word.length >= MIN_LENGTH && !STOPWORDS.has(word) && !NUMBER_WORDS.has(word)) {
            words.add(word);
          }
        }
      }
    }
  }
  vocabularyCache = words;
  return words;
}

/** Jaro similarity: matching characters within a sliding window, minus transpositions. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(b.length, i + window + 1);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/** How much a shared prefix (up to 4 characters) lifts the score. */
const WINKLER_SCALING = 0.1;

/**
 * Jaro-Winkler similarity, 0–1.
 *
 * The Winkler prefix bonus is what makes this the right measure here: a
 * mishearing or an inflection nearly always keeps the opening of the word,
 * whereas two different clinical terms usually part company early.
 */
export function similarity(a: string, b: string): number {
  const score = jaro(a, b);
  let prefix = 0;
  const limit = Math.min(4, a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix++;
  return score + prefix * WINKLER_SCALING * (1 - score);
}

/**
 * A token is off-limits if it is, or contains, a number in any form.
 *
 * Deliberately broad: "16", "seize", "sixteen", "1.6", "16a" are all refused.
 * The cost of being too cautious here is one utterance falling through to the
 * LLM; the cost of being too permissive is a finding on the wrong tooth.
 */
function isNumeric(token: string): boolean {
  return /\d/.test(token) || NUMBER_WORDS.has(token);
}

export interface FuzzyRepair {
  /** The transcript with near-miss terms replaced. */
  text: string;
  /** What was changed, for the HUD and the audit trail. */
  corrections: { from: string; to: string }[];
}

/** How many candidates per token the grammar is allowed to arbitrate between. */
const MAX_CANDIDATES = 3;

/**
 * Repairs a transcript's clinical terms.
 *
 * Returns the text unchanged, with an empty `corrections`, when nothing was
 * close enough — which is the common case for an utterance the grammar
 * already handles, so calling this before every grammar retry costs nothing.
 *
 * Pass `accept` to let the caller's parser choose between close candidates —
 * see the note inside on why similarity alone picks the wrong word across
 * languages. The caller should surface `corrections` when the repair lands: a
 * dentist is entitled to know that the system heard one word and acted on
 * another.
 */
export function repairClinicalTerms(
  transcript: string,
  accept?: (text: string) => boolean,
): FuzzyRepair {
  const vocabulary = clinicalVocabulary();

  // Elisions first: "l'obturation" has to become two tokens before either can
  // be looked up.
  const expanded = expandElisions(transcript);

  // Split into pieces so a token's replacement can be swapped without
  // re-scanning the string.
  const pieces = expanded.split(/([\p{L}\p{N}]+)/u);
  const options = new Map<number, string[]>();

  for (let i = 0; i < pieces.length; i++) {
    // Odd indices are the captured word tokens.
    if (i % 2 === 0) continue;
    const folded = foldAccents(pieces[i]);
    if (folded.length < MIN_LENGTH) continue;
    if (isNumeric(folded)) continue;
    if (vocabulary.has(folded)) continue;

    const ranked = rankCandidates(folded, vocabulary);
    if (ranked.length > 0) options.set(i, ranked);
  }

  if (options.size === 0) return { text: expanded, corrections: [] };

  const chosen = new Map<number, number>();
  for (const index of options.keys()) chosen.set(index, 0);

  const build = (): string => {
    const out = [...pieces];
    for (const [index, choice] of chosen) out[index] = options.get(index)![choice];
    return out.join('');
  };

  // Without a validator the highest-scoring candidate stands.
  if (accept) {
    // Similarity alone picks the wrong word across languages: "recurrence"
    // scores higher against the French "récurrente" than the English
    // "recurrent", and the French pattern needs "carie" in front of it, so the
    // repaired sentence still fails to parse. The grammar is the only thing
    // that knows which candidate actually means something, so it arbitrates —
    // one token at a time, keeping whichever choice the grammar accepts.
    if (!accept(build())) {
      outer: for (const [index, candidates] of options) {
        for (let choice = 1; choice < candidates.length; choice++) {
          chosen.set(index, choice);
          if (accept(build())) break outer;
        }
        chosen.set(index, 0);
      }
    }
  }

  const corrections: { from: string; to: string }[] = [];
  for (const [index, choice] of chosen) {
    corrections.push({ from: pieces[index], to: options.get(index)![choice] });
  }
  return { text: build(), corrections };
}

/** The closest vocabulary words to a token, best first. */
function rankCandidates(folded: string, vocabulary: ReadonlySet<string>): string[] {
  const scored: { word: string; score: number }[] = [];
  for (const candidate of vocabulary) {
    const score = similarity(folded, candidate);
    if (score >= SIMILARITY_FLOOR) scored.push({ word: candidate, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(entry => entry.word);
}
