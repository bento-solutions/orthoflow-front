import { Arch, Face, FurcationSite, ProbingSite } from './perio.model';

/**
 * The geometry of the chart, in CSS pixels. Everything on it lines up on these numbers: the rows of
 * dots and cells above and below the teeth, the tooth drawings, and the probing lines drawn over
 * them. One millimetre is MM_PX pixels on the drawings.
 */

export const UPPER_TEETH: readonly string[] = [
  '18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28',
];
export const LOWER_TEETH: readonly string[] = [
  '48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38',
];
export const ALL_TEETH: readonly string[] = [...UPPER_TEETH, ...LOWER_TEETH];
export const teethOf = (arch: Arch): readonly string[] => (arch === 'upper' ? UPPER_TEETH : LOWER_TEETH);

/** Gap between the two halves of an arch (between teeth 11/21 and 41/31). */
export const MID_GAP = 12;
/** Distance of the mesial and distal sites from the middle one. */
export const SITE_OFFSET = 12;
/** Height of a tooth drawing. */
export const TOOTH_HEIGHT = 100;
/** Width of the pill that groups a tooth's three measurement cells. */
export const PILL_WIDTH = 36;
/** Pixels per millimetre on the tooth drawings. */
export const MM_PX = 4;
/** Width of the label column to the left of every row, and the gap between label and row. */
export const LABEL_WIDTH = 112;
export const LABEL_GAP = 8;

/** Incisors 38, canines 48, premolars 45, molars 68: roughly the width of the crowns. */
export function toothWidth(tooth: string): number {
  switch (tooth.charAt(1)) {
    case '1':
    case '2':
      return 38;
    case '4':
    case '5':
      return 45;
    case '6':
    case '7':
    case '8':
      return 68;
    default:
      return 48;
  }
}

export interface ToothSlot {
  readonly code: string;
  /** Left edge, from the left of the arch. */
  readonly x: number;
  readonly width: number;
  /** Horizontal middle of the tooth: where the buccal/lingual site sits. */
  readonly center: number;
  /** x of the three sites, left to right (the drawings and the cells share them). */
  readonly siteX: readonly [number, number, number];
  readonly index: number;
}

function buildSlots(arch: Arch): { slots: ToothSlot[]; width: number } {
  let x = 0;
  const slots = teethOf(arch).map((code, index) => {
    if (index === 8) x += MID_GAP;
    const width = toothWidth(code);
    const center = x + width / 2;
    const slot: ToothSlot = {
      code, x, width, center, index,
      siteX: [center - SITE_OFFSET, center, center + SITE_OFFSET],
    };
    x += width;
    return slot;
  });
  return { slots, width: x };
}

const LAYOUTS: Record<Arch, { slots: ToothSlot[]; width: number }> = {
  upper: buildSlots('upper'),
  lower: buildSlots('lower'),
};

/** The 16 teeth of an arch with their position. The mid gap is already accounted for. */
export const slotsOf = (arch: Arch): readonly ToothSlot[] => LAYOUTS[arch].slots;
/** Width of an arch. Both arches are the same width (848). */
export const archWidth = (arch: Arch): number => LAYOUTS[arch].width;

/** Quadrants 2 and 3 are drawn mirrored: the patient's left is on the viewer's right. */
export const isMirrored = (tooth: string): boolean => tooth.charAt(0) === '2' || tooth.charAt(0) === '3';
export const isUpperTooth = (tooth: string): boolean => tooth.charAt(0) === '1' || tooth.charAt(0) === '2';

/**
 * The three probing sites of one face, left to right as drawn: the distal site is toward the back of
 * the mouth, so on the patient's right (quadrants 1 and 4, left side of the screen) it comes first.
 */
export function probingSitesOf(tooth: string, face: Face): readonly [ProbingSite, ProbingSite, ProbingSite] {
  const mesialFirst = isMirrored(tooth);
  if (face === 'buccal') {
    return mesialFirst ? ['mesiobuccal', 'buccal', 'distobuccal'] : ['distobuccal', 'buccal', 'mesiobuccal'];
  }
  return mesialFirst ? ['mesiolingual', 'lingual', 'distolingual'] : ['distolingual', 'lingual', 'mesiolingual'];
}

