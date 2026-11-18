import { PAINT_ZONES, ToothPaint } from './tooth-paint';

export type MouthGroupKind = 'condition' | 'suspected' | 'planned' | 'existing' | 'absent';

/** One kind of state in the mouth and the teeth in it, in chart order. */
export interface MouthGroup {
  readonly kind: MouthGroupKind;
  /** Its heading's translation key. */
  readonly key: string;
  readonly teeth: readonly string[];
}

/**
 * The state of the mouth at a glance, from what the chart paints: the teeth with a condition,
 * those only suspected, those with work to be done, those with work in place, and the absent
 * ones. A tooth can be in several groups. Groups with no tooth are left out.
 */
export function summarizeMouth(teeth: readonly string[], paintByFdi: ReadonlyMap<string, ToothPaint>): MouthGroup[] {
  const groups: Record<MouthGroupKind, string[]> = { condition: [], planned: [], existing: [], absent: [], suspected: [] };
  for (const fdi of teeth) {
    const paint = paintByFdi.get(fdi);
    if (!paint) continue;
    const families = new Set(PAINT_ZONES.map((zone) => paint.zones[zone]?.family));
    if (paint.absent) groups.absent.push(fdi);
    // Tartar and plaque are findings of the tooth even though nothing is painted on a part of it.
    if (families.has('condition') || paint.lesion || paint.flagged || paint.deposit.calculus || paint.deposit.plaque) groups.condition.push(fdi);
    if (paint.suspected) groups.suspected.push(fdi);
    if (paint.planned || families.has('planned')) groups.planned.push(fdi);
    if (families.has('existing')) groups.existing.push(fdi);
  }
  return (Object.entries(groups) as [MouthGroupKind, string[]][])
    .filter(([, inGroup]) => inGroup.length)
    .map(([kind, inGroup]) => ({ kind, key: `DENTAL_3D.GROUP.${kind.toUpperCase()}`, teeth: inGroup }));
}
