import { ALL_TEETH, LOWER_TEETH, UPPER_TEETH, furcationSitesOf, probingSitesOf } from './perio-layout';
import { CellSite, PROBING_SITES, PerioCell, PerioMode, ToothStatusMap } from './perio.model';

/**
 * Where the keyboard goes next. The clinician dictates a whole mouth site by site, so the order is the
 * order a periodontist probes in: the cheek side of the upper arch, right to left of the patient (left
 * to right on the screen), then the palatal side, then the lower arch the same way.
 */

const RIGHT_UPPER = UPPER_TEETH.slice(0, 8);
const LEFT_UPPER = UPPER_TEETH.slice(8);
const RIGHT_LOWER = LOWER_TEETH.slice(0, 8);
const LEFT_LOWER = LOWER_TEETH.slice(8);

const cells = (teeth: readonly string[], face: 'buccal' | 'lingual'): PerioCell[] =>
  teeth.flatMap((tooth) => probingSitesOf(tooth, face).map((site) => ({ tooth, site })));

/** All 192 probing sites in probing order. */
export const PROBING_SEQUENCE: readonly PerioCell[] = [
  ...cells(RIGHT_UPPER, 'buccal'), ...cells(LEFT_UPPER, 'buccal'),
  ...cells(RIGHT_UPPER, 'lingual'), ...cells(LEFT_UPPER, 'lingual'),
  ...cells(RIGHT_LOWER, 'buccal'), ...cells(LEFT_LOWER, 'buccal'),
  ...cells(RIGHT_LOWER, 'lingual'), ...cells(LEFT_LOWER, 'lingual'),
];

/** Mobility is one value per tooth, kept on its cheek site. */
export const MOBILITY_SITE: CellSite = 'buccal';
const MOBILITY_SEQUENCE: readonly PerioCell[] = ALL_TEETH.map((tooth) => ({ tooth, site: MOBILITY_SITE }));
const FURCATION_SEQUENCE: readonly PerioCell[] = ALL_TEETH.flatMap((tooth) =>
  furcationSitesOf(tooth).map((site) => ({ tooth, site })));

export function sequenceFor(mode: PerioMode): readonly PerioCell[] {
  if (mode === 'furcation') return FURCATION_SEQUENCE;
  if (mode === 'mobility') return MOBILITY_SEQUENCE;
  return PROBING_SEQUENCE;
}

const key = (cell: PerioCell): string => `${cell.tooth}-${cell.site}`;
const INDEXES = new Map<PerioMode, Map<string, number>>();
function indexOf(mode: PerioMode, cell: PerioCell): number {
  const sequence = sequenceFor(mode);
  const cacheKey: PerioMode = mode === 'furcation' || mode === 'mobility' ? mode : 'pocketDepth';
  let index = INDEXES.get(cacheKey);
  if (!index) {
    index = new Map(sequence.map((c, i) => [key(c), i]));
    INDEXES.set(cacheKey, index);
  }
  return index.get(key(cell)) ?? -1;
}

/** A tooth that is missing or a bridge pontic has nothing to probe: navigation steps over it. */
export const isSkipped = (tooth: string, status: ToothStatusMap): boolean =>
  status[tooth] === 'missing' || status[tooth] === 'pontic';

/**
 * The cell after (or before) `current` in the order of `mode`, wrapping around the mouth and skipping
 * absent teeth. With no current cell, the first one that can be charted.
 */
export function step(current: PerioCell | null, mode: PerioMode, direction: 'next' | 'prev', status: ToothStatusMap): PerioCell | null {
  const sequence = sequenceFor(mode);
  if (sequence.length === 0) return null;
  if (!current) return sequence.find((c) => !isSkipped(c.tooth, status)) ?? sequence[0];

  const from = indexOf(mode, current);
  if (from === -1) return null;
  const delta = direction === 'next' ? 1 : -1;
  let at = from;
  for (let i = 0; i < sequence.length; i++) {
    at = (at + delta + sequence.length) % sequence.length;
    const candidate = sequence[at];
    // mobility is per tooth: moving on means moving to another tooth
    if (mode === 'mobility' && candidate.tooth === current.tooth) continue;
    if (!isSkipped(candidate.tooth, status)) return candidate;
  }
  // everything is skipped: stay where the order says
  return sequence[(from + delta + sequence.length) % sequence.length];
}

/** Whether a site can be charted in this mode on this tooth. */
export function isSiteValid(site: CellSite, mode: PerioMode, tooth: string): boolean {
  switch (mode) {
    case 'furcation': return furcationSitesOf(tooth).includes(site as never);
    case 'mobility': return site === MOBILITY_SITE;
    default: return (PROBING_SITES as readonly string[]).includes(site);
  }
}

/** The first site of a tooth for a mode: where the keyboard lands when the clinician switches mode. */
export function firstSiteOf(tooth: string, mode: PerioMode): CellSite | null {
  switch (mode) {
    case 'furcation': return furcationSitesOf(tooth)[0] ?? null;
    case 'mobility': return MOBILITY_SITE;
    default: return PROBING_SITES[0];
  }
}

/**
 * The cell to use after the mode changed. The clinician is looking at a tooth: staying on it matters
 * more than staying at the same site, so the same site is kept when the new mode has it, otherwise the
 * first site of the tooth, otherwise the nearest tooth that has one.
 */
export function cellAfterModeChange(current: PerioCell | null, mode: PerioMode, status: ToothStatusMap): PerioCell | null {
  if (current && !isSkipped(current.tooth, status)) {
    if (isSiteValid(current.site, mode, current.tooth)) return current;
    const first = firstSiteOf(current.tooth, mode);
    if (first) return { tooth: current.tooth, site: first };
  }
  if (current) {
    const next = step(current, mode, 'next', status) ?? step(current, mode, 'prev', status);
    if (next) return next;
  }
  return step(null, mode, 'next', status);
}

