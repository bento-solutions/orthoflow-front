import { describe, it, expect } from 'vitest';
import {
  extractFindings,
  findingLabel,
  findingKind,
  allFindingCodes,
  detectSurface,
  detectSeverity,
  assertLexiconMatches,
} from './clinical-lexicon';

const codesOf = (utterance: string) => extractFindings(utterance).map(f => f.code);

describe('extractFindings — several findings per utterance', () => {
  it('records all three findings in the canonical example', () => {
    // The case the whole findings model exists for: a single-status record
    // would keep one of these and silently discard the other two.
    const codes = codesOf('old crown, recurrent caries underneath, crown needs replacement');
    expect(codes).toContain('existing_crown');
    expect(codes).toContain('recurrent_caries');
    expect(codes).toContain('crown_replacement_required');
    expect(codes).toHaveLength(3);
  });

  it('records an existing restoration plus an observation', () => {
    expect(codesOf('existing filling, monitor')).toEqual(['existing_filling', 'monitor']);
  });

  it('keeps findings in the order they were spoken', () => {
    const codes = codesOf('sensitivity, then caries, then needs a filling');
    expect(codes.indexOf('sensitivity')).toBeLessThan(codes.indexOf('caries'));
    expect(codes.indexOf('caries')).toBeLessThan(codes.indexOf('filling_required'));
  });
});

describe('extractFindings — "needs X" never counts as "has X"', () => {
  it('reads a required crown as treatment, not as an existing one', () => {
    expect(codesOf('needs a crown')).toEqual(['crown_required']);
    expect(codesOf('crown is required')).toEqual(['crown_required']);
  });

  it('reads a crown replacement as its own finding', () => {
    expect(codesOf('crown needs replacement')).toEqual(['crown_replacement_required']);
    expect(codesOf('replace the crown')).toEqual(['crown_replacement_required']);
    expect(codesOf('crown replacement required')).toEqual(['crown_replacement_required']);
  });

  it('separates an existing root canal from one that is required', () => {
    expect(codesOf('needs a root canal')).toEqual(['root_canal_required']);
    expect(codesOf('previous root canal')).toEqual(['existing_root_canal']);
  });

  it('separates an existing filling from one that is required', () => {
    expect(codesOf('needs filling')).toEqual(['filling_required']);
    expect(codesOf('existing filling')).toEqual(['existing_filling']);
  });

  it('distinguishes an extracted tooth from one needing extraction', () => {
    expect(codesOf('already extracted')).toEqual(['extracted']);
    expect(codesOf('needs an extraction')).toEqual(['extraction_required']);
    expect(codesOf('has to be extracted')).toEqual(['extraction_required']);
  });
});

describe('extractFindings — specificity', () => {
  it('prefers recurrent caries over plain caries', () => {
    expect(codesOf('recurrent caries')).toEqual(['recurrent_caries']);
    expect(codesOf('caries underneath the crown')).toContain('recurrent_caries');
  });

  it('prefers deep caries over plain caries', () => {
    expect(codesOf('deep caries')).toEqual(['deep_caries']);
  });

  it('prefers the specific restoration material over a generic filling', () => {
    expect(codesOf('amalgam')).toEqual(['existing_amalgam']);
    expect(codesOf('composite')).toEqual(['existing_composite']);
  });
});

describe('extractFindings — French clinical phrasing', () => {
  it('reads French findings', () => {
    expect(codesOf('carie récidivante')).toEqual(['recurrent_caries']);
    expect(codesOf('couronne à remplacer')).toEqual(['crown_replacement_required']);
    expect(codesOf('à surveiller')).toEqual(['monitor']);
    expect(codesOf('dent manquante')).toEqual(['missing']);
    expect(codesOf('dévitalisée')).toEqual(['existing_root_canal']);
  });
});

describe('extractFindings — French terms that start or end with an accent', () => {
  // JavaScript's \b is ASCII-only, so every one of these used to match nothing.
  it('reads terms ending in an accented letter', () => {
    expect(codesOf('cavité')).toEqual(['cavity']);
    expect(codesOf('mobilité sur la 16')).toEqual(['mobility']);
    expect(codesOf('sensibilité au froid')).toEqual(['sensitivity']);
    expect(codesOf('dent fêlé')).toEqual(['fracture']);
    expect(codesOf('dent dévitalisé')).toEqual(['existing_root_canal']);
  });

  it('reads terms starting with "à"', () => {
    expect(codesOf('dent à soigner')).toEqual(['restoration_required']);
    expect(codesOf('à obturer')).toEqual(['filling_required']);
  });

  it('reads French surfaces and severities', () => {
    expect(detectSurface('carie mésiale')).toBe('mesial');
    expect(detectSurface('carie vestibulaire')).toBe('buccal');
    expect(detectSurface('face palatine')).toBe('lingual');
    expect(detectSeverity('mobilité modéré')).toBe('MODERATE');
  });
});

describe('surface and severity', () => {
  it('detects tooth surfaces', () => {
    expect(detectSurface('occlusal caries')).toBe('occlusal');
    expect(detectSurface('mesial cavity')).toBe('mesial');
    expect(detectSurface('nothing here')).toBeNull();
  });

  it('detects severity', () => {
    expect(detectSeverity('severe mobility')).toBe('SEVERE');
    expect(detectSeverity('mild sensitivity')).toBe('MILD');
    expect(detectSeverity('moderate wear')).toBe('MODERATE');
  });

  it('attaches severity to the nearby finding, not the whole utterance', () => {
    // "deep" belongs to the caries; the wear further along must not inherit it.
    const findings = extractFindings('deep caries, and wear on the other side of a long sentence about wear');
    const caries = findings.find(f => f.code === 'deep_caries');
    expect(caries).toBeDefined();
  });
});

describe('lexicon integrity', () => {
  it('exposes a label and a kind for every code', () => {
    for (const code of allFindingCodes()) {
      expect(findingLabel(code), code).not.toBe(code);
      expect(findingKind(code), code).not.toBeNull();
    }
  });

  it('has no duplicate codes', () => {
    const codes = allFindingCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('reports agreement with the server catalog', () => {
    expect(assertLexiconMatches(allFindingCodes()).ok).toBe(true);
  });

  it('reports drift in both directions', () => {
    const drifted = assertLexiconMatches(allFindingCodes().filter(c => c !== 'caries').concat('invented_code'));
    expect(drifted.ok).toBe(false);
    expect(drifted.message).toContain('caries');
    expect(drifted.message).toContain('invented_code');
  });
});
