import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { DentitionView } from '../../core/services/dental-3d-view.service';

/**
 * Where each tooth stands in each of the chart's arrangements.
 *
 * The panoramic arrangement (the chart's default until Nov 2026, and still one click away) unrolls the arches, like a panoramic radiograph: upper
 * teeth above with their crowns down, lower teeth below with their crowns up,
 * the patient's right on the left of the screen, every crown and every root in
 * sight at the same size. It is the picture a dentist already reads every day,
 * and nothing is hidden behind anything, so it needs no rotating before it can
 * be used. Tilting each tooth forward brings its biting surface into the same view.
 *
 * Each tooth is rigid and keeps its own place in the row, so going from one
 * arrangement to another is just a move and a turn per tooth.
 */

/** What the bake records about a tooth, in model units. */
export interface ToothMetrics {
  readonly fdi: string;
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly crownHeight: number;
  readonly rootLength: number;
  readonly top: number;
  readonly bottom: number;
  readonly apex: readonly [number, number, number];
}

export interface ToothPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface DentitionLayout {
  readonly poses: ReadonlyMap<string, ToothPose>;
  /** How far the tooth numbers stand from each row's centre line, clear of the longest crown. */
  readonly labelReach: { readonly upper: number; readonly lower: number };
  /** Half extents of what must be framed, centred on the origin. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly orbit: { readonly azimuth: number; readonly polarMin: number; readonly polarMax: number };
  /** The camera's direction from the centre of the arrangement. */
  readonly cameraDirection: Vector3;
  /**
   * Where each jaw stands, as the one rigid move from the natural arch (the bake's own space) to this
   * arrangement. The gums and the palate ride on it with their teeth. Null when the teeth have left
   * their natural arches: there is no gum round teeth laid out in a row.
   */
  readonly jaws: { readonly upper: Matrix4; readonly lower: Matrix4 } | null;
}

const isUpper = (fdi: string) => ['1', '2', '5', '6'].includes(fdi.charAt(0));
const isRightSide = (fdi: string) => ['1', '4', '5', '8'].includes(fdi.charAt(0));

/** Space between neighbouring teeth, as a share of the row's mean tooth width. */
const TOOTH_GAP = 0.12;

/**
 * Teeth of one row in screen order, from the patient's right to their left. Ordered
 * by quadrant and position, not by where they stand, because a row must never swap teeth.
 */
export function rowOrder(teeth: readonly ToothMetrics[], upper: boolean): ToothMetrics[] {
  const row = teeth.filter((t) => isUpper(t.fdi) === upper);
  const right = row.filter((t) => isRightSide(t.fdi)).sort((a, b) => Number(b.fdi.charAt(1)) - Number(a.fdi.charAt(1)));
  const left = row.filter((t) => !isRightSide(t.fdi)).sort((a, b) => Number(a.fdi.charAt(1)) - Number(b.fdi.charAt(1)));
  return [...right, ...left];
}

function rowPositions(row: readonly ToothMetrics[], pitch: (t: ToothMetrics) => number, gap: number): { x: Map<string, number>; halfWidth: number } {
  const total = row.reduce((sum, t) => sum + pitch(t), 0) + gap * Math.max(0, row.length - 1);
  const x = new Map<string, number>();
  let cursor = -total / 2;
  for (const tooth of row) {
    const width = pitch(tooth);
    x.set(tooth.fdi, cursor + width / 2);
    cursor += width + gap;
  }
  return { x, halfWidth: total / 2 };
}

