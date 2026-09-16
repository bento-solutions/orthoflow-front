import { describe, it, expect } from 'vitest';
import {
  resolveTooth,
  describeFdi,
  isValidFdi,
  parseNumber,
  universalToFdi,
  allFdiCodes,
} from './tooth-lexicon';

/**
 * The tooth lexicon is the one place where a wrong answer writes to the wrong
 * patient's tooth, so these tests are written as a safety net rather than for
 * coverage: every naming convention the product promises to accept has a case,
 * and so does every phrase that must be refused instead of guessed.
 */
describe('resolveTooth — naming conventions the doctor may use', () => {
  const expectFdi = (utterance: string, fdi: string, dentition: 'adult' | 'child' = 'adult') => {
    const result = resolveTooth(utterance, dentition);
    expect(result.kind, `"${utterance}" should resolve, got ${JSON.stringify(result)}`).toBe('resolved');
    if (result.kind === 'resolved') expect(result.fdi, `"${utterance}"`).toBe(fdi);
  };

  it('resolves fully-specified anatomical names', () => {
    expectFdi('upper right first molar', '16');
    expectFdi('top right first molar', '16');
    expectFdi('lower left second molar', '37');
    expectFdi('upper left central incisor', '21');
    expectFdi('upper right central incisor', '11');
    expectFdi('lower right canine', '43');
    expectFdi('upper left second premolar', '25');
    expectFdi('lower left third molar', '38');
    expectFdi('upper right wisdom tooth', '18');
  });

  it('resolves the trailing-ordinal forms ("molar one", "incisor two")', () => {
    expectFdi('upper right molar one', '16');
    expectFdi('upper left molar two', '27');
    expectFdi('lower right premolar one', '44');
    expectFdi('upper left incisor two', '22');
  });

  it('resolves quadrant-plus-position shorthand', () => {
    expectFdi('right upper six', '16');
    expectFdi('upper right 6', '16');
    expectFdi('lower left 7', '37');
  });

  it('resolves explicit FDI codes, spoken whole or digit by digit', () => {
    expectFdi('tooth sixteen', '16');
    expectFdi('tooth 16', '16');
    expectFdi('tooth one six', '16');
    expectFdi('tooth four eight', '48');
    expectFdi('dent 36', '36');
  });

  it('resolves a bare FDI code with no "tooth" prefix', () => {
    expectFdi('16 recurrent caries', '16');
  });

  it('resolves French clinical phrasing', () => {
    expectFdi('molaire superieure droite un', '16');
    expectFdi('incisive centrale superieure gauche', '21');
    expectFdi('canine inferieure droite', '43');
    expectFdi('dent de sagesse superieure gauche', '28');
  });

  it('ignores redundant region words the doctor adds naturally', () => {
    // "Upper front left central incisor one" — front and "one" are both
    // redundant with "central incisor", and must not break the parse.
    expectFdi('upper front left central incisor one', '21');
    expectFdi('upper front right central incisor one', '11');
  });

  it('accepts Universal numbering when the doctor says so explicitly', () => {
    expectFdi('universal 3', '16');
    expectFdi('universal number 30', '46');
    expect(universalToFdi(1)).toBe('18');
    expect(universalToFdi(32)).toBe('48');
    expect(universalToFdi(33)).toBeNull();
  });

  it('maps the deciduous dentition to quadrants 5-8 with no premolars', () => {
    expectFdi('upper right first molar', '54', 'child');
    expectFdi('lower left second molar', '75', 'child');
    expectFdi('upper left central incisor', '61', 'child');
  });
});

