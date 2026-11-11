import { describe, expect, it } from 'vitest';
import { repairSttConfusions } from './stt-confusions';

/**
 * Each pair here comes from a sentence the recogniser returned in the session
 * of 10 Nov 2026 (docs/voice-audit-2026-11-10) or its probes. The repairs only
 * ever touch a word next to a tooth number, and never the number.
 */
describe('repairSttConfusions — what the recogniser makes of "dent" and "carie"', () => {
  const repaired = (text: string) => repairSttConfusions(text).text;

  it('reads "dans 16" before a finding as "dent 16"', () => {
    expect(repaired('Donc vous avez dans 16 caries occlusales.')).toBe('Donc vous avez dent 16 caries occlusales.');
  });

  it('reads "dont 11" before a finding as "dent 11"', () => {
    expect(repaired("C'est le schéma dentaire dont 11 caries occlusales.")).toBe("C'est le schéma dentaire dent 11 caries occlusales.");
    expect(repaired('dont 12 absentes.')).toBe('dent 12 absentes.');
  });

  it('reads the other renderings of "dent"', () => {
    expect(repaired("d'en 16 carie")).toBe('dent 16 carie');
    expect(repaired('den 16 carie')).toBe('dent 16 carie');
    expect(repaired('temps 16 carie')).toBe('dent 16 carie');
    expect(repaired('tant 16 carie')).toBe('dent 16 carie');
    expect(repaired('dans seize carie')).toBe('dent seize carie');
  });

  it('reads "carré" beside a tooth as "carie", keeping the plural', () => {
    expect(repaired('38 carré occlusal.')).toBe('38 carie occlusal.');
    expect(repaired('Dans 11 carrés.')).toBe('Dent 11 caries.');
    expect(repaired('dent 16 carrée')).toBe('dent 16 carie');
    expect(repaired('dent 16 karies')).toBe('dent 16 caries');
    expect(repaired('dent 16 cari')).toBe('dent 16 carie');
  });

  it('says which rule did what, so a finding respelled can be read back', () => {
    expect(repairSttConfusions('Dans 11 carrés.').repairs).toEqual([
      { from: 'carrés', to: 'caries', rule: 'finding' },
      { from: 'Dans', to: 'Dent', rule: 'tooth-word' },
    ]);
  });

  it('leaves a quantity, a time and a sugar lump alone', () => {
    for (const said of ['dans 15 jours', 'dans 15 jours on enlève les fils', 'dans 16 minutes', 'dans 16 minutes on rince',
      'un carré de sucre', 'le carré de la 16 heures', 'rendez-vous dans 12 semaines']) {
      expect(repaired(said), said).toBe(said);
    }
  });

  it('needs a finding after the number before "dans" becomes a tooth', () => {
    expect(repaired('on se voit dans 16 ans')).toBe('on se voit dans 16 ans');
    expect(repaired('il habite dans 16 rue des roses')).toBe('il habite dans 16 rue des roses');
  });

  it('only counts a tooth that exists in the dentition', () => {
    expect(repaired('dans 19 caries')).toBe('dans 19 caries');
    expect(repairSttConfusions('dans 55 caries', 'child').text).toBe('dent 55 caries');
    expect(repairSttConfusions('dans 16 caries', 'child').text).toBe('dans 16 caries');
  });

  it('never changes the number', () => {
    for (const said of ['dans 16 caries', '38 carré occlusal', 'dont 24 absentes']) {
      const numbers = (text: string) => text.match(/\d+/g);
      expect(numbers(repaired(said))).toEqual(numbers(said));
    }
  });
});
