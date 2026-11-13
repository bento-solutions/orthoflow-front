import { describe, expect, it } from 'vitest';
import { allFindingCodes, extractFindings } from './clinical-lexicon';
import { resolveWithGrammar } from './voice-grammar';
import { VoiceContextSnapshot } from './voice-intent.model';

/**
 * "Référentiel des états cliniques dentaires": every state of its catalogue, in its own words,
 * must be a state of the chart that a dentist can dictate. This is the catalogue, section by
 * section, with the state each line is recorded as.
 */
const CATALOGUE: ReadonlyArray<readonly [section: string, items: ReadonlyArray<readonly [said: string, code: string]>]> = [
  ['1. Présence, absence et développement dentaire', [
    // "Présente / saine" is one state, said "saine" or "présente et saine": "présente" alone is also the verb of "présente une carie".
    ['Présente et saine', 'normal'],
    ['Saine', 'normal'],
    ['Absente', 'missing'],
    ['Extraite', 'extracted'],
    ['Agénésie dentaire (absence congénitale)', 'agenesis'],
    ['Incluse', 'impacted'],
    ['Partiellement éruptée', 'partially_erupted'],
    ['Non éruptée', 'unerupted'],
    ['En cours d\'éruption', 'erupting'],
    ['Dent temporaire persistante', 'persistent_deciduous'],
    ['Dent surnuméraire', 'supernumerary'],
    ['Racine résiduelle / reliquat radiculaire', 'retained_root'],
    ['Dent temporaire (déciduale)', 'existing_deciduous'],
    ['Dent permanente', 'permanent_tooth'],
    ['Éruption ectopique', 'ectopic_eruption'],
  ]],
  ['2. Structure dentaire et pathologies', [
    ['Caries', 'caries'],
    ['Caries récidivantes / secondaires', 'recurrent_caries'],
    ['Lésion amélaire initiale / tache blanche', 'white_spot_lesion'],
    ['Déminéralisation', 'demineralisation'],
    ['Lésion cavitaire', 'cavity'],
    ['Dent fracturée', 'fracture'],
    ['Dent fissurée', 'cracked_tooth'],
    ['Fêlures amélaires (craze lines)', 'craze_lines'],
    ['Fracture cuspidienne', 'cusp_fracture'],
    ['Fracture coronaire', 'crown_fracture'],
    ['Fracture radiculaire', 'root_fracture'],
    ['Attrition', 'attrition'],
    ['Abrasion', 'abrasion'],
    ['Érosion', 'erosion'],
    ['Abfraction / lésion cervicale', 'abfraction'],
    ['Hypoplasie de l\'émail', 'enamel_hypoplasia'],
    ['Fluorose', 'fluorosis'],
    ['Dyschromie / coloration', 'discoloration'],
    ['Usure dentaire', 'tooth_wear'],
    ['Lésion cervicale non carieuse', 'non_carious_cervical_lesion'],
    ['Mobilité dentaire', 'mobility'],
    ['Sensibilité dentaire', 'sensitivity'],
    ['Exposition pulpaire', 'pulp_exposure'],
  ]],
  ['3. Restaurations et prothèses existantes', [
    ['Restauration en composite', 'existing_composite'],
    ['Restauration en amalgame', 'existing_amalgam'],
    ['Restauration au verre ionomère', 'existing_glass_ionomer'],
    ['Obturation provisoire', 'existing_temporary_filling'],
    ['Inlay', 'existing_inlay'],
    ['Onlay', 'existing_onlay'],
    ['Overlay', 'existing_overlay'],
    ['Couronne', 'existing_crown'],
    ['Facette', 'existing_veneer'],
    ['Pilier de bridge', 'bridge_abutment'],
    ['Inter de bridge', 'bridge_pontic'],
    ['Couronne sur implant', 'implant_crown'],
    ['Implant dentaire', 'existing_implant'],
    ['Couronne provisoire', 'temporary_crown'],
    ['Tenon / reconstitution corono-radiculaire', 'existing_post'],
    ['Tenon et couronne', 'post_and_crown'],
    ['Scellement des sillons', 'existing_sealant'],
    ['Restauration défectueuse', 'defective_restoration'],
    ['Restauration fracturée', 'fractured_restoration'],
    ['Restauration absente / perdue', 'lost_restoration'],
    ['Défaut marginal', 'marginal_defect'],
    ['Débordement de restauration', 'restoration_overhang'],
  ]],
  ['4. Pulpe et endodontie', [
    ['Pulpe normale', 'normal_pulp'],
    ['Pulpite réversible', 'reversible_pulpitis'],
    ['Pulpite irréversible symptomatique', 'irreversible_pulpitis_symptomatic'],
    ['Pulpite irréversible asymptomatique', 'irreversible_pulpitis_asymptomatic'],
    ['Nécrose pulpaire', 'necrosis'],
    ['Dent déjà traitée endodontiquement', 'existing_root_canal'],
    ['Traitement endodontique commencé mais non terminé', 'endo_treatment_started'],
    ['Calcification pulpaire', 'pulp_calcification'],
    ['Calcul pulpaire', 'pulp_stone'],
    ['Résorption radiculaire interne', 'internal_resorption'],
    ['Résorption radiculaire externe', 'external_resorption'],
    ['Obstruction canalaire', 'canal_obstruction'],
    ['Obturation canalaire incomplète', 'incomplete_root_filling'],
    ['Retraitement endodontique à envisager', 'retreatment_required'],
    ['Perforation', 'perforation'],
    ['Instrument endodontique fracturé / séparé', 'separated_instrument'],
    ['Parodontite apicale', 'apical_periodontitis'],
    ['Abcès péri-apical', 'periapical_abscess'],
    ['Lésion péri-apicale / radioclarté', 'periapical_lesion'],
    ['Apex ouvert / dent immature', 'open_apex'],
    ['Fracture radiculaire', 'root_fracture'],
    ['Hypercémentose', 'hypercementosis'],
  ]],
  ['5. Gencive et parodonte', [
    ['Gencive saine', 'healthy_gingiva'],
    ['Inflammation gingivale', 'gingival_inflammation'],
    ['Gingivite', 'gingivitis'],
    ['Saignement gingival', 'gingival_bleeding'],
    ['Saignement au sondage', 'bleeding_on_probing'],
    ['Récession gingivale', 'gingival_recession'],
    ['Augmentation de volume gingival', 'gingival_enlargement'],
    ['Hyperplasie gingivale', 'gingival_hyperplasia'],
    ['Poche parodontale', 'periodontal_pocket'],
    ['Perte d\'attache clinique', 'clinical_attachment_loss'],
    ['Parodontite', 'periodontitis'],
    ['Abcès gingival', 'gingival_abscess'],
    ['Abcès parodontal', 'periodontal_abscess'],
    ['Ulcération gingivale', 'gingival_ulceration'],
    ['Lésion gingivale', 'gingival_lesion'],
    ['Pigmentation gingivale', 'gingival_pigmentation'],
    ['Atteinte de furcation', 'furcation_involvement'],
    ['Mobilité dentaire', 'mobility'],
    ['Tartre', 'calculus'],
    ['Accumulation de plaque dentaire', 'plaque'],
    ['Suppuration', 'suppuration'],
    ['Anomalie mucogingivale', 'mucogingival_anomaly'],
    ['Mucosite péri-implantaire', 'peri_implant_mucositis'],
    ['Péri-implantite', 'peri_implantitis'],
  ]],
  ['6. Position, alignement et occlusion', [
    ['Encombrement dentaire', 'crowding'],
    ['Espacement / diastème', 'spacing'],
    ['Rotation', 'rotation'],
    ['Version / inclinaison', 'tilting'],
    ['Déplacement dentaire', 'displacement'],
    ['Intrusion', 'intrusion'],
    ['Égression / extrusion', 'extrusion'],
    ['Déplacement vestibulaire', 'buccal_displacement'],
    ['Déplacement lingual / palatin', 'lingual_displacement'],
    ['Migration mésiale', 'mesial_migration'],
    ['Migration distale', 'distal_migration'],
    ['Articulé croisé', 'crossbite'],
    ['Béance', 'open_bite'],
    ['Supraclusion / occlusion profonde', 'deep_bite'],
    ['Occlusion traumatique', 'traumatic_occlusion'],
    ['Interférence occlusale', 'occlusal_interference'],
    ['Migration dentaire', 'tooth_migration'],
  ]],
  ['7. Traumatismes et autres constatations', [
    ['Contusion dentaire (concussion)', 'concussion'],
    ['Subluxation', 'subluxation'],
    ['Luxation latérale', 'lateral_luxation'],
    ['Luxation extrusive', 'extrusive_luxation'],
    ['Luxation intrusive', 'intrusive_luxation'],
    ['Avulsion', 'avulsion'],
    ['Fracture amélaire', 'enamel_fracture'],
    ['Fracture amélo-dentinaire', 'enamel_dentin_fracture'],
    ['Fracture coronaire compliquée', 'complicated_crown_fracture'],
    ['Fracture corono-radiculaire', 'crown_root_fracture'],
    ['Fracture radiculaire', 'root_fracture'],
    ['Traumatisme des tissus mous', 'soft_tissue_trauma'],
    ['Ankylose', 'ankylosis'],
    ['Dyschromie pulpaire après traumatisme', 'post_trauma_pulpal_discoloration'],
    ['Sensibilité à la percussion', 'percussion_sensitivity'],
  ]],
];

