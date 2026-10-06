import { describe, expect, it } from 'vitest';
import { allFindingCodes, extractFindings } from './clinical-lexicon';
import { resolveWithGrammar } from './voice-grammar';
import { VoiceContextSnapshot } from './voice-intent.model';
import {
  COMMAND_EXAMPLES,
  FINDING_TERMS,
  speechHints,
  spokenConfirmation,
  spokenQuestion,
  spokenStagedList,
  spokenSurface,
} from './voice-vocabulary';

/**
 * The vocabulary biases the recogniser, so a term here that the grammar
 * cannot parse would actively steer transcripts towards failure. These tests
 * are what make the list trustworthy.
 */

const context = (overrides: Partial<VoiceContextSnapshot> = {}): VoiceContextSnapshot => ({
  patientId: 'p-1',
  patientName: 'Ahmed El Amrani',
  dentition: 'adult',
  module: 'patient-dossier',
  route: '/patients/p-1',
  selectedFdi: null,
  sessionId: 's-1',
  locale: 'fr-MA',
  recentIntents: [],
  recentUtterances: [],
  // A previous write, so "non, en fait…" has something to correct.
  lastWrite: { commandId: 'chart.addToothFindings', targetType: 'BufferedCommand', targetId: 'a-1', fdi: '16', description: '' },
  ...overrides,
});

describe('FINDING_TERMS', () => {
  it('covers every finding code the lexicon knows', () => {
    expect(Object.keys(FINDING_TERMS).sort()).toEqual(allFindingCodes().sort());
  });

  it('every term, in both languages, extracts to exactly its own code', () => {
    for (const [code, terms] of Object.entries(FINDING_TERMS)) {
      for (const term of [...terms.fr, ...terms.en]) {
        expect(extractFindings(term).map(f => f.code), `"${term}"`).toEqual([code]);
      }
    }
  });
});

describe('COMMAND_EXAMPLES', () => {
  it('every example resolves to its command, in French and in English', () => {
    for (const example of COMMAND_EXAMPLES) {
      for (const utterance of [example.fr, example.en]) {
        const result = resolveWithGrammar(utterance, context());
        expect(result.kind, `"${utterance}" → ${JSON.stringify(result)}`).toBe('intent');
        if (result.kind === 'intent') expect(result.intent.intent, `"${utterance}"`).toBe(example.intent);
      }
    }
  });
});

describe('speechHints', () => {
  it('leads with the wake word and stays inside the server cap', () => {
    const hints = speechHints(context({ selectedFdi: '26' }));
    expect(hints.startsWith('Calypso')).toBe(true);
    expect(hints).toContain('dent 26');
    expect(hints.length).toBeLessThan(4000);
  });

  it('never tells the recogniser who the patient is', () => {
    const hints = speechHints(context({ patientName: 'Ahmed El Amrani', selectedFdi: '26' }));
    expect(hints).not.toMatch(/ahmed|amrani/i);
    expect(hints).not.toContain('patient Ahmed');
  });
});

describe('spoken read-backs', () => {
  it('reads a staged finding back in French with its surface', () => {
    const spoken = spokenConfirmation('clinical.addFindings',
      { fdi: '16', findings: [{ code: 'recurrent_caries', surface: 'occlusal' }] }, 'fr');
    expect(spoken).toEqual({ text: 'Dent 16 : carie récurrente occlusale.', locale: 'fr-FR' });
  });

  it('reads it back in English for an English interface', () => {
    const spoken = spokenConfirmation('clinical.addFindings',
      { fdi: '36', findings: [{ code: 'deep_caries' }, { code: 'root_canal_required' }] }, 'en');
    expect(spoken?.text).toBe('Tooth 36: deep caries, root canal required.');
  });

  it('asks the grammar\'s questions in French', () => {
    expect(spokenQuestion('Which tooth is that for?', 'fr').text).toBe('Quelle dent ?');
    expect(spokenQuestion('Did you mean 16 (upper right first molar) or 26 (upper left first molar)?', 'fr').text)
      .toBe('Dent 16 ou 26 ?');
    expect(spokenQuestion('Which tooth is that for?', 'en')).toEqual({ text: 'Which tooth is that for?', locale: 'en-US' });
  });
});

