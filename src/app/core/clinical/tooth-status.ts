/* =========================================================================
   Odontogram — the clinical status encoding
   =========================================================================

   THE ONE SOURCE OF TRUTH for how a tooth's state is drawn, in the 2D chart,
   the 3D viewer, the legend, the status picker and the exported PDF. Before
   this file, the same table was written out three times (the chart service,
   the 2D component, the 3D canvas) with fifteen unrelated Tailwind default
   hexes and three different subsets of the status list.

   ── Why colour is not per-status ────────────────────────────────────────
   Fifteen hues is not a scale, it is a lookup table, and nobody memorises a
   lookup table between patients. Odontograms — paper ones and every serious
   dental package — encode the *kind* of thing, not the individual procedure:
   the clinician's at-a-glance question is "is there disease here, is there
   work already in place, is there work still owed, is the tooth even there",
   and only then "which restoration exactly".

   The backend already models that axis. `FindingCatalog` classifies every
   finding as EXISTING / CONDITION / TREATMENT_REQUIRED / OBSERVATION, and
   `tooth_states.status` is derived from those findings. This file paints the
   same axis, so the chart and the record agree by construction:

     FAMILY      MEANS                         COLOUR    TOKEN RAMP
     sound       nothing recorded              none      —
     existing    restoration already in place  petrol    --petrol-*
     condition   active pathology              red       --critical-*
     absent      tooth not present             grey      --ink-*
     planned     work owed (overlay, not fill) amber     --caution-*

   Those are the design system's own status colours (tokens.css): existing =
   `active`, condition = `critical`, absent = `idle`, planned = `attention`.
   The odontogram is therefore not a private palette — it is the product's
   status vocabulary applied to teeth.

   Absence gets grey rather than red even though `extracted` and `missing`
   are CONDITION-kind findings. Painting a missing tooth red would say "treat
   this", which is the wrong instruction; absence is a structural fact, not a
   lesion. This is the one place the paint deliberately departs from `kind`.

   ── Colour is never the only channel (WCAG 1.4.1) ───────────────────────
   Every family also carries a fill *geometry* — a hatch, a stipple, a cross —
   so the chart survives greyscale printing and the ~8% of male patients-of-
   the-clinician with a red/green deficiency. Geometry also subdivides each
   family into the groups a clinician actually reads apart at a glance
   (direct filling vs. lab-made crown vs. endodontics), while the exact
   status is always available as a text label on hover, focus, selection, in
   the per-tooth report and in the PDF legend.

   ── Colours are literal, on purpose ─────────────────────────────────────
   These are `rgb()` triplets rather than `var(--critical-500)` because they are
   read outside CSS too: the 3D chart hands them to the graphics card, and the
   printed chart (OdontogramRenderer on the server) mirrors them. `tooth-status.spec`
   parses `src/tokens.css` and fails if any value here drifts from its token.
   ========================================================================= */

import { ToothStatus } from '../models/patient.model';
import { FindingKind, ToothFinding } from '../models/clinical-record.model';
import { REFERENTIAL_UNPAINTED_CONDITIONS } from './finding-referential';

/** The four ways a tooth can read at a glance, plus the overlay family. */
export type ToothStatusFamily = 'sound' | 'existing' | 'condition' | 'absent';

/**
 * Fill geometries. One per clinically-distinct group, not one per status:
 * a crown and a veneer are both lab-made coverage and read the same from
 * across the room, which is the read this channel is for.
 */
export type ToothFillGeometry =
  | 'none'    /* sound — the tooth's own outline, nothing added        */
  | 'solid'   /* direct restoration placed into the tooth              */
  | 'hatch'   /* indirect / lab-made restoration covering the tooth    */
  | 'endo'    /* endodontics — a line down the root axis               */
  | 'dotted'  /* deciduous — present but temporary                     */
  | 'stipple' /* caries — decay                                        */
  | 'bars'    /* obstructed: impacted, retained root                   */
  | 'jag'     /* structural failure: fracture                          */
  | 'cross';  /* absent                                                */

export interface FamilyPaint {
  /** Ground wash under the pattern. Low alpha so the tooth outline survives. */
  readonly ground: string;
  /** Pattern strokes and the tooth's emphasised outline. */
  readonly ink: string;
  /** Legend/label text. The AA-validated `-700` text step of the ramp. */
  readonly text: string;
  /** Pill/chip ground for legends and pickers. The `-50` tint step. */
  readonly tint: string;
  /** Flat colour: legend dots, surface marks, and the wash under the 3D chart's patterns. */
  readonly solid: string;
}