const context = (overrides: Partial<VoiceContextSnapshot> = {}): VoiceContextSnapshot => ({
  patientId: 'p-1',
  patientName: 'Test',
  dentition: 'adult',
  module: 'patient-dossier',
  route: '/patients/p-1',
  selectedFdi: null,
  sessionId: 's-1',
  locale: 'fr-MA',
  recentIntents: [],
  recentUtterances: [],
  lastWrite: null,
  ...overrides,
});

const everyItem = CATALOGUE.flatMap(([, items]) => items);

/** Lines of the document that give one adjective of two ("Caries récidivantes / secondaires"): the second takes the place of the first. */
const ADJECTIVE_ALTERNATIVES = new Set([
  'Caries récidivantes / secondaires',
  'Restauration absente / perdue',
  'Instrument endodontique fracturé / séparé',
  'Déplacement lingual / palatin',
]);

/** A catalogue line "A / B (C)" is one state said as A, as B or as C: each is dictated on its own. */
const alternatives = (line: string): string[] => {
  if (ADJECTIVE_ALTERNATIVES.has(line)) {
    const [first, second] = line.split(/\s+\/\s+/);
    const words = first.split(' ');
    return [first, [...words.slice(0, -1), second].join(' ')];
  }
  return line.split(/\s+\/\s+/).flatMap(part => {
    const withBrackets = /^(.*?)\s*\((.+)\)$/.exec(part);
    return withBrackets ? [withBrackets[1], withBrackets[2]] : [part];
  });
};

