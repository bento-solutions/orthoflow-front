import { describe, it, expect } from 'vitest';
import { resolveWithGrammar } from './voice-grammar';
import { VoiceContextSnapshot, FindingEntity } from './voice-intent.model';

const baseContext = (overrides: Partial<VoiceContextSnapshot> = {}): VoiceContextSnapshot => ({
  patientId: 'p-1',
  patientName: 'Ahmed El Amrani',
  dentition: 'adult',
  module: 'patient-dossier',
  route: '/patients/p-1',
  selectedFdi: null,
  sessionId: 's-1',
  locale: 'en-US',
  recentIntents: [],
  recentUtterances: [],
  lastWrite: null,
  ...overrides,
});

const resolve = (utterance: string, overrides: Partial<VoiceContextSnapshot> = {}) =>
  resolveWithGrammar(utterance, baseContext(overrides));

const expectIntent = (utterance: string, id: string, overrides: Partial<VoiceContextSnapshot> = {}) => {
  const result = resolve(utterance, overrides);
  expect(result.kind, `"${utterance}" → ${JSON.stringify(result)}`).toBe('intent');
  if (result.kind !== 'intent') throw new Error('unreachable');
  expect(result.intent.intent, `"${utterance}"`).toBe(id);
  return result.intent;
};

const findingCodes = (entities: Record<string, unknown>): string[] =>
  ((entities['findings'] ?? []) as FindingEntity[]).map(f => f.code);

describe('the scripted examination from the requirements', () => {
  it('opens and closes a dictated session', () => {
    expectIntent('Start examination.', 'voice.session.start');
    expectIntent('End examination.', 'voice.session.end');
    expectIntent('Show me today\'s findings.', 'voice.session.summary');
  });

  it('records a tooth with an existing restoration and a recommendation', () => {
    const found = expectIntent(
      'Upper right central incisor: existing crown, replacement recommended.',
      'chart.addToothFindings',
    );
    expect(found.entities['fdi']).toBe('11');
    expect(findingCodes(found.entities)).toEqual(
      expect.arrayContaining(['existing_crown', 'crown_replacement_required']),
    );
  });

  it('records the three-finding case that motivates the findings model', () => {
    const found = expectIntent(
      'Upper right first molar: old crown, recurrent caries underneath, crown needs replacement.',
      'chart.addToothFindings',
    );
    expect(found.entities['fdi']).toBe('16');
    expect(findingCodes(found.entities).sort()).toEqual(
      ['crown_replacement_required', 'existing_crown', 'recurrent_caries'],
    );
  });

  it('walks the rest of the scripted dentition', () => {
    const cases: Array<[string, string, string[]]> = [
      ['Upper front left central incisor one: crown needs replacement.', '21', ['crown_replacement_required']],
      ['Upper front right central incisor one: cavity.', '11', ['cavity']],
      ['Upper right first molar: needs filling.', '16', ['filling_required']],
      ['Lower left second molar: existing filling, monitor.', '37', ['existing_filling', 'monitor']],
      ['Upper right lateral incisor: normal.', '12', ['normal']],
      ['Upper right canine: sensitivity.', '13', ['sensitivity']],
      ['Upper right first premolar: filling.', '14', ['existing_filling']],
      ['Lower left second molar: missing.', '37', ['missing']],
      // A fractured crown on an incisor is the tooth fracturing. It must not
      // also assert that a crown restoration is present — see the ordering
      // note on `fracture` in clinical-lexicon.ts.
      ['Upper left central incisor: fractured crown.', '21', ['fracture']],
      ['Lower right second molar: deep cavity.', '47', ['deep_caries']],
    ];
    for (const [utterance, fdi, codes] of cases) {
      const found = expectIntent(utterance, 'chart.addToothFindings');
      expect(found.entities['fdi'], utterance).toBe(fdi);
      expect(findingCodes(found.entities), utterance).toEqual(expect.arrayContaining(codes));
    }
  });
});

describe('structured medical records', () => {
  it('records allergies from several phrasings', () => {
    expect(expectIntent('Add allergy: penicillin.', 'clinical.addAllergy').entities['substance'])
      .toBe('penicillin');
    expect(expectIntent('Patient is allergic to latex.', 'clinical.addAllergy').entities['substance'])
      .toBe('latex');
    expect(expectIntent('Patient allergic to penicillin.', 'clinical.addAllergy').entities['substance'])
      .toBe('penicillin');
  });

  it('records medical history', () => {
    const found = expectIntent('Medical history: type 2 diabetes.', 'clinical.addMedicalHistory');
    expect(found.entities['category']).toBe('CONDITION');
    expect(String(found.entities['label'])).toContain('diabetes');
  });

  it('records previous dental history, keeping the tooth it names', () => {
    const found = expectIntent(
      'Previous dental history: extraction of upper left wisdom tooth.',
      'clinical.addMedicalHistory',
    );
    expect(found.entities['category']).toBe('DENTAL_HISTORY');
    expect(found.entities['fdi']).toBe('28');
  });

  it('records an explicit note', () => {
    const found = expectIntent(
      'Add a note: patient reports sensitivity to cold.',
      'clinical.addNote',
    );
    expect(String(found.entities['content'])).toContain('sensitivity to cold');
    expect(found.entities['fdi']).toBeNull();
  });
});

