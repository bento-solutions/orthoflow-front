/* =========================================================================
   Tooth surfaces
   =========================================================================

   A finding can say WHERE on the tooth it is: the backend stores `surface` as
   one or more of the words below joined by hyphens ("mesial-occlusal"), in
   the order of SURFACE_ORDER, which is the order the voice lexicon writes
   them in (core/voice/clinical-lexicon.ts). This file is the one place the
   2D chart marks, the surface picker and the history list agree on what those
   words mean and where they sit on a drawn tooth.

   ── Orientation ─────────────────────────────────────────────────────────
   The chart is drawn as the dentist faces the patient. "Mesial" is the side
   toward the midline, so on the patient's right (quadrants 1, 4, 5, 8) it is
   the right-hand side of the drawing, and on the left (2, 3, 6, 7) the
   left-hand side. Drawing mesial on a fixed side would show a caries on the
   wrong face of half the mouth.
   ========================================================================= */

/** Canonical order, identical to the voice lexicon's. */
export const SURFACE_ORDER = [
  'mesial', 'occlusal', 'distal', 'incisal', 'buccal', 'lingual', 'cervical',
] as const;

export type ToothSurface = (typeof SURFACE_ORDER)[number];

/** The server accepts at most this many parts in one compound surface. */
export const MAX_SURFACE_PARTS = 5;

const KNOWN = new Set<string>(SURFACE_ORDER);

/** "mesial-occlusal" → ['mesial', 'occlusal']; unknown words are dropped. */
export function parseSurface(value: string | null | undefined): ToothSurface[] {
  if (!value) return [];
  const seen = new Set<string>(value.toLowerCase().split('-').filter((p) => KNOWN.has(p)));
  return SURFACE_ORDER.filter((s) => seen.has(s));
}

/** ['occlusal', 'mesial'] → "mesial-occlusal"; null when empty. */
export function formatSurface(surfaces: Iterable<ToothSurface>): string | null {
  const set = new Set(surfaces);
  const ordered = SURFACE_ORDER.filter((s) => set.has(s)).slice(0, MAX_SURFACE_PARTS);
  return ordered.length ? ordered.join('-') : null;
}

/** Single-letter shorthand dentists chart in: M, O, D, I, B/V, L/P, C. */
export const SURFACE_LETTER: Readonly<Record<ToothSurface, string>> = {
  mesial: 'M',
  occlusal: 'O',
  distal: 'D',
  incisal: 'I',
  buccal: 'B',
  lingual: 'L',
  cervical: 'C',
};

/** "mesial-occlusal-distal" → "MOD". */
export function surfaceShorthand(value: string | null | undefined): string {
  return parseSurface(value).map((s) => SURFACE_LETTER[s]).join('');
}

// ── Where each surface sits on the drawing ──────────────────────────────

export type SurfaceZone = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** Incisors and canines (positions 1-3, permanent or primary) bite on an edge, not a table. */
export function isAnteriorTooth(fdi: string): boolean {
  return Number(fdi.charAt(1)) <= 3;
}

/** Patient's-right quadrants: 1 and 4 (permanent), 5 and 8 (primary). */
function onPatientsRight(fdi: string): boolean {
  return ['1', '4', '5', '8'].includes(fdi.charAt(0));
}

/** The surface the centre of the drawing stands for on this tooth. */
export function centreSurface(fdi: string): ToothSurface {
  return isAnteriorTooth(fdi) ? 'incisal' : 'occlusal';
}

/**
 * Which zone of the five-part drawing a surface occupies on this tooth.
 * `cervical` has no zone (it is a band around the neck, not a face) and the
 * surface that the tooth does not have (occlusal on an incisor) falls on the
 * same centre zone, so a record made on another chart still shows.
 */
export function surfaceZone(fdi: string, surface: ToothSurface): SurfaceZone | null {
  switch (surface) {
    case 'buccal': return 'top';
    case 'lingual': return 'bottom';
    case 'occlusal':
    case 'incisal': return 'center';
    case 'mesial': return onPatientsRight(fdi) ? 'right' : 'left';
    case 'distal': return onPatientsRight(fdi) ? 'left' : 'right';
    default: return null;
  }
}

/** The surface each zone stands for on this tooth. */
export function zoneSurface(fdi: string, zone: SurfaceZone): ToothSurface {
  switch (zone) {
    case 'top': return 'buccal';
    case 'bottom': return 'lingual';
    case 'center': return centreSurface(fdi);
    case 'left': return onPatientsRight(fdi) ? 'distal' : 'mesial';
    case 'right': return onPatientsRight(fdi) ? 'mesial' : 'distal';
  }
}

export const SURFACE_ZONES: readonly SurfaceZone[] = ['top', 'left', 'center', 'right', 'bottom'];

/**
 * The five parts of the drawing in a 30×30 box: a square centre with four
 * trapezoids around it. One set of paths for the picker and for the small
 * mark drawn on the chart, so they cannot disagree.
 */
export const SURFACE_ZONE_PATH: Readonly<Record<SurfaceZone, string>> = {
  top: 'M1 1 L29 1 L21 9 L9 9 Z',
  bottom: 'M1 29 L29 29 L21 21 L9 21 Z',
  left: 'M1 1 L9 9 L9 21 L1 29 Z',
  right: 'M29 1 L21 9 L21 21 L29 29 Z',
  center: 'M9 9 L21 9 L21 21 L9 21 Z',
};

/** Zones covered by a surface value on one tooth. */
export function zonesOf(fdi: string, value: string | null | undefined): Set<SurfaceZone> {
  const zones = new Set<SurfaceZone>();
  for (const surface of parseSurface(value)) {
    const zone = surfaceZone(fdi, surface);
    if (zone) zones.add(zone);
  }
  return zones;
}