describe('reading back what is staged', () => {
  const entry = (fdi: string, code: string) => ({
    intent: 'clinical.addFindings',
    entities: { fdi, findings: [{ code }] },
    preview: `Tooth ${fdi}`,
  });

  it('reads each staged entry as it was read when it was staged, with a count', () => {
    const spoken = spokenStagedList([entry('16', 'recurrent_caries'), entry('26', 'fracture')], 'fr');

    expect(spoken.locale).toBe('fr-FR');
    expect(spoken.text).toBe('2 entrées. Dent 16 : carie récurrente. Dent 26 : fracture.');
  });

  it('says so when there is nothing staged', () => {
    expect(spokenStagedList([], 'fr').text).toBe('Rien à relire pour l\'instant.');
    expect(spokenStagedList([], 'en').text).toBe('Nothing to read back yet.');
  });

  it('reads only the latest entries of a long session and says how many there are', () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(`1${(i % 8) + 1}`, 'caries'));

    const spoken = spokenStagedList(many, 'fr');

    expect(spoken.text).toMatch(/^9 entrées, les 6 dernières\./);
    expect(spoken.text.match(/Dent /g)).toHaveLength(6);
  });

  it('includes a note in the words it was filed in', () => {
    const spoken = spokenStagedList([{
      intent: 'clinical.addNote',
      entities: { content: 'dent 16 pas de carie', fdi: '16' },
      preview: 'Note',
    }], 'fr');

    expect(spoken.text).toContain('Note sur la dent 16 : dent 16 pas de carie.');
  });
});

describe('a read-back that does not cost the next sentence', () => {
  it('keeps the first findings of a crowded tooth and counts the rest', () => {
    const spoken = spokenConfirmation('clinical.addFindings', {
      fdi: '16',
      findings: ['caries', 'fracture', 'existing_crown', 'sensitivity', 'mobility', 'abscess'].map(code => ({ code })),
    }, 'fr');

    expect(spoken?.text).toMatch(/^Dent 16 : .+, .+, .+, .+, et 2 autres\.$/);
  });

  it('leaves four findings whole', () => {
    const spoken = spokenConfirmation('clinical.addFindings', {
      fdi: '16', findings: ['caries', 'fracture', 'existing_crown', 'sensitivity'].map(code => ({ code })),
    }, 'en');

    expect(spoken?.text).not.toContain('more');
  });
});

describe('a compound surface read back as it was said', () => {
  it('uses the combining form a French dentist uses', () => {
    expect(spokenSurface('mesial-occlusal', 'fr')).toBe('mésio-occlusale');
    expect(spokenSurface('occlusal-distal', 'fr')).toBe('occluso-distale');
    expect(spokenSurface('mesial-occlusal-distal', 'fr')).toBe('mésio-occluso-distale');
    expect(spokenSurface('buccal-occlusal', 'fr')).toBe('vestibulo-occlusale');
  });

  it('reads a single surface as an adjective', () => {
    expect(spokenSurface('occlusal', 'fr')).toBe('occlusale');
    expect(spokenSurface('mesial', 'en')).toBe('mesial');
  });

  it('is part of the spoken confirmation, so the dentist hears both faces', () => {
    const spoken = spokenConfirmation('clinical.addFindings',
      { fdi: '16', findings: [{ code: 'caries', surface: 'mesial-occlusal' }] }, 'fr');

    expect(spoken?.text).toBe('Dent 16 : carie mésio-occlusale.');
  });
});

describe('spokenConfirmation of a task', () => {
  it('reads who, when and what, in the language of the doctor', () => {
    expect(spokenConfirmation('tasks.create', { title: 'Commander des gants', assigneeRole: 'ASSISTANT', dueDay: 'tomorrow' }, 'fr')?.text)
      .toBe('Tâche pour l\'accueil, pour demain : Commander des gants.');
    expect(spokenConfirmation('tasks.create', { title: 'Order gloves' }, 'en')?.text).toBe('Task for you: Order gloves.');
  });
});
