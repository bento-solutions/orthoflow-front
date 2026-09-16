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
