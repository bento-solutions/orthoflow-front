import type { PerioCondition, PerioRegion } from '../models/clinical-record.model';
import { GUM_EFFECTS, GumEffect } from './finding-referential';
import type { GumPaint, ToothPaint } from './tooth-paint';

/**
 * What the gum shows at each tooth: what was recorded about that tooth's own gum, and what was recorded
 * about the part of the mouth it is in (the gum assessment is by sextant, "gencive haut droite").
 *
 * The 3D mouth draws it (dentition-engine.ts); knowing nothing about three.js, this can be tested
 * without a graphics context.
 */

/** The six parts the gum is assessed by. */
export type GumArea = Exclude<PerioRegion, 'WHOLE_MOUTH'>;

/**
 * The sextant of a tooth: the back teeth of each side of each jaw, and the front six of each jaw (canine to
 * canine). A child's teeth are in the same places: 55–54 and 64–65, 53–63, 85–84 and 74–75, 83–73.
 */
export function areaOfTooth(fdi: string): GumArea {
  const quadrant = Number(fdi.charAt(0));
  const position = Number(fdi.charAt(1));
  const upper = quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
  const right = quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8;
  if (position <= 3) return upper ? 'UPPER_FRONT' : 'LOWER_FRONT';
  if (upper) return right ? 'UPPER_RIGHT' : 'UPPER_LEFT';
  return right ? 'LOWER_RIGHT' : 'LOWER_LEFT';
}

/** The teeth of a part of the mouth, out of the teeth a chart has. */
export function teethOfArea(area: PerioRegion, teeth: readonly string[]): string[] {
  return area === 'WHOLE_MOUTH' ? [...teeth] : teeth.filter((fdi) => areaOfTooth(fdi) === area);
}

/** How far each stage of periodontitis goes (stage I to IV): the gum of a stage IV mouth is the worst the picture shows. */
const STAGE_STRENGTH: Readonly<Record<number, number>> = { 1: 0.45, 2: 0.65, 3: 0.85, 4: 1 };

/** What a gum assessment does to the gum. Healthy does nothing. */
export function effectOfCondition(condition: PerioCondition, stage?: number | null): GumEffect {
  switch (condition) {
    case 'GINGIVITIS':
      return { ...GUM_EFFECTS['gingivitis'] };
    case 'PERIODONTITIS': {
      const strength = (stage && STAGE_STRENGTH[stage]) || 1;
      const base = GUM_EFFECTS['periodontitis'];
      return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, (value as number) * strength])) as GumEffect;
    }
    default:
      return {};
  }
}

const KEYS: ReadonlyArray<keyof GumEffect> = [
  'inflamed', 'swollen', 'recession', 'pocket', 'perio', 'bleeding', 'pus', 'ulcer', 'pigment', 'abscess', 'lesion', 'pale',
];

function strongest(...effects: ReadonlyArray<GumEffect | null | undefined>): GumEffect {
  const merged: Record<string, number> = {};
  for (const effect of effects) {
    if (!effect) continue;
    for (const key of KEYS) {
      const value = effect[key];
      if (value) merged[key] = Math.max(merged[key] ?? 0, value);
    }
  }
  return merged as GumEffect;
}

/** An assessment, as the part of the mouth and the state it says. */
export interface GumAssessment {
  readonly region: PerioRegion;
  readonly condition: PerioCondition;
  readonly stage?: number | null;
}

/**
 * The gum of each tooth that has something to show. The assessment of its sextant, or of the whole mouth
 * when its sextant has none, and what was recorded on the tooth itself, the strongest of each. A tooth whose
 * own gum was recorded healthy ("gencive saine") shows none of its area's state: someone looked at it.
 */
export function gumPaints(
  teeth: readonly string[],
  paints: ReadonlyMap<string, ToothPaint>,
  assessments: readonly GumAssessment[],
): Map<string, GumPaint> {
  const out = new Map<string, GumPaint>();
  for (const fdi of teeth) {
    const own = paints.get(fdi)?.gum ?? null;
    const markedHealthy = own !== null && KEYS.every((key) => !own[key]) && own.recessionMm === undefined;
    if (markedHealthy) continue;
    const area = assessments.find((a) => a.region === areaOfTooth(fdi)) ?? assessments.find((a) => a.region === 'WHOLE_MOUTH');
    const effect = strongest(area ? effectOfCondition(area.condition, area.stage) : null, own);
    const recessionMm = own?.recessionMm;
    if (Object.keys(effect).length === 0 && recessionMm === undefined) continue;
    out.set(fdi, { ...effect, ...(recessionMm !== undefined ? { recessionMm } : {}) });
  }
  return out;
}