/* Values mirror src/tokens.css — see the header note and the spec. */
const PETROL_500 = '47 143 162';
const PETROL_700 = '33 94 111';
const PETROL_50 = '240 249 250';
const CRITICAL_500 = '230 69 69';
const CRITICAL_700 = '175 32 32';
const CRITICAL_50 = '254 242 242';
const CAUTION_500 = '207 112 8';
const CAUTION_600 = '173 90 6';
const CAUTION_700 = '140 71 8';
const CAUTION_50 = '255 248 234';
const INK_200 = '213 221 224';
const INK_400 = '125 142 147';
const INK_500 = '99 116 122';
const INK_700 = '65 81 85';
const INK_50 = '246 248 248';

/** Exposed so the spec can assert these against tokens.css by name. */
export const TOKEN_MIRROR: Readonly<Record<string, string>> = {
  'petrol-500': PETROL_500,
  'petrol-700': PETROL_700,
  'petrol-50': PETROL_50,
  'critical-500': CRITICAL_500,
  'critical-700': CRITICAL_700,
  'critical-50': CRITICAL_50,
  'caution-500': CAUTION_500,
  'caution-600': CAUTION_600,
  'caution-700': CAUTION_700,
  'caution-50': CAUTION_50,
  'ink-200': INK_200,
  'ink-400': INK_400,
  'ink-500': INK_500,
  'ink-700': INK_700,
  'ink-50': INK_50,
};

export const FAMILY_PAINT: Readonly<Record<ToothStatusFamily, FamilyPaint>> = {
  sound: {
    ground: 'transparent',
    ink: `rgb(${INK_400})`,
    text: `rgb(${INK_700})`,
    tint: `rgb(${INK_50})`,
    solid: `rgb(${INK_400})`,
  },
  existing: {
    ground: `rgb(${PETROL_500} / 0.16)`,
    ink: `rgb(${PETROL_700})`,
    text: `rgb(${PETROL_700})`,
    tint: `rgb(${PETROL_50})`,
    solid: `rgb(${PETROL_500})`,
  },
  condition: {
    ground: `rgb(${CRITICAL_500} / 0.18)`,
    ink: `rgb(${CRITICAL_700})`,
    text: `rgb(${CRITICAL_700})`,
    tint: `rgb(${CRITICAL_50})`,
    solid: `rgb(${CRITICAL_500})`,
  },
  absent: {
    ground: `rgb(${INK_200} / 0.7)`,
    ink: `rgb(${INK_500})`,
    text: `rgb(${INK_700})`,
    tint: `rgb(${INK_50})`,
    solid: `rgb(${INK_400})`,
  },
};

/**
 * The treatment-plan progress ring drawn around a tooth by the "assigned
 * treatments" feature (`patientTreatments`) — a scheduling status, distinct
 * from the clinical finding overlay below. Reuses the design system's own
 * done/attention/action status colours (tokens.css) instead of inventing a
 * fourth palette for the same three-state idea.
 */
const POSITIVE_600 = '18 124 74';
export const TREATMENT_PLAN_INK = {
  COMPLETED: `rgb(${POSITIVE_600})`,
  ACTIVE: `rgb(${CAUTION_600})`,
  PLANNED: `rgb(${PETROL_500})`,
} as const;

/** Dictated, not yet saved. Amber reads as "pending" beside every status family. */
export const VOICE_STAGED_INK = '#d97706';
/** The tooth the last voice command was about. */
export const VOICE_FOCUS_INK = '#0e7490';

/**
 * Planned work is drawn *over* whatever the tooth already is, never instead
 * of it: a tooth with caries and a planned filling has to show both, because
 * the pathology is what justifies the plan and the plan is what the patient
 * is consenting to. It therefore has no fill of its own — only a dashed
 * outline and a corner marker.
 */
export const PLANNED_PAINT = {
  ink: `rgb(${CAUTION_600})`,
  text: `rgb(${CAUTION_700})`,
  tint: `rgb(${CAUTION_50})`,
  solid: `rgb(${CAUTION_500})`,
} as const;

export interface ToothStatusDefinition {
  readonly status: ToothStatus;
  readonly family: ToothStatusFamily;
  readonly geometry: ToothFillGeometry;
  /** ngx-translate key. */
  readonly labelKey: string;
  /**
   * The `FindingCatalog` kind this status is derived from, kept here so the
   * chart's grouping and the clinical record's grouping cannot drift.
   * `null` for `present`, which is the absence of any finding.
   */
  readonly kind: FindingKind | null;
}

const D = (
  status: ToothStatus,
  family: ToothStatusFamily,
  geometry: ToothFillGeometry,
  kind: FindingKind | null,
): ToothStatusDefinition => ({
  status,
  family,
  geometry,
  kind,
  labelKey: `DENTAL_CHART.STATUS.${status.toUpperCase()}`,
});