describe('the clinical referential', () => {
  it('lists every state of its catalogue', () => {
    // 14 + 23 + 22 + 22 + 24 + 17 + 15 lines of the document (one of the first is listed as two ways of saying it).
    expect(everyItem).toHaveLength(138);
  });

  for (const [section, items] of CATALOGUE) {
    describe(section, () => {
      for (const [line, code] of items) {
        for (const said of alternatives(line)) {
          it(`reads "${said}" as ${code}`, () => {
            expect(extractFindings(said).map(f => f.code)).toEqual([code]);
          });

          it(`records "dent 46 ${said.toLowerCase()}" on the tooth, as ${code}`, () => {
            const result = resolveWithGrammar(`dent 46 ${said.toLowerCase()}`, context());
            expect(result.kind).toBe('intent');
            if (result.kind !== 'intent') return;
            expect(result.intent.intent).toBe('chart.addToothFindings');
            expect(result.intent.entities['fdi']).toBe('46');
            const found = (result.intent.entities['findings'] as Array<{ code: string }>).map(f => f.code);
            expect(found).toEqual([code]);
          });
        }
      }
    });
  }

  it('leaves no state of the chart unspoken', () => {
    const said = new Set(everyItem.map(([, code]) => code));
    // States the referential implies without listing, so that "résorption" alone, "plaque et tartre"
    // together, a bare "pulpite" or an "extraction" are still understood; the rest of the legacy codes.
    const alsoSpoken = new Set([
      'root_resorption', 'plaque_calculus', 'pulpitis', 'extraction_required', 'infection', 'abscess', 'pain', 'swelling', 'bleeding',
      'malposition', 'deep_caries', 'extensive_destruction', 'crown_defective', 'cavity', 'note', 'monitor', 'follow_up',
      'existing_filling', 'existing_bridge', 'existing_implant', 'crown_required', 'crown_replacement_required', 'filling_required',
      'root_canal_required', 'implant_required', 'bridge_required', 'veneer_required', 'scaling_required', 'sealant_required',
      'restoration_required', 'periodontal_treatment_required',
    ]);
    const unspoken = allFindingCodes().filter(code => !said.has(code) && !alsoSpoken.has(code));
    expect(unspoken).toEqual([]);
  });
});

