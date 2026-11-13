/* =========================================================================
   Tooth paint: what a tooth's record looks like, part by part
   =========================================================================

   tooth-status.ts decides the vocabulary (families, colours, fill geometries).
   This file applies it to the parts of a tooth, because a 3D tooth can show
   what the one derived status cannot: a crown covers the crown and leaves the
   root alone, a root canal treatment is in the root, a caries mesial is on the
   mesial face, and work still owed sits over all of it.

   It knows nothing about three.js, so what the chart draws can be tested
   without a graphics context.

   A part takes the strongest thing recorded on it, pathology over work in
   place over work still owed, for the reason the 2D chart's surface marks do:
   the doctor scanning the chart needs the problem to show even where a
   restoration also exists.
   ========================================================================= */

import { FindingKind, ToothFinding } from '../models/clinical-record.model';
import { ToothState, ToothStatus } from '../models/patient.model';
import { FAMILY_PAINT, PLANNED_PAINT, ToothFillGeometry, ToothStatusFamily, toothStatusDefinition } from './tooth-status';
import { ToothSurface, parseSurface } from './tooth-surfaces';
import {
  DEPOSITS, GUM_EFFECTS, GumEffect, IMPLANT_THREAD_CODES, REFERENTIAL_ABSENT, REFERENTIAL_IMPLIED_STATUS, REFERENTIAL_LESIONS,
  REFERENTIAL_RULES, ROOT_POST_CODES,
} from './finding-referential';

/** The parts of a tooth the chart can colour on their own. */
export const PAINT_ZONES = ['root', 'cervical', 'occlusal', 'mesial', 'distal', 'buccal', 'lingual'] as const;
export type PaintZone = (typeof PAINT_ZONES)[number];

const CROWN: readonly PaintZone[] = ['cervical', 'occlusal', 'mesial', 'distal', 'buccal', 'lingual'];
const WHOLE: readonly PaintZone[] = ['root', ...CROWN];

/** `suspected` is what the dentist has not confirmed: drawn on the part it concerns, under everything that is. */
export type ZoneFamily = 'existing' | 'condition' | 'planned' | 'suspected';

export interface ZonePaint {
  readonly family: ZoneFamily;
  readonly pattern: ToothFillGeometry | 'owed' | 'suspect';
}

/** The faces of a tooth a deposit covers, as bits: tartar on the cheek side is `DEPOSIT_FACES.buccal`. */
export const DEPOSIT_FACES = { mesial: 1, distal: 2, buccal: 4, lingual: 8, all: 15 } as const;

/** What the gum round a tooth shows. Each effect is the strongest recorded on the tooth, 0 to 1. */
export interface GumPaint extends GumEffect {
  /** How far the gum has receded, in millimetres, when it was measured. */
  readonly recessionMm?: number;
}

/** What the assigned-treatment tracker says about a tooth, drawn as a ring on its number. */
export type TreatmentRing = 'COMPLETED' | 'ACTIVE' | 'PLANNED';

export interface ToothPaint {
  readonly fdi: string;
  readonly zones: Readonly<Partial<Record<PaintZone, ZonePaint>>>;
  /** The tooth is not in the mouth. */
  readonly absent: boolean;
  /** The crown is gone and the root remains. */
  readonly crownLost: boolean;
  /** A lesion at the root's tip: abscess, periapical lesion, necrosis. */
  readonly lesion: boolean;
  /** Recorded, but it has no place on the tooth to be painted: mobility, pain, a watch. */
  readonly flagged: boolean;
  /** Work still owed on this tooth. */
  readonly planned: boolean;
  /** Dictated during this session and not saved yet. */
  readonly staged: boolean;
  readonly treatment: TreatmentRing | null;
  /** Tartar and plaque at the neck of the tooth: the faces each covers (see {@link DEPOSIT_FACES}), 0 for none. */
  readonly deposit: { readonly calculus: number; readonly plaque: number };
  /** What was recorded about the gum at this tooth, or null when nothing was. An empty object is "healthy". */
  readonly gum: GumPaint | null;
  /** Something recorded on this tooth is only suspected. */
  readonly suspected: boolean;
}

/** A finding dictated but not saved, in as much detail as the voice session has it. */
export interface StagedFinding {
  readonly fdi: string;
  readonly code: string;
  readonly surface: string | null;
  /** Suspected, not confirmed. */
  readonly certainty?: 'SUSPECTED' | 'CONFIRMED' | null;
  /** What was said with it ("3 mm"). */
  readonly note?: string | null;
}