/** The drawing of a tooth, as published in /perio/teeth (quadrants 1 and 3 only; 2 and 4 are mirrored). */
export function toothImageUrl(tooth: string, arch: Arch, face: Face): string {
  const quadrant = tooth.charAt(0);
  const position = tooth.charAt(1);
  const view = face === 'buccal' ? 'b' : arch === 'upper' ? 'p' : 'l';
  const [folder, file] = quadrant === '1' || quadrant === '2' ? ['Q1', `1${position}`] : ['Q3', `4${position}`];
  return `/perio/teeth/${folder}/${file}-${view}.svg`;
}

/**
 * Where the gum margin sits on a tooth drawing, and which way the root lies. `direction` 1 means
 * the root is toward the top of the drawing (the upper arch seen from the cheek, the lower arch
 * seen from the tongue), so a deeper pocket is a smaller y.
 */
export function marginOf(arch: Arch, face: Face): { baseY: number; direction: 1 | -1 } {
  const rootUp = arch === 'upper' ? face === 'buccal' : face === 'lingual';
  return { baseY: rootUp ? 65 : 35, direction: rootUp ? 1 : -1 };
}

/** y of the gum margin at a site, given its recession (null = margin at the junction). */
export const marginY = (baseY: number, direction: 1 | -1, recession: number | null): number | null =>
  recession == null ? null : baseY - direction * recession * MM_PX;

/** y of the bottom of the pocket, measured from the margin (or from the junction when no recession). */
export const pocketY = (baseY: number, direction: 1 | -1, margin: number | null, depth: number | null): number | null =>
  depth == null ? null : (margin ?? baseY) - direction * depth * MM_PX;

/** The millimetre rulings behind the teeth: one every MM_PX, from the junction toward the root. */
export function rulerLines(baseY: number, direction: 1 | -1, count: number): number[] {
  const lines: number[] = [];
  for (let i = 0; i < count; i++) {
    const y = baseY - direction * i * MM_PX;
    if (y >= 0) lines.push(y);
  }
  return lines;
}

/** Horizontal positions of the dots drawn on a tooth, which spread wider on molars than the cells do. */
export function dotXs(width: number): readonly [number, number, number] {
  const offset = Math.max(12, width * 0.25);
  const middle = width / 2;
  return [middle - offset, middle, middle + offset];
}

/** Furcation sites drawn under/over the teeth: which can be probed on which tooth. */
const MAXILLARY_MOLARS = ['16', '17', '18', '26', '27', '28'];
const MAXILLARY_PREMOLARS = ['14', '15', '24', '25'];
const MANDIBULAR_MOLARS = ['36', '37', '38', '46', '47', '48'];

export function furcationSitesOf(tooth: string): readonly FurcationSite[] {
  if (MAXILLARY_MOLARS.includes(tooth)) return ['buccal', 'palatal_mesial', 'palatal_distal'];
  if (MAXILLARY_PREMOLARS.includes(tooth)) return ['buccal'];
  if (MANDIBULAR_MOLARS.includes(tooth)) return ['buccal', 'lingual'];
  return [];
}

/** The two palatal furcations of an upper molar, drawn in the palatal rows. */
export const palatalFurcationsOf = (tooth: string): readonly FurcationSite[] =>
  isUpperTooth(tooth) ? furcationSitesOf(tooth).filter((s) => s === 'palatal_mesial' || s === 'palatal_distal') : [];

/** Universal numbering runs 1 to 32 from the patient's upper right third molar, round to the lower right one. */
const UNIVERSAL: Readonly<Record<string, string>> = Object.fromEntries(
  [...UPPER_TEETH, ...[...LOWER_TEETH.slice(8)].reverse(), ...[...LOWER_TEETH.slice(0, 8)].reverse()]
    .map((fdi, i) => [fdi, String(i + 1)]));

export type ToothNumbering = 'FDI' | 'universal';

/** The number a tooth is shown under: its FDI code, or 1-32. */
export const toothLabel = (fdi: string, numbering: ToothNumbering): string =>
  numbering === 'universal' ? UNIVERSAL[fdi] ?? fdi : fdi;
