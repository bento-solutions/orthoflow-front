/**
 * The periodontal chart, as the clinician works on it. Every measurement is a number of
 * millimetres (or a grade) at one of six sites of a tooth, so the working copy is dense:
 * all 32 teeth exist, every site has a value or null. The wire format is sparse (see
 * perio-data.ts); only what was charted is stored.
 */

/** Three sites on the cheek side of a tooth, three on the tongue/palate side. */
export const PROBING_SITES = [
  'mesiobuccal', 'buccal', 'distobuccal', 'mesiolingual', 'lingual', 'distolingual',
] as const;
export type ProbingSite = (typeof PROBING_SITES)[number];

/** Where a furcation can be probed: the cheek, the tongue (lower molars), the two palatal roots (upper molars). */
export const FURCATION_SITES = ['buccal', 'lingual', 'palatal_mesial', 'palatal_distal'] as const;
export type FurcationSite = (typeof FURCATION_SITES)[number];

export type FurcationGrade = 'I' | 'II' | 'III';
export const FURCATION_GRADES: readonly FurcationGrade[] = ['I', 'II', 'III'];

export type ToothStatus = 'present' | 'missing' | 'pontic' | 'implant';
export const TOOTH_STATUSES: readonly ToothStatus[] = ['present', 'missing', 'pontic', 'implant'];
export type AbsentStatus = Exclude<ToothStatus, 'present'>;

export type PerioMode =
  | 'pocketDepth' | 'recession' | 'bleeding' | 'plaque' | 'suppuration' | 'mobility' | 'furcation';
export const PERIO_MODES: readonly PerioMode[] = [
  'pocketDepth', 'recession', 'bleeding', 'plaque', 'suppuration', 'mobility', 'furcation',
];
export const BOOLEAN_MODES = ['bleeding', 'plaque', 'suppuration'] as const;
export type BooleanMode = (typeof BOOLEAN_MODES)[number];
export const isBooleanMode = (mode: PerioMode): mode is BooleanMode =>
  (BOOLEAN_MODES as readonly string[]).includes(mode);

export type Arch = 'upper' | 'lower';
/** The face of a tooth: the cheek/lip side, or the tongue (lower) / palate (upper) side. */
export type Face = 'buccal' | 'lingual';

export type CellSite = ProbingSite | FurcationSite;
export interface PerioCell {
  readonly tooth: string;
  readonly site: CellSite;
}

/** Limits of the examination, shared with the server's validation. */
export const MAX_POCKET_DEPTH = 16;
export const MIN_RECESSION = -10;
export const MAX_RECESSION = 16;
export const MAX_MOBILITY = 3;

export interface PerioTooth {
  readonly mobility: number | null;
  readonly furcation: Readonly<Partial<Record<FurcationSite, FurcationGrade>>>;
  readonly pocketDepth: Readonly<Record<ProbingSite, number | null>>;
  readonly recession: Readonly<Record<ProbingSite, number | null>>;
  readonly bleeding: Readonly<Record<ProbingSite, boolean>>;
  readonly plaque: Readonly<Record<ProbingSite, boolean>>;
  readonly suppuration: Readonly<Record<ProbingSite, boolean>>;
}
export type PerioData = Readonly<Record<string, PerioTooth>>;
/** Teeth that are not simply present. Absent = present. */
export type ToothStatusMap = Readonly<Record<string, AbsentStatus>>;

/** What a value looks like for each mode. */
export type ModeValue = number | boolean | FurcationGrade | null;

/** The wire format: sparse, only what was charted. */
export interface ApiTooth {
  mobility?: number | null;
  furcation?: Partial<Record<FurcationSite, FurcationGrade>>;
  pocketDepth?: Partial<Record<ProbingSite, number>>;
  recession?: Partial<Record<ProbingSite, number>>;
  bleeding?: ProbingSite[];
  plaque?: ProbingSite[];
  suppuration?: ProbingSite[];
}
export type ApiTeeth = Record<string, ApiTooth>;

export interface PerioSummary {
  sitesRecorded: number;
  bleedingPercent: number;
  plaquePercent: number;
  suppurationPercent: number;
  meanPocketDepth: number | null;
  pocketsAboveFourPercent: number | null;
  deepestPocketDepth: number | null;
  meanRecession: number | null;
  meanCal: number | null;
  sitesAboveFiveCalPercent: number | null;
}

export interface PerioChartListItem {
  id: string;
  chartDate: string;
  visitReason?: string | null;
  version: number;
  updatedAt: string;
  deletedAt?: string | null;
  summary: PerioSummary;
}

export interface PerioChartDto {
  id: string;
  patientId: string;
  chartDate: string;
  visitReason?: string | null;
  clinicalNotes?: string | null;
  toothStatus: Record<string, AbsentStatus>;
  teeth: ApiTeeth;
  version: number;
  createdAt: string;
  updatedAt: string;
  summary: PerioSummary;
}

export interface SavePerioChartRequest {
  expectedVersion: number;
  chartDate?: string;
  visitReason?: string | null;
  clinicalNotes?: string | null;
  toothStatus: Record<string, AbsentStatus>;
  teeth: ApiTeeth;
}

export interface CreatePerioChartRequest {
  chartDate?: string;
  visitReason?: string | null;
}
