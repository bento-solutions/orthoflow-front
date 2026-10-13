import { furcationSitesOf, ALL_TEETH } from './perio-layout';
import {
  AbsentStatus, ApiTeeth, ApiTooth, FurcationGrade, FurcationSite, ModeValue, PROBING_SITES, PerioData, PerioMode,
  PerioSummary, PerioTooth, ProbingSite, ToothStatus, ToothStatusMap, CellSite,
} from './perio.model';

const allSites = <T>(value: T): Record<ProbingSite, T> => ({
  mesiobuccal: value, buccal: value, distobuccal: value, mesiolingual: value, lingual: value, distolingual: value,
});

export function emptyTooth(): PerioTooth {
  return {
    mobility: null,
    furcation: {},
    pocketDepth: allSites<number | null>(null),
    recession: allSites<number | null>(null),
    bleeding: allSites(false),
    plaque: allSites(false),
    suppuration: allSites(false),
  };
}

export function emptyPerioData(): PerioData {
  return Object.fromEntries(ALL_TEETH.map((code) => [code, emptyTooth()]));
}

// ── wire format ↔ working copy ─────────────────────────────────────────

export function fromApi(teeth: ApiTeeth): PerioData {
  const data: Record<string, PerioTooth> = {};
  for (const code of ALL_TEETH) {
    const sent: ApiTooth = teeth[code] ?? {};
    const tooth = emptyTooth();
    data[code] = {
      mobility: sent.mobility ?? null,
      furcation: { ...(sent.furcation ?? {}) },
      pocketDepth: { ...tooth.pocketDepth, ...(sent.pocketDepth ?? {}) },
      recession: { ...tooth.recession, ...(sent.recession ?? {}) },
      bleeding: flags(sent.bleeding),
      plaque: flags(sent.plaque),
      suppuration: flags(sent.suppuration),
    };
  }
  return data;
}

const flags = (sites: readonly ProbingSite[] | undefined): Record<ProbingSite, boolean> => {
  const result = allSites(false);
  for (const site of sites ?? []) result[site] = true;
  return result;
};

const sitesWhere = (values: Readonly<Record<ProbingSite, boolean>>): ProbingSite[] =>
  PROBING_SITES.filter((site) => values[site]);

const numbersOf = (values: Readonly<Record<ProbingSite, number | null>>): Partial<Record<ProbingSite, number>> => {
  const result: Partial<Record<ProbingSite, number>> = {};
  for (const site of PROBING_SITES) {
    const value = values[site];
    if (value != null) result[site] = value;
  }
  return result;
};

/** Only what was charted: a tooth with nothing on it is not sent. */
export function toApi(data: PerioData): ApiTeeth {
  const teeth: ApiTeeth = {};
  for (const code of ALL_TEETH) {
    const tooth = data[code];
    if (!tooth) continue;
    const out: ApiTooth = {};
    if (tooth.mobility != null) out.mobility = tooth.mobility;
    if (Object.keys(tooth.furcation).length) out.furcation = { ...tooth.furcation };
    const depths = numbersOf(tooth.pocketDepth);
    if (Object.keys(depths).length) out.pocketDepth = depths;
    const recessions = numbersOf(tooth.recession);
    if (Object.keys(recessions).length) out.recession = recessions;
    const bleeding = sitesWhere(tooth.bleeding);
    if (bleeding.length) out.bleeding = bleeding;
    const plaque = sitesWhere(tooth.plaque);
    if (plaque.length) out.plaque = plaque;
    const suppuration = sitesWhere(tooth.suppuration);
    if (suppuration.length) out.suppuration = suppuration;
    if (Object.keys(out).length) teeth[code] = out;
  }
  return teeth;
}

// ── reading and writing a value ─────────────────────────────────────────

export function valueAt(data: PerioData, tooth: string, mode: PerioMode, site: CellSite): ModeValue {
  const t = data[tooth];
  if (!t) return null;
  switch (mode) {
    case 'pocketDepth': return t.pocketDepth[site as ProbingSite] ?? null;
    case 'recession': return t.recession[site as ProbingSite] ?? null;
    case 'bleeding': return t.bleeding[site as ProbingSite] ?? false;
    case 'plaque': return t.plaque[site as ProbingSite] ?? false;
    case 'suppuration': return t.suppuration[site as ProbingSite] ?? false;
    case 'mobility': return t.mobility;
    case 'furcation': return t.furcation[site as FurcationSite] ?? null;
  }
}