/**
 * Ordered as the legend and the status picker present them: absence first
 * (the most consequential fact about a tooth), then pathology, then existing
 * work grouped by how it was made, then the baseline.
 */
export const TOOTH_STATUS_DEFINITIONS: readonly ToothStatusDefinition[] = [
  D('present', 'sound', 'none', null),

  D('extracted', 'absent', 'cross', 'CONDITION'),
  D('missing', 'absent', 'cross', 'CONDITION'),

  D('caries', 'condition', 'stipple', 'CONDITION'),
  D('fracture', 'condition', 'jag', 'CONDITION'),
  D('impacted', 'condition', 'bars', 'CONDITION'),

  D('composite', 'existing', 'solid', 'EXISTING'),
  D('amalgam', 'existing', 'solid', 'EXISTING'),
  D('crown', 'existing', 'hatch', 'EXISTING'),
  D('bridge', 'existing', 'hatch', 'EXISTING'),
  D('veneer', 'existing', 'hatch', 'EXISTING'),
  D('implant', 'existing', 'hatch', 'EXISTING'),
  D('post', 'existing', 'endo', 'EXISTING'),
  D('root_canal', 'existing', 'endo', 'EXISTING'),
  D('deciduous', 'existing', 'dotted', 'EXISTING'),
];

const BY_STATUS = new Map<ToothStatus, ToothStatusDefinition>(
  TOOTH_STATUS_DEFINITIONS.map((d) => [d.status, d]),
);

export function toothStatusDefinition(status: ToothStatus): ToothStatusDefinition {
  return BY_STATUS.get(status) ?? BY_STATUS.get('present')!;
}

export function toothStatusFamily(status: ToothStatus): ToothStatusFamily {
  return toothStatusDefinition(status).family;
}

export function toothStatusLabelKey(status: ToothStatus): string {
  return toothStatusDefinition(status).labelKey;
}

/**
 * Legend and picker grouping. Every group has a heading, so the picker reads
 * as a clinical vocabulary rather than a colour swatch grid.
 */
export interface ToothStatusGroup {
  readonly family: ToothStatusFamily;
  readonly titleKey: string;
  readonly statuses: readonly ToothStatus[];
}

export const TOOTH_STATUS_GROUPS: readonly ToothStatusGroup[] = (
  ['absent', 'condition', 'existing'] as const
).map((family) => ({
  family,
  titleKey: `DENTAL_CHART.FAMILY.${family.toUpperCase()}`,
  statuses: TOOTH_STATUS_DEFINITIONS.filter((d) => d.family === family).map((d) => d.status),
}));

/* ── SVG paint ────────────────────────────────────────────────────────── */

export interface ToothPaint {
  /** `fill` for the tooth's outline path: a pattern url, a colour, or none. */
  readonly fill: string;
  readonly fillOpacity: string;
  /** Stroke for the tooth outline. */
  readonly stroke: string;
  readonly strokeWidth: string;
}

/** `<pattern>` id for a geometry, or null when the geometry needs no pattern. */
function patternId(family: ToothStatusFamily, geometry: ToothFillGeometry): string | null {
  if (geometry === 'none') return null;
  if (geometry === 'solid') return null; /* a flat wash, no pattern needed */
  return `odo-${family}-${geometry}`;
}

export function toothPaint(status: ToothStatus): ToothPaint {
  const def = toothStatusDefinition(status);
  const paint = FAMILY_PAINT[def.family];

  if (def.geometry === 'none') {
    return { fill: 'transparent', fillOpacity: '1', stroke: paint.ink, strokeWidth: '1' };
  }

  const id = patternId(def.family, def.geometry);
  return {
    fill: id ? `url(#${id})` : paint.ground,
    fillOpacity: '1',
    stroke: paint.ink,
    strokeWidth: '1.4',
  };
}

/**
 * The `<defs>` block the odontogram SVG needs. Generated rather than written
 * by hand so a family's colour is defined in exactly one place, and injected
 * into the SVG string at render time.
 *
 * `patternUnits="userSpaceOnUse"` keeps the hatch pitch constant across teeth
 * of different sizes — with the default `objectBoundingBox` a molar's hatch
 * would be twice the pitch of an incisor's and the two would not read as the
 * same status.
 */
