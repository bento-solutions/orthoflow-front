import { describe, expect, it } from 'vitest';
import { canChart, suggestFromSentence, suggestionGrammarText } from './consultation-suggestion';
import { resolveWithGrammar } from '../voice/voice-grammar';
import { VoiceContextSnapshot } from '../voice/voice-intent.model';
import { allFindingCodes, findingKind } from '../voice/clinical-lexicon';

const snapshot: VoiceContextSnapshot = {
  patientId: 'p-1',
  patientName: 'Patient',
  dentition: 'adult',
  module: 'patient-dossier',
  route: '/patients/p-1',
  selectedFdi: null,
  sessionId: 's-1',
  locale: 'fr-MA',
  recentIntents: [],
  recentUtterances: [],
  lastWrite: null,
};

/** The finding codes the chart grammar reads back from "dent <fdi> <words>". */
function charted(fdi: string, words: string): string[] {
  const resolution = resolveWithGrammar(`dent ${fdi} ${words}`, snapshot);
  const intents = resolution.kind === 'intent' ? [resolution.intent] : resolution.kind === 'sequence' ? resolution.intents : [];
  return intents
    .filter(intent => intent.intent === 'chart.addToothFindings')
    .flatMap(intent => ((intent.entities['findings'] ?? []) as { code: string }[]).map(finding => finding.code));
}

describe('what a sentence left to confirm most likely meant', () => {
  it('reads a state of a tooth, with the tooth and the surface', () => {
    const s = suggestFromSentence('alors la 16 il y a une carie occlusale');

    expect(s?.findings.map(f => f.code)).toEqual(['caries']);
    expect(s?.findings[0].type).toBe('state');
    expect(s?.findings[0].surface).toContain('occlusal');
    expect(s?.teeth).toEqual(['16']);
  });

  it('reads a treatment the tooth needs as a treatment', () => {
    const s = suggestFromSentence('la 38 il faudra l’extraire, extraction à prévoir');

    expect(s?.findings.some(f => f.type === 'treatment')).toBe(true);
    expect(s?.teeth).toEqual(['38']);
  });

  it('puts back what the recogniser usually mishears before reading', () => {
    const s = suggestFromSentence('dans 16 carré');

    expect(s?.findings.map(f => f.code)).toEqual(['caries']);
    expect(s?.teeth).toEqual(['16']);
    expect(s?.approximate).toBe(true);
  });

  it('keeps a doubt the doctor said', () => {
    expect(suggestFromSentence('suspicion de carie sur la 26')?.findings[0].suspected).toBe(true);
  });

  it('suggests nothing for a denied finding or a sentence with no clinical word', () => {
    expect(suggestFromSentence('pas de carie sur la 16')).toBeNull();
    expect(suggestFromSentence('bonjour, comment ça va aujourd’hui ?')).toBeNull();
    expect(suggestFromSentence('')).toBeNull();
  });

  it('leaves several teeth with several findings for the doctor to place', () => {
    const one = suggestFromSentence('16 carie occlusale');
    const many = suggestFromSentence('la 16 une carie et la 17 une fracture');

    expect(canChart(one)).toBe(true);
    expect(many?.teeth.length).toBe(2);
    expect(canChart(many)).toBe(false);
    expect(canChart(suggestFromSentence('une carie quelque part'))).toBe(false);
  });

  it('is put on the chart with words the chart grammar reads back as the same finding', () => {
    for (const sentence of ['la 16 carie occlusale', 'la 46 il faut une couronne', 'la 36 a une fracture']) {
      const s = suggestFromSentence(sentence);
      expect(canChart(s), sentence).toBe(true);
      const codes = charted(s!.teeth[0], s!.findings.map(suggestionGrammarText).join(' et '));
      expect(codes, sentence).toEqual(expect.arrayContaining(s!.findings.map(f => f.code)));
    }
  });

  it('reads the French words of most findings back as the same finding', () => {
    const codes = allFindingCodes().filter(code => findingKind(code) !== 'OBSERVATION');
    const lost = codes.filter(code => !charted('16', suggestionGrammarText({ code, type: 'state', surface: null, suspected: false })).includes(code));
    // A few states are only ever said with more words than their name; the doctor adds those by hand.
    expect(lost.length / codes.length, lost.join(', ')).toBeLessThan(0.2);
  });
});
