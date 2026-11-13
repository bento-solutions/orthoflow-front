import { describe, expect, it } from 'vitest';
import { WORD_CLASS, WORD_END, unicodeBoundaries } from './voice-regex';

/**
 * The word boundary of every voice pattern. It was `[\p{L}\p{N}_]`, a class of every letter of every script,
 * and the lexicon's seven hundred patterns, each boundary compiled four times, took about four seconds of
 * the first two sentences dictated. It is now written out for the scripts the voice speaks, and this holds it to
 * being the same set there.
 */
describe('the word character of the voice patterns', () => {
  // The blocks French, English and Arabic are written in.
  const BLOCKS: ReadonlyArray<readonly [number, number]> = [
    [0x0000, 0x024f], // Basic Latin to Latin Extended-B
    [0x1e00, 0x1eff], // Latin Extended Additional
    [0x0600, 0x06ff], // Arabic
    [0xfb50, 0xfdff], // Arabic Presentation Forms-A
    [0xfe70, 0xfeff], // Arabic Presentation Forms-B
  ];

  it('is exactly the letters, digits and underscore of Unicode, in those blocks', () => {
    const written = new RegExp(WORD_CLASS, 'u');
    const unicode = /[\p{L}\p{N}_]/u;
    const different: string[] = [];
    for (const [from, to] of BLOCKS) {
      for (let code = from; code <= to; code++) {
        const char = String.fromCodePoint(code);
        if (written.test(char) !== unicode.test(char)) different.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }
    expect(different).toEqual([]);
  });

  it('is not the class of every letter of every script, which is what made it slow to compile', () => {
    expect(WORD_CLASS).not.toContain('\\p{');
    expect(WORD_END).not.toContain('\\p{');
  });

  it('ends a word at the end of "carie", and "cavité", and not before the next letter', () => {
    expect(unicodeBoundaries(/\bcavit[ée]\b/iu).test('une cavité sur la 16')).toBe(true);
    expect(unicodeBoundaries(/\bcavit[ée]\b/iu).test('cavités')).toBe(false);
    expect(unicodeBoundaries(/\b[àa]\s+soigner\b/iu).test('dent 16, à soigner')).toBe(true);
    expect(unicodeBoundaries(/\bcarie\b/iu).test('précarie')).toBe(false);
    expect(unicodeBoundaries(/\bcarie\b/iu).test('carie_2')).toBe(false);
  });

  it('reads Arabic words, digits and punctuation as such', () => {
    expect(unicodeBoundaries(/\bتسوس\b/u).test('سن ١٦، تسوس')).toBe(true);
    expect(unicodeBoundaries(/\bتسوس\b/u).test('تسوسات')).toBe(false);
    expect(unicodeBoundaries(/\bسن\b/u).test('سن؟')).toBe(true);
  });

  it('keeps the end-of-word marker for the patterns written without \\b', () => {
    expect(new RegExp(`carie${WORD_END}`, 'iu').test('carie, profonde')).toBe(true);
    expect(new RegExp(`carie${WORD_END}`, 'iu').test('cariée')).toBe(false);
  });

  it('compiles the whole lexicon\'s worth of patterns in a fraction of the time the full class took', () => {
    // 300 patterns, each run twice: the class of every letter took about 1.7 seconds, this about a tenth of it.
    const patterns = Array.from({ length: 300 }, (_, i) => unicodeBoundaries(new RegExp(String.raw`\bcarie${i}s?\b|\bfracture${i}\b`, 'iu')));
    const started = performance.now();
    for (const text of ['dent 17 fracture et gingivite sur la molaire', 'dent 18 carie profonde mésio-occlusale']) {
      for (const pattern of patterns) pattern.exec(text);
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
