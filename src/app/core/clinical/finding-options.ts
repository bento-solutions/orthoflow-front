import type { TranslateService } from '@ngx-translate/core';
import { FindingKind } from '../models/clinical-record.model';
import { FINDING_GROUPS, FindingGroup, REFERENTIAL_OPTIONS, ROOT_CODES } from './finding-referential';

/**
 * What the tooth panel offers: every state of the chart, in the groups of the clinical referential
 * ("Référentiel des états cliniques dentaires"). Every code here must exist in the backend's
 * FindingCatalog and in the voice lexicon: the spec checks it against the lexicon.
 */
export interface FindingOption {
  readonly code: string;
  readonly kind: FindingKind;
  /** Whether the finding is about a part of the tooth, so the surface picker is shown. */
  readonly surfaces: boolean;
  /** The part of the referential it is listed under. */
  readonly group: FindingGroup;
  /** Whether it can be about one root of a back tooth, so the root picker is shown. */
  readonly roots: boolean;
}

const o = (code: string, kind: FindingKind, surfaces: boolean, group: FindingGroup): FindingOption =>
  ({ code, kind, surfaces, group, roots: ROOT_CODES.has(code) });

/** The states the panel offered before the referential, now sorted into its groups. */
const BASE_OPTIONS: readonly FindingOption[] = [
  // Development
  o('missing', 'CONDITION', false, 'development'),
  o('extracted', 'CONDITION', false, 'development'),
  o('impacted', 'CONDITION', false, 'development'),
  o('retained_root', 'CONDITION', false, 'development'),
  o('existing_deciduous', 'EXISTING', false, 'development'),
  o('avulsion', 'CONDITION', false, 'trauma'),
  // Structure
  o('caries', 'CONDITION', true, 'structure'),
  o('recurrent_caries', 'CONDITION', true, 'structure'),
  o('deep_caries', 'CONDITION', true, 'structure'),
  o('cavity', 'CONDITION', true, 'structure'),
  o('fracture', 'CONDITION', true, 'structure'),
  o('extensive_destruction', 'CONDITION', false, 'structure'),
  o('tooth_wear', 'CONDITION', true, 'structure'),
  o('discoloration', 'CONDITION', true, 'structure'),
  o('mobility', 'CONDITION', false, 'structure'),
  o('sensitivity', 'CONDITION', false, 'structure'),
  o('pain', 'CONDITION', false, 'structure'),
  o('swelling', 'CONDITION', false, 'structure'),
  // Restorations
  o('existing_composite', 'EXISTING', true, 'restoration'),
  o('existing_amalgam', 'EXISTING', true, 'restoration'),
  o('existing_filling', 'EXISTING', true, 'restoration'),
  o('existing_inlay', 'EXISTING', true, 'restoration'),
  o('existing_sealant', 'EXISTING', true, 'restoration'),
  o('existing_crown', 'EXISTING', false, 'restoration'),
  o('existing_bridge', 'EXISTING', false, 'restoration'),
  o('existing_veneer', 'EXISTING', false, 'restoration'),
  o('existing_post', 'EXISTING', false, 'restoration'),
  o('existing_implant', 'EXISTING', false, 'restoration'),
  o('crown_defective', 'CONDITION', false, 'restoration'),
  // Pulp and endodontics
  o('pulpitis', 'CONDITION', false, 'endo'),
  o('necrosis', 'CONDITION', false, 'endo'),
  o('abscess', 'CONDITION', false, 'endo'),
  o('infection', 'CONDITION', false, 'endo'),
  o('periapical_lesion', 'CONDITION', false, 'endo'),
  o('existing_root_canal', 'EXISTING', false, 'endo'),
  // Gum and periodontium
  o('gingival_inflammation', 'CONDITION', false, 'perio'),
  o('gingival_recession', 'CONDITION', true, 'perio'),
  o('periodontal_pocket', 'CONDITION', true, 'perio'),
  o('plaque_calculus', 'CONDITION', true, 'perio'),
  o('bleeding', 'CONDITION', false, 'perio'),
  // Position
  o('malposition', 'CONDITION', false, 'position'),
  // Work still to do
  o('filling_required', 'TREATMENT_REQUIRED', true, 'plan'),
  o('sealant_required', 'TREATMENT_REQUIRED', true, 'plan'),
  o('restoration_required', 'TREATMENT_REQUIRED', true, 'plan'),
  o('crown_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('crown_replacement_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('root_canal_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('extraction_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('implant_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('bridge_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('veneer_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('scaling_required', 'TREATMENT_REQUIRED', false, 'plan'),
  o('periodontal_treatment_required', 'TREATMENT_REQUIRED', false, 'plan'),
  // Watch
  o('normal', 'OBSERVATION', false, 'observation'),
  o('monitor', 'OBSERVATION', false, 'observation'),
  o('follow_up', 'OBSERVATION', false, 'observation'),
];

/** Every state the panel offers, listed by group in the referential's order, and by kind within one. */
export const FINDING_OPTIONS: readonly FindingOption[] = [
  ...BASE_OPTIONS,
  ...REFERENTIAL_OPTIONS.map((option) => o(option.code, option.kind, option.surfaces, option.group)),
].sort((a, b) => FINDING_GROUPS.indexOf(a.group) - FINDING_GROUPS.indexOf(b.group));

export const FINDING_KIND_ORDER: readonly FindingKind[] =
  ['CONDITION', 'EXISTING', 'TREATMENT_REQUIRED', 'OBSERVATION'];

/** The groups that have something to offer, in the order of the referential. */
export function findingGroupsInUse(): readonly FindingGroup[] {
  return FINDING_GROUPS.filter((group) => FINDING_OPTIONS.some((option) => option.group === group));
}

const BY_CODE = new Map(FINDING_OPTIONS.map((f) => [f.code, f]));

export function findingOption(code: string): FindingOption | undefined {
  return BY_CODE.get(code);
}

/** ngx-translate key of a finding code. Codes outside FINDING_OPTIONS fall back to their own words. */
export function findingLabelKey(code: string): string {
  return `FINDING.${code.toUpperCase()}`;
}

/** The words for a finding code in the language in use, or a readable form of the code itself. */
export function findingLabel(translate: TranslateService, code: string): string {
  const key = findingLabelKey(code);
  const text = translate.instant(key);
  return text === key ? findingFallbackLabel(code) : text;
}

/** Readable fallback for a code that has no translation: "recurrent_caries" → "Recurrent caries". */
export function findingFallbackLabel(code: string): string {
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