/** What the paint reads of a finding. */
export interface PaintableFinding extends Pick<ToothFinding, 'findingCode' | 'kind' | 'surface'> {
  readonly note?: string | null;
  readonly certainty?: string | null;
}

interface Rule {
  readonly family: ZoneFamily;
  readonly pattern: ToothFillGeometry | 'owed';
  /** Where it goes when the finding names no surface. */
  readonly where: readonly PaintZone[];
  /** Whether a named surface narrows it down; a crown is a crown whatever was said. */
  readonly bySurface?: boolean;
}

const rule = (family: ZoneFamily, pattern: ToothFillGeometry | 'owed', where: readonly PaintZone[], bySurface = false): Rule =>
  ({ family, pattern, where, bySurface });

/** Mirrors the codes of the backend's FindingCatalog. A code missing here is flagged, never lost. */
const BASE_RULES: Readonly<Record<string, Rule>> = {
  // Work in the mouth
  existing_crown: rule('existing', 'hatch', CROWN),
  existing_bridge: rule('existing', 'hatch', CROWN),
  existing_implant: rule('existing', 'hatch', CROWN),
  existing_veneer: rule('existing', 'hatch', ['buccal']),
  existing_root_canal: rule('existing', 'endo', ['root']),
  existing_post: rule('existing', 'endo', ['root']),
  existing_filling: rule('existing', 'solid', CROWN, true),
  existing_composite: rule('existing', 'solid', CROWN, true),
  existing_amalgam: rule('existing', 'solid', CROWN, true),
  existing_inlay: rule('existing', 'solid', ['occlusal'], true),
  existing_sealant: rule('existing', 'solid', ['occlusal'], true),
  existing_deciduous: rule('existing', 'dotted', CROWN),
  // Pathology
  caries: rule('condition', 'stipple', CROWN, true),
  recurrent_caries: rule('condition', 'stipple', CROWN, true),
  deep_caries: rule('condition', 'stipple', CROWN, true),
  cavity: rule('condition', 'stipple', CROWN, true),
  fracture: rule('condition', 'jag', CROWN, true),
  extensive_destruction: rule('condition', 'jag', CROWN, true),
  tooth_wear: rule('condition', 'bars', ['occlusal'], true),
  discoloration: rule('condition', 'stipple', CROWN, true),
  crown_defective: rule('condition', 'hatch', CROWN),
  impacted: rule('condition', 'bars', WHOLE),
  gingival_inflammation: rule('condition', 'stipple', ['cervical']),
  periodontal_pocket: rule('condition', 'stipple', ['cervical']),
  gingival_recession: rule('condition', 'stipple', ['cervical']),
  // Work still owed
  crown_required: rule('planned', 'owed', CROWN),
  crown_replacement_required: rule('planned', 'owed', CROWN),
  bridge_required: rule('planned', 'owed', CROWN),
  veneer_required: rule('planned', 'owed', ['buccal']),
  root_canal_required: rule('planned', 'owed', ['root']),
  extraction_required: rule('planned', 'owed', WHOLE),
  implant_required: rule('planned', 'owed', WHOLE),
  filling_required: rule('planned', 'owed', ['occlusal'], true),
  restoration_required: rule('planned', 'owed', ['occlusal'], true),
  sealant_required: rule('planned', 'owed', ['occlusal'], true),
  scaling_required: rule('planned', 'owed', ['cervical']),
  periodontal_treatment_required: rule('planned', 'owed', ['cervical']),
};

/** The states of the clinical referential, resolved onto the parts of a tooth. */
const REFERENTIAL_PAINT: Readonly<Record<string, Rule>> = Object.fromEntries(
  Object.entries(REFERENTIAL_RULES).map(([code, r]) => [
    code,
    rule(r.family, r.pattern, r.where === 'CROWN' ? CROWN : r.where === 'WHOLE' ? WHOLE : (r.where as readonly PaintZone[]), r.bySurface),
  ]),
);

const RULES: Readonly<Record<string, Rule>> = { ...BASE_RULES, ...REFERENTIAL_PAINT };