export function odontogramPatternDefs(): string {
  const families: ToothStatusFamily[] = ['existing', 'condition', 'absent'];
  const geometries: ToothFillGeometry[] = [
    'hatch', 'endo', 'dotted', 'stipple', 'bars', 'jag', 'cross',
  ];

  const used = new Set(
    TOOTH_STATUS_DEFINITIONS.map((d) => `${d.family}|${d.geometry}`),
  );

  const blocks: string[] = [];
  for (const family of families) {
    const { ground, ink } = FAMILY_PAINT[family];
    for (const geometry of geometries) {
      if (!used.has(`${family}|${geometry}`)) continue;
      blocks.push(
        `<pattern id="${patternId(family, geometry)}" patternUnits="userSpaceOnUse" ` +
          `width="4" height="4">` +
          `<rect width="4" height="4" fill="${ground}"/>` +
          geometryMarks(geometry, ink) +
          `</pattern>`,
      );
    }
  }
  return `<defs class="odontogram-defs">${blocks.join('')}</defs>`;
}

/** The marks inside one 4×4 pattern tile. */
function geometryMarks(geometry: ToothFillGeometry, ink: string): string {
  const line = (d: string, w = 0.7) =>
    `<path d="${d}" stroke="${ink}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  switch (geometry) {
    /* Lab-made coverage: a single 45° hatch. */
    case 'hatch':
      return line('M0 4 L4 0') + line('M-1 1 L1 -1') + line('M3 5 L5 3');
    /* Endodontics: a line down the tooth's long axis. */
    case 'endo':
      return line('M2 0 L2 4', 0.9);
    /* Deciduous: present, but dashed — temporary. */
    case 'dotted':
      return line('M2 0.4 L2 1.6', 0.8) + line('M2 2.4 L2 3.6', 0.8);
    /* Caries: stipple. */
    case 'stipple':
      return `<circle cx="1" cy="1" r="0.55" fill="${ink}"/><circle cx="3" cy="3" r="0.55" fill="${ink}"/>`;
    /* Obstructed: horizontal bars. */
    case 'bars':
      return line('M0 1 L4 1', 0.8) + line('M0 3 L4 3', 0.8);
    /* Structural failure: a heavy counter-diagonal. */
    case 'jag':
      return line('M0 0 L4 4', 1.1);
    /* Absent: cross-hatch — the universal "not there". */
    case 'cross':
      return line('M0 4 L4 0', 0.6) + line('M0 0 L4 4', 0.6);
    default:
      return '';
  }
}

/* ── Findings-driven overlays ─────────────────────────────────────────── */

export interface ToothOverlay {
  /** The tooth has active TREATMENT_REQUIRED findings. */
  readonly planned: readonly string[];
  /**
   * The tooth has active CONDITION findings that the derived primary status
   * does not paint — a defective crown still painted as a sound crown, an
   * abscess under a restoration, mobility on a present tooth. Without this
   * marker those findings are recorded and invisible, which is the failure
   * mode a chart exists to prevent.
   */
  readonly unpaintedConditions: readonly string[];
}

/**
 * Which codes never drive `tooth_states.status` and so are invisible unless
 * this overlay draws them. Mirrors the `null` implied-status rows in the
 * backend's `FindingCatalog`, plus `crown_defective`, which resolves to the
 * same `crown` paint as a sound crown.
 */
const CONDITIONS_THE_FILL_CANNOT_SHOW = new Set([
  ...REFERENTIAL_UNPAINTED_CONDITIONS,
  'infection', 'abscess', 'mobility', 'sensitivity', 'pain', 'tooth_wear',
  'discoloration', 'gingival_inflammation', 'periodontal_pocket',
  'gingival_recession', 'plaque_calculus', 'malposition', 'crown_defective',
]);

/**
 * Group active findings into per-tooth overlays. Retracted and resolved
 * findings are excluded — the chart shows the tooth as it is now, and the
 * history lives in the record.
 */
export function toothOverlays(findings: readonly ToothFinding[]): Map<string, ToothOverlay> {
  const byFdi = new Map<string, { planned: string[]; unpaintedConditions: string[] }>();

  for (const f of findings) {
    if (f.status !== 'ACTIVE') continue;
    const isPlanned = f.kind === 'TREATMENT_REQUIRED';
    const isHidden = f.kind === 'CONDITION' && CONDITIONS_THE_FILL_CANNOT_SHOW.has(f.findingCode);
    if (!isPlanned && !isHidden) continue;

    let entry = byFdi.get(f.fdi);
    if (!entry) {
      entry = { planned: [], unpaintedConditions: [] };
      byFdi.set(f.fdi, entry);
    }
    (isPlanned ? entry.planned : entry.unpaintedConditions).push(f.findingCode);
  }

  return new Map(
    [...byFdi].map(([fdi, e]) => [
      fdi,
      { planned: e.planned, unpaintedConditions: e.unpaintedConditions } as ToothOverlay,
    ]),
  );
}
