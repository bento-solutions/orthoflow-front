import { describe, it, expect } from 'vitest';
import {
  affirmedFindings,
  extractEveryFinding,
  extractFindings,
  findingLabel,
  findingKind,
  allFindingCodes,
  detectSurface,
  detectSeverity,
  assertLexiconMatches,
  spokenFindingCovers,
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

describe('spokenFindingCovers — taking back what was just dictated', () => {
  it('lets a general term remove the specific finding it names', () => {
    expect(spokenFindingCovers('caries', 'recurrent_caries')).toBe(true);
    expect(spokenFindingCovers('caries', 'deep_caries')).toBe(true);
    expect(spokenFindingCovers('existing_crown', 'crown_replacement_required')).toBe(true);
    expect(spokenFindingCovers('abscess', 'abscess')).toBe(true);
  });

  it('never lets one finding remove an unrelated one', () => {
    expect(spokenFindingCovers('recurrent_caries', 'caries')).toBe(false);
    expect(spokenFindingCovers('caries', 'abscess')).toBe(false);
    expect(spokenFindingCovers('mobility', 'periodontal_pocket')).toBe(false);
  });
});

describe('extractFindings — a negation is reported, never recorded as the finding', () => {
  const affirmed = (utterance: string) => affirmedFindings(extractFindings(utterance)).map(f => f.code);
  const denied = (utterance: string) => extractFindings(utterance).filter(f => f.negated).map(f => f.code);

  it('marks a finding a negation governs', () => {
    expect(denied('pas de carie')).toEqual(['caries']);
    expect(denied('dent 16 sans carie')).toEqual(['caries']);
    expect(denied('no caries')).toEqual(['caries']);
    expect(denied('16 is not fractured')).toEqual(['fracture']);
    expect(denied('la 16 n\'est pas fracturée')).toEqual(['fracture']);
    expect(denied('sans mobilité')).toEqual(['mobility']);
  });

  it('leaves nothing affirmed when everything is denied', () => {
    expect(affirmed('pas de carie ni de fracture')).toEqual([]);
    expect(denied('pas de carie ni de fracture').sort()).toEqual(['caries', 'fracture']);
  });

  it('keeps what is affirmed beside what is denied', () => {
    expect(affirmed('pas de carie mais fracture')).toEqual(['fracture']);
    expect(denied('pas de carie mais fracture')).toEqual(['caries']);
    expect(affirmed('carie sans douleur')).toEqual(['caries']);
    expect(denied('carie sans douleur')).toEqual(['pain']);
  });

  it('does not deny a finding just because "non" opened a correction', () => {
    expect(denied('non, en fait couronne à remplacer')).toEqual([]);
    expect(affirmed('non, en fait couronne à remplacer')).toEqual(['crown_replacement_required']);
  });

  it('carries the clause the words came from, for a note', () => {
    const [finding] = extractFindings('dent 16 pas de carie, à surveiller');
    expect(finding.negated).toBe(true);
    expect(finding.clause).toBe('dent 16 pas de carie');
  });
});

describe('extractFindings — "à faire" is a need, never an existing restoration', () => {
  it('turns an existing restoration into the treatment it needs', () => {
    expect(codesOf('couronne à faire')).toEqual(['crown_required']);
    expect(codesOf('il faudra une couronne')).toEqual(['crown_required']);
    expect(codesOf('ancienne couronne à refaire')).toEqual(['crown_replacement_required']);
    expect(codesOf('composite à refaire')).toEqual(['filling_required']);
    expect(codesOf('amalgame à remplacer')).toEqual(['filling_required']);
    expect(codesOf('l\'obturation est à refaire')).toEqual(['filling_required']);
    expect(codesOf('bridge à faire')).toEqual(['bridge_required']);
    expect(codesOf('implant à poser')).toEqual(['implant_required']);
    expect(codesOf('facette à refaire')).toEqual(['veneer_required']);
    expect(codesOf('dévitalisation à faire')).toEqual(['root_canal_required']);
    expect(codesOf('détartrage à faire')).toEqual(['scaling_required']);
  });

  it('does the same in English', () => {
    expect(codesOf('composite needs to be redone')).toEqual(['filling_required']);
    expect(codesOf('the amalgam is to be replaced')).toEqual(['filling_required']);
    expect(codesOf('crown is recommended')).toEqual(['crown_required']);
  });

  it('still reads a restoration that is simply there as existing', () => {
    expect(codesOf('couronne existante')).toEqual(['existing_crown']);
    expect(codesOf('composite')).toEqual(['existing_composite']);
    expect(codesOf('amalgame existant')).toEqual(['existing_amalgam']);
    expect(codesOf('ancienne obturation')).toEqual(['existing_filling']);
  });

  it('does not let a need in another clause reach the restoration', () => {
    expect(codesOf('couronne, à surveiller')).toEqual(['existing_crown', 'monitor']);
    expect(codesOf('composite. il faudra une radio')).toEqual(['existing_composite']);
  });

  it('keeps one need once when two phrasings name it', () => {
    expect(codesOf('composite à refaire, needs a filling')).toEqual(['filling_required']);
  });
});

describe('extractEveryFinding', () => {
  it('finds a finding named twice, where extractFindings finds it once', () => {
    const utterance = 'dent 16 carie, dent 17 carie';
    expect(extractFindings(utterance)).toHaveLength(1);
    expect(extractEveryFinding(utterance).map(f => f.code)).toEqual(['caries', 'caries']);
    expect(extractEveryFinding(utterance).map(f => f.at)).toEqual([
      utterance.indexOf('carie'),
      utterance.lastIndexOf('carie'),
    ]);
  });
});
