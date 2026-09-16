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

const WORD = '[\\p{L}\\p{N}_]';
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
export const WORD_END = '(?![\\p{L}\\p{N}])';
