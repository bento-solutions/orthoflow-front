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

describe('allergy substance', () => {
  it('keeps the substance and drops the French article', () => {
    const snapshot = {
      patientId: 'p', patientName: null, dentition: 'adult', module: 'patient-dossier', route: '/patients/p',
      selectedFdi: null, sessionId: null, locale: 'fr-MA', recentIntents: [], recentUtterances: [], lastWrite: null,
    } as const;
    for (const [said, substance] of [
      ['allergie à la pénicilline', 'pénicilline'],
      ["allergie à l'amoxicilline", 'amoxicilline'],
      ['allergie au latex', 'latex'],
      ['allergy to penicillin', 'penicillin'],
    ]) {
      const resolution = resolveWithGrammar(said, snapshot as never);
      expect(resolution.kind).toBe('intent');
      if (resolution.kind === 'intent') expect(resolution.intent.entities['substance']).toBe(substance);
    }
  });
});

// ── What a dictated sentence must never be recorded as ─────────────────────

/** Every entry an utterance resolves to, whether it is one command or several. */
const intentsOf = (utterance: string, overrides: Partial<VoiceContextSnapshot> = {}) => {
  const result = resolve(utterance, overrides);
  if (result.kind === 'intent') return [result.intent];
  if (result.kind === 'sequence') return result.intents;
  return [];
};

const describeAll = (utterance: string, overrides: Partial<VoiceContextSnapshot> = {}) =>
  intentsOf(utterance, overrides).map(i => `${i.intent}:${i.entities['fdi'] ?? ''}:${findingCodes(i.entities).join('+')}`);

describe('negation — a denied finding is never recorded as a finding', () => {
  const NEVER_A_FINDING = [
    'pas de carie sur la seize',
    'dent 16 pas de carie',
    'dent 16 sans carie',
    'dent 16 no caries',
    'dent 16 not fractured',
    'la 16 n\'est pas fracturée',
    'dent 16 pas de carie ni de fracture',
    'dent 26 pas normal',
  ];

  for (const utterance of NEVER_A_FINDING) {
    it(`keeps "${utterance}" as a note in the dentist's own words`, () => {
      const [only] = intentsOf(utterance);
      expect(only.intent, utterance).toBe('clinical.addNote');
      expect(String(only.entities['content']).length).toBeGreaterThan(0);
      expect(only.entities['fdi'], utterance).toBeDefined();
    });
  }

  it('records what is affirmed and keeps the denial as the tooth\'s note', () => {
    const [only] = intentsOf('dent 16 pas de carie mais fracture');
    expect(only.intent).toBe('chart.addToothFindings');
    expect(findingCodes(only.entities)).toEqual(['fracture']);
    expect(only.entities['note']).toBe('dent 16 pas de carie');
  });

  it('asks which tooth when a denial names none, and finishes it as a note', () => {
    const result = resolve('pas de carie');
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.clarification.pendingIntent).toBe('clinical.addNote');
      expect(result.clarification.awaiting).toBe('fdi');
    }
  });

  it('attaches a denial to the tooth already selected', () => {
    const [only] = intentsOf('pas de carie', { selectedFdi: '16' });
    expect(only.intent).toBe('clinical.addNote');
    expect(only.entities['fdi']).toBe('16');
  });

  it('does not treat the "non" that opens a correction as a denial', () => {
    const result = resolve('non, en fait couronne à remplacer', {
      lastWrite: { commandId: 'chart.addToothFindings', targetType: 'BufferedCommand', targetId: 'a-1', fdi: '16', description: '' },
    });
    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.intent).toBe('chart.replaceLastFinding');
      expect(findingCodes(result.intent.entities)).toEqual(['crown_replacement_required']);
    }
  });
});

