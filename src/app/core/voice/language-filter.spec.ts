import { describe, expect, it } from 'vitest';
import { classifyLanguage, isLanguageNeutralAnswer } from './language-filter';

describe('dictation language filter', () => {
  describe('French chosen', () => {
    it('keeps French dictation, however it is phrased', () => {
      for (const text of [
        'dent 16 carie', 'sur la 16 je vois des caries', 'la 13 et 14 amalgame', 'Calypso, la 36 est cariée',
        'je vois une carie sur la seize', 'dent 17 infection et amalgame',
      ]) {
        expect(classifyLanguage(text, 'fr'), text).not.toBe('noise');
      }
    });

    it('drops English as noise', () => {
      for (const text of [
        'tooth 16 has deep caries', 'the patient has pain and the tooth is not mobile',
        'I see caries on tooth 16', 'tooth 16 caries', 'there is a cavity on the upper left molar',
      ]) {
        expect(classifyLanguage(text, 'fr'), text).toBe('noise');
      }
    });

    it('drops Arabic script and Darija in Latin letters as noise', () => {
      for (const text of [
        'السن السادسة فيها تسوس', 'Calypso السن 16 فيها تسوس', 'wakha khoya daba nji', 'la 16 fiha tsous',
        '3andi wja3 f dars', 'safi bzaf', 'ghadi nbghi nrja3 daba',
      ]) {
        expect(classifyLanguage(text, 'fr'), text).toBe('noise');
      }
    });

    it('keeps French that borrows a word or two (code-switching)', () => {
      expect(classifyLanguage('dent seize carie mésiale wakha', 'fr')).not.toBe('noise');
      expect(classifyLanguage('la carie est mésiale, mchat', 'fr')).not.toBe('noise');
      expect(classifyLanguage('la 16 carie ok safi', 'fr')).not.toBe('noise');
    });

    it('keeps a sentence that mixes the two languages about equally', () => {
      expect(classifyLanguage('tooth 17 infectione et amalgam', 'fr')).not.toBe('noise');
      expect(classifyLanguage('la 16 caries and amalgam', 'fr')).not.toBe('noise');
    });
  });

  describe('English chosen', () => {
    it('keeps English dictation', () => {
      for (const text of [
        'tooth 16 has deep caries', 'I see caries on tooth 16', 'tooth 13 and 14 amalgam', 'Calypso, the 16 is fractured',
        'tooth 17 infection and amalgam',
      ]) {
        expect(classifyLanguage(text, 'en'), text).not.toBe('noise');
      }
    });

    it('drops French as noise — even a short command', () => {
      for (const text of [
        'le patient a mal et la dent est dans un état très mauvais', 'dent 16 carie', 'la 13 et 14 amalgame',
        'sur la 16 je vois des caries', 'Calypso, couronne à remplacer',
      ]) {
        expect(classifyLanguage(text, 'en'), text).toBe('noise');
      }
    });

    it('drops Arabic script and Darija as noise', () => {
      expect(classifyLanguage('السن السادسة فيها تسوس', 'en')).toBe('noise');
      expect(classifyLanguage('wakha khoya daba', 'en')).toBe('noise');
      expect(classifyLanguage('3andi wja3 f dars', 'en')).toBe('noise');
    });

    it('keeps a sentence that mixes the two languages about equally', () => {
      expect(classifyLanguage('tooth 17 infectione et amalgam', 'en')).not.toBe('noise');
    });
  });

  describe('Arabic chosen', () => {
    it('drops a Latin-script sentence', () => {
      expect(classifyLanguage('the patient is waiting outside the room', 'ar')).toBe('noise');
      expect(classifyLanguage('le patient attend dehors', 'ar')).toBe('noise');
      expect(classifyLanguage('tooth 16 caries', 'ar')).toBe('noise');
    });

    it('keeps Arabic dictation that carries tooth codes and the wake word', () => {
      expect(classifyLanguage('Calypso السن 16 فيها تسوس', 'ar')).toBe('match');
      expect(classifyLanguage('16 caries', 'ar')).toBe('unsure');
    });
  });

  it('does not decide on what belongs to no language', () => {
    expect(classifyLanguage('16', 'fr')).toBe('unsure');
    expect(classifyLanguage('Calypso', 'fr')).toBe('unsure');
    expect(classifyLanguage('Calypso', 'en')).toBe('unsure');
    expect(classifyLanguage('16 amalgam', 'fr')).toBe('unsure');
    expect(classifyLanguage('implant 36', 'en')).toBe('unsure');
  });

  it('does not mistake an ordinal, a unit or a tooth code for Darija', () => {
    expect(classifyLanguage('2nd molar 16 caries', 'en')).toBe('match');
    expect(classifyLanguage('3rd molar caries', 'en')).toBe('match');
    expect(classifyLanguage('5mg of amoxicilline for the tooth', 'en')).not.toBe('noise');
  });

  it('knows a yes, a no and an ok in every language', () => {
    for (const answer of ['oui', 'non', 'Yes', 'no', 'ok', 'okay', 'd’accord', 'confirme', 'annule', 'Oui.']) {
      expect(isLanguageNeutralAnswer(answer), answer).toBe(true);
    }
    expect(isLanguageNeutralAnswer('oui docteur la 16')).toBe(false);
    expect(isLanguageNeutralAnswer('dent 16 carie')).toBe(false);
  });
});