/** A new chart with one value changed. Nothing is mutated: the chart is a signal. */
export function withValue(data: PerioData, tooth: string, mode: PerioMode, site: CellSite, value: ModeValue): PerioData {
  const t = data[tooth];
  if (!t) return data;
  let next: PerioTooth;
  switch (mode) {
    case 'pocketDepth': next = { ...t, pocketDepth: { ...t.pocketDepth, [site]: value as number | null } }; break;
    case 'recession': next = { ...t, recession: { ...t.recession, [site]: value as number | null } }; break;
    case 'bleeding': next = { ...t, bleeding: { ...t.bleeding, [site]: !!value } }; break;
    case 'plaque': next = { ...t, plaque: { ...t.plaque, [site]: !!value } }; break;
    case 'suppuration': next = { ...t, suppuration: { ...t.suppuration, [site]: !!value } }; break;
    case 'mobility': next = { ...t, mobility: value as number | null }; break;
    case 'furcation': {
      const furcation = { ...t.furcation };
      if (value) furcation[site as FurcationSite] = value as FurcationGrade;
      else delete furcation[site as FurcationSite];
      next = { ...t, furcation };
      break;
    }
  }
  return { ...data, [tooth]: next };
}

export const withToothCleared = (data: PerioData, tooth: string): PerioData =>
  data[tooth] ? { ...data, [tooth]: emptyTooth() } : data;

export function hasMeasurements(tooth: PerioTooth | undefined): boolean {
  if (!tooth) return false;
  if (tooth.mobility != null || Object.keys(tooth.furcation).length > 0) return true;
  return PROBING_SITES.some((s) =>
    tooth.pocketDepth[s] != null || tooth.recession[s] != null || tooth.bleeding[s] || tooth.plaque[s] || tooth.suppuration[s]);
}

export const isEmptyChart = (data: PerioData): boolean => ALL_TEETH.every((c) => !hasMeasurements(data[c]));

// ── tooth status ─────────────────────────────────────────────────────────

export function withToothStatus(status: ToothStatusMap, tooth: string, next: ToothStatus): ToothStatusMap {
  const copy: Record<string, AbsentStatus> = { ...status };
  if (next === 'present') delete copy[tooth];
  else copy[tooth] = next;
  return copy;
}

export const statusOf = (status: ToothStatusMap, tooth: string): ToothStatus => status[tooth] ?? 'present';

/** Furcation sites exist only on some teeth: used to decide whether the chart can show one. */
export const hasFurcation = (tooth: string): boolean => furcationSitesOf(tooth).length > 0;

// ── summary ─────────────────────────────────────────────────────────────

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The figures of the summary card. The server computes the same ones for the history list; both are
 * pinned to the same hand-worked chart in their specs.
 */
export function summarize(data: PerioData): PerioSummary {
  let recorded = 0, bleeding = 0, plaque = 0, suppuration = 0;
  let depthCount = 0, depthSum = 0, depthFourOrMore = 0;
  let deepest: number | null = null;
  let recessionCount = 0, recessionSum = 0;
  let calCount = 0, calSum = 0, calFiveOrMore = 0;

  for (const code of ALL_TEETH) {
    const tooth = data[code];
    if (!tooth) continue;
    for (const site of PROBING_SITES) {
      const depth = tooth.pocketDepth[site];
      const recession = tooth.recession[site];
      const bled = tooth.bleeding[site];
      const plaqued = tooth.plaque[site];
      const pus = tooth.suppuration[site];
      if (depth == null && recession == null && !bled && !plaqued && !pus) continue;
      recorded++;
      if (bled) bleeding++;
      if (plaqued) plaque++;
      if (pus) suppuration++;
      if (depth != null) {
        depthCount++;
        depthSum += depth;
        if (depth >= 4) depthFourOrMore++;
        if (deepest === null || depth > deepest) deepest = depth;
      }
      if (recession != null) {
        recessionCount++;
        recessionSum += recession;
      }
      if (depth != null && recession != null) {
        const cal = depth + recession;
        calCount++;
        calSum += cal;
        if (cal >= 5) calFiveOrMore++;
      }
    }
  }

  const percent = (part: number, whole: number): number => (whole === 0 ? 0 : round1((100 * part) / whole));
  return {
    sitesRecorded: recorded,
    bleedingPercent: percent(bleeding, recorded),
    plaquePercent: percent(plaque, recorded),
    suppurationPercent: percent(suppuration, recorded),
    meanPocketDepth: depthCount ? round1(depthSum / depthCount) : null,
    pocketsAboveFourPercent: depthCount ? round1((100 * depthFourOrMore) / depthCount) : null,
    deepestPocketDepth: deepest,
    meanRecession: recessionCount ? round1(recessionSum / recessionCount) : null,
    meanCal: calCount ? round1(calSum / calCount) : null,
    sitesAboveFiveCalPercent: calCount ? round1((100 * calFiveOrMore) / calCount) : null,
  };
}