describe('negation — an allergy the patient does not have is not an allergy', () => {
  const NOT_AN_ALLERGY = [
    'le patient n\'est pas allergique à la pénicilline',
    'aucune allergie connue',
    'pas d\'allergie',
    'patient sans allergie',
    'le patient n\'a pas d\'allergie',
    'no known allergies',
    'patient not allergic to penicillin',
    'allergie: aucune',
  ];

  for (const utterance of NOT_AN_ALLERGY) {
    it(`keeps "${utterance}" as a medical-history note`, () => {
      const [only] = intentsOf(utterance);
      expect(only.intent, utterance).toBe('clinical.addNote');
      expect(only.entities['category']).toBe('MEDICAL_HISTORY');
      expect(only.entities['substance']).toBeUndefined();
    });
  }

  it('still records a real allergy', () => {
    expect(expectIntent('allergie à la pénicilline', 'clinical.addAllergy').entities['substance']).toBe('pénicilline');
    expect(expectIntent('allergy: latex', 'clinical.addAllergy').entities['substance']).toBe('latex');
  });

  it('leaves out a second allergy the patient was said not to have', () => {
    const allergy = expectIntent('allergie à la pénicilline mais pas à l\'amoxicilline', 'clinical.addAllergy');
    expect(allergy.entities['substance']).toBe('pénicilline');
  });

  it('does not file "no medication" as a medication', () => {
    const [only] = intentsOf('le patient ne prend pas de médicaments');
    expect(only.intent).toBe('clinical.addNote');
  });

  it('does not file "none" as a medical history entry', () => {
    const [only] = intentsOf('antécédents médicaux : aucun');
    expect(only.intent).toBe('clinical.addNote');
    expect(only.entities['label']).toBeUndefined();
  });

  it('does not book a follow-up that was declined', () => {
    expect(resolve('pas besoin de rendez-vous').kind).toBe('unrecognized');
  });
});

describe('several teeth in one utterance — nothing lands on the wrong one', () => {
  it('gives each tooth its own findings', () => {
    expect(describeAll('dent 16 carie et dent 17 couronne')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:existing_crown',
    ]);
    expect(describeAll('dent 16 carie puis la 17 fracture')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:fracture',
    ]);
  });

  it('reads teeth said in French words', () => {
    expect(describeAll('la seize carie, la dix-sept obturation existante')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:existing_filling',
    ]);
  });

  it('gives the same finding to every tooth in a list', () => {
    expect(describeAll('dent 16, 17 et 18 carie')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:caries',
      'chart.addToothFindings:18:caries',
    ]);
    expect(describeAll('carie sur la 16 et la 17')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:caries',
    ]);
  });

  it('names the same finding on two teeth, which the first-only reading could not', () => {
    expect(describeAll('dent 16 carie, dent 17 carie')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:caries',
    ]);
  });

  it('keeps a denial on the tooth it was said about', () => {
    const [sixteen, seventeen] = intentsOf('dent 16 pas de carie et dent 17 carie');
    expect(sixteen.intent).toBe('clinical.addNote');
    expect(sixteen.entities['fdi']).toBe('16');
    expect(sixteen.entities['content']).toBe('dent 16 pas de carie');
    expect(seventeen.intent).toBe('chart.addToothFindings');
    expect(seventeen.entities['fdi']).toBe('17');
  });

  it('asks instead of guessing when a tooth has no findings of its own', () => {
    for (const utterance of ['dent 16 carie et 17', 'carie, dent 16 couronne, dent 17', 'dent 16 pas de carie et dent 17']) {
      const result = resolve(utterance);
      expect(result.kind, utterance).toBe('clarification');
    }
  });

  it('does not take a quantity for a second tooth', () => {
    // "15 jours" is a delay, not tooth 15: the finding stays on 16 and the
    // recall is kept, as a follow-up, instead of being lost as a stray word.
    expect(describeAll('dent 16 carie, contrôle dans 15 jours'))
      .toEqual(['chart.addToothFindings:16:caries', 'schedule.followUp::']);
  });

  it('refuses a number that is not a tooth rather than use the selected one', () => {
    const result = resolve('dent 58 carie', { selectedFdi: '16' });
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') expect(result.clarification.question).toMatch(/does not exist/);
  });

  it('asks about a baby tooth said against an adult chart', () => {
    expect(resolve('dent 16 carie et dent 52 fracture').kind).toBe('clarification');
  });
});

