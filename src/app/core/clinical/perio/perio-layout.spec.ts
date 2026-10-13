import { describe, expect, it } from 'vitest';
import {
  archWidth, dotXs, furcationSitesOf, isMirrored, marginOf, marginY, pocketY, probingSitesOf, rulerLines, slotsOf,
  toothImageUrl, toothLabel, toothWidth, LOWER_TEETH, UPPER_TEETH,
} from './perio-layout';

describe('perio layout', () => {
  it('sizes teeth by what they are', () => {
    expect(['11', '12', '21', '42'].map(toothWidth)).toEqual([38, 38, 38, 38]);
    expect(['13', '33'].map(toothWidth)).toEqual([48, 48]);
    expect(['14', '15', '44', '35'].map(toothWidth)).toEqual([45, 45, 45, 45]);
    expect(['16', '17', '18', '36', '48'].map(toothWidth)).toEqual([68, 68, 68, 68, 68]);
  });

  it('makes both arches 848 pixels wide, with a 12 pixel gap in the middle', () => {
    expect(archWidth('upper')).toBe(848);
    expect(archWidth('lower')).toBe(848);
    const upper = slotsOf('upper');
    expect(upper).toHaveLength(16);
    expect(upper[7].code).toBe('11');
    expect(upper[8].code).toBe('21');
    expect(upper[8].x - (upper[7].x + upper[7].width)).toBe(12);
    expect(upper[0].x).toBe(0);
  });

  it('places the three sites 12 pixels either side of the middle', () => {
    const molar = slotsOf('upper')[0];
    expect(molar.center).toBe(34);
    expect(molar.siteX).toEqual([22, 34, 46]);
  });

  it('puts the distal site first on the patient’s right and the mesial site first on the left', () => {
    expect(probingSitesOf('16', 'buccal')).toEqual(['distobuccal', 'buccal', 'mesiobuccal']);
    expect(probingSitesOf('26', 'buccal')).toEqual(['mesiobuccal', 'buccal', 'distobuccal']);
    expect(probingSitesOf('46', 'lingual')).toEqual(['distolingual', 'lingual', 'mesiolingual']);
    expect(probingSitesOf('36', 'lingual')).toEqual(['mesiolingual', 'lingual', 'distolingual']);
  });

  it('draws quadrants 2 and 3 mirrored, from the drawings of quadrants 1 and 4', () => {
    expect(['11', '18', '41', '48'].map(isMirrored)).toEqual([false, false, false, false]);
    expect(['21', '28', '31', '38'].map(isMirrored)).toEqual([true, true, true, true]);
    expect(toothImageUrl('21', 'upper', 'buccal')).toBe('/perio/teeth/Q1/11-b.svg');
    expect(toothImageUrl('28', 'upper', 'lingual')).toBe('/perio/teeth/Q1/18-p.svg');
    expect(toothImageUrl('31', 'lower', 'buccal')).toBe('/perio/teeth/Q3/41-b.svg');
    expect(toothImageUrl('46', 'lower', 'lingual')).toBe('/perio/teeth/Q3/46-l.svg');
  });

  it('puts the gum margin where each view of a tooth has it', () => {
    expect(marginOf('upper', 'buccal')).toEqual({ baseY: 65, direction: 1 });
    expect(marginOf('upper', 'lingual')).toEqual({ baseY: 35, direction: -1 });
    expect(marginOf('lower', 'lingual')).toEqual({ baseY: 65, direction: 1 });
    expect(marginOf('lower', 'buccal')).toEqual({ baseY: 35, direction: -1 });
  });

  it('moves the margin and the pocket four pixels per millimetre toward the root', () => {
    const { baseY, direction } = marginOf('upper', 'buccal');
    expect(marginY(baseY, direction, null)).toBeNull();
    expect(marginY(baseY, direction, 2)).toBe(57);
    expect(pocketY(baseY, direction, null, 3)).toBe(53);
    expect(pocketY(baseY, direction, 57, 3)).toBe(45);
    expect(pocketY(baseY, direction, 57, null)).toBeNull();

    const lower = marginOf('upper', 'lingual');
    expect(pocketY(lower.baseY, lower.direction, null, 3)).toBe(47);
  });

  it('rules a millimetre every four pixels', () => {
    expect(rulerLines(65, 1, 16)).toEqual([65, 61, 57, 53, 49, 45, 41, 37, 33, 29, 25, 21, 17, 13, 9, 5]);
    expect(rulerLines(35, -1, 3)).toEqual([35, 39, 43]);
    expect(rulerLines(5, 1, 4)).toEqual([5, 1]);
  });

  it('spreads the dots wider on molars than on the cells', () => {
    expect(dotXs(68)).toEqual([17, 34, 51]);
    expect(dotXs(38)).toEqual([7, 19, 31]);
    expect(dotXs(45)).toEqual([10.5, 22.5, 34.5]);
  });

  it('knows where furcations can be probed', () => {
    expect(furcationSitesOf('16')).toEqual(['buccal', 'palatal_mesial', 'palatal_distal']);
    expect(furcationSitesOf('25')).toEqual(['buccal']);
    expect(furcationSitesOf('46')).toEqual(['buccal', 'lingual']);
    expect(furcationSitesOf('44')).toEqual([]);
    expect(furcationSitesOf('11')).toEqual([]);
  });
});

describe('tooth numbering', () => {
  it('shows the FDI code as it is', () => {
    expect(toothLabel('16', 'FDI')).toBe('16');
  });

  it('numbers 1 to 32 from the upper right third molar, round to the lower right one', () => {
    expect(['18', '11', '21', '28', '38', '31', '41', '48'].map((t) => toothLabel(t, 'universal')))
      .toEqual(['1', '8', '9', '16', '17', '24', '25', '32']);
    expect(toothLabel('16', 'universal')).toBe('3');
    expect(toothLabel('46', 'universal')).toBe('30');
  });

  it('gives every tooth its own number', () => {
    const numbers = [...UPPER_TEETH, ...LOWER_TEETH].map((t) => toothLabel(t, 'universal'));
    expect(new Set(numbers).size).toBe(32);
    expect(numbers.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });
});