describe('resolveTooth — refuses to guess', () => {
  const expectAmbiguous = (utterance: string) => {
    const result = resolveTooth(utterance);
    expect(result.kind, `"${utterance}" must not resolve to a single tooth`).toBe('ambiguous');
    return result;
  };

  it('asks which tooth when the family names several', () => {
    const result = expectAmbiguous('upper molar needs treatment');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThan(1);
      expect(result.question).toMatch(/which|did you mean/i);
    }
  });

  it('asks for the side when only the arch is given', () => {
    expectAmbiguous('upper first molar');
  });

  it('asks for the arch when only the side is given', () => {
    expectAmbiguous('right first molar');
  });

  it('offers a short pick-list when few teeth remain', () => {
    // Arch and position known, side missing → exactly two candidates.
    const result = resolveTooth('upper first molar');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toEqual(['16', '26']);
      expect(result.question).toContain('16');
      expect(result.question).toContain('26');
    }
  });

  it('refuses a permanent tooth code on a child chart instead of translating it', () => {
    const result = resolveTooth('tooth 16', 'child');
    expect(result.kind).toBe('ambiguous');
  });

  it('refuses a premolar on a child chart', () => {
    const result = resolveTooth('upper right first premolar', 'child');
    expect(result.kind).toBe('ambiguous');
  });

  it('returns none when the utterance mentions no tooth at all', () => {
    expect(resolveTooth('patient reports pain when chewing').kind).toBe('none');
    expect(resolveTooth('add an allergy to penicillin').kind).toBe('none');
  });
});

describe('FDI helpers', () => {
  it('validates FDI codes against the dentition each quadrant belongs to', () => {
    expect(isValidFdi('16')).toBe(true);
    expect(isValidFdi('48')).toBe(true);
    expect(isValidFdi('55')).toBe(true);
    expect(isValidFdi('56')).toBe(false); // deciduous quadrants stop at 5
    expect(isValidFdi('19')).toBe(false);
    expect(isValidFdi('09')).toBe(false);
    expect(isValidFdi('1')).toBe(false);
  });

  it('describes a code in the words a doctor would use', () => {
    expect(describeFdi('16')).toBe('upper right first molar');
    expect(describeFdi('21')).toBe('upper left central incisor');
    expect(describeFdi('37')).toBe('lower left second molar');
    expect(describeFdi('43')).toBe('lower right canine');
  });

  it('enumerates 32 permanent and 20 deciduous teeth', () => {
    expect(allFdiCodes('adult')).toHaveLength(32);
    expect(allFdiCodes('child')).toHaveLength(20);
  });
});

describe('parseNumber — the recogniser hands us words as often as digits', () => {
  it('reads digits and English number words', () => {
    expect(parseNumber('16')).toBe(16);
    expect(parseNumber('sixteen')).toBe(16);
    expect(parseNumber('twenty six')).toBe(26);
    expect(parseNumber('forty eight')).toBe(48);
  });

  it('reads French number words including the "et" compound', () => {
    expect(parseNumber('seize')).toBe(16);
    expect(parseNumber('vingt six')).toBe(26);
    expect(parseNumber('vingt et un')).toBe(21);
    expect(parseNumber('trente six')).toBe(36);
  });

  it('reads transliterated Arabic digits', () => {
    expect(parseNumber('setta')).toBe(6);
    expect(parseNumber('tmnya')).toBe(8);
  });

  it('folds Arabic-Indic numerals to ASCII', () => {
    expect(parseNumber('١٦')).toBe(16);
  });

  it('returns null when there is no number', () => {
    expect(parseNumber('crown replacement')).toBeNull();
  });
});

describe('resolveTooth — French article forms', () => {
  it('reads "sur la seize" and "la vingt-six" as teeth, as French dictation names them', () => {
    expect(resolveTooth('carie sur la seize')).toMatchObject({ kind: 'resolved', fdi: '16' });
    expect(resolveTooth('la vingt-six, couronne à remplacer')).toMatchObject({ kind: 'resolved', fdi: '26' });
    expect(resolveTooth('enlève la carie sur la seize')).toMatchObject({ kind: 'resolved', fdi: '16' });
  });

  it('never turns an article and a small number, or a noun, into a tooth', () => {
    expect(resolveTooth('la deux')).toEqual({ kind: 'none' });
    expect(resolveTooth('la carie')).toEqual({ kind: 'none' });
  });
});
