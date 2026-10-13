import { PerioChartListItem } from '../../../core/clinical/perio/perio.model';
import { FLAG_COLORS, PERIO } from './perio-palette';

/** What the periodontist asks of a series of charts: is it getting better? */

export type TrendKey = 'PERCENT' | 'DEPTH' | 'DEEP' | 'CAL' | 'RECESSION' | 'SEVERE';
export type TrendMetric =
  | 'BLEEDING' | 'PLAQUE' | 'SUPPURATION' | 'MEAN_DEPTH' | 'DEEPEST' | 'SITES_4' | 'MEAN_CAL' | 'MEAN_RECESSION' | 'SITES_5_CAL';

export const TREND_KEYS: readonly TrendKey[] = ['PERCENT', 'DEPTH', 'DEEP', 'CAL', 'RECESSION', 'SEVERE'];
export const TREND_METRICS: readonly TrendMetric[] = [
  'BLEEDING', 'PLAQUE', 'SUPPURATION', 'MEAN_DEPTH', 'DEEPEST', 'SITES_4', 'MEAN_CAL', 'MEAN_RECESSION', 'SITES_5_CAL',
];

export interface TrendSeries {
  readonly metric: TrendMetric;
  readonly color: string;
  /** One value per examination, null where the chart has none (no depth recorded, say). */
  readonly values: readonly (number | null)[];
}

export interface Trend {
  readonly key: TrendKey;
  readonly unit: '%' | 'mm';
  readonly series: readonly TrendSeries[];
}

export interface ProgressionPoint {
  readonly id: string;
  readonly date: string;
  readonly summary: PerioChartListItem['summary'];
}

/**
 * The examinations that carry something to compare, oldest first. A chart that was just started and has
 * nothing on it is not an examination.
 */
export function progressionPoints(charts: readonly PerioChartListItem[]): ProgressionPoint[] {
  return charts
    .filter((c) => c.summary.sitesRecorded > 0)
    .map((c) => ({ id: c.id, date: c.chartDate, summary: c.summary, updatedAt: c.updatedAt }))
    .sort((a, b) => (a.date === b.date ? a.updatedAt.localeCompare(b.updatedAt) : a.date.localeCompare(b.date)))
    .map(({ id, date, summary }) => ({ id, date, summary }));
}

export function trendsOf(points: readonly ProgressionPoint[]): Trend[] {
  const of = (pick: (s: ProgressionPoint['summary']) => number | null): (number | null)[] => points.map((p) => pick(p.summary));
  return [
    {
      key: 'PERCENT', unit: '%',
      series: [
        { metric: 'BLEEDING', color: FLAG_COLORS.bleeding.base, values: of((s) => s.bleedingPercent) },
        { metric: 'PLAQUE', color: FLAG_COLORS.plaque.base, values: of((s) => s.plaquePercent) },
        { metric: 'SUPPURATION', color: FLAG_COLORS.suppuration.base, values: of((s) => s.suppurationPercent) },
      ],
    },
    {
      key: 'DEPTH', unit: 'mm',
      series: [
        { metric: 'MEAN_DEPTH', color: PERIO.probing, values: of((s) => s.meanPocketDepth) },
        { metric: 'DEEPEST', color: '#1e3a8a', values: of((s) => s.deepestPocketDepth) },
      ],
    },
    { key: 'DEEP', unit: '%', series: [{ metric: 'SITES_4', color: PERIO.probing, values: of((s) => s.pocketsAboveFourPercent) }] },
    { key: 'CAL', unit: 'mm', series: [{ metric: 'MEAN_CAL', color: '#7c3aed', values: of((s) => s.meanCal) }] },
    { key: 'RECESSION', unit: 'mm', series: [{ metric: 'MEAN_RECESSION', color: PERIO.recession, values: of((s) => s.meanRecession) }] },
    { key: 'SEVERE', unit: '%', series: [{ metric: 'SITES_5_CAL', color: '#b91c1c', values: of((s) => s.sitesAboveFiveCalPercent) }] },
  ];
}

/** Whether there is a trend to draw: at least two examinations that have something on them. */
export const hasProgression = (points: readonly ProgressionPoint[]): boolean => points.length >= 2;
