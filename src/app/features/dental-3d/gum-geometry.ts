import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3, Quaternion } from 'three';
import { ToothMetrics, rowOrder } from './dentition-layout';

/**
 * The gums and the palate, built from the teeth they hold.
 *
 * The model has no soft tissue, so the mouth is made here, round the teeth as the bake placed them in
 * the natural arch: each jaw is a horseshoe swept along the necks of its teeth, its cross-section a
 * rolled margin at the neck, a cheek side and a tongue side that bulge over the roots and close under
 * them, and a crest between the two margins. The margin rises into a papilla between every two
 * teeth and falls to the neck at each one, which is the scallop a gum has. The upper jaw also gets
 * the palate: a vault rising from the tongue side of the ridge to the middle of the mouth.
 *
 * Everything the engine needs to show a state is in the vertices, so a state is one small texture and
 * nothing is rebuilt when one changes (dentition-engine.ts):
 *
 *  - `_g`    where the vertex stands: x is its place along the arch in tooth units, counted from the
 *            jaw's first slot (a tooth is at a whole number, an interdental papilla at a half); y is its
 *            band, 0 at the gum margin and 1 at the base (on the palate, 0 at the ridge and 1 in the
 *            middle of the vault); z is the side, +1 cheek, -1 tongue, 0 crest or palate; w is 0 for
 *            the ridge and 1 for the palate (z is 3 on the far edge of the palate, which fades out).
 *  - `_axis` the way toward the crown there, which is the way a receding margin moves away from.
 *
 * Built in the bake's model units and in the natural arch; the layout's jaw matrix moves each jaw
 * where its teeth stand (dentition-layout.ts).
 */

/** Each jaw has this many slots in the engine's gum texture, whatever its teeth: the lower one starts after the upper. */
export const GUM_SLOTS_PER_JAW = 32;
export const GUM_SLOT_OFFSET = { upper: 0, lower: GUM_SLOTS_PER_JAW } as const;

export interface GumJaw {
  readonly geometry: BufferGeometry;
  /** The tooth of each slot of this jaw, from the patient's right round to their left. */
  readonly fdis: readonly string[];
  /** The first slot of this jaw in the engine's gum texture. */
  readonly offset: number;
}

export interface GumModel {
  readonly upper: GumJaw | null;
  readonly lower: GumJaw | null;
}

/** Steps of the curve between two teeth. */
const SEGMENTS_PER_TOOTH = 8;
/** How far the gum goes past the last tooth of a jaw, in teeth, tapering to nothing: the pad behind the last molar. */
const BEYOND = 1;
/** Where, past the last tooth's centre, the full size of the gum starts to taper, in teeth. */
const TAPER_FROM = 0.5;
/** Points down each side of the cross-section, from the margin to the base. */
const SIDE_POINTS = 8;
/** Rings from the ridge to the middle of the palate. */
const PALATE_RINGS = 10;
/** The side mark of the palate's far edge, which fades out: no side of the ridge has it. */
export const PALATE_BACK = 3;
/** Where on the tongue side the palate leaves the ridge: the share of the way down from the margin. */
const PALATE_FROM = 0.5;

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

interface Sample {
  readonly at: Vector3;
  /** Along the arch. */
  readonly tangent: Vector3;
  /** Toward the crown. */
  readonly up: Vector3;
  /** Toward the cheek. */
  readonly out: Vector3;
  /** Place along the arch in tooth units. */
  readonly k: number;
  readonly depth: number;
  readonly root: number;
  readonly crown: number;
  /** 1 along the teeth, falling to 0 at the rounded ends past the last ones. */
  readonly taper: number;
}

/**
 * The one jaw. `row` is its teeth from the patient's right round to their left.
 */