const ABSENT = new Set(['extracted', 'missing', 'avulsion', ...REFERENTIAL_ABSENT]);
const LESION = new Set(['abscess', 'periapical_lesion', 'necrosis', 'pulpitis', 'infection', ...REFERENTIAL_LESIONS]);
/** Said of the tooth and the gum being as they should be: nothing to flag on the number. */
const NEUTRAL = new Set(['normal', 'normal_pulp', 'healthy_gingiva', 'permanent_tooth']);
const IMPLANT_THREADS: ZonePaint = { family: 'existing', pattern: 'bars' };
const RETAINED_ROOT: ZonePaint = { family: 'condition', pattern: 'stipple' };
const ROOT_POST: ZonePaint = { family: 'existing', pattern: 'endo' };

/** The surfaces of the finding, on the parts of the tooth that carry them. */
function zonesOfSurfaces(surface: string | null | undefined): PaintZone[] {
  const map: Record<ToothSurface, PaintZone> = {
    mesial: 'mesial', distal: 'distal', buccal: 'buccal', lingual: 'lingual',
    occlusal: 'occlusal', incisal: 'occlusal', cervical: 'cervical',
    // A named root is a part of the root: the 3D model has one root zone, not one per root.
    mesialroot: 'root', distalroot: 'root', buccalroot: 'root', lingualroot: 'root',
  };
  return parseSurface(surface).map((s) => map[s]);
}

const RANK: Readonly<Record<ZoneFamily, number>> = { suspected: 0, planned: 1, existing: 2, condition: 3 };

function stronger(current: ZonePaint | undefined, next: ZonePaint): boolean {
  return !current || RANK[next.family] > RANK[current.family];
}

/**
 * What a status means when no finding explains it: a chart older than findings,
 * or a status written straight on the tooth. The paint still has to say
 * something, so it says what the 2D chart's fill says, on the part it belongs to.
 */
function zonesOfStatus(status: ToothStatus): readonly PaintZone[] {
  switch (status) {
    case 'root_canal':
    case 'post':
      return ['root'];
    case 'veneer':
      return ['buccal'];
    case 'impacted':
      return WHOLE;
    default:
      return CROWN;
  }
}

function familyOfStatus(family: ToothStatusFamily): ZoneFamily | null {
  return family === 'existing' || family === 'condition' ? family : null;
}

/** Which status each code implies, enough to tell whether findings already explain a status. */
function explainsStatus(code: string, status: ToothStatus): boolean {
  const map: Partial<Record<ToothStatus, readonly string[]>> = {
    crown: ['existing_crown', 'crown_defective'],
    bridge: ['existing_bridge'],
    implant: ['existing_implant'],
    veneer: ['existing_veneer'],
    root_canal: ['existing_root_canal'],
    composite: ['existing_filling', 'existing_composite', 'existing_inlay'],
    amalgam: ['existing_amalgam'],
    post: ['existing_post'],
    deciduous: ['existing_deciduous'],
    caries: ['caries', 'recurrent_caries', 'deep_caries', 'cavity'],
    fracture: ['fracture', 'retained_root'],
    impacted: ['impacted'],
    extracted: ['extracted'],
    missing: ['missing', 'avulsion'],
  };
  return (map[status]?.includes(code) ?? false) || REFERENTIAL_IMPLIED_STATUS[code] === status;
}

/** The faces a finding's surface names, as deposit bits; all of them when it names none. */
function depositFaces(surface: string | null | undefined): number {
  const bits = parseSurface(surface).reduce((faces, s) => faces
    | (s === 'mesial' ? DEPOSIT_FACES.mesial : s === 'distal' ? DEPOSIT_FACES.distal : s === 'buccal' ? DEPOSIT_FACES.buccal : s === 'lingual' ? DEPOSIT_FACES.lingual : 0), 0);
  return bits || DEPOSIT_FACES.all;
}

/** "3 mm" → 3, for what a measured state does to the gum. */
function millimetres(note: string | null | undefined): number | undefined {
  // The measure leads the note: "3 mm", or "3 mm · patient anxieux" from the panel.
  const match = /^(\d+(?:\.\d+)?) mm(?![\p{L}\p{N}])/u.exec(note ?? '');
  return match ? Number(match[1]) : undefined;
}