describe('patient-level narrative is not mistaken for a tooth finding', () => {
  it('treats a present-tense complaint as an observation', () => {
    // Contains "pain" and "right" — both tooth-ish — but names no tooth.
    const found = expectIntent(
      'Patient reports pain when chewing on the right side.',
      'clinical.addNote',
    );
    expect(found.entities['category']).toBe('OBSERVATION');
  });

  it('routes an unmistakably dental past history to the dental record', () => {
    const found = expectIntent(
      'Patient had orthodontic treatment approximately five years ago.',
      'clinical.addMedicalHistory',
    );
    expect(found.entities['category']).toBe('DENTAL_HISTORY');
  });

  it('asks where an undetermined history belongs rather than defaulting', () => {
    const result = resolve('Patient has a history of dental anxiety and high blood pressure.');
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.clarification.question).toMatch(/medical history or the dental history/i);
      expect(result.clarification.options.map(o => o.value))
        .toEqual(expect.arrayContaining(['CONDITION', 'DENTAL_HISTORY']));
    }
  });
});

describe('never guesses a tooth', () => {
  it('asks which upper molar was meant', () => {
    const result = resolve('Upper molar needs treatment.');
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.clarification.question).toMatch(/which|did you mean/i);
      // The pending command survives the question, so answering completes it.
      expect(result.clarification.pendingIntent).toBe('chart.addToothFindings');
      expect(result.clarification.awaiting).toBe('fdi');
    }
  });

  it('offers a pick-list when only two teeth remain', () => {
    const result = resolve('Upper first molar: caries.');
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.clarification.options.map(o => o.value)).toEqual(['16', '26']);
    }
  });

  it('asks which tooth when a finding arrives with no tooth and none selected', () => {
    const result = resolve('Recurrent caries.');
    expect(result.kind).toBe('clarification');
  });
});

describe('conversational context', () => {
  it('uses the selected tooth when the doctor keeps dictating', () => {
    const found = expectIntent('Recurrent caries.', 'chart.addToothFindings', { selectedFdi: '26' });
    expect(found.entities['fdi']).toBe('26');
  });

  it('resolves "that tooth"', () => {
    const found = expectIntent('Sensitivity on that tooth.', 'chart.addToothFindings', { selectedFdi: '36' });
    expect(found.entities['fdi']).toBe('36');
  });

  it('treats "no, actually…" as a correction of the last write', () => {
    const found = expectIntent('No, actually crown replacement.', 'chart.replaceLastFinding', {
      lastWrite: {
        commandId: 'chart.addToothFindings',
        targetType: 'tooth', targetId: '16', fdi: '16', description: 'Tooth 16 → filling required',
      },
    });
    expect(findingCodes(found.entities)).toEqual(['crown_replacement_required']);
  });

  it('removes a finding from the tooth in context', () => {
    const found = expectIntent('Remove the sensitivity note from that tooth.', 'chart.removeFinding', {
      selectedFdi: '16',
    });
    expect(found.entities['fdi']).toBe('16');
    expect(findingCodes(found.entities)).toEqual(['sensitivity']);
  });

  it('recognises undo', () => {
    expectIntent('Undo.', 'voice.correction.undo');
  });
});

describe('reads, and what voice deliberately cannot do', () => {
  it('never navigates away from the dossier', () => {
    // Dictation results are shown in the dossier; a misheard "open" that
    // swapped the screen mid-examination could not be undone hands-free.
    expect(resolve("Open Ahmed El Amrani's dossier.").kind).toBe('unrecognized');
    expect(resolve('Go to the schedule.').kind).toBe('unrecognized');
    expect(resolve('Open the clinical tab.').kind).toBe('unrecognized');
  });

  it('reads a tooth, in English and French, without mistaking the question for a medication', () => {
    expect(expectIntent('What is on tooth 16?', 'chart.readTooth').entities['fdi']).toBe('16');
    expect(expectIntent('Lis la dent 26.', 'chart.readTooth').entities['fdi']).toBe('26');
  });

  it('opens and closes a session in French, with the article the recogniser splits', () => {
    expectIntent("Commencer l'examen.", 'voice.session.start');
    expectIntent("Fin de l'examen.", 'voice.session.end');
    expectIntent('Montre les constatations.', 'voice.session.summary');
    expectIntent('Résumé', 'voice.session.summary');
  });

  it('undoes in French', () => {
    expectIntent('Annule.', 'voice.correction.undo');
    expectIntent('Efface ça.', 'voice.correction.undo');
  });

  it('selects a tooth without writing anything', () => {
    expect(expectIntent('Show tooth 16.', 'chart.selectTooth').entities['fdi']).toBe('16');
  });

  it('schedules a follow-up', () => {
    expectIntent('Schedule a follow-up in two weeks.', 'schedule.followUp');
  });

  it('reads the outstanding balance', () => {
    expectIntent('What is the outstanding balance?', 'patients.readBalance');
  });
});

describe('unrecognised input is never forced into a command', () => {
  it('returns unrecognized for prose the grammar has no rule for', () => {
    const result = resolve('The weather outside is quite something today.');
    expect(result.kind).toBe('unrecognized');
  });
});
