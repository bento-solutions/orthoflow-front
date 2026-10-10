import type { TranslateService } from '@ngx-translate/core';
import { FindingKind } from '../models/clinical-record.model';

/**
 * What the tooth panel offers. A curated subset of the backend's
 * FindingCatalog, which has more codes than a dentist picks from by hand
 * (the rest come from dictation). Every code here must exist there: the
 * spec checks it against the voice lexicon.
 */
export interface FindingOption {
  readonly code: string;
  readonly kind: FindingKind;
  /** Whether the finding is about a part of the tooth, so the surface picker is shown. */
  readonly surfaces: boolean;
}

const o = (code: string, kind: FindingKind, surfaces: boolean): FindingOption => ({ code, kind, surfaces });

export const FINDING_OPTIONS: readonly FindingOption[] = [
  // Condition
  o('caries', 'CONDITION', true),
  o('recurrent_caries', 'CONDITION', true),
  o('deep_caries', 'CONDITION', true),
  o('fracture', 'CONDITION', true),
  o('tooth_wear', 'CONDITION', true),
  o('discoloration', 'CONDITION', true),
  o('crown_defective', 'CONDITION', false),
  o('mobility', 'CONDITION', false),
  o('sensitivity', 'CONDITION', false),
  o('pulpitis', 'CONDITION', false),
  o('abscess', 'CONDITION', false),
  o('periapical_lesion', 'CONDITION', false),
  o('retained_root', 'CONDITION', false),
  o('impacted', 'CONDITION', false),
  o('missing', 'CONDITION', false),
  o('extracted', 'CONDITION', false),
  // Work already in the mouth
  o('existing_composite', 'EXISTING', true),
  o('existing_amalgam', 'EXISTING', true),
  o('existing_inlay', 'EXISTING', true),
  o('existing_sealant', 'EXISTING', true),
  o('existing_crown', 'EXISTING', false),
  o('existing_bridge', 'EXISTING', false),
  o('existing_veneer', 'EXISTING', false),
  o('existing_root_canal', 'EXISTING', false),
  o('existing_post', 'EXISTING', false),
  o('existing_implant', 'EXISTING', false),
  o('existing_deciduous', 'EXISTING', false),
  // Work still to do
  o('filling_required', 'TREATMENT_REQUIRED', true),
  o('sealant_required', 'TREATMENT_REQUIRED', true),
  o('restoration_required', 'TREATMENT_REQUIRED', true),
  o('crown_required', 'TREATMENT_REQUIRED', false),
  o('crown_replacement_required', 'TREATMENT_REQUIRED', false),
  o('root_canal_required', 'TREATMENT_REQUIRED', false),
  o('extraction_required', 'TREATMENT_REQUIRED', false),
  o('implant_required', 'TREATMENT_REQUIRED', false),
  o('bridge_required', 'TREATMENT_REQUIRED', false),
  o('veneer_required', 'TREATMENT_REQUIRED', false),
  // Watch
  o('monitor', 'OBSERVATION', false),
  o('follow_up', 'OBSERVATION', false),
];

export const FINDING_KIND_ORDER: readonly FindingKind[] =
  ['CONDITION', 'EXISTING', 'TREATMENT_REQUIRED', 'OBSERVATION'];

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
