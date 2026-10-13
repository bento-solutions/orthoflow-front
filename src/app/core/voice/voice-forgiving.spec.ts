import { describe, expect, it } from 'vitest';
import { classifyLanguage } from './language-filter';
import { COMMAND_EXAMPLES, FINDING_TERMS } from './voice-vocabulary';
import { VoiceContextSnapshot } from './voice-intent.model';
import { resolveForgiving } from './voice-resolve';
import { isSelfEvidentDictation } from './voice-wake';

/**
 * How a doctor really says it, as opposed to how the grammar was written. Each
 * line is a sentence a French- or English-speaking dentist says (or a
 * recogniser makes of one), with the teeth and findings it must produce — the
 * ones in the first block came straight from the clinic: "sur la 16 je vois des
 * caries", "la 13 et 14 amalgame", "tooth 17 infectione et amalgam".
 */

const context: VoiceContextSnapshot = {
  patientId: 'p-1', patientName: null, dentition: 'adult', module: 'patient-dossier', route: '/patients/p-1',
  selectedFdi: null, sessionId: 's-1', locale: 'fr-MA', recentIntents: [], recentUtterances: [], lastWrite: null,
};

/** "16:caries,17:crown" — each tooth with its findings, in the order said. */
function staged(utterance: string): string {
  const { resolution } = resolveForgiving([utterance], context);
  const intents = resolution.kind === 'intent' ? [resolution.intent] : resolution.kind === 'sequence' ? resolution.intents : [];
  if (intents.length === 0) return resolution.kind;
  return intents.map(intent => {
    const findings = (intent.entities['findings'] as Array<{ code: string }> | undefined) ?? [];
    return `${intent.entities['fdi']}:${findings.map(f => f.code).sort().join('+')}`;
  }).join(',');
}

const AMALGAM = 'existing_amalgam';

