import { describe, expect, it } from 'vitest';
import { FINDING_OPTIONS, findingLabelKey, findingFallbackLabel } from './finding-options';
import { allFindingCodes, findingKind } from '../voice/clinical-lexicon';

describe('finding options', () => {
  it('offers only codes the voice lexicon and the server know, with the kind the server derives', () => {
    const known = new Set(allFindingCodes());
    for (const option of FINDING_OPTIONS) {
      expect(known.has(option.code), option.code).toBe(true);
      expect(findingKind(option.code), option.code).toBe(option.kind);
    }
  });

  it('lists no code twice', () => {
    const codes = FINDING_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('only asks for a surface where the finding is about a part of the tooth', () => {
    const bySurface = (code: string) => FINDING_OPTIONS.find((o) => o.code === code)!.surfaces;
    expect(bySurface('caries')).toBe(true);
    expect(bySurface('existing_amalgam')).toBe(true);
    expect(bySurface('existing_crown')).toBe(false);
    expect(bySurface('extraction_required')).toBe(false);
  });

  it('names its translation key and has a readable fallback', () => {
    expect(findingLabelKey('existing_amalgam')).toBe('FINDING.EXISTING_AMALGAM');
    expect(findingFallbackLabel('recurrent_caries')).toBe('Recurrent caries');
  });
});