describe('a treatment need is never recorded as the restoration', () => {
  it('reads "à faire" and "à refaire" as work to do', () => {
    expect(describeAll('dent 25 couronne à faire')).toEqual(['chart.addToothFindings:25:crown_required']);
    expect(describeAll('dent 12 composite à refaire')).toEqual(['chart.addToothFindings:12:filling_required']);
    expect(describeAll('dent 47 amalgame à remplacer')).toEqual(['chart.addToothFindings:47:filling_required']);
    expect(describeAll('dent 16 bridge à faire')).toEqual(['chart.addToothFindings:16:bridge_required']);
    expect(describeAll('dent 21 facette à refaire')).toEqual(['chart.addToothFindings:21:veneer_required']);
  });

  it('reads a need said before the restoration', () => {
    const result = resolve('il faudra une couronne', { selectedFdi: '16' });
    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') expect(findingCodes(result.intent.entities)).toEqual(['crown_required']);
  });

  it('still records a restoration that is simply there', () => {
    expect(describeAll('dent 16 couronne existante')).toEqual(['chart.addToothFindings:16:existing_crown']);
    expect(describeAll('dent 16 composite')).toEqual(['chart.addToothFindings:16:existing_composite']);
  });
});

// ── French vocabulary a dentist actually uses ───────────────────────────

describe('French clinical vocabulary', () => {
  const FINDS: Array<[string, string]> = [
    ['dent 16 avulsion', 'avulsion'],
    ['dent 21 avulsée', 'avulsion'],
    ['dent 18 extraction', 'extraction_required'],
    ['dent 18 extraction à faire', 'extraction_required'],
    ['dent 26 pulpite', 'pulpitis'],
    ['dent 26 nécrose pulpaire', 'necrosis'],
    ['dent 36 granulome', 'periapical_lesion'],
    ['dent 16 kyste', 'periapical_lesion'],
    ['dent 16 lésion périapicale', 'periapical_lesion'],
    ['dent 11 fêlure', 'fracture'],
    ['dent 46 délabrée', 'extensive_destruction'],
    ['dent 46 cariée', 'caries'],
    ['dent 16 lésion carieuse', 'caries'],
    ['dent 16 reconstitution', 'existing_filling'],
    ['dent 16 reconstitution à refaire', 'filling_required'],
    ['dent 16 inlay', 'existing_inlay'],
    ['dent 26 onlay', 'existing_inlay'],
    ['dent 36 dévitalisation', 'existing_root_canal'],
    ['dent 36 dévitalisation à faire', 'root_canal_required'],
    ['dent 16 saignement', 'bleeding'],
    ['dent 36 gonflement', 'swelling'],
    ['dent 16 hypersensibilité', 'sensitivity'],
    ['dent 16 récession', 'gingival_recession'],
    ['dent 12 en rotation', 'malposition'],
    ['dent 13 ectopique', 'malposition'],
    ['dent 16 colorée', 'discoloration'],
    ['dent 16 bruxisme', 'tooth_wear'],
    ['dent 16 faux moignon', 'existing_post'],
  ];

  for (const [said, code] of FINDS) {
    it(`understands "${said}" as ${code}`, () => {
      const found = expectIntent(said, 'chart.addToothFindings');
      expect(findingCodes(found.entities)).toEqual([code]);
    });
  }

  it('never reads a bare "extraction" as the tooth already being gone', () => {
    const codes = findingCodes(expectIntent('dent 18 extraction', 'chart.addToothFindings').entities);
    expect(codes).not.toContain('extracted');
    expect(codes).not.toContain('missing');
  });

  it('still reads "extraite" as done', () => {
    expect(findingCodes(expectIntent('dent 18 extraite', 'chart.addToothFindings').entities)).toEqual(['extracted']);
  });
});