const SAID: Array<[string, string]> = [
  // ── straight from the clinic
  ['sur la 16 je vois des caries', '16:caries'],
  ['la 13 et 14 amalgame', `13:${AMALGAM},14:${AMALGAM}`],
  ['tooth 17 infectione et amalgam', `17:${AMALGAM}+infection`],
  ['dent 17 infection et amalgame', `17:${AMALGAM}+infection`],

  // ── one tooth, however it is opened
  ['sur la 16 je vois une carie', '16:caries'],
  ['je vois une carie sur la 16', '16:caries'],
  ['je vois des caries sur la 16', '16:caries'],
  ['la 16 a une carie', '16:caries'],
  ['la 16 est cariée', '16:caries'],
  ['la seize est cariée', '16:caries'],
  ['il y a une carie sur la 16', '16:caries'],
  ['il y a une carie sur la seize', '16:caries'],
  ['on a une carie sur la 16', '16:caries'],
  ['on voit une carie sur la 16', '16:caries'],
  ['carie sur la 16', '16:caries'],
  ['carie sur 16', '16:caries'],
  ['16 carie', '16:caries'],
  ['16 caries', '16:caries'],
  ['seize carie', '16:caries'],
  ['dix-sept amalgame', `17:${AMALGAM}`],
  ['vingt-six couronne', '26:existing_crown'],
  ['la 16 carie', '16:caries'],
  ['dent numéro 16 carie', '16:caries'],
  ['numéro 16 carie', '16:caries'],
  ['la dent 16 est cariée', '16:caries'],
  ['sur la dent seize une carie', '16:caries'],
  ['pour la 16 carie profonde', '16:deep_caries'],
  ['la 16 : carie, abcès', '16:abscess+caries'],
  ['alors sur la 16 euh je vois des caries', '16:caries'],
  ['bon la 16 carie', '16:caries'],
  ['donc sur la 16 on a une carie', '16:caries'],

  // ── several teeth, one finding
  ['la 13 et la 14 amalgame', `13:${AMALGAM},14:${AMALGAM}`],
  ['13 et 14 amalgame', `13:${AMALGAM},14:${AMALGAM}`],
  ['les 13 et 14 amalgames', `13:${AMALGAM},14:${AMALGAM}`],
  ['sur les 13 et 14 amalgame', `13:${AMALGAM},14:${AMALGAM}`],
  ['la 13, la 14, la 15 amalgame', `13:${AMALGAM},14:${AMALGAM},15:${AMALGAM}`],
  ['la 16 et la 17 caries', '16:caries,17:caries'],
  ['je vois des caries sur la 16 et la 17', '16:caries,17:caries'],
  ['13 14 amalgame', `13:${AMALGAM},14:${AMALGAM}`],
  ['la 11 et la 21 composite', '11:existing_composite,21:existing_composite'],
  ['dents 16, 17 et 18 carie', '16:caries,17:caries,18:caries'],

  // ── several teeth, each with its own finding
  ['la 13 amalgame et la 14 composite', `13:${AMALGAM},14:existing_composite`],
  ['la 16 carie et la 17 fracture', '16:caries,17:fracture'],
  ['sur la 14 amalgame et sur la 15 carie', `14:${AMALGAM},15:caries`],
  ['la 36 couronne et la 37 absente', '36:existing_crown,37:missing'],

  // ── lists of teeth, each list with its own finding — in either order
  ['je vois un amalgame sur la 14 et la 15 et une carie sur la 16', `14:${AMALGAM},15:${AMALGAM},16:caries`],
  ['la 14 et la 15 amalgame et la 16 carie', `14:${AMALGAM},15:${AMALGAM},16:caries`],
  ['amalgame sur la 14, la 15 et une carie sur la 16 et la 17', `14:${AMALGAM},15:${AMALGAM},16:caries,17:caries`],
  ['la 11 et la 21 composite, la 12 et la 22 fracture', '11:existing_composite,21:existing_composite,12:fracture,22:fracture'],

  // ── several findings on one tooth
  ['la 17 infection et amalgame', `17:${AMALGAM}+infection`],
  ['la 17 infectée avec amalgame', `17:${AMALGAM}+infection`],
  ['la 17 amalgame et infection', `17:${AMALGAM}+infection`],
  ['sur la 17 il y a une infection et un amalgame', `17:${AMALGAM}+infection`],
  ['la 26 carie profonde et mobilité', '26:deep_caries+mobility'],
  ['la 36 couronne et dévitalisée', '36:existing_crown+existing_root_canal'],

  // ── a need belongs to the nearest restoration, not the one before it
  ['la 46 dévitalisée avec couronne à refaire', '46:crown_replacement_required+existing_root_canal'],
  ['la 46 amalgame et composite à refaire', `46:${AMALGAM}+filling_required`],

  // ── what the recogniser makes of it
  ['la 17 infectione et amalgame', `17:${AMALGAM}+infection`],
  ['dent 17 infectione et amalgame', `17:${AMALGAM}+infection`],
  ['la 16 carriée', '16:caries'],
  ['la 16 caria', '16:caries'],
  ['dent 16 carries', '16:caries'],
  ['la 16 composit', '16:existing_composite'],
  ['la 16 amalgam', `16:${AMALGAM}`],
  ['la 16 devitalisee', '16:existing_root_canal'],
  ['dent 16 abces', '16:abscess'],

  // ── English
  ['tooth 17 infection and amalgam', `17:${AMALGAM}+infection`],
  ['17 infection and amalgam', `17:${AMALGAM}+infection`],
  ['tooth 17 has infection and amalgam', `17:${AMALGAM}+infection`],
  ['there is caries on tooth 16', '16:caries'],
  ['I see caries on tooth 16', '16:caries'],
  ['I can see a cavity on the 16', '16:cavity'],
  ['on the 16 I see caries', '16:caries'],
  ['the 16 has caries', '16:caries'],
  ['16 is carious', '16:caries'],
  ['tooth sixteen caries', '16:caries'],
  ['sixteen caries', '16:caries'],
  ['tooth 13 and 14 amalgam', `13:${AMALGAM},14:${AMALGAM}`],
  ['13 and 14 amalgam', `13:${AMALGAM},14:${AMALGAM}`],
  ['teeth 13 and 14 amalgam', `13:${AMALGAM},14:${AMALGAM}`],
  ['the 13 and the 14 amalgam', `13:${AMALGAM},14:${AMALGAM}`],
  ['tooth 16 caries and tooth 17 crown', '16:caries,17:existing_crown'],
  ['tooth 26 needs root canal and crown', '26:crown_required+root_canal_required'],
  ['tooth 16 is fractured and sensitive', '16:fracture+sensitivity'],
];

