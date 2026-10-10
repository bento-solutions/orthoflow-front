import { describe, expect, it } from 'vitest';
import { classifyLanguage } from './language-filter';

describe('dictation language filter', () => {
  it('drops Arabic heard while dictating French or English', () => {
    expect(classifyLanguage('السن السادسة فيها تسوس', 'fr')).toBe('noise');
    expect(classifyLanguage('السن السادسة فيها تسوس', 'en')).toBe('noise');
  });

  it('drops a Latin-script sentence heard while dictating Arabic', () => {
    expect(classifyLanguage('the patient is waiting outside the room', 'ar')).toBe('noise');
    expect(classifyLanguage('le patient attend dehors', 'ar')).toBe('noise');
  });

  it('keeps Arabic dictation that carries tooth codes and the wake word', () => {
    expect(classifyLanguage('Calypso السن 16 فيها تسوس', 'ar')).toBe('match');
    expect(classifyLanguage('16 caries', 'ar')).toBe('unsure');
  });

  it('keeps French that borrows Arabic words (code-switching)', () => {
    expect(classifyLanguage('dent seize carie mésiale wakha', 'fr')).not.toBe('noise');
    expect(classifyLanguage('la carie est mésiale, mchat', 'fr')).not.toBe('noise');
  });

  it('keeps language-neutral commands', () => {
    expect(classifyLanguage('16', 'fr')).toBe('unsure');
    expect(classifyLanguage('Calypso', 'fr')).not.toBe('noise');
    expect(classifyLanguage('dent 16 carie', 'fr')).not.toBe('noise');
    expect(classifyLanguage('tooth 16 caries', 'fr')).not.toBe('noise');
  });

  it('tells French from English only when it is clear', () => {
    expect(classifyLanguage('the patient has pain and the tooth is not mobile', 'fr')).toBe('noise');
    expect(classifyLanguage('le patient a mal et la dent est dans un état très mauvais', 'en')).toBe('noise');
    expect(classifyLanguage('le patient a mal et la dent est mobile', 'fr')).toBe('match');
    expect(classifyLanguage('the patient has pain and the tooth is mobile', 'en')).toBe('match');
  });

  it('does not decide on a short utterance', () => {
    expect(classifyLanguage('yes please', 'fr')).toBe('unsure');
    expect(classifyLanguage('oui merci', 'en')).toBe('unsure');
  });
});