/** One tooth's paint, from everything known about it. */
export function paintTooth(
  fdi: string,
  status: ToothStatus,
  findings: readonly PaintableFinding[],
  staged: readonly StagedFinding[] = [],
  treatment: TreatmentRing | null = null,
): ToothPaint {
  const zones: Partial<Record<PaintZone, ZonePaint>> = {};
  const put = (where: readonly PaintZone[], paint: ZonePaint) => {
    for (const zone of where) if (stronger(zones[zone], paint)) zones[zone] = paint;
  };

  let absent = toothStatusDefinition(status).family === 'absent';
  let crownLost = false;
  let lesion = false;
  let flagged = false;
  let planned = false;
  let suspected = false;
  let explained = status === 'present';
  let calculus = 0;
  let plaque = 0;
  const gum: Record<string, number> = {};
  let gumSeen = false;
  let recessionMm: number | undefined;

  const apply = (
    code: string,
    kind: FindingKind | undefined,
    surface: string | null | undefined,
    certainty?: string | null,
    note?: string | null,
  ) => {
    if (certainty === 'SUSPECTED') {
      // Not confirmed: drawn on the part it concerns in its own colour, under everything that is,
      // and never as the tooth being absent, a lesion, tartar or an effect on the gum.
      suspected = true;
      const found = RULES[code];
      if (!found || ABSENT.has(code) || LESION.has(code)) {
        flagged = true;
        return;
      }
      const named = found.bySurface ? zonesOfSurfaces(surface) : [];
      put(named.length ? named : found.where, { family: 'suspected', pattern: 'suspect' });
      return;
    }
    if (explainsStatus(code, status)) explained = true;
    if (ABSENT.has(code)) { absent = true; return; }
    if (LESION.has(code)) lesion = true;
    if (code === 'retained_root') {
      crownLost = true;
      put(['root'], RETAINED_ROOT);
      return;
    }
    const deposit = DEPOSITS[code];
    if (deposit) {
      const faces = depositFaces(surface);
      if (deposit !== 'plaque') calculus |= faces;
      if (deposit !== 'calculus') plaque |= faces;
    }
    const effect = GUM_EFFECTS[code];
    if (effect) {
      gumSeen = true;
      for (const [key, value] of Object.entries(effect)) gum[key] = Math.max(gum[key] ?? 0, value as number);
      if (code === 'gingival_recession' || code === 'clinical_attachment_loss') {
        const mm = millimetres(note);
        if (mm !== undefined) recessionMm = Math.max(recessionMm ?? 0, mm);
      }
    }
    if (kind === 'TREATMENT_REQUIRED') planned = true;
    const found = RULES[code];
    if (!found) {
      if (LESION.has(code) || deposit || NEUTRAL.has(code)) return;
      // Anything without a place on the tooth still has to be visible, or it is recorded and never seen.
      flagged = true;
      return;
    }
    const named = found.bySurface ? zonesOfSurfaces(surface) : [];
    put(named.length ? named : found.where, { family: found.family, pattern: found.pattern });
    if (code === 'existing_implant' || IMPLANT_THREAD_CODES.includes(code)) put(['root'], IMPLANT_THREADS);
    if (ROOT_POST_CODES.includes(code)) put(['root'], ROOT_POST);
  };

  for (const finding of findings) {
    if (finding.findingCode) apply(finding.findingCode, finding.kind, finding.surface, finding.certainty, finding.note);
  }
  for (const finding of staged) apply(finding.code, kindOfCode(finding.code), finding.surface, finding.certainty, finding.note);

  if (!explained && !absent) {
    const definition = toothStatusDefinition(status);
    const family = familyOfStatus(definition.family);
    if (family) put(zonesOfStatus(status), { family, pattern: definition.geometry });
    if (status === 'implant') put(['root'], IMPLANT_THREADS);
  }

  return {
    fdi, zones, absent, crownLost, lesion, flagged, planned, staged: staged.length > 0, treatment,
    deposit: { calculus, plaque },
    gum: gumSeen ? { ...gum, ...(recessionMm !== undefined ? { recessionMm } : {}) } : null,
    suspected,
  };
}

function kindOfCode(code: string): FindingKind | undefined {
  const found = RULES[code];
  if (found?.family === 'planned') return 'TREATMENT_REQUIRED';
  return undefined;
}