describe('commands as they are really said', () => {
  for (const [said, expected] of SAID) {
    it(`"${said}" → ${expected}`, () => {
      expect(staged(said)).toBe(expected);
    });
  }

  it('still asks, rather than guess, when a finding could go with either list', () => {
    expect(staged('carie la 14 et la 15 amalgame')).toBe('clarification');
    expect(staged('la 14 et la 15 carie et la 16')).toBe('clarification');
  });

  it('does not repair a tooth number', () => {
    expect(staged('la 17 carie et amalgame')).toBe(`17:caries+${AMALGAM}`);
    // "dix-sept" and "dix-huit" are one edit apart; neither is ever turned into the other
    expect(staged('dix-sept amalgame')).toBe(`17:${AMALGAM}`);
  });

  it('does not add a finding the doctor did not say', () => {
    expect(staged('la 16 carie')).toBe('16:caries');
    expect(staged('la 16 fracture mésiale')).toBe('16:fracture');
  });
});

describe('what needs no wake word', () => {
  const NO_WAKE_WORD = [
    'sur la 16 je vois des caries', 'je vois une carie sur la 16', 'je vois des caries sur la 16 et la 17',
    'il y a une carie sur la 16', 'on a une carie sur la 16', 'alors sur la 14 euh je vois un amalgame',
    'la 13 et 14 amalgame', 'seize carie', 'dent 16 carie', 'il faut une couronne sur la 26', 'I see caries on tooth 16', 'there is a cavity on tooth 26',
    'tooth 17 infectione et amalgam', 'on the 16 I see caries', 'la 16 carriée', 'la 16 caria', 'dent 17 infectione',
  ];
  for (const sentence of NO_WAKE_WORD) {
    it(`"${sentence}" is dictation`, () => expect(isSelfEvidentDictation(sentence)).toBe(true));
  }

  const TALK = [
    'j\'ai mal à la 16 depuis hier', 'passe-moi le composite pour la seize', 'est-ce que vous avez mal à la 16 ?',
    'rendez-vous le 15 mai pour une carie', 'le patient a 36 ans et une carie', 'I have pain on the 16',
    'does the 16 hurt', 'il faudra faire une couronne un jour', 'ouvrez grand',
  ];
  for (const sentence of TALK) {
    it(`"${sentence}" is not`, () => expect(isSelfEvidentDictation(sentence)).toBe(false));
  }
});

describe('the language filter against real dictation', () => {
  it('never calls the doctor\'s own French noise, whatever the finding', () => {
    for (const [said] of SAID.filter(([sentence]) => !/^(?:tooth|teeth|I |there |on the|the |17 |13 and|16 is|sixteen|\d\d and)/.test(sentence))) {
      expect(classifyLanguage(said, 'fr'), said).not.toBe('noise');
    }
  });

  it('never calls the doctor\'s own English noise', () => {
    for (const said of [
      'tooth 17 infection and amalgam', 'there is caries on tooth 16', 'I see caries on tooth 16', 'tooth 13 and 14 amalgam',
      'the 16 has caries', 'tooth 16 caries and tooth 17 crown', 'tooth 26 needs root canal and crown',
      'tooth 16 is fractured and sensitive', 'on the 16 I see caries', 'Calypso, deep caries on tooth 36',
    ]) {
      expect(classifyLanguage(said, 'en'), said).not.toBe('noise');
    }
  });

  it('accepts every example and finding term the app itself teaches, in its own language', () => {
    for (const example of COMMAND_EXAMPLES) {
      expect(classifyLanguage(example.fr, 'fr'), example.fr).not.toBe('noise');
      expect(classifyLanguage(example.en, 'en'), example.en).not.toBe('noise');
    }
    for (const [code, terms] of Object.entries(FINDING_TERMS)) {
      for (const term of terms.fr) expect(classifyLanguage(`dent 16, ${term}`, 'fr'), `${code}: ${term}`).not.toBe('noise');
      for (const term of terms.en) expect(classifyLanguage(`tooth 16, ${term}`, 'en'), `${code}: ${term}`).not.toBe('noise');
    }
  });
});
