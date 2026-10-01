import { describe, expect, it } from 'vitest';
import { acceptsFollowUp } from './voice-followup';
import { VoiceContextSnapshot } from './voice-intent.model';
import { isBareFindingDictation, looksLikeQuestion } from './voice-wake';

/**
 * The follow-up window keeps the microphone listening without the wake word for
 * a few seconds after a command. These are the sentences that arrive in it —
 * the ones that must reach the record, and the ones that are only somebody
 * talking in the room.
 */

const afterDictatingSixteen: VoiceContextSnapshot = {
  patientId: 'p-1',
  patientName: 'Ahmed El Amrani',
  dentition: 'adult',
  module: 'patient-dossier',
  route: '/patients/p-1',
  // What every staged dictation leaves behind: the tooth stays selected.
  selectedFdi: '16',
  sessionId: 's-1',
  locale: 'fr-MA',
  recentIntents: [],
  recentUtterances: [],
  lastWrite: { commandId: 'chart.addToothFindings', targetType: 'BufferedCommand', targetId: 'a-1', fdi: '16', description: '' },
};

describe('acceptsFollowUp — somebody talking is not a command', () => {
  const CHATTER = [
    // The patient answering.
    'oui docteur c\'est douloureux',
    'oui ça fait mal',
    'c\'est sensible au froid',
    'ça saigne un peu',
    // Questions — to the patient, to the room.
    'j\'ai une carie ?',
    'vous avez une infection ?',
    'est-ce que c\'est cassé ?',
    'et vous avez mal ?',
    // The dentist or assistant talking, not dictating.
    'il faudra une couronne',
    'il faut l\'extraire',
    'la carie est profonde',
    'la couronne est ancienne',
    'ouvrez grand',
    'vous avez mal depuis quand',
    'on va faire un détartrage',
    'rincez',
    'oui',
    'ça va',
    // A denial with no tooth named is not attached to whichever is selected.
    'pas de carie',
    'pas de douleur',
    'sans fracture',
  ];

  for (const sentence of CHATTER) {
    it(`ignores "${sentence}"`, () => {
      expect(acceptsFollowUp(sentence, afterDictatingSixteen)).toBe(false);
    });
  }
});

describe('acceptsFollowUp — a run of dictation still flows', () => {
  const DICTATION = [
    'carie profonde',
    'couronne à remplacer',
    'et une fracture',
    'plus, mobilité',
    'carie distale',
    'fracture',
    'à surveiller',
    'mobilité grade 2',
  ];

  for (const sentence of DICTATION) {
    it(`accepts "${sentence}" for the tooth already selected`, () => {
      expect(acceptsFollowUp(sentence, afterDictatingSixteen)).toBe(true);
    });
  }

  it('accepts a finding on a tooth that is named', () => {
    expect(acceptsFollowUp('dent 17 carie', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('la 17 fracture', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('dent 17 pas de carie', afterDictatingSixteen)).toBe(true);
  });

  it('accepts commands that do not depend on which tooth is selected', () => {
    expect(acceptsFollowUp('annule', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('non, en fait couronne à remplacer', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('enlève la carie sur la seize', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('note : patient anxieux', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('allergie à la pénicilline', afterDictatingSixteen)).toBe(true);
    expect(acceptsFollowUp('montre les constatations', afterDictatingSixteen)).toBe(true);
  });

  it('accepts several teeth said at once', () => {
    expect(acceptsFollowUp('dent 17 carie et dent 18 couronne', afterDictatingSixteen)).toBe(true);
  });
});

describe('looksLikeQuestion', () => {
  it('reads a question mark, in any language', () => {
    expect(looksLikeQuestion('vous avez mal ?')).toBe(true);
    expect(looksLikeQuestion('does it hurt?')).toBe(true);
  });

  it('reads a question said without the mark', () => {
    expect(looksLikeQuestion('est-ce que ça fait mal')).toBe(true);
    expect(looksLikeQuestion('vous avez une carie')).toBe(true);
    expect(looksLikeQuestion('où est la douleur')).toBe(true);
    expect(looksLikeQuestion('do you feel that')).toBe(true);
  });

  it('leaves a finding alone', () => {
    expect(looksLikeQuestion('carie profonde')).toBe(false);
    expect(looksLikeQuestion('dent 16, carie récurrente')).toBe(false);
    // "qui" is also the start of "quinze".
    expect(looksLikeQuestion('quinze carie')).toBe(false);
  });
});

describe('isBareFindingDictation', () => {
  it('accepts a short finding that opens the sentence', () => {
    expect(isBareFindingDictation('carie profonde')).toBe(true);
    expect(isBareFindingDictation('et une fracture')).toBe(true);
    expect(isBareFindingDictation('plus, mobilité')).toBe(true);
  });

  it('refuses a sentence that only contains a finding', () => {
    expect(isBareFindingDictation('oui docteur c\'est douloureux')).toBe(false);
    expect(isBareFindingDictation('il faudra une couronne')).toBe(false);
  });

  it('refuses a long sentence, a question and a denial', () => {
    expect(isBareFindingDictation('carie profonde qui fait mal depuis trois jours quand je mange chaud')).toBe(false);
    expect(isBareFindingDictation('carie profonde ?')).toBe(false);
    expect(isBareFindingDictation('pas de carie')).toBe(false);
  });
});

describe('a sentence that names a tooth', () => {
  it('is dictation when it opens with the tooth, as a dentist dictates', () => {
    // Said by the dentist about the tooth in front of them; staged, read back,
    // and reviewed. Dropping it would lose a finding with no sound to say so.
    for (const said of ['la 17 est cassée', 'la 17 est cassée depuis hier', 'dent 17 fracture depuis hier']) {
      expect(acceptsFollowUp(said, afterDictatingSixteen), said).toBe(true);
    }
  });

  it('is talk when it is the patient\'s, a question, or an answer', () => {
    for (const said of [
      'oui la 17 me fait mal depuis hier',
      'j\'ai mal à la 17 depuis hier',
      'vous avez mal à la 17 depuis hier ?',
      'elle est cassée depuis hier',
    ]) {
      expect(acceptsFollowUp(said, afterDictatingSixteen), said).toBe(false);
    }
  });
});