describe('the detail a finding is said with', () => {
  const surfaceOf = (utterance: string, code: string) => {
    const found = expectIntent(utterance, 'chart.addToothFindings');
    return ((found.entities['findings'] ?? []) as FindingEntity[]).find(f => f.code === code)?.surface ?? null;
  };

  it('keeps every face of a compound surface', () => {
    expect(surfaceOf('dent 16 carie mésio-occlusale', 'caries')).toBe('mesial-occlusal');
    expect(surfaceOf('dent 16 mésio-occlusale carie', 'caries')).toBe('mesial-occlusal');
    expect(surfaceOf('dent 26 carie occluso-distale', 'caries')).toBe('occlusal-distal');
    expect(surfaceOf('dent 16 carie mésio-occluso-distale', 'caries')).toBe('mesial-occlusal-distal');
    expect(surfaceOf('tooth 16 mesial occlusal caries', 'caries')).toBe('mesial-occlusal');
  });

  it('gives each surface to the finding it describes, not to both', () => {
    const utterance = 'dent 16 carie mésio-occlusale et fracture distale';
    expect(surfaceOf(utterance, 'caries')).toBe('mesial-occlusal');
    expect(surfaceOf(utterance, 'fracture')).toBe('distal');
  });

  it('leaves the surface empty when none was said', () => {
    expect(surfaceOf('dent 16 carie', 'caries')).toBeNull();
  });

  it('records the grade of a mobility', () => {
    for (const [said, severity] of [
      ['dent 26 mobilité grade 1', 'MILD'],
      ['dent 26 mobilité grade 2', 'MODERATE'],
      ['dent 26 mobilité de grade deux', 'MODERATE'],
      ['dent 26 mobilité classe 3', 'SEVERE'],
      ['dent 26 mobility grade II', 'MODERATE'],
    ]) {
      const found = expectIntent(said, 'chart.addToothFindings');
      const mobility = (found.entities['findings'] as FindingEntity[]).find(f => f.code === 'mobility');
      expect(mobility?.severity, said).toBe(severity);
      expect(mobility?.note, said).toMatch(/^grade [123]$/);
    }
  });

  it('records a mobility with no grade without inventing one', () => {
    const found = expectIntent('dent 26 mobile', 'chart.addToothFindings');
    const mobility = (found.entities['findings'] as FindingEntity[])[0];
    expect(mobility.severity).toBeNull();
    expect(mobility.note).toBeUndefined();
  });
});

describe('what the dentist says about the patient', () => {
  const history = (utterance: string) => intentsOf(utterance).map(i =>
    `${i.intent}:${i.entities['category'] ?? ''}:${String(i.entities['label'] ?? '').toLowerCase()}`);

  it('files a medication as medical history', () => {
    expect(history('patient sous anticoagulants')).toEqual(['clinical.addMedicalHistory:MEDICATION:anticoagulants']);
    expect(history('patient is on warfarin')).toEqual(['clinical.addMedicalHistory:MEDICATION:warfarin']);
  });

  it('files a condition as medical history', () => {
    expect(history('le patient est diabétique')).toEqual(['clinical.addMedicalHistory:CONDITION:diabétique']);
    expect(history('patient fumeur')).toEqual(['clinical.addMedicalHistory:CONDITION:fumeur']);
  });

  it('does not drop the second thing said', () => {
    expect(history('patient hypertendu et diabétique')).toEqual([
      'clinical.addMedicalHistory:CONDITION:diabétique',
      'clinical.addMedicalHistory:CONDITION:hypertendu',
    ]);
    expect(history('patient diabétique sous insuline')).toEqual([
      'clinical.addMedicalHistory:CONDITION:diabétique',
      'clinical.addMedicalHistory:MEDICATION:insuline',
    ]);
    expect(history('le patient est sous aspirine et metformine')).toEqual([
      'clinical.addMedicalHistory:MEDICATION:aspirine',
      'clinical.addMedicalHistory:MEDICATION:metformine',
    ]);
  });

  it('keeps a denial as a note in the dentist\'s words, never as a condition', () => {
    const [entry] = intentsOf('le patient n\'est pas diabétique');
    expect(entry.intent).toBe('clinical.addNote');
    expect(entry.entities['content']).toBe('le patient n\'est pas diabétique');
  });

  it('leaves a story to the narrative rule', () => {
    expect(history('le patient a eu un infarctus il y a deux ans')).toEqual([]);
  });

  it('does not take "sous la couronne" for a medication', () => {
    const codes = describeAll('dent 16 carie sous la couronne');
    expect(codes).toEqual(['chart.addToothFindings:16:recurrent_caries']);
    expect(history('la dent est sous la couronne')).toEqual([]);
  });
});

