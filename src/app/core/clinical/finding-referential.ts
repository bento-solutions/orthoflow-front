/* =========================================================================
   The states of the clinical referential, as the charts need them
   =========================================================================

   Where a state is drawn (3D paint rules), what the gum and the teeth's deposits show for it,
   what a measure means for it, and what the tooth panel offers. The codes are the ones of
   FindingCatalog.java (server) and clinical-lexicon-referential.ts (voice): all three move together.
   ========================================================================= */

import type { FindingKind } from '../models/clinical-record.model';
import type { ToothStatus } from '../models/patient.model';

/** The groups of the referential, in the order the tooth panel lists them. */
export const FINDING_GROUPS = [
  'development', 'structure', 'restoration', 'endo', 'perio', 'position', 'trauma', 'plan', 'observation',
] as const;
export type FindingGroup = (typeof FINDING_GROUPS)[number];

export type ReferentialOption = { code: string; kind: FindingKind; surfaces: boolean; group: FindingGroup };
const o = (code: string, kind: FindingKind, surfaces: boolean, group: FindingGroup): ReferentialOption =>
  ({ code, kind, surfaces, group });

/** The states the referential added to the panel's list (the base list is in finding-options.ts). */
export const REFERENTIAL_OPTIONS: readonly ReferentialOption[] = [
  o('agenesis', 'CONDITION', false, 'development'),
  o('partially_erupted', 'CONDITION', false, 'development'),
  o('unerupted', 'CONDITION', false, 'development'),
  o('erupting', 'CONDITION', false, 'development'),
  o('persistent_deciduous', 'CONDITION', false, 'development'),
  o('supernumerary', 'CONDITION', false, 'development'),
  o('permanent_tooth', 'OBSERVATION', false, 'development'),
  o('ectopic_eruption', 'CONDITION', false, 'development'),
  o('white_spot_lesion', 'CONDITION', true, 'structure'),
  o('demineralisation', 'CONDITION', true, 'structure'),
  o('cracked_tooth', 'CONDITION', true, 'structure'),
  o('craze_lines', 'CONDITION', true, 'structure'),
  o('cusp_fracture', 'CONDITION', true, 'structure'),
  o('enamel_dentin_fracture', 'CONDITION', true, 'trauma'),
  o('complicated_crown_fracture', 'CONDITION', true, 'trauma'),
  o('crown_root_fracture', 'CONDITION', true, 'trauma'),
  o('crown_fracture', 'CONDITION', true, 'structure'),
  o('root_fracture', 'CONDITION', false, 'endo'),
  o('attrition', 'CONDITION', true, 'structure'),
  o('abrasion', 'CONDITION', true, 'structure'),
  o('erosion', 'CONDITION', true, 'structure'),
  o('non_carious_cervical_lesion', 'CONDITION', true, 'structure'),
  o('abfraction', 'CONDITION', true, 'structure'),
  o('enamel_hypoplasia', 'CONDITION', true, 'structure'),
  o('fluorosis', 'CONDITION', true, 'structure'),
  o('post_trauma_pulpal_discoloration', 'CONDITION', true, 'trauma'),
  o('pulp_exposure', 'CONDITION', true, 'structure'),
  o('existing_glass_ionomer', 'EXISTING', true, 'restoration'),
  o('existing_temporary_filling', 'EXISTING', true, 'restoration'),
  o('existing_overlay', 'EXISTING', false, 'restoration'),
  o('existing_onlay', 'EXISTING', true, 'restoration'),
  o('bridge_abutment', 'EXISTING', false, 'restoration'),
  o('bridge_pontic', 'EXISTING', false, 'restoration'),
  o('implant_crown', 'EXISTING', false, 'restoration'),
  o('temporary_crown', 'EXISTING', false, 'restoration'),
  o('post_and_crown', 'EXISTING', false, 'restoration'),
  o('defective_restoration', 'CONDITION', true, 'restoration'),
  o('fractured_restoration', 'CONDITION', true, 'restoration'),
  o('lost_restoration', 'CONDITION', true, 'restoration'),
  o('marginal_defect', 'CONDITION', true, 'restoration'),
  o('restoration_overhang', 'CONDITION', true, 'restoration'),
  o('normal_pulp', 'OBSERVATION', false, 'endo'),
  o('reversible_pulpitis', 'CONDITION', false, 'endo'),
  o('irreversible_pulpitis_symptomatic', 'CONDITION', false, 'endo'),
  o('irreversible_pulpitis_asymptomatic', 'CONDITION', false, 'endo'),
  o('endo_treatment_started', 'CONDITION', false, 'endo'),
  o('pulp_calcification', 'CONDITION', false, 'endo'),
  o('pulp_stone', 'CONDITION', false, 'endo'),
  o('internal_resorption', 'CONDITION', false, 'endo'),
  o('external_resorption', 'CONDITION', false, 'endo'),
  o('root_resorption', 'CONDITION', false, 'endo'),
  o('canal_obstruction', 'CONDITION', false, 'endo'),
  o('incomplete_root_filling', 'CONDITION', false, 'endo'),
  o('retreatment_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('perforation', 'CONDITION', false, 'endo'),
  o('separated_instrument', 'CONDITION', false, 'endo'),
  o('apical_periodontitis', 'CONDITION', false, 'endo'),
  o('periapical_abscess', 'CONDITION', false, 'endo'),
  o('open_apex', 'CONDITION', false, 'endo'),
  o('hypercementosis', 'CONDITION', false, 'endo'),
  o('healthy_gingiva', 'OBSERVATION', false, 'perio'),
  o('gingivitis', 'CONDITION', false, 'perio'),
  o('gingival_bleeding', 'CONDITION', false, 'perio'),
  o('bleeding_on_probing', 'CONDITION', false, 'perio'),
  o('gingival_enlargement', 'CONDITION', false, 'perio'),
  o('gingival_hyperplasia', 'CONDITION', false, 'perio'),
  o('clinical_attachment_loss', 'CONDITION', false, 'perio'),
  o('periodontitis', 'CONDITION', false, 'perio'),
  o('gingival_abscess', 'CONDITION', false, 'perio'),
  o('periodontal_abscess', 'CONDITION', false, 'perio'),
  o('gingival_ulceration', 'CONDITION', false, 'perio'),
  o('gingival_lesion', 'CONDITION', false, 'perio'),
  o('gingival_pigmentation', 'CONDITION', false, 'perio'),
  o('furcation_involvement', 'CONDITION', false, 'perio'),
  o('suppuration', 'CONDITION', false, 'perio'),
  o('mucogingival_anomaly', 'CONDITION', false, 'perio'),
  o('peri_implant_mucositis', 'CONDITION', false, 'perio'),
  o('peri_implantitis', 'CONDITION', false, 'perio'),
  o('calculus', 'CONDITION', true, 'perio'),
  o('plaque', 'CONDITION', true, 'perio'),
  o('crowding', 'CONDITION', false, 'position'),
  o('spacing', 'CONDITION', false, 'position'),
  o('rotation', 'CONDITION', false, 'position'),
  o('tilting', 'CONDITION', false, 'position'),
  o('buccal_displacement', 'CONDITION', false, 'position'),
  o('lingual_displacement', 'CONDITION', false, 'position'),
  o('displacement', 'CONDITION', false, 'position'),
  o('intrusion', 'CONDITION', false, 'position'),
  o('extrusion', 'CONDITION', false, 'position'),
  o('mesial_migration', 'CONDITION', false, 'position'),
  o('distal_migration', 'CONDITION', false, 'position'),
  o('crossbite', 'CONDITION', false, 'position'),
  o('open_bite', 'CONDITION', false, 'position'),
  o('deep_bite', 'CONDITION', false, 'position'),
  o('traumatic_occlusion', 'CONDITION', false, 'position'),
  o('occlusal_interference', 'CONDITION', false, 'position'),
  o('tooth_migration', 'CONDITION', false, 'position'),
  o('concussion', 'CONDITION', false, 'trauma'),
  o('subluxation', 'CONDITION', false, 'trauma'),
  o('lateral_luxation', 'CONDITION', false, 'trauma'),
  o('extrusive_luxation', 'CONDITION', false, 'trauma'),
  o('intrusive_luxation', 'CONDITION', false, 'trauma'),
  o('enamel_fracture', 'CONDITION', true, 'trauma'),
  o('soft_tissue_trauma', 'CONDITION', false, 'trauma'),
  o('ankylosis', 'CONDITION', false, 'trauma'),
  o('percussion_sensitivity', 'CONDITION', false, 'trauma'),
];

/** What a part of a tooth shows for a state, in tooth-paint.ts' own terms. */
export type ReferentialRule = {
  family: 'existing' | 'condition' | 'planned';
  pattern: 'solid' | 'hatch' | 'endo' | 'dotted' | 'stipple' | 'bars' | 'jag' | 'cross' | 'owed';
  /** Part names, or 'CROWN' / 'WHOLE'. */
  where: readonly string[] | 'CROWN' | 'WHOLE';
  bySurface: boolean;
};
const rule = (family: ReferentialRule['family'], pattern: ReferentialRule['pattern'], where: ReferentialRule['where'], bySurface: boolean): ReferentialRule =>
  ({ family, pattern, where, bySurface });

export const REFERENTIAL_RULES: Readonly<Record<string, ReferentialRule>> = {
  unerupted: rule('condition', 'bars', 'WHOLE', false),
  white_spot_lesion: rule('condition', 'stipple', 'CROWN', true),
  demineralisation: rule('condition', 'stipple', 'CROWN', true),
  cracked_tooth: rule('condition', 'jag', 'CROWN', true),
  cusp_fracture: rule('condition', 'jag', 'CROWN', true),
  enamel_dentin_fracture: rule('condition', 'jag', 'CROWN', true),
  complicated_crown_fracture: rule('condition', 'jag', 'CROWN', true),
  crown_root_fracture: rule('condition', 'jag', 'WHOLE', true),
  crown_fracture: rule('condition', 'jag', 'CROWN', true),
  root_fracture: rule('condition', 'jag', ['root'], false),
  attrition: rule('condition', 'bars', ['occlusal'], true),
  abrasion: rule('condition', 'bars', ['cervical', 'buccal'], true),
  erosion: rule('condition', 'bars', 'CROWN', true),
  non_carious_cervical_lesion: rule('condition', 'bars', ['cervical'], true),
  abfraction: rule('condition', 'bars', ['cervical'], true),
  enamel_hypoplasia: rule('condition', 'stipple', 'CROWN', true),
  fluorosis: rule('condition', 'stipple', 'CROWN', true),
  post_trauma_pulpal_discoloration: rule('condition', 'stipple', 'CROWN', true),
  pulp_exposure: rule('condition', 'stipple', 'CROWN', true),
  existing_glass_ionomer: rule('existing', 'solid', 'CROWN', true),
  existing_temporary_filling: rule('existing', 'solid', 'CROWN', true),
  existing_overlay: rule('existing', 'hatch', ['occlusal', 'mesial', 'distal', 'buccal', 'lingual'], false),
  existing_onlay: rule('existing', 'solid', ['occlusal'], true),
  bridge_abutment: rule('existing', 'hatch', 'CROWN', false),
  bridge_pontic: rule('existing', 'hatch', 'CROWN', false),
  implant_crown: rule('existing', 'hatch', 'CROWN', false),
  temporary_crown: rule('existing', 'hatch', 'CROWN', false),
  post_and_crown: rule('existing', 'hatch', 'CROWN', false),
  defective_restoration: rule('condition', 'hatch', 'CROWN', true),
  fractured_restoration: rule('condition', 'jag', 'CROWN', true),
  lost_restoration: rule('condition', 'stipple', 'CROWN', true),
  marginal_defect: rule('condition', 'stipple', 'CROWN', true),
  restoration_overhang: rule('condition', 'bars', ['mesial', 'distal'], true),
  endo_treatment_started: rule('condition', 'endo', ['root'], false),
  internal_resorption: rule('condition', 'stipple', ['root'], false),
  external_resorption: rule('condition', 'stipple', ['root'], false),
  root_resorption: rule('condition', 'stipple', ['root'], false),
  canal_obstruction: rule('condition', 'bars', ['root'], false),
  incomplete_root_filling: rule('condition', 'endo', ['root'], false),
  retreatment_required: rule('planned', 'owed', ['root'], false),
  perforation: rule('condition', 'jag', ['root'], false),
  separated_instrument: rule('condition', 'jag', ['root'], false),
  gingivitis: rule('condition', 'stipple', ['cervical'], false),
  gingival_bleeding: rule('condition', 'stipple', ['cervical'], false),
  bleeding_on_probing: rule('condition', 'stipple', ['cervical'], false),
  gingival_enlargement: rule('condition', 'stipple', ['cervical'], false),
  gingival_hyperplasia: rule('condition', 'stipple', ['cervical'], false),
  clinical_attachment_loss: rule('condition', 'stipple', ['cervical'], false),
  periodontitis: rule('condition', 'stipple', ['cervical'], false),
  gingival_abscess: rule('condition', 'stipple', ['cervical'], false),
  periodontal_abscess: rule('condition', 'stipple', ['cervical'], false),
  gingival_ulceration: rule('condition', 'stipple', ['cervical'], false),
  gingival_lesion: rule('condition', 'stipple', ['cervical'], false),
  furcation_involvement: rule('condition', 'stipple', ['root'], false),
  suppuration: rule('condition', 'stipple', ['cervical'], false),
  peri_implant_mucositis: rule('condition', 'stipple', ['cervical'], false),
  peri_implantitis: rule('condition', 'stipple', ['cervical'], false),
  enamel_fracture: rule('condition', 'jag', 'CROWN', true),
};

/** A mark at the root's tip, like an abscess. */
export const REFERENTIAL_LESIONS: readonly string[] = ['reversible_pulpitis', 'irreversible_pulpitis_symptomatic', 'irreversible_pulpitis_asymptomatic', 'apical_periodontitis', 'periapical_abscess'];
/** The tooth is not in the mouth. */
export const REFERENTIAL_ABSENT: readonly string[] = ['agenesis'];
/** States that also put threads on the root (a crown on an implant) or a post in it. */
export const IMPLANT_THREAD_CODES: readonly string[] = ['implant_crown'];
export const ROOT_POST_CODES: readonly string[] = ['post_and_crown'];

/** Conditions that imply no single status, so the 2D chart's fill cannot show them: it marks them on the tooth instead. */
export const REFERENTIAL_UNPAINTED_CONDITIONS: readonly string[] = ['partially_erupted', 'erupting', 'persistent_deciduous', 'supernumerary', 'ectopic_eruption', 'white_spot_lesion', 'demineralisation', 'craze_lines', 'attrition', 'abrasion', 'erosion', 'non_carious_cervical_lesion', 'abfraction', 'enamel_hypoplasia', 'fluorosis', 'post_trauma_pulpal_discoloration', 'pulp_exposure', 'defective_restoration', 'fractured_restoration', 'lost_restoration', 'marginal_defect', 'restoration_overhang', 'reversible_pulpitis', 'irreversible_pulpitis_symptomatic', 'irreversible_pulpitis_asymptomatic', 'endo_treatment_started', 'pulp_calcification', 'pulp_stone', 'internal_resorption', 'external_resorption', 'root_resorption', 'canal_obstruction', 'incomplete_root_filling', 'perforation', 'separated_instrument', 'apical_periodontitis', 'periapical_abscess', 'open_apex', 'hypercementosis', 'gingivitis', 'gingival_bleeding', 'bleeding_on_probing', 'gingival_enlargement', 'gingival_hyperplasia', 'clinical_attachment_loss', 'periodontitis', 'gingival_abscess', 'periodontal_abscess', 'gingival_ulceration', 'gingival_lesion', 'gingival_pigmentation', 'furcation_involvement', 'suppuration', 'mucogingival_anomaly', 'peri_implant_mucositis', 'peri_implantitis', 'calculus', 'plaque', 'crowding', 'spacing', 'rotation', 'tilting', 'buccal_displacement', 'lingual_displacement', 'displacement', 'intrusion', 'extrusion', 'mesial_migration', 'distal_migration', 'crossbite', 'open_bite', 'deep_bite', 'traumatic_occlusion', 'occlusal_interference', 'tooth_migration', 'concussion', 'subluxation', 'lateral_luxation', 'extrusive_luxation', 'intrusive_luxation', 'soft_tissue_trauma', 'ankylosis', 'percussion_sensitivity'];

/** What each gum state does to the gum (0 to 1; flags are 1). Read by the 3D mouth. */
export interface GumEffect {
  inflamed?: number; swollen?: number; recession?: number; pocket?: number; perio?: number;
  bleeding?: number; pus?: number; ulcer?: number; pigment?: number; abscess?: number; lesion?: number; pale?: number;
}
export const GUM_EFFECTS: Readonly<Record<string, GumEffect>> = {
  healthy_gingiva: {},
  gingivitis: {inflamed:0.75,swollen:0.4},
  gingival_bleeding: {inflamed:0.5,bleeding:1},
  bleeding_on_probing: {inflamed:0.35,bleeding:1},
  gingival_enlargement: {swollen:0.8,inflamed:0.25},
  gingival_hyperplasia: {swollen:1,inflamed:0.2},
  clinical_attachment_loss: {recession:0.6,pocket:0.3},
  periodontitis: {perio:1,recession:0.5,inflamed:0.5,swollen:0.15},
  gingival_abscess: {abscess:1,inflamed:0.6,swollen:0.5,pus:1},
  periodontal_abscess: {abscess:1,inflamed:0.6,swollen:0.6,pus:1,pocket:0.5},
  gingival_ulceration: {ulcer:1,inflamed:0.3},
  gingival_lesion: {lesion:1},
  gingival_pigmentation: {pigment:1},
  furcation_involvement: {pocket:1},
  suppuration: {pus:1,inflamed:0.4},
  mucogingival_anomaly: {pale:1,recession:0.2},
  peri_implant_mucositis: {inflamed:0.6,swollen:0.3},
  peri_implantitis: {perio:0.8,recession:0.4,inflamed:0.6},
  gingival_inflammation: {inflamed:0.6,swollen:0.3},
  periodontal_pocket: {inflamed:0.45,pocket:1},
  gingival_recession: {recession:0.5},
  soft_tissue_trauma: {lesion:1},
};

/** What a state leaves on the tooth: tartar is a crust at the neck, plaque a film. */
export type Deposit = 'calculus' | 'plaque' | 'both';
export const DEPOSITS: Readonly<Record<string, Deposit>> = {
  calculus: 'calculus',
  plaque: 'plaque',
  plaque_calculus: 'both',
};

/** States about the roots: a root of a back tooth can be named ("racine mésiale"). */
export const ROOT_CODES: ReadonlySet<string> = new Set(['root_fracture', 'endo_treatment_started', 'internal_resorption', 'external_resorption', 'root_resorption', 'canal_obstruction', 'incomplete_root_filling', 'retreatment_required', 'perforation', 'separated_instrument', 'apical_periodontitis', 'periapical_abscess', 'open_apex', 'hypercementosis', 'furcation_involvement', 'existing_root_canal', 'existing_post', 'periapical_lesion', 'abscess', 'necrosis', 'retained_root']);

/** What a number said with the state means: millimetres or a grade. */
export type MeasureKind = 'mm' | 'grade';
export const MEASURES: Readonly<Record<string, MeasureKind>> = {
  gingival_recession: 'mm',
  periodontal_pocket: 'mm',
  mobility: 'grade',
  clinical_attachment_loss: 'mm',
  furcation_involvement: 'grade',
};

/** The legacy single status each new state implies (server FindingCatalog). */
export const REFERENTIAL_IMPLIED_STATUS: Readonly<Record<string, ToothStatus>> = {
  agenesis: 'missing',
  unerupted: 'impacted',
  cracked_tooth: 'fracture',
  cusp_fracture: 'fracture',
  enamel_dentin_fracture: 'fracture',
  complicated_crown_fracture: 'fracture',
  crown_root_fracture: 'fracture',
  crown_fracture: 'fracture',
  root_fracture: 'fracture',
  existing_glass_ionomer: 'composite',
  existing_temporary_filling: 'composite',
  existing_overlay: 'composite',
  existing_onlay: 'composite',
  bridge_abutment: 'bridge',
  bridge_pontic: 'bridge',
  implant_crown: 'implant',
  temporary_crown: 'crown',
  post_and_crown: 'crown',
  enamel_fracture: 'fracture',
};
