import { describe, expect, it } from 'vitest';
import { isBeginExaminationPhrase } from './consultation-phrases';
import { isStopPhrase } from '../voice/voice-wake';

/**
 * During the conversation the microphone hears everything, and "consultation"
 * is a word a doctor and a patient say all day. Starting the examination — and
 * with it the chart commands — on the wrong utterance is the failure to avoid.
 */
describe('isBeginExaminationPhrase', () => {
  it.each([
    'Calypso, consultation',
    'Calypso consultation.',
    'Calypso, début de la consultation',
    'calypso commence la consultation',
    'Calypso, examen',
    'On commence la consultation',
    'Commençons la consultation.',
    'Début de consultation',
    'Début de l\'examen',
    'Passons à l\'examen',
    'On passe à la consultation',
    'La consultation commence',
    'Démarrons l\'examen',
    'Let\'s start the consultation',
    'Begin the examination',
    'Calypso, consultation please'.replace(' please', ''),
    'نبدا الفحص',
  ])('accepts %s', phrase => {
    expect(isBeginExaminationPhrase(phrase)).toBe(true);
  });

  it.each([
    // the word said in conversation
    'Après la consultation je vous donne une ordonnance',
    'Votre dernière consultation date de mars',
    'La consultation coûte trois cents dirhams',
    'Je voulais une consultation pour mon fils',
    // the bare word without the wake word
    'Consultation',
    'Examen',
    // a command, not an order to begin
    'Calypso, dent 16 carie',
    'Calypso, fin de la consultation',
    // small talk containing the phrase
    'Est-ce qu\'on commence la consultation maintenant ou vous voulez attendre votre mari ?',
    '',
    '   ',
  ])('ignores %s', phrase => {
    expect(isBeginExaminationPhrase(phrase)).toBe(false);
  });

  it('is not the end phrase, which the voice pipeline already owns', () => {
    expect(isStopPhrase('Fin de la consultation')).toBe(true);
    expect(isBeginExaminationPhrase('Fin de la consultation')).toBe(false);
    expect(isStopPhrase('On commence la consultation')).toBe(false);
  });
});