describe('a recall said in words', () => {
  it('is a follow-up, however it is phrased', () => {
    for (const said of ['revoir dans 15 jours', 'revoir dans deux semaines', 'contrôle dans un mois',
      'rappel dans 6 mois', 'recall in 3 months', 'programme un rendez-vous']) {
      expectIntent(said, 'schedule.followUp');
    }
  });

  it('keeps the findings said with it', () => {
    expect(describeAll('dent 16 carie, revoir dans 15 jours'))
      .toEqual(['chart.addToothFindings:16:caries', 'schedule.followUp::']);
    expect(describeAll('dent 16 carie et dent 17 fracture, contrôle dans un mois')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:fracture',
      'schedule.followUp::',
    ]);
  });

  it('is not a follow-up when it is denied', () => {
    expect(intentsOf('pas besoin de rendez-vous').map(i => i.intent)).not.toContain('schedule.followUp');
  });
});

describe('several teeth described in words', () => {
  it('gives each tooth its own findings', () => {
    expect(describeAll('première molaire supérieure droite carie et canine inférieure gauche fracture')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:33:fracture',
    ]);
    expect(describeAll('upper right first molar caries and lower left canine fracture')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:33:fracture',
    ]);
  });

  it('keeps findings that follow one description with that tooth', () => {
    expect(describeAll('upper right first molar caries and fracture'))
      .toEqual(['chart.addToothFindings:16:caries+fracture']);
  });

  it('asks rather than leave a tooth with nothing', () => {
    expect(resolve('upper right first molar caries, lower left canine').kind).toBe('clarification');
  });

  it('asks about a description that stops short of one tooth', () => {
    expect(resolve('lower left molar fracture and upper right canine caries').kind).toBe('clarification');
  });
});

describe('removing a finding from several teeth', () => {
  it('removes it from each tooth named', () => {
    expect(describeAll('enlève la carie sur la 16 et la 17')).toEqual([
      'chart.removeFinding:16:caries',
      'chart.removeFinding:17:caries',
    ]);
  });

  it('removes a different finding from each', () => {
    expect(describeAll('enlève la carie sur la 16 et la fracture sur la 17')).toEqual([
      'chart.removeFinding:16:caries',
      'chart.removeFinding:17:fracture',
    ]);
  });

  it('still removes from the one tooth named', () => {
    expect(describeAll('enlève la carie sur la 16')).toEqual(['chart.removeFinding:16:caries']);
  });

  it('does not fall back to the selected tooth when the one named was not recognised', () => {
    expect(describeAll('enlève la carie sur la 58 et la 17', { selectedFdi: '16' }))
      .toEqual(['chart.removeFinding:17:caries']);
  });
});

describe('several teeth, finding first', () => {
  it('pairs "carie sur la 16 et fracture sur la 17" the way it was said', () => {
    expect(describeAll('carie sur la 16 et fracture sur la 17')).toEqual([
      'chart.addToothFindings:16:caries',
      'chart.addToothFindings:17:fracture',
    ]);
  });

  it('does not pair by position when nothing ties each tooth to its finding', () => {
    expect(resolve('carie, dent 16 couronne, dent 17').kind).toBe('clarification');
  });
});