function rows(
  teeth: readonly ToothMetrics[],
  tilt: number,
  yaw: number,
): DentitionLayout {
  const upper = rowOrder(teeth, true);
  const lower = rowOrder(teeth, false);
  const meanWidth = teeth.reduce((sum, t) => sum + t.halfWidth * 2, 0) / teeth.length;
  const gap = meanWidth * TOOTH_GAP;

  // Upper and lower teeth have different widths. Both rows share the wider row's
  // span, so 16 stays over 46 near enough for the eye, as on a radiograph.
  const span = Math.max(sumWidths(upper) + gap * (upper.length - 1), sumWidths(lower) + gap * (lower.length - 1));
  const spread = (row: readonly ToothMetrics[]) => (span - sumWidths(row)) / Math.max(1, row.length - 1);

  const upperX = rowPositions(upper, (t) => t.halfWidth * 2, spread(upper));
  const lowerX = rowPositions(lower, (t) => t.halfWidth * 2, spread(lower));

  const cos = Math.abs(Math.cos(tilt));
  const sin = Math.abs(Math.sin(tilt));
  // How far a tooth reaches toward the central band and away from it once tilted.
  const reachCrown = (t: ToothMetrics) => t.top * cos + t.halfDepth * sin;
  const reachRoot = (t: ToothMetrics) => -t.bottom * cos + t.halfDepth * sin;

  // Wide enough for both rows of tooth numbers.
  const band = meanWidth * 1.35;
  const upperCrown = Math.max(...upper.map(reachCrown));
  const lowerCrown = Math.max(...lower.map(reachCrown));
  const upperY = band / 2 + upperCrown;
  const lowerY = -(band / 2 + lowerCrown);

  const poses = new Map<string, ToothPose>();
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  for (const tooth of upper) {
    const q = new Quaternion()
      .setFromEuler(new Euler(-tilt, 0, Math.PI, 'XYZ'))
      .multiply(facing);
    poses.set(tooth.fdi, { position: new Vector3(upperX.x.get(tooth.fdi)!, upperY, 0), quaternion: q });
  }
  for (const tooth of lower) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt).multiply(facing);
    poses.set(tooth.fdi, { position: new Vector3(lowerX.x.get(tooth.fdi)!, lowerY, 0), quaternion: q });
  }

  const top = upperY + Math.max(...upper.map(reachRoot));
  const bottom = -lowerY + Math.max(...lower.map(reachRoot));
  return {
    poses,
    labelReach: { upper: upperCrown, lower: lowerCrown },
    halfWidth: span / 2 + meanWidth * 0.2,
    // Room at the top and bottom for the captions over the stage.
    halfHeight: Math.max(top, bottom) + meanWidth * 0.4,
    orbit: { azimuth: Math.PI / 3, polarMin: Math.PI / 2 - Math.PI / 3, polarMax: Math.PI / 2 + Math.PI / 3 },
    cameraDirection: new Vector3(0, 0, 1),
    jaws: null,
  };
}

/**
 * The same teeth for a portrait screen, where sixteen in a row would leave each too small to
 * tap: one row per quadrant, the patient's right above their left, so a tooth is about twice as
 * wide. Upper teeth still point down and lower teeth up, with the numbers beside the crowns.
 */
function quadrantRows(teeth: readonly ToothMetrics[], tilt: number, yaw: number): DentitionLayout {
  const inQuadrants = (right: string, left: string, upper: boolean) => {
    const row = rowOrder(teeth, upper);
    return [row.filter((t) => t.fdi.charAt(0) === right), row.filter((t) => t.fdi.charAt(0) === left)];
  };
  const child = teeth.some((t) => Number(t.fdi.charAt(0)) >= 5);
  const [q1, q2] = inQuadrants(child ? '5' : '1', child ? '6' : '2', true);
  const [q4, q3] = inQuadrants(child ? '8' : '4', child ? '7' : '3', false);

  const meanWidth = teeth.reduce((sum, t) => sum + t.halfWidth * 2, 0) / teeth.length;
  const gap = meanWidth * TOOTH_GAP;
  const cos = Math.abs(Math.cos(tilt));
  const sin = Math.abs(Math.sin(tilt));
  const reachCrown = (t: ToothMetrics) => t.top * cos + t.halfDepth * sin;
  const reachRoot = (t: ToothMetrics) => -t.bottom * cos + t.halfDepth * sin;
  const band = meanWidth * 0.8;

  const poses = new Map<string, ToothPose>();
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const upperTurn = new Quaternion().setFromEuler(new Euler(-tilt, 0, Math.PI, 'XYZ')).multiply(facing);
  const lowerTurn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt).multiply(facing);

  let halfWidth = 0;
  let cursor = 0;
  const place = (row: readonly ToothMetrics[], upper: boolean) => {
    const positions = rowPositions(row, (t) => t.halfWidth * 2, gap);
    halfWidth = Math.max(halfWidth, positions.halfWidth);
    const roots = Math.max(...row.map(reachRoot));
    const crowns = Math.max(...row.map(reachCrown));
    // From the top down: roots then crown then numbers for an upper row, the reverse for a lower.
    const y = upper ? cursor - roots : cursor - band - crowns;
    for (const tooth of row) {
      poses.set(tooth.fdi, { position: new Vector3(positions.x.get(tooth.fdi)!, y, 0), quaternion: (upper ? upperTurn : lowerTurn).clone() });
    }
    cursor = upper ? y - crowns - band : y - roots;
  };
  place(q1, true);
  place(q2, true);
  place(q4, false);
  place(q3, false);

  // Centred, so upper rows are above the line and lower rows below it, as the numbers expect.
  const middle = cursor / 2;
  for (const pose of poses.values()) pose.position.y -= middle;

  return {
    poses,
    labelReach: { upper: Math.max(...[...q1, ...q2].map(reachCrown)), lower: Math.max(...[...q3, ...q4].map(reachCrown)) },
    halfWidth: halfWidth + meanWidth * 0.15,
    halfHeight: -cursor / 2 + meanWidth * 0.2,
    orbit: { azimuth: Math.PI / 3, polarMin: Math.PI / 2 - Math.PI / 3, polarMax: Math.PI / 2 + Math.PI / 3 },
    cameraDirection: new Vector3(0, 0, 1),
    jaws: null,
  };
}

