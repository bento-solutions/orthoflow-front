/**
 * Colours for a scan that carries none of its own (STL stores the shape only): crowns in enamel,
 * gums in pink, estimated from the shape. It is an approximation drawn to make the model readable,
 * not the patient's real colours; a PLY exported with colour shows those.
 *
 * <p>How the gum line is found, with nothing but positions:
 * <ol>
 *   <li>An arch is a flat horseshoe, so the axis along which it varies least is the one from the
 *       gums to the biting surfaces (the occlusal axis).</li>
 *   <li>An intraoral scan is an open surface: it stops somewhere on the gums. Summed over every
 *       triangle, the area vectors of an open surface point away from its missing cap, so they point
 *       towards the crowns. A closed model (a printed cast) sums to nothing; its flat base, the
 *       largest flat area facing along the axis, is then the gum side.</li>
 *   <li>Along that axis the upper part is crown and the lower part is gum, with a soft blend where
 *       they meet so that a line that is not quite right reads as shading, not as a cut.</li>
 * </ol>
 */

/** Share of the arch's height, from the biting edge, drawn as tooth. */
export const CROWN_SHARE = 0.5;
/** Half the width of the blend between tooth and gum, as a share of the arch's height. */
export const BLEND_SHARE = 0.07;

/** Enamel and gingiva, as sRGB hex; converted to linear for the renderer. */
export const ENAMEL = 0xf1eadb;
export const GUM = 0xd98a8f;

export type Vec3 = [number, number, number];

/**
 * One RGB triple per vertex (linear colour space, as three.js reads vertex colours).
 * `index` is the triangle list when the geometry is indexed, otherwise null (consecutive triplets).
 */
export function toothGumColors(positions: ArrayLike<number>, index: ArrayLike<number> | null): Float32Array {
  const count = Math.floor(positions.length / 3);
  const colors = new Float32Array(count * 3);
  if (count === 0) return colors;

  const centre = centroid(positions, count);
  const axis = occlusalAxis(positions, count, centre);
  const sign = crownSide(positions, index, count, axis);

  let lo = Infinity;
  let hi = -Infinity;
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const h = sign * ((positions[i * 3] - centre[0]) * axis[0] + (positions[i * 3 + 1] - centre[1]) * axis[1] + (positions[i * 3 + 2] - centre[2]) * axis[2]);
    heights[i] = h;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const span = hi - lo || 1;
  const gumLine = hi - CROWN_SHARE * span;
  const blend = BLEND_SHARE * span;

  const enamel = linear(ENAMEL);
  const gum = linear(GUM);
  for (let i = 0; i < count; i++) {
    // 0 deep in the gum, 1 on the crown, a smooth step across the line.
    const t = smoothstep(gumLine - blend, gumLine + blend, heights[i]);
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = gum[c] + (enamel[c] - gum[c]) * t;
  }
  return colors;
}

function centroid(p: ArrayLike<number>, count: number): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < count; i++) { x += p[i * 3]; y += p[i * 3 + 1]; z += p[i * 3 + 2]; }
  return [x / count, y / count, z / count];
}

/** The direction in which the points spread least: the smallest principal axis. */
export function occlusalAxis(p: ArrayLike<number>, count: number, c: Vec3): Vec3 {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const step = Math.max(1, Math.floor(count / 200_000));
  for (let i = 0; i < count; i += step) {
    const d = [p[i * 3] - c[0], p[i * 3 + 1] - c[1], p[i * 3 + 2] - c[2]];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[r][k] += d[r] * d[k];
  }
  const { values, vectors } = jacobi(m);
  let best = 0;
  for (let k = 1; k < 3; k++) if (values[k] < values[best]) best = k;
  return normalise([vectors[0][best], vectors[1][best], vectors[2][best]]);
}

/** +1 when the crowns lie towards +axis, -1 when they lie towards -axis. */
export function crownSide(p: ArrayLike<number>, index: ArrayLike<number> | null, count: number, axis: Vec3): 1 | -1 {
  const triangles = index ? Math.floor(index.length / 3) : Math.floor(count / 3);
  let along = 0;     // area vectors summed, projected on the axis
  let total = 0;     // total area, to judge whether that sum is meaningful
  let flatUp = 0;    // area of faces facing +axis squarely
  let flatDown = 0;  // area of faces facing -axis squarely
  for (let t = 0; t < triangles; t++) {
    const a = index ? index[t * 3] : t * 3;
    const b = index ? index[t * 3 + 1] : t * 3 + 1;
    const c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz);
    if (area === 0) continue;
    const proj = nx * axis[0] + ny * axis[1] + nz * axis[2];
    along += proj;
    total += area;
    const facing = proj / area;
    if (facing > 0.97) flatUp += area;
    else if (facing < -0.97) flatDown += area;
  }
  // An open scan: the faces lean, on balance, towards the crowns.
  if (total > 0 && Math.abs(along) > 0.02 * total) return along > 0 ? 1 : -1;
  // A closed cast: its base is the big flat face, and it faces away from the crowns.
  return flatDown >= flatUp ? 1 : -1;
}

/** Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi); eigenvectors are the columns. */
function jacobi(input: number[][]): { values: number[]; vectors: number[][] } {
  const a = input.map((row) => [...row]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-12 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-30)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cos = 1 / Math.sqrt(t * t + 1);
      const sin = t * cos;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = cos * akp - sin * akq;
        a[k][q] = sin * akp + cos * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = cos * apk - sin * aqk;
        a[q][k] = sin * apk + cos * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = cos * vkp - sin * vkq;
        v[k][q] = sin * vkp + cos * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}

function normalise(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** sRGB hex to linear RGB, the space three.js reads vertex colours in. */
function linear(hex: number): Vec3 {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [ch((hex >> 16) & 255), ch((hex >> 8) & 255), ch(hex & 255)];
}