describe('a task for the team', () => {
  const task = (utterance: string, overrides: Partial<VoiceContextSnapshot> = {}) =>
    expectIntent(utterance, 'tasks.create', overrides).entities;

  it('reads who it is for, the day and the words, as said', () => {
    expect(task('Crée une tâche pour l\'accueil : commander des gants demain')).toMatchObject({
      assigneeRole: 'ASSISTANT',
      title: 'Commander des gants demain',
    });
    expect(task('create a task for reception, tomorrow: Order gloves')).toMatchObject({
      assigneeRole: 'ASSISTANT',
      dueDay: 'tomorrow',
      title: 'Order gloves',
    });
  });

  it('takes the phrases in any order, and urgency', () => {
    expect(task('tâche urgente pour la réception demain : appeler le laboratoire')).toMatchObject({
      assigneeRole: 'ASSISTANT',
      dueDay: 'tomorrow',
      priority: 'URGENT',
      title: 'Appeler le laboratoire',
    });
  });

  it('is the doctor\'s own when it is for no one else', () => {
    const own = task('nouvelle tâche pour moi : relire le devis');
    expect(own['assigneeRole']).toBeUndefined();
    expect(own['title']).toBe('Relire le devis');
    expect(task('add a task: relire le devis')['assigneeRole']).toBeUndefined();
  });

  it('is not mistaken for a recall or a note, whatever the words say', () => {
    expect(task('crée une tâche pour l\'accueil : fixer un rendez-vous de contrôle')['title'])
      .toBe('Fixer un rendez-vous de contrôle');
    expect(task('tâche pour l\'accueil : rappeler le patient dans 15 jours')['assigneeRole']).toBe('ASSISTANT');
  });

  it('is filed against the patient only when the words are about them', () => {
    expect(task('crée une tâche pour l\'accueil : rappeler le patient')['linkPatient']).toBe(true);
    expect(task('crée une tâche pour l\'accueil : commander des gants')['linkPatient']).toBeUndefined();
    expect(task('create a task for reception: call the patient', { patientId: null })['linkPatient']).toBeUndefined();
  });

  it('asks what it should say when nothing follows', () => {
    const result = resolve('crée une tâche pour l\'accueil');
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') throw new Error('unreachable');
    expect(result.clarification.pendingIntent).toBe('tasks.create');
    expect(result.clarification.awaiting).toBe('title');
    expect(result.clarification.pendingEntities).toMatchObject({ assigneeRole: 'ASSISTANT' });
  });

  it('is not a task when it is denied', () => {
    expect(resolve('pas de tâche pour l\'accueil').kind).not.toBe('intent');
  });
});

describe('corrections that say what was wrong', () => {
  const lastOn16 = {
    lastWrite: { commandId: 'chart.addToothFindings', targetType: 'BufferedCommand', targetId: 'a-1', fdi: '16', description: 'x' },
  };

  it('"not caries, it\'s inflammation" swaps the finding rather than adding one', () => {
    const found = expectIntent('Not caries, it\'s inflammation.', 'chart.reclassifyFinding', lastOn16);
    expect(found.entities['fdi']).toBe('16');
    expect(((found.entities['from'] ?? []) as FindingEntity[]).map(f => f.code)).toEqual(['caries']);
    expect(findingCodes(found.entities)).toEqual(['gingival_inflammation']);
  });

  it('reads the French and the named-tooth forms', () => {
    const fr = expectIntent('Ce n\'est pas une carie, c\'est une inflammation.', 'chart.reclassifyFinding', lastOn16);
    expect(findingCodes(fr.entities)).toEqual(['gingival_inflammation']);
    const named = expectIntent('Tooth 17 is not caries but inflammation', 'chart.reclassifyFinding');
    expect(named.entities['fdi']).toBe('17');
  });

  it('keeps "no caries, inflammation" as two statements about the tooth, not a correction', () => {
    const result = resolve('Tooth 16: no caries, inflammation.');
    expect(result.kind === 'intent' && result.intent.intent).not.toBe('chart.reclassifyFinding');
    const fr = resolve('Dent 16 pas de carie, inflammation.');
    expect(fr.kind === 'intent' && fr.intent.intent).not.toBe('chart.reclassifyFinding');
  });

  it('asks which tooth when none is named, selected or just written', () => {
    expect(resolve('Not caries, it\'s inflammation.').kind).toBe('clarification');
  });

  it('"forget tooth 16, this is 17" moves the entry', () => {
    const found = expectIntent('Forget tooth 16, this is 17.', 'chart.moveFindings');
    expect(found.entities['fromFdi']).toBe('16');
    expect(found.entities['fdi']).toBe('17');
    expect(found.entities['findings']).toBeUndefined();
    const fr = expectIntent('Oublie la 16, c\'est la 17.', 'chart.moveFindings');
    expect([fr.entities['fromFdi'], fr.entities['fdi']]).toEqual(['16', '17']);
  });

  it('findings said after the new tooth redo the entry on it', () => {
    const found = expectIntent('Forget 16, it\'s 17, deep caries.', 'chart.moveFindings');
    expect(findingCodes(found.entities)).toEqual(['deep_caries']);
  });

  it('is not triggered by a list of teeth', () => {
    const result = resolve('Not 16 and 17 caries.');
    expect(result.kind === 'intent' && result.intent.intent).not.toBe('chart.moveFindings');
  });
});