function buildJaw(row: readonly ToothMetrics[], offset: number, upper: boolean): GumJaw | null {
  const n = row.length;
  if (n < 2) return null;

  const necks = row.map((t) => new Vector3(...t.position));
  const ups = row.map((t) => new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...t.quaternion)));
  const outs = row.map((t) => new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...t.quaternion)));
  // The arch goes on, straight, a tooth past each end: the gum is not cut off at the last molar, it runs out behind it.
  const along = (from: Vector3, toward: Vector3) => from.clone().add(from.clone().sub(toward).setLength(from.distanceTo(toward) * BEYOND));
  const curve = new CatmullRomCurve3(
    [along(necks[0], necks[1]), ...necks, along(necks[n - 1], necks[n - 2])], false, 'centripetal');

  // k runs from -BEYOND to n - 1 + BEYOND: a tooth is at a whole number.
  const span = n - 1 + BEYOND * 2;
  const count = Math.round(span * SEGMENTS_PER_TOOTH) + 1;
  const samples: Sample[] = [];
  for (let m = 0; m < count; m++) {
    const t = m / (count - 1);
    const k = -BEYOND + t * span;
    // What the gum is made of past the last tooth is what the last tooth had.
    const held = Math.min(n - 1, Math.max(0, k));
    const i0 = Math.min(Math.floor(held), n - 2);
    const f = held - i0;
    const lerp = (a: number, b: number) => a + (b - a) * f;
    const tangent = curve.getTangent(t).normalize();
    // The way toward the crown, taken square to the arch; the cheek is square to both.
    const upRaw = ups[i0].clone().lerp(ups[i0 + 1], f);
    const up = upRaw.sub(tangent.clone().multiplyScalar(tangent.dot(upRaw))).normalize();
    const outRaw = outs[i0].clone().lerp(outs[i0 + 1], f);
    const out = outRaw
      .sub(tangent.clone().multiplyScalar(tangent.dot(outRaw)))
      .sub(up.clone().multiplyScalar(up.dot(outRaw)))
      .normalize();
    // Full size from the last tooth's far side, tapering to a rounded end.
    const outside = Math.max(-k, k - (n - 1));
    const taper = 1 - smooth(TAPER_FROM, BEYOND, outside);
    samples.push({
      at: curve.getPoint(t),
      tangent, up, out, k, taper,
      depth: lerp(row[i0].halfDepth, row[i0 + 1].halfDepth),
      root: lerp(row[i0].rootLength, row[i0 + 1].rootLength),
      crown: lerp(row[i0].crownHeight, row[i0 + 1].crownHeight),
    });
  }

  // ── The cross-section: a loop of points, one side after the other ──────────
  const profile = (s: Sample) => {
    const pw = Math.pow((1 - Math.cos(Math.PI * 2 * s.k)) / 2, 1.3) * s.taper;
    // At a tooth the margin stands a little over the neck; between two it rises into the papilla.
    const atNeck = s.crown * 0.05;
    const rise = s.crown * 0.34 * pw;
    const size = 0.18 + 0.82 * s.taper;
    const depth = (s.root * 1.02 + 0.07) * (0.4 + 0.6 * s.taper);
    const thick = s.depth * size;
    const points: Array<{ o: number; h: number; band: number; side: number }> = [];
    // The scallop is the margin's: it has gone by half way down, and the base is smooth.
    const heightAt = (band: number) => atNeck - band * depth + rise * (1 - smooth(0, 0.55, band));
    for (let j = 0; j <= SIDE_POINTS; j++) {
      const band = j / SIDE_POINTS;
      const bulge = 0.8 + 0.22 * smooth(0, 0.28, band) - 0.32 * smooth(0.55, 1, band);
      points.push({ o: thick * bulge, h: heightAt(band), band, side: 1 });
    }
    // Closed under the roots, round.
    for (const [o, drop] of [[0.42, 0.05], [0, 0.07], [-0.42, 0.05]] as const) {
      points.push({ o: thick * o, h: atNeck - depth - drop * size, band: 1, side: 0 });
    }
    for (let j = SIDE_POINTS; j >= 0; j--) {
      const band = j / SIDE_POINTS;
      const bulge = 0.78 + 0.18 * smooth(0, 0.28, band) - 0.28 * smooth(0.55, 1, band);
      points.push({ o: -thick * bulge, h: heightAt(band), band, side: -1 });
    }
    return points;
  };
  const perSample = (SIDE_POINTS + 1) * 2 + 3;

  const positions: number[] = [];
  const axes: number[] = [];
  const marks: number[] = [];
  const place = (s: Sample, o: number, h: number): [number, number, number] => [
    s.at.x + s.out.x * o + s.up.x * h,
    s.at.y + s.out.y * o + s.up.y * h,
    s.at.z + s.out.z * o + s.up.z * h,
  ];
  for (const s of samples) {
    for (const p of profile(s)) {
      positions.push(...place(s, p.o, p.h));
      axes.push(s.up.x, s.up.y, s.up.z);
      marks.push(offset + Math.min(n - 1, Math.max(0, s.k)), p.band, p.side, 0);
    }
  }

  const index: number[] = [];
  for (let m = 0; m < count - 1; m++) {
    for (let e = 0; e < perSample; e++) {
      const next = (e + 1) % perSample;
      const a = m * perSample + e;
      const b = m * perSample + next;
      const c = (m + 1) * perSample + next;
      const d = (m + 1) * perSample + e;
      index.push(a, b, c, a, c, d);
    }
  }

  // The ends of the horseshoe are closed with a fan, each looking along the arch and away from the jaw.
  const cap = (m: number, outward: Vector3) => {
    const first = positions.length / 3;
    const centre = new Vector3();
    for (let e = 0; e < perSample; e++) {
      centre.x += positions[(m * perSample + e) * 3];
      centre.y += positions[(m * perSample + e) * 3 + 1];
      centre.z += positions[(m * perSample + e) * 3 + 2];
    }
    centre.divideScalar(perSample);
    positions.push(centre.x, centre.y, centre.z);
    axes.push(samples[m].up.x, samples[m].up.y, samples[m].up.z);
    // w = 2 marks the middle of a cap: it keeps the winding chosen here when the ridge is turned.
    marks.push(offset + Math.min(n - 1, Math.max(0, samples[m].k)), 1, 0, 2);
    const at = (e: number) => new Vector3(positions[(m * perSample + e) * 3], positions[(m * perSample + e) * 3 + 1], positions[(m * perSample + e) * 3 + 2]);
    const facing = at(0).sub(centre).cross(at(1).sub(centre)).dot(outward) >= 0;
    for (let e = 0; e < perSample; e++) {
      const here = m * perSample + e;
      const next = m * perSample + (e + 1) % perSample;
      if (facing) index.push(first, here, next);
      else index.push(first, next, here);
    }
  };
  cap(0, samples[0].tangent.clone().negate());
  cap(count - 1, samples[count - 1].tangent.clone());

  // ── The palate ─────────────────────────────────────────────────────────────
  if (upper) {
    const fromIndex = SIDE_POINTS + 1 + 3 + Math.round((1 - PALATE_FROM) * SIDE_POINTS);
    const ring: Vector3[] = [];
    const ringK: number[] = [];
    // The ring along the back, behind the last teeth, is not a gum: it fades into the throat.
    const ringBack: boolean[] = [];
    for (let m = 0; m < count; m++) {
      const at = (m * perSample + fromIndex) * 3;
      ring.push(new Vector3(positions[at], positions[at + 1], positions[at + 2]));
      ringK.push(Math.min(n - 1, Math.max(0, samples[m].k)));
      ringBack.push(false);
    }
    // Behind the last teeth the palate carries on straight across, from the end of one side to the other.
    const BACK = 8;
    const first = ring[0];
    const last = ring[ring.length - 1];
    for (let b = 1; b < BACK; b++) {
      ring.push(last.clone().lerp(first, b / BACK));
      ringK.push(b < BACK / 2 ? n - 1 : 0);
      ringBack.push(true);
    }
    const centre = new Vector3();
    ring.forEach((p) => centre.add(p));
    centre.divideScalar(ring.length);
    const up = new Vector3();
    samples.forEach((s) => up.add(s.up));
    up.normalize();
    const apical = up.clone().negate();
    const meanRoot = samples.reduce((sum, s) => sum + s.root, 0) / samples.length;
    const vault = 0.3 + 0.45 * meanRoot;

    const base = positions.length / 3;
    for (let i = 0; i < ring.length; i++) {
      for (let u = 0; u <= PALATE_RINGS; u++) {
        const x = u / PALATE_RINGS;
        const p = ring[i].clone().lerp(centre, x).addScaledVector(apical, vault * (1 - Math.pow(1 - x, 2.2)));
        positions.push(p.x, p.y, p.z);
        axes.push(up.x, up.y, up.z);
        marks.push(offset + ringK[i], x, ringBack[i] ? PALATE_BACK : 0, 1);
      }
    }
    const rings = ring.length;
    const width = PALATE_RINGS + 1;
    for (let i = 0; i < rings; i++) {
      const next = (i + 1) % rings;
      for (let u = 0; u < PALATE_RINGS; u++) {
        const a = base + i * width + u;
        const b = base + next * width + u;
        const c = base + next * width + u + 1;
        const d = base + i * width + u + 1;
        index.push(a, b, c, a, c, d);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('_axis', new Float32BufferAttribute(axes, 3));
  geometry.setAttribute('_g', new Float32BufferAttribute(marks, 4));
  geometry.setIndex(index);
  orientOutward(geometry, row, samples, upper);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  return { geometry, fdis: row.map((t) => t.fdi), offset };
}

/**
 * Turns the triangles so that every face looks out of the solid: the ridge away from the inside of the
 * horseshoe's tube, the palate down toward the mouth. Decided from the geometry, so it holds whichever
 * way the bake's frames happen to run.
 */
function orientOutward(geometry: BufferGeometry, row: readonly ToothMetrics[], samples: readonly Sample[], upper: boolean): void {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const marks = geometry.getAttribute('_g');
  const centre = new Vector3();
  row.forEach((t) => centre.add(new Vector3(...t.position)));
  centre.divideScalar(row.length);
  const up = new Vector3();
  samples.forEach((s) => up.add(s.up));
  up.normalize();

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();
  const middle = new Vector3();
  let ridgeVotes = 0;
  let palateVotes = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    normal.subVectors(b, a).cross(c.clone().sub(a));
    if (marks.getW(index.getX(i)) === 1) {
      // The palate looks toward the bite.
      palateVotes += Math.sign(normal.dot(up));
    } else if (marks.getZ(index.getX(i)) !== 0 && marks.getY(index.getX(i)) > 0.15) {
      // A side of the ridge looks away from the middle of the tube: the cheek away from the mouth, the tongue into it.
      middle.copy(a).add(b).add(c).divideScalar(3).sub(centre);
      middle.y = 0;
      const side = marks.getZ(index.getX(i));
      ridgeVotes += Math.sign(normal.dot(middle)) * side;
    }
  }
  const flipRidge = ridgeVotes < 0;
  const flipPalate = upper && palateVotes < 0;
  if (!flipRidge && !flipPalate) return;
  const flipped = index.array.slice() as Uint32Array | Uint16Array;
  for (let i = 0; i < index.count; i += 3) {
    const kind = marks.getW(index.getX(i));
    // A cap was turned toward the outside when it was made.
    if (kind === 2) continue;
    const palate = kind === 1;
    if (palate ? flipPalate : flipRidge) {
      const second = flipped[i + 1];
      flipped[i + 1] = flipped[i + 2];
      flipped[i + 2] = second;
    }
  }
  geometry.setIndex(Array.from(flipped));
}

/** The gums of both jaws of this set of teeth, in the natural arch. */
export function buildGum(teeth: readonly ToothMetrics[]): GumModel {
  return {
    upper: buildJaw(rowOrder(teeth, true), GUM_SLOT_OFFSET.upper, true),
    lower: buildJaw(rowOrder(teeth, false), GUM_SLOT_OFFSET.lower, false),
  };
}

/** The tooth a place on the gum belongs to: the nearest whole tooth unit. */
export function toothAtSlot(model: GumModel, slotCoordinate: number): string | null {
  for (const jaw of [model.upper, model.lower]) {
    if (!jaw) continue;
    const local = Math.round(slotCoordinate - jaw.offset);
    if (slotCoordinate >= jaw.offset - 0.5 && local >= 0 && local < jaw.fdis.length && slotCoordinate < jaw.offset + GUM_SLOTS_PER_JAW) {
      return jaw.fdis[local];
    }
  }
  return null;
}

/** The slot of a tooth in the engine's gum texture, or -1 when the model has no such tooth. */
export function slotOfTooth(model: GumModel, fdi: string): number {
  for (const jaw of [model.upper, model.lower]) {
    const at = jaw?.fdis.indexOf(fdi) ?? -1;
    if (jaw && at >= 0) return jaw.offset + at;
  }
  return -1;
}