describe('the sentence the referential gives as its example', () => {
  const sentence = 'La dent 46 présente une carie mésiale, un composite occlusal, une récession gingivale vestibulaire de 3 mm et un traitement endodontique antérieur.';

  it('records caries, composite, recession and the earlier root canal on tooth 46, each where it was said', () => {
    const result = resolveWithGrammar(sentence, context());
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.intent).toBe('chart.addToothFindings');
    expect(result.intent.entities['fdi']).toBe('46');
    const findings = result.intent.entities['findings'] as Array<{ code: string; surface: string | null; note?: string }>;
    const by = (code: string) => findings.find(f => f.code === code);
    expect(findings.map(f => f.code).sort()).toEqual(['caries', 'existing_composite', 'existing_root_canal', 'gingival_recession']);
    expect(by('caries')?.surface).toBe('mesial');
    expect(by('existing_composite')?.surface).toBe('occlusal');
    expect(by('gingival_recession')?.surface).toBe('buccal');
    expect(by('gingival_recession')?.note).toBe('3 mm');
    expect(by('existing_root_canal')?.surface).toBeNull();
  });
});

describe('a dictation that doubts, measures or names a root', () => {
  const record = (said: string) => {
    const result = resolveWithGrammar(said, context());
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') throw new Error(said);
    return result.intent.entities['findings'] as Array<{ code: string; surface: string | null; note?: string; certainty?: string; severity: string | null }>;
  };

  it('keeps a suspicion suspected', () => {
    const [caries] = record('dent 16 suspicion de carie mésiale');
    expect(caries).toMatchObject({ code: 'caries', surface: 'mesial', certainty: 'SUSPECTED' });
  });

  it('keeps what is certain beside what is not', () => {
    const findings = record('dent 26 fracture et nécrose probable');
    expect(findings.find(f => f.code === 'fracture')?.certainty).toBeUndefined();
    expect(findings.find(f => f.code === 'necrosis')?.certainty).toBe('SUSPECTED');
  });

  it('records the grade of a furcation and the root of a fracture', () => {
    expect(record('dent 36 atteinte de furcation grade 2')[0]).toMatchObject({ code: 'furcation_involvement', severity: 'MODERATE', note: 'grade II' });
    expect(record('dent 46 fracture radiculaire racine mésiale')[0]).toMatchObject({ code: 'root_fracture', surface: 'mesialroot' });
  });

  it('does not record a state denied by its grade', () => {
    const result = resolveWithGrammar('dent 36 mobilité grade 0', context());
    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') expect(result.intent.intent).toBe('clinical.addNote');
  });

  it('reads the same states in English', () => {
    expect(record('tooth 46 periodontal pocket of 5 mm')[0]).toMatchObject({ code: 'periodontal_pocket', note: '5 mm' });
    expect(record('tooth 16 suspected periapical lesion on the mesiobuccal root')[0]).toMatchObject({ code: 'periapical_lesion', certainty: 'SUSPECTED' });
  });

  it('reads the states in Arabic, by the names the chart gives them', () => {
    expect(extractFindings('تسوس').map(f => f.code)).toEqual(['caries']);
    expect(extractFindings('خراج').map(f => f.code)).toEqual(['abscess']);
    expect(extractFindings('التهاب دواعم السن').map(f => f.code)).toEqual(['periodontitis']);
    expect(extractFindings('كسر جذري').map(f => f.code)).toEqual(['root_fracture']);
    expect(extractFindings('عضة مفتوحة').map(f => f.code)).toEqual(['open_bite']);
  });
});

