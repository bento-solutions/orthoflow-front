import { isSiteValid } from './perio-navigation';
import {
  CellSite, FURCATION_GRADES, FurcationGrade, MAX_MOBILITY, MAX_POCKET_DEPTH, MAX_RECESSION, MIN_RECESSION, ModeValue, PerioMode,
} from './perio.model';
import { furcationSitesOf } from './perio-layout';

/** Why a value was refused, as a translation key under PERIO.VALIDATION. */
export type RefusalKey =
  | 'POCKET_DEPTH_NEGATIVE' | 'POCKET_DEPTH_TOO_LARGE' | 'POCKET_DEPTH_INVALID'
  | 'RECESSION_TOO_SMALL' | 'RECESSION_TOO_LARGE' | 'RECESSION_INVALID'
  | 'BLEEDING_INVALID' | 'PLAQUE_INVALID' | 'SUPPURATION_INVALID'
  | 'MOBILITY_INVALID' | 'FURCATION_INVALID' | 'FURCATION_NO_SITES' | 'MOBILITY_ONLY_BUCCAL' | 'SITE_INVALID';

const REFUSAL_KEY_SET: Record<RefusalKey, true> = {
  POCKET_DEPTH_NEGATIVE: true, POCKET_DEPTH_TOO_LARGE: true, POCKET_DEPTH_INVALID: true,
  RECESSION_TOO_SMALL: true, RECESSION_TOO_LARGE: true, RECESSION_INVALID: true,
  BLEEDING_INVALID: true, PLAQUE_INVALID: true, SUPPURATION_INVALID: true,
  MOBILITY_INVALID: true, FURCATION_INVALID: true, FURCATION_NO_SITES: true, MOBILITY_ONLY_BUCCAL: true, SITE_INVALID: true,
};
/** Every key `refuse` can return: each needs a translation (checked in dynamic-keys.spec). */
export const REFUSAL_KEYS = Object.keys(REFUSAL_KEY_SET) as RefusalKey[];

export interface InputRefusal {
  readonly key: RefusalKey;
  readonly params?: Record<string, string>;
}

/** Whether `value` can be written at this site. null = fine. */
export function refuse(value: ModeValue, mode: PerioMode, tooth: string, site: CellSite): InputRefusal | null {
  switch (mode) {
    case 'pocketDepth':
      if (value === null) break;
      if (typeof value !== 'number' || !Number.isInteger(value)) return { key: 'POCKET_DEPTH_INVALID' };
      if (value < 0) return { key: 'POCKET_DEPTH_NEGATIVE' };
      if (value > MAX_POCKET_DEPTH) return { key: 'POCKET_DEPTH_TOO_LARGE' };
      break;
    case 'recession':
      if (value === null) break;
      if (typeof value !== 'number' || !Number.isInteger(value)) return { key: 'RECESSION_INVALID' };
      if (value < MIN_RECESSION) return { key: 'RECESSION_TOO_SMALL' };
      if (value > MAX_RECESSION) return { key: 'RECESSION_TOO_LARGE' };
      break;
    case 'bleeding':
    case 'plaque':
    case 'suppuration':
      if (typeof value !== 'boolean') return { key: `${mode.toUpperCase()}_INVALID` as RefusalKey };
      break;
    case 'mobility':
      if (value === null) break;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_MOBILITY) return { key: 'MOBILITY_INVALID' };
      break;
    case 'furcation':
      if (value === null) break;
      if (!FURCATION_GRADES.includes(value as FurcationGrade)) return { key: 'FURCATION_INVALID' };
      break;
  }
  if (mode === 'furcation' && furcationSitesOf(tooth).length === 0) {
    return { key: 'FURCATION_NO_SITES', params: { toothCode: tooth } };
  }
  if (!isSiteValid(site, mode, tooth)) {
    return { key: mode === 'mobility' ? 'MOBILITY_ONLY_BUCCAL' : 'SITE_INVALID', params: { site, mode } };
  }
  return null;
}

export const FURCATION_BY_KEY: Readonly<Record<number, FurcationGrade>> = { 1: 'I', 2: 'II', 3: 'III' };

/** How long a lone "1" waits for a second digit before it means one millimetre. */
export const DIGIT_WAIT_MS = 500;

/**
 * Typing a depth: 0 and 2-9 are complete at once, but a depth of 10 to 16 starts with "1", so a "1" waits
 * a moment for a second digit. The pending digit belongs to the site it was typed at, whatever happens to
 * the focus afterwards.
 */
export class DigitBuffer {
  private pending: { value: number; cell: { tooth: string; site: CellSite }; mode: PerioMode } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly commit: (value: number, tooth: string, site: CellSite, mode: PerioMode) => void,
              private readonly waitMs = DIGIT_WAIT_MS) {}

  get isPending(): boolean {
    return this.pending !== null;
  }

  /** A digit was typed at this cell. */
  type(digit: number, tooth: string, site: CellSite, mode: PerioMode): void {
    const wide = mode === 'pocketDepth' || mode === 'recession';
    if (this.pending) {
      const { value, cell, mode: pendingMode } = this.pending;
      this.clear();
      this.commit(value * 10 + digit, cell.tooth, cell.site, pendingMode);
      return;
    }
    if (!wide || digit === 0 || digit >= 2) {
      this.commit(digit, tooth, site, mode);
      return;
    }
    this.pending = { value: digit, cell: { tooth, site }, mode };
    this.timer = setTimeout(() => this.flush(), this.waitMs);
  }

  /** Whatever is waiting is complete: write it where it was typed. */
  flush(): void {
    if (!this.pending) return;
    const { value, cell, mode } = this.pending;
    this.clear();
    this.commit(value, cell.tooth, cell.site, mode);
  }

  /** Drop what is waiting (the value was cleared, or the screen goes away). */
  cancel(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
