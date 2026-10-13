import { describe, expect, it } from 'vitest';
import { PROBING_SEQUENCE, cellAfterModeChange, isSiteValid, sequenceFor, step } from './perio-navigation';

const at = (tooth: string, site: string) => ({ tooth, site }) as never;

describe('perio navigation', () => {
  it('visits all 192 sites, upper cheek side, upper palatal, lower cheek side, lower tongue side', () => {
    expect(PROBING_SEQUENCE).toHaveLength(192);
    expect(PROBING_SEQUENCE[0]).toEqual(at('18', 'distobuccal'));
    expect(PROBING_SEQUENCE[1]).toEqual(at('18', 'buccal'));
    expect(PROBING_SEQUENCE[23]).toEqual(at('11', 'mesiobuccal'));
    expect(PROBING_SEQUENCE[24]).toEqual(at('21', 'mesiobuccal'));
    expect(PROBING_SEQUENCE[47]).toEqual(at('28', 'distobuccal'));
    expect(PROBING_SEQUENCE[48]).toEqual(at('18', 'distolingual'));
    expect(PROBING_SEQUENCE[96]).toEqual(at('48', 'distobuccal'));
    expect(PROBING_SEQUENCE[144]).toEqual(at('48', 'distolingual'));
    expect(PROBING_SEQUENCE[191]).toEqual(at('38', 'distolingual'));
  });

  it('starts on the first tooth that is present', () => {
    expect(step(null, 'pocketDepth', 'next', {})).toEqual(at('18', 'distobuccal'));
    expect(step(null, 'pocketDepth', 'next', { '18': 'missing', '17': 'pontic' })).toEqual(at('16', 'distobuccal'));
  });

  it('moves one site on and one site back', () => {
    expect(step(at('18', 'distobuccal'), 'pocketDepth', 'next', {})).toEqual(at('18', 'buccal'));
    expect(step(at('18', 'buccal'), 'pocketDepth', 'prev', {})).toEqual(at('18', 'distobuccal'));
    expect(step(at('18', 'mesiobuccal'), 'pocketDepth', 'next', {})).toEqual(at('17', 'distobuccal'));
  });

  it('steps over teeth that are missing or bridge pontics, but not implants', () => {
    const status = { '17': 'missing', '16': 'pontic' } as const;
    expect(step(at('18', 'mesiobuccal'), 'pocketDepth', 'next', status)).toEqual(at('15', 'distobuccal'));
    expect(step(at('15', 'distobuccal'), 'pocketDepth', 'prev', status)).toEqual(at('18', 'mesiobuccal'));
    expect(step(at('18', 'mesiobuccal'), 'pocketDepth', 'next', { '17': 'implant' })).toEqual(at('17', 'distobuccal'));
  });

  it('wraps around the mouth', () => {
    expect(step(at('38', 'distolingual'), 'pocketDepth', 'next', {})).toEqual(at('18', 'distobuccal'));
    expect(step(at('18', 'distobuccal'), 'pocketDepth', 'prev', {})).toEqual(at('38', 'distolingual'));
  });

  it('goes tooth to tooth for mobility, one value per tooth', () => {
    expect(sequenceFor('mobility')).toHaveLength(32);
    expect(step(at('18', 'buccal'), 'mobility', 'next', {})).toEqual(at('17', 'buccal'));
    expect(step(at('11', 'buccal'), 'mobility', 'next', {})).toEqual(at('21', 'buccal'));
    expect(step(at('17', 'buccal'), 'mobility', 'next', { '16': 'missing' })).toEqual(at('15', 'buccal'));
  });

  it('visits only the furcation sites that exist', () => {
    const sequence = sequenceFor('furcation');
    expect(sequence[0]).toEqual(at('18', 'buccal'));
    expect(sequence[1]).toEqual(at('18', 'palatal_mesial'));
    expect(sequence[2]).toEqual(at('18', 'palatal_distal'));
    expect(sequence.every((c) => ['14', '15', '16', '17', '18', '24', '25', '26', '27', '28', '36', '37', '38', '46', '47', '48'].includes(c.tooth))).toBe(true);
    expect(sequence).toHaveLength(6 * 3 + 4 * 1 + 6 * 2);
    expect(step(at('15', 'buccal'), 'furcation', 'next', {})).toEqual(at('14', 'buccal'));
  });

  it('knows which sites belong to which mode', () => {
    expect(isSiteValid('buccal', 'mobility', '16')).toBe(true);
    expect(isSiteValid('mesiobuccal', 'mobility', '16')).toBe(false);
    expect(isSiteValid('lingual', 'pocketDepth', '16')).toBe(true);
    expect(isSiteValid('palatal_mesial', 'pocketDepth', '16')).toBe(false);
    expect(isSiteValid('palatal_mesial', 'furcation', '16')).toBe(true);
    expect(isSiteValid('lingual', 'furcation', '16')).toBe(false);
    expect(isSiteValid('buccal', 'furcation', '11')).toBe(false);
  });

  describe('changing the measurement', () => {
    it('stays on the same site when the new measurement has it', () => {
      expect(cellAfterModeChange(at('16', 'lingual'), 'recession', {})).toEqual(at('16', 'lingual'));
      expect(cellAfterModeChange(at('16', 'buccal'), 'furcation', {})).toEqual(at('16', 'buccal'));
    });

    it('stays on the same tooth, at its first site, when the site does not exist for the new measurement', () => {
      expect(cellAfterModeChange(at('16', 'distobuccal'), 'mobility', {})).toEqual(at('16', 'buccal'));
      expect(cellAfterModeChange(at('16', 'mesiolingual'), 'furcation', {})).toEqual(at('16', 'buccal'));
      expect(cellAfterModeChange(at('16', 'palatal_distal'), 'pocketDepth', {})).toEqual(at('16', 'mesiobuccal'));
    });

    it('starts over at the first furcation when the tooth has none', () => {
      expect(cellAfterModeChange(at('13', 'buccal'), 'furcation', {})).toEqual(at('18', 'buccal'));
    });

    it('leaves a missing tooth for the next one', () => {
      expect(cellAfterModeChange(at('16', 'buccal'), 'mobility', { '16': 'missing' })).toEqual(at('15', 'buccal'));
    });

    it('starts at the beginning when there was no cell', () => {
      expect(cellAfterModeChange(null, 'furcation', {})).toEqual(at('18', 'buccal'));
    });
  });
});