/** Every tooth of a chart. Resolved and withdrawn findings are history, not the tooth as it is now. */
export function paintChart(
  teeth: Readonly<Record<string, ToothState>>,
  findings: readonly ToothFinding[],
  staged: readonly StagedFinding[] = [],
  treatments: readonly { teeth?: string | null; status?: string | null }[] = [],
): ToothPaint[] {
  const active = new Map<string, ToothFinding[]>();
  for (const finding of findings) {
    if (finding.status !== 'ACTIVE' || !finding.fdi) continue;
    (active.get(finding.fdi) ?? active.set(finding.fdi, []).get(finding.fdi)!).push(finding);
  }
  const stagedByTooth = new Map<string, StagedFinding[]>();
  for (const finding of staged) {
    (stagedByTooth.get(finding.fdi) ?? stagedByTooth.set(finding.fdi, []).get(finding.fdi)!).push(finding);
  }
  const rings = treatmentRings(treatments);
  return Object.values(teeth).map((tooth) => paintTooth(
    tooth.id,
    tooth.status,
    active.get(tooth.id) ?? [],
    stagedByTooth.get(tooth.id) ?? [],
    rings.get(tooth.id) ?? null,
  ));
}

/** Work under way says the most about a tooth, then work to come, then work done. */
function treatmentRings(treatments: readonly { teeth?: string | null; status?: string | null }[]): Map<string, TreatmentRing> {
  const rank: Record<TreatmentRing, number> = { COMPLETED: 1, PLANNED: 2, ACTIVE: 3 };
  const rings = new Map<string, TreatmentRing>();
  for (const treatment of treatments) {
    const status = treatment.status as TreatmentRing | undefined;
    if (!status || !(status in rank) || !treatment.teeth) continue;
    for (const fdi of treatment.teeth.split(',').map((t) => t.trim()).filter(Boolean)) {
      const current = rings.get(fdi);
      if (!current || rank[status] > rank[current]) rings.set(fdi, status);
    }
  }
  return rings;
}

/* ── Colours as the graphics card takes them ──────────────────────────── */

/** rgb(47 143 162) → [47, 143, 162]. */
export function rgbTriplet(css: string): [number, number, number] {
  const [r, g, b] = css.replace(/[^\d\s]/g, '').trim().split(/\s+/).map(Number);
  return [r, g, b];
}

/** A suspicion is violet: no status family uses it, and it reads as "not yet" beside red, petrol and amber. */
export const SUSPECTED_INK = '#7c3aed';

export const ZONE_COLOUR: Readonly<Record<ZoneFamily, readonly [number, number, number]>> = {
  existing: rgbTriplet(FAMILY_PAINT.existing.solid),
  condition: rgbTriplet(FAMILY_PAINT.condition.solid),
  planned: rgbTriplet(PLANNED_PAINT.solid),
  suspected: [124, 58, 237],
};

/** Pattern number the shader switches on. 0 means the part is not painted. */
export const PATTERN_ID: Readonly<Record<ZonePaint['pattern'], number>> = {
  none: 0, solid: 1, hatch: 2, endo: 3, dotted: 4, stipple: 5, bars: 6, jag: 7, cross: 8, owed: 9, suspect: 10,
};

/* ── Which part of a tooth a point on it belongs to ───────────────────── */

/**
 * The bake gives every point of a tooth three coordinates: toward the midline
 * (+1) or away from it (-1), toward the cheek (+1) or the tongue (-1), and its
 * height above the enamel line (0 to 1 up the crown, 0 to -1 down the root).
 *
 * Seen from above, a back tooth divides like the chart's five-part drawing: a
 * central table and four sides. A front tooth has an edge instead of a table.
 * The shader draws from these same numbers (dentition-engine.ts); what is
 * clicked and what is painted must not disagree.
 */
export const ZONE_LIMITS = {
  cervicalBand: 0.14,
  occlusalCentre: 0.58,
  occlusalHeight: 0.5,
  incisalEdge: 0.78,
} as const;

export function zoneAt(mesial: number, buccal: number, height: number, anterior: boolean): PaintZone {
  if (height < 0) return 'root';
  if (height < ZONE_LIMITS.cervicalBand) return 'cervical';
  if (anterior) {
    if (height > ZONE_LIMITS.incisalEdge) return 'occlusal';
  } else if (Math.max(Math.abs(mesial), Math.abs(buccal)) < ZONE_LIMITS.occlusalCentre && height > ZONE_LIMITS.occlusalHeight) {
    return 'occlusal';
  }
  if (Math.abs(mesial) > Math.abs(buccal)) return mesial > 0 ? 'mesial' : 'distal';
  return buccal > 0 ? 'buccal' : 'lingual';
}

/** The surface word a part stands for on this tooth; the root has none. */
export function surfaceOfZone(zone: PaintZone, fdi: string): ToothSurface | null {
  if (zone === 'root') return null;
  if (zone === 'occlusal') return Number(fdi.charAt(1)) <= 3 ? 'incisal' : 'occlusal';
  return zone;
}