function sumWidths(row: readonly ToothMetrics[]): number {
  return row.reduce((sum, t) => sum + t.halfWidth * 2, 0);
}

/** How far each jaw turns from the bite to part the arches: the teeth alone, then the mouth with its gums and palate. */
const ARCH_OPENING = 0.3;
const MOUTH_OPENING = 0.42;

/**
 * The natural arches, parted like an open mouth so neither hides the other. The mouth view parts them
 * a little more: the palate and the floor between the arches are what it is for, and they are seen
 * through the opening.
 */
function arches(teeth: readonly ToothMetrics[], opening = ARCH_OPENING, withGums = false): DentitionLayout {
  const upper = teeth.filter((t) => isUpper(t.fdi));
  const lower = teeth.filter((t) => !isUpper(t.fdi));

  const average = (list: readonly ToothMetrics[], axis: 0 | 1 | 2) => list.reduce((s, t) => s + t.position[axis], 0) / list.length;
  const midY = (average(upper, 1) + average(lower, 1)) / 2;
  const allZ = teeth.map((t) => t.position[2]);
  const backZ = Math.min(...allZ);
  const frontZ = Math.max(...allZ);
  const midX = average(teeth, 0);
  const hinge = new Vector3(midX, midY, backZ - (frontZ - backZ) * 0.25);
  const centreZ = (backZ + frontZ) / 2;
  const centre = new Vector3(midX, midY, centreZ);

  // Each jaw is one rigid body: the move of a tooth is the move of the jaw it stands in.
  const jaw = (turn: Quaternion) => new Matrix4()
    .makeTranslation(hinge.clone().sub(centre))
    .multiply(new Matrix4().makeRotationFromQuaternion(turn))
    .multiply(new Matrix4().makeTranslation(hinge.clone().negate()));
  const turns = {
    upper: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -opening),
    lower: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), opening),
  };

  const poses = new Map<string, ToothPose>();
  const box = { x: 0, y: 0 };
  for (const tooth of teeth) {
    const turn = isUpper(tooth.fdi) ? turns.upper : turns.lower;
    const position = new Vector3(...tooth.position).sub(hinge).applyQuaternion(turn).add(hinge);
    position.x -= midX;
    position.y -= midY;
    position.z -= centreZ;
    const quaternion = turn.clone().multiply(new Quaternion(...tooth.quaternion));
    poses.set(tooth.fdi, { position, quaternion });
    const reach = Math.max(tooth.top, -tooth.bottom);
    box.x = Math.max(box.x, Math.abs(position.x) + tooth.halfWidth);
    box.y = Math.max(box.y, Math.abs(position.y) + reach);
  }
  return {
    poses,
    labelReach: { upper: 0, lower: 0 },
    // Perspective shrinks the far teeth, so the box of them all is a generous frame; the gums go a little past the roots.
    halfWidth: withGums ? box.x * 0.96 + GUM_FRAME : box.x * 0.92,
    halfHeight: withGums ? box.y * 0.92 + GUM_FRAME : box.y * 0.86,
    orbit: { azimuth: Infinity, polarMin: 0.05, polarMax: Math.PI - 0.05 },
    cameraDirection: new Vector3(0, 0, 1),
    jaws: { upper: jaw(turns.upper), lower: jaw(turns.lower) },
  };
}

/** How much further than the teeth the frame reaches for the gums that go past their roots. */
const GUM_FRAME = 0.12;

const OVERVIEW_TILT = 0.34;
const OCCLUSAL_TILT = 1.32;

/** `portrait` is for a stage taller than it is wide: each quadrant gets a row of its own. */
export function layoutFor(view: DentitionView, teeth: readonly ToothMetrics[], portrait = false): DentitionLayout {
  const arrange = portrait ? quadrantRows : rows;
  switch (view) {
    case 'overview': return arches(teeth, MOUTH_OPENING, true);
    case 'panoramic': return arrange(teeth, OVERVIEW_TILT, 0);
    case 'occlusal': return arrange(teeth, OCCLUSAL_TILT, 0);
    case 'lingual': return arrange(teeth, OVERVIEW_TILT, Math.PI);
    case 'arch': return arches(teeth);
  }
}

/** Distance at which a box fits a perspective camera, whichever side is the tighter one. */
export function fitDistance(halfWidth: number, halfHeight: number, fovDegrees: number, aspect: number): number {
  const tan = Math.tan((fovDegrees * Math.PI) / 360);
  return Math.max(halfHeight / tan, halfWidth / (tan * Math.max(aspect, 0.01)));
}
