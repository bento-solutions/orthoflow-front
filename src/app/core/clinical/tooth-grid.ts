import { DentalChartType } from '../models/patient.model';

/**
 * Which tooth an arrow key goes to. Both charts walk the mouth the same way, so a key does the
 * same thing wherever the doctor learned it: left and right along the arch, up and down to the
 * tooth it bites against. The rows run from the patient's right to their left, which is left to
 * right on every chart, so an arrow means the same on an Arabic screen as on a French one.
 */

export type ToothGrid = readonly (readonly string[])[];

const ARCHES: Record<DentalChartType, ToothGrid> = {
  adult: [
    ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
    ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'],
  ],
  child: [
    ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'],
    ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'],
  ],
};

/** One row per quadrant, as the 3D chart stands the teeth on a screen taller than it is wide. */
const QUADRANTS: Record<DentalChartType, ToothGrid> = {
  adult: [
    ['18', '17', '16', '15', '14', '13', '12', '11'],
    ['21', '22', '23', '24', '25', '26', '27', '28'],
    ['48', '47', '46', '45', '44', '43', '42', '41'],
    ['31', '32', '33', '34', '35', '36', '37', '38'],
  ],
  child: [
    ['55', '54', '53', '52', '51'],
    ['61', '62', '63', '64', '65'],
    ['85', '84', '83', '82', '81'],
    ['71', '72', '73', '74', '75'],
  ],
};

export function toothGrid(type: DentalChartType, quadrantRows = false): ToothGrid {
  return (quadrantRows ? QUADRANTS : ARCHES)[type];
}

/**
 * The tooth a key moves to, or null when the key does not move anything. At the end of a row
 * focus stays where it is, as in any grid: wrapping would jump to the other side of the mouth.
 */
export function stepInGrid(grid: ToothGrid, fdi: string, key: string, toEnds = false): string | null {
  const row = grid.findIndex((r) => r.includes(fdi));
  if (row < 0) return null;
  const column = grid[row].indexOf(fdi);
  const last = grid[row].length - 1;
  switch (key) {
    case 'ArrowLeft': return grid[row][Math.max(0, column - 1)];
    case 'ArrowRight': return grid[row][Math.min(last, column + 1)];
    case 'ArrowUp': return grid[Math.max(0, row - 1)][column];
    case 'ArrowDown': return grid[Math.min(grid.length - 1, row + 1)][column];
    case 'Home': return toEnds ? grid[0][0] : grid[row][0];
    case 'End': return toEnds ? grid[grid.length - 1][grid[grid.length - 1].length - 1] : grid[row][last];
    default: return null;
  }
}

/** Typing a tooth's number goes to it: the shortest way there from anywhere on the chart. */
export class ToothNumberTyping {
  private typed = '';
  private at = 0;

  /** The tooth the typed digits name, once both have been typed. */
  type(digit: string, teeth: readonly string[], now: number): string | null {
    this.typed = now - this.at < 900 ? this.typed + digit : digit;
    this.at = now;
    if (this.typed.length < 2) return null;
    const fdi = this.typed;
    this.typed = '';
    return teeth.includes(fdi) ? fdi : null;
  }
}
