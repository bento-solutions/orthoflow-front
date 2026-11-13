/**
 * `\b` in JavaScript is ASCII-only, even under the `u` flag: to the regex
 * engine "é" is not a word character. So `/\bcavit[ée]\b/` never matched
 * "cavité", `/\bmobilit(?:y|[ée])\b/` never matched "mobilité", and
 * `/\b[àa]\s+soigner/` never matched "à soigner" — every French term that
 * starts or ends with an accented letter failed silently, which in a French
 * clinic is a large share of the vocabulary.
 *
 * Rather than rewrite dozens of patterns by hand (and have the next one added
 * repeat the mistake), patterns keep their readable `\b` and are compiled
 * once through this, which substitutes a Unicode-aware boundary.
 */

/**
 * The letters and digits of the languages this speaks: the Latin blocks (French, English) and Arabic, written
 * out as ranges. It is exactly `\p{L}\p{N}` over those blocks (`voice-regex.spec.ts` proves it), and not that
 * class itself: a class of every letter of every script, compiled four times for each `\b` of some seven
 * hundred patterns, cost about four seconds of the first two sentences dictated (measured), where this
 * costs a fraction of one. A letter of another script is not a word character here.
 */
const LETTERS_AND_DIGITS =
  '\\u0030-\\u0039\\u0041-\\u005A\\u0061-\\u007A\\u00AA\\u00B2-\\u00B3\\u00B5\\u00B9-\\u00BA\\u00BC-\\u00BE' +
  '\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u1E00-\\u1EFF' +
  '\\u0620-\\u064A\\u0660-\\u0669\\u066E-\\u066F\\u0671-\\u06D3\\u06D5\\u06E5-\\u06E6\\u06EE-\\u06FC\\u06FF' +
  '\\uFB50-\\uFBB1\\uFBD3-\\uFD3D\\uFD50-\\uFD8F\\uFD92-\\uFDC7\\uFDF0-\\uFDFB\\uFE70-\\uFE74\\uFE76-\\uFEFC';

/** A word character, as a class: letters, digits and the underscore. */
export const WORD_CLASS = `[${LETTERS_AND_DIGITS}_]`;
const WORD = WORD_CLASS;
const UNICODE_BOUNDARY = `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;

const compiled = new WeakMap<RegExp, RegExp>();

export function unicodeBoundaries(pattern: RegExp): RegExp {
  let result = compiled.get(pattern);
  if (!result) {
    const flags = pattern.flags.includes('u') ? pattern.flags : `${pattern.flags}u`;
    result = new RegExp(pattern.source.replace(/\\b/g, UNICODE_BOUNDARY), flags);
    compiled.set(pattern, result);
  }
  return result;
}

/** End of a word, for patterns written without `\b` (Unicode-aware). */
export const WORD_END = `(?![${LETTERS_AND_DIGITS}])`;
