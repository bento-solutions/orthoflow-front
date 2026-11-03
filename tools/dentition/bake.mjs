/**
 * Bakes the source dentition model into the GLB files the 3D chart loads.
 *
 *   npm install && npm run bake        (from frontend/tools/dentition)
 *
 * Why the source cannot be shipped as it is: 17 textures of 4096x4096 are 1.5 GB
 * of GPU memory once decoded, the teeth carry no FDI identity (a runtime had to
 * guess it from positions), and nothing marks where a tooth's surfaces are. What
 * is good in it is the geometry, sculpted from CT data, and the textures' clean
 * split between white enamel and tan root.
 *
 * So this script keeps the geometry and turns the rest into per-vertex data:
 *
 *   POSITION   the tooth in its own frame (x = y cross z, y = occlusal, z = buccal)
 *   NORMAL     in the same frame
 *   COLOR_0    the texture sampled at the vertex
 *   _LOCAL     (mesial, buccal, height above the enamel line, occlusion): what the
 *              chart's shader draws each surface from
 *
 * Teeth are named by FDI code from a mapping that is checked against the source's
 * own materials, and the bake stops if the check fails: a chart must not show a
 * finding on the wrong tooth because a model changed.
 *
 * The primary dentition is derived here, from textbook crown and root dimensions,
 * because no model of it could be downloaded without a Sketchfab account. See the
 * README for dropping real scans in.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { MeshoptEncoder } from 'meshoptimizer';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'source/permanent_dentition');
const FRONTEND = join(HERE, '../..');
const OUT_DIR = join(FRONTEND, 'public/3d/dentition');
const GENERATED = join(FRONTEND, 'src/app/features/dental-3d/dentition-assets.generated.ts');

/* ── Small vector helpers ─────────────────────────────────────────────── */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mean = (points) => mul(points.reduce(add, [0, 0, 0]), 1 / points.length);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function matMul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const linearPart = (m) => [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
const determinant = (m) => {
  const [a, b, c] = linearPart(m);
  return dot(a, cross(b, c));
};
/** Normals follow the inverse transpose, which keeps them right under mirroring and scale. */
function normalMatrix(m) {
  const [a, b, c] = linearPart(m);
  const det = dot(a, cross(b, c));
  return [mul(cross(b, c), 1 / det), mul(cross(c, a), 1 / det), mul(cross(a, b), 1 / det)];
}
const transformNormal = (n, v) => normalize([
  n[0][0] * v[0] + n[1][0] * v[1] + n[2][0] * v[2],
  n[0][1] * v[0] + n[1][1] * v[1] + n[2][1] * v[2],
  n[0][2] * v[0] + n[1][2] * v[1] + n[2][2] * v[2],
]);

/* ── Reading the source ───────────────────────────────────────────────── */

const gltf = JSON.parse(readFileSync(join(SOURCE, 'scene.gltf'), 'utf8'));
const bin = readFileSync(join(SOURCE, 'scene.bin'));

function accessorArray(index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const Type = { 5125: Uint32Array, 5123: Uint16Array, 5126: Float32Array }[accessor.componentType];
  const copy = new Uint8Array(accessor.count * components * Type.BYTES_PER_ELEMENT);
  const stride = view.byteStride ?? components * Type.BYTES_PER_ELEMENT;
  const elementSize = components * Type.BYTES_PER_ELEMENT;
  for (let i = 0; i < accessor.count; i++) {
    copy.set(bin.subarray(offset + i * stride, offset + i * stride + elementSize), i * elementSize);
  }
  return new Type(copy.buffer);
}

const textureCache = new Map();
function baseColorOf(materialIndex) {
  const textureIndex = gltf.materials[materialIndex].pbrMetallicRoughness.baseColorTexture.index;
  const uri = gltf.images[gltf.textures[textureIndex].source].uri;
  if (!textureCache.has(uri)) {
    const started = Date.now();
    textureCache.set(uri, jpeg.decode(readFileSync(join(SOURCE, uri)), { useTArray: true, maxMemoryUsageInMB: 1024 }));
    console.log(`  decoded ${uri} in ${Date.now() - started} ms`);
  }
  return textureCache.get(uri);
}

/** Bilinear, and blind to the black background around a texture island. */
function sampleTexture(image, u, v) {
  const x = ((u % 1) + 1) % 1 * (image.width - 1);
  const y = ((v % 1) + 1) % 1 * (image.height - 1);
  const pixel = (px, py) => {
    const i = (Math.round(py) * image.width + Math.round(px)) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  };
  const isBackground = (c) => c[0] + c[1] + c[2] < 45;
  let sum = [0, 0, 0];
  let weight = 0;
  for (let radius = 3; radius <= 96 && weight === 0; radius *= 2) {
    for (let dy = -radius; dy <= radius; dy += radius) {
      for (let dx = -radius; dx <= radius; dx += radius) {
        const c = pixel(clamp(x + dx, 0, image.width - 1), clamp(y + dy, 0, image.height - 1));
        if (isBackground(c)) continue;
        sum = add(sum, c);
        weight++;
      }
    }
  }
  return weight ? mul(sum, 1 / weight) : [230, 215, 190];
}

function worldMatrices() {
  const world = new Map();
  const parents = new Map();
  const walk = (index, parent) => {
    const node = gltf.nodes[index];
    const m = matMul(parent, nodeMatrix(node));
    world.set(index, m);
    for (const child of node.children ?? []) {
      parents.set(child, index);
      walk(child, m);
    }
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, IDENTITY);
  return { world, parents };
}

function readTeeth() {
  const { world, parents } = worldMatrices();
  const raw = [];
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    const primitive = gltf.meshes[node.mesh].primitives[0];
    const positions = accessorArray(primitive.attributes.POSITION);
    const count = positions.length / 3;
    // The source carries one four-vertex sliver beside tooth 26: a modelling artefact, not a tooth.
    if (count < 50) { console.log(`  dropped ${node.name} (${count} vertices)`); return; }

    const m = world.get(index);
    const normals = accessorArray(primitive.attributes.NORMAL);
    const uvs = accessorArray(primitive.attributes.TEXCOORD_0);
    const indices = Uint32Array.from(accessorArray(primitive.indices));
    const nm = normalMatrix(m);
    const image = baseColorOf(primitive.material);

    const P = [], N = [], C = [];
    for (let i = 0; i < count; i++) {
      P.push(transformPoint(m, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]));
      N.push(transformNormal(nm, [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]));
      C.push(sampleTexture(image, uvs[i * 2], uvs[i * 2 + 1]));
    }
    if (determinant(m) < 0) {
      for (let t = 0; t < indices.length; t += 3) { const s = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = s; }
    }
    let ancestor = index;
    const path = [];
    while (ancestor !== undefined) { path.push(gltf.nodes[ancestor].name); ancestor = parents.get(ancestor); }
    raw.push({
      name: node.name,
      path,
      material: gltf.materials[primitive.material].name,
      lower: path.includes('Mandible_group1'),
      P, N, C,
      indices,
    });
  });
  return raw;
}

/* ── FDI identity ─────────────────────────────────────────────────────── */

/**
 * Position in the quadrant (1 = central incisor) per source material. The source
 * uses one material per mirrored pair, so this both names the teeth and proves
 * the geometric sort below agreed with the people who made the model.
 */
const MATERIAL_POSITION = {
  material: 1, blinn14: 2, blinn15: 3, blinn16: 4, blinn17: 5, blinn18: 6, blinn19: 7, blinn20: 8,
  Mandible_ll1: 1, Mandible_l2: 2, Mandible_ll3: 3, Mandible_ll4: 4, Mandible_ll5: 5, Mandible_blinn10: 6, Mandible_ll7: 7, Mandible_ll8: 8,
};

function assignFdi(raw) {
  if (raw.length !== 32) throw new Error(`Expected 32 teeth in the source, found ${raw.length}`);
  const teeth = new Map();
  for (const lower of [false, true]) {
    const arch = raw.filter((t) => t.lower === lower);
    if (arch.length !== 16) throw new Error(`Expected 16 teeth per arch, found ${arch.length}`);
    const centroids = arch.map((t) => mean(t.P));
    const midline = centroids.reduce((s, c) => s + c[0], 0) / arch.length;
    // Facing the patient's front (+Z), the patient's left is +X.
    for (const side of ['right', 'left']) {
      const onSide = arch
        .map((t, i) => ({ t, c: centroids[i] }))
        .filter(({ c }) => (side === 'left' ? c[0] > midline : c[0] < midline))
        .sort((a, b) => b.c[2] - a.c[2]);
      if (onSide.length !== 8) throw new Error(`Expected 8 teeth on the ${side} side, found ${onSide.length}`);
      const quadrant = lower ? (side === 'left' ? 3 : 4) : side === 'right' ? 1 : 2;
      onSide.forEach(({ t }, i) => {
        const position = i + 1;
        if (MATERIAL_POSITION[t.material] !== position) {
          throw new Error(`Tooth ${quadrant}${position}: sorted by position, but material ${t.material} says position ${MATERIAL_POSITION[t.material]}`);
        }
        teeth.set(`${quadrant}${position}`, t);
      });
    }
  }
  for (let q = 1; q <= 4; q++) {
    for (let position = 1; position <= 8; position++) {
      const twin = teeth.get(`${q % 2 ? q + 1 : q - 1}${position}`);
      if (teeth.get(`${q}${position}`).P.length !== twin.P.length) throw new Error(`Mirrored pair mismatch at position ${position}`);
    }
  }
  return teeth;
}

/* ── One tooth's frame, enamel line and surfaces ──────────────────────── */

/** Enamel is white, root is tan: saturation alone separates them. */
function enamelness(color) {
  const max = Math.max(...color);
  const min = Math.min(...color);
  const saturation = max > 0 ? (max - min) / max : 0;
  return smoothstep(0.17, 0.1, saturation);
}

function adjacency(indices, count) {
  const neighbours = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    neighbours[a].add(b); neighbours[a].add(c);
    neighbours[b].add(a); neighbours[b].add(c);
    neighbours[c].add(a); neighbours[c].add(b);
  }
  return neighbours;
}

/** Vertices at the same place share one neighbourhood, so UV seams do not read as edges. */
function positionGroups(P) {
  const groups = new Map();
  P.forEach((p, i) => {
    const key = p.map((v) => Math.round(v * 2e4)).join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  return [...groups.values()];
}

function weldedAdjacency(P, indices) {
  const neighbours = adjacency(indices, P.length);
  for (const group of positionGroups(P)) {
    if (group.length < 2) continue;
    const union = new Set();
    for (const i of group) for (const n of neighbours[i]) union.add(n);
    for (const i of group) neighbours[i] = union;
  }
  return neighbours;
}

/** Self-occlusion from the mesh itself, so fissures and furcations read in any arrangement of the teeth. */
function bakeOcclusion(P, N, indices) {
  const directions = [];
  const RAYS = 36;
  for (let i = 0; i < RAYS; i++) {
    const y = 1 - (i + 0.5) / RAYS * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    directions.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  const triangles = indices.length / 3;
  const v0 = [], e1 = [], e2 = [];
  for (let t = 0; t < triangles; t++) {
    const a = P[indices[t * 3]], b = P[indices[t * 3 + 1]], c = P[indices[t * 3 + 2]];
    v0.push(a); e1.push(sub(b, a)); e2.push(sub(c, a));
  }
  const size = length(sub(P[0], mean(P))) || 1;
  const offset = size * 0.004;
  const reach = size * 1.1;
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) {
    const origin = add(P[i], mul(N[i], offset));
    let open = 0, total = 0;
    for (const d of directions) {
      const cosine = dot(d, N[i]);
      if (cosine <= 0.02) continue;
      total += cosine;
      let hit = false;
      for (let t = 0; t < triangles && !hit; t++) {
        const h = cross(d, e2[t]);
        const det = dot(e1[t], h);
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const s = sub(origin, v0[t]);
        const u = dot(s, h) * inv;
        if (u < 0 || u > 1) continue;
        const q = cross(s, e1[t]);
        const v = dot(d, q) * inv;
        if (v < 0 || u + v > 1) continue;
        const distance = dot(e2[t], q) * inv;
        hit = distance > 1e-5 && distance < reach;
      }
      if (!hit) open += cosine;
    }
    out[i] = total ? open / total : 1;
  }
  return out;
}

function buildTooth(fdi, raw) {
  const { P, N, C, indices } = raw;
  const count = P.length;
  const neighbours = weldedAdjacency(P, indices);

  // Smoothing removes painted specks, then the threshold gives the enamel line.
  let enamel = C.map(enamelness);
  for (let pass = 0; pass < 2; pass++) {
    enamel = enamel.map((value, i) => {
      if (!neighbours[i].size) return value;
      let sum = value;
      for (const n of neighbours[i]) sum += enamel[n];
      return sum / (neighbours[i].size + 1);
    });
  }

  const crownPoints = P.filter((_, i) => enamel[i] >= 0.5);
  const rootPoints = P.filter((_, i) => enamel[i] < 0.5);
  if (crownPoints.length < 20 || rootPoints.length < 20) throw new Error(`Tooth ${fdi}: enamel and root could not be told apart`);

  const boundary = [];
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + (e + 1) % 3];
      const ea = enamel[a] - 0.5, eb = enamel[b] - 0.5;
      if (ea * eb < 0) boundary.push(add(P[a], mul(sub(P[b], P[a]), ea / (ea - eb))));
    }
  }
  if (boundary.length < 6) throw new Error(`Tooth ${fdi}: no enamel line found`);

  return {
    fdi,
    P, N,
    C,
    indices,
    enamel,
    crownCentroid: mean(crownPoints),
    rootCentroid: mean(rootPoints),
    origin: mean(boundary),
    boundary,
    occlusion: null,
  };
}

const ARCH_ORDER = {
  upper: ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
  lower: ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'],
};

function attachFrames(teeth) {
  for (const order of Object.values(ARCH_ORDER)) {
    const centroids = order.map((fdi) => teeth.get(fdi).crownCentroid);
    const center = mean([centroids[0], centroids[1], centroids[14], centroids[15]]);
    order.forEach((fdi, i) => {
      const tooth = teeth.get(fdi);
      const ey = normalize(sub(tooth.crownCentroid, tooth.rootCentroid));
      const tangent = sub(centroids[Math.min(i + 1, 15)], centroids[Math.max(i - 1, 0)]);
      let outward = normalize(cross(tangent, [0, 1, 0]));
      if (dot(outward, sub(tooth.crownCentroid, center)) < 0) outward = mul(outward, -1);
      const ez = normalize(sub(outward, mul(ey, dot(outward, ey))));
      const ex = cross(ey, ez);
      tooth.frame = { ex, ey, ez };
      // Toward the midline: the neighbour nearer the centre of the arch order.
      const toMidline = sub(centroids[i < 8 ? i + 1 : i - 1], tooth.crownCentroid);
      tooth.mesialSign = dot(ex, toMidline) >= 0 ? 1 : -1;
    });
  }
}

/** Moves a tooth into its own frame and works out where each vertex sits on it. */
function localise(tooth) {
  const { frame: { ex, ey, ez }, origin, mesialSign } = tooth;
  const toLocal = (p) => { const d = sub(p, origin); return [dot(d, ex), dot(d, ey), dot(d, ez)]; };
  const toLocalDir = (n) => normalize([dot(n, ex), dot(n, ey), dot(n, ez)]);
  tooth.L = tooth.P.map(toLocal);
  tooth.LN = tooth.N.map(toLocalDir);

  // The enamel line is scalloped, so "above the line" depends on the angle around the axis.
  const BINS = 24;
  const heights = Array.from({ length: BINS }, () => []);
  const angleBin = (p) => Math.floor(((Math.atan2(p[2], p[0]) + Math.PI) / (Math.PI * 2)) * BINS) % BINS;
  for (const b of tooth.boundary) {
    const l = toLocal(b);
    heights[angleBin(l)].push(l[1]);
  }
  const line = heights.map((h) => (h.length ? h.reduce((a, b) => a + b, 0) / h.length : null));
  for (let i = 0; i < BINS; i++) {
    if (line[i] !== null) continue;
    let before = i, after = i;
    do { before = (before + BINS - 1) % BINS; } while (line[before] === null);
    do { after = (after + 1) % BINS; } while (line[after] === null);
    line[i] = (line[before] + line[after]) / 2;
  }
  const smoothLine = line.map((_, i) => (line[(i + BINS - 1) % BINS] + 2 * line[i] + line[(i + 1) % BINS]) / 4);
  const lineAt = (l) => {
    const position = ((Math.atan2(l[2], l[0]) + Math.PI) / (Math.PI * 2)) * BINS - 0.5;
    const i = Math.floor(position);
    const t = position - i;
    return smoothLine[(i + BINS) % BINS] * (1 - t) + smoothLine[(i + 1 + BINS) % BINS] * t;
  };

  const above = tooth.L.map((l) => l[1] - lineAt(l));
  const crownIndices = above.map((a, i) => (a >= 0 ? i : -1)).filter((i) => i >= 0);
  const crownHeight = Math.max(...crownIndices.map((i) => above[i]));
  const rootLength = Math.max(...above.map((a) => -a));
  const halfWidth = Math.max(...crownIndices.map((i) => Math.abs(tooth.L[i][0])));
  const halfDepth = Math.max(...crownIndices.map((i) => Math.abs(tooth.L[i][2])));

  tooth.surface = tooth.L.map((l, i) => [
    clamp((mesialSign * l[0]) / halfWidth, -1, 1),
    clamp(l[2] / halfDepth, -1, 1),
    above[i] >= 0 ? clamp(above[i] / crownHeight, 0, 1) : clamp(above[i] / rootLength, -1, 0),
  ]);

  let apex = tooth.L[0];
  for (const l of tooth.L) if (l[1] < apex[1]) apex = l;

  tooth.meta = {
    halfWidth,
    halfDepth,
    crownHeight,
    rootLength,
    top: Math.max(...tooth.L.map((l) => l[1])),
    bottom: Math.min(...tooth.L.map((l) => l[1])),
    apex,
    mesialSign,
  };
}

/* ── Writing a GLB ────────────────────────────────────────────────────── */

const pad4 = (n) => (n + 3) & ~3;

function quaternionFromBasis(ex, ey, ez) {
  const [m00, m10, m20] = ex, [m01, m11, m21] = ey, [m02, m12, m22] = ez;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

function round(values, digits = 5) {
  const f = 10 ** digits;
  return values.map((v) => Math.round(v * f) / f);
}

/** Writes teeth, already localised, as one compressed GLB. */
async function writeGlb(teeth, fileStem, rootExtras) {
  const positionScale = Math.max(...teeth.flatMap((t) => t.L.flat().map(Math.abs))) * 1.0001;
  const json = {
    asset: { version: '2.0', generator: 'orthoflow dentition bake', copyright: 'Adapted from "Permanent Dentition", University of Dundee, School of Dentistry, CC BY 4.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: teeth.map((_, i) => i), extras: { ...rootExtras, positionScale } }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }, { byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  };
  const chunks = [];
  let compressedLength = 0;
  let fallbackLength = 0;
  const views = (bytes, count, stride, mode, target) => {
    const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
    const padded = pad4(encoded.length);
    const copy = new Uint8Array(padded);
    copy.set(encoded);
    chunks.push(copy);
    json.bufferViews.push({
      buffer: 1,
      byteOffset: fallbackLength,
      byteLength: bytes.length,
      byteStride: mode === 'ATTRIBUTES' ? stride : undefined,
      target,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: compressedLength, byteLength: encoded.length, byteStride: stride, mode, count } },
    });
    compressedLength += padded;
    fallbackLength += pad4(bytes.length);
    return json.bufferViews.length - 1;
  };

  let triangles = 0;
  let vertices = 0;
  teeth.forEach((tooth) => {
    const count = tooth.L.length;
    // Cache-friendly order: faster to draw and it compresses far better. reorderMesh rewrites
    // the index buffer it is given and returns where each old vertex went.
    const remapped = Uint32Array.from(tooth.indices);
    const [map2, unique2] = MeshoptEncoder.reorderMesh(remapped, true, true);

    const position = new Int16Array(unique2 * 4);
    const normal = new Int8Array(unique2 * 4);
    const color = new Uint8Array(unique2 * 4);
    const local = new Int8Array(unique2 * 4);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const j = map2[i];
      if (j === 0xffffffff) continue;
      for (let k = 0; k < 3; k++) {
        const value = Math.round((tooth.L[i][k] / positionScale) * 32767);
        position[j * 4 + k] = value;
        // Accessor bounds are in the stored integers, and the loader builds the
        // tooth's bounding sphere from them; picking depends on that sphere.
        min[k] = Math.min(min[k], value);
        max[k] = Math.max(max[k], value);
        normal[j * 4 + k] = Math.round(tooth.LN[i][k] * 127);
        color[j * 4 + k] = Math.round(clamp(tooth.C[i][k], 0, 255));
        local[j * 4 + k] = Math.round(tooth.surface[i][k] * 127);
      }
      color[j * 4 + 3] = 255;
      local[j * 4 + 3] = Math.round(clamp(tooth.occlusion[i], 0, 1) * 127);
    }
    const indexBytes = new Uint16Array(remapped.length);
    indexBytes.set(remapped);

    const accessor = (bufferView, componentType, type, normalized, extra = {}) => {
      json.accessors.push({ bufferView, componentType, count: unique2, type, normalized, ...extra });
      return json.accessors.length - 1;
    };
    const attributes = {
      POSITION: accessor(views(new Uint8Array(position.buffer), unique2, 8, 'ATTRIBUTES', 34962), 5122, 'VEC3', true, { min, max }),
      NORMAL: accessor(views(new Uint8Array(normal.buffer), unique2, 4, 'ATTRIBUTES', 34962), 5120, 'VEC3', true),
      COLOR_0: accessor(views(new Uint8Array(color.buffer), unique2, 4, 'ATTRIBUTES', 34962), 5121, 'VEC4', true),
      _LOCAL: accessor(views(new Uint8Array(local.buffer), unique2, 4, 'ATTRIBUTES', 34962), 5120, 'VEC4', true),
    };
    const indexView = views(new Uint8Array(indexBytes.buffer), indexBytes.length, 2, 'TRIANGLES', 34963);
    json.accessors.push({ bufferView: indexView, componentType: 5123, count: indexBytes.length, type: 'SCALAR' });

    json.meshes.push({ primitives: [{ attributes, indices: json.accessors.length - 1 }] });
    json.nodes.push({
      name: `tooth-${tooth.fdi}`,
      mesh: json.meshes.length - 1,
      extras: {
        fdi: tooth.fdi,
        // Where the tooth stands in the natural arch: local frame to model space.
        position: round(tooth.origin),
        quaternion: round(quaternionFromBasis(tooth.frame.ex, tooth.frame.ey, tooth.frame.ez), 6),
        halfWidth: round([tooth.meta.halfWidth])[0],
        halfDepth: round([tooth.meta.halfDepth])[0],
        crownHeight: round([tooth.meta.crownHeight])[0],
        rootLength: round([tooth.meta.rootLength])[0],
        top: round([tooth.meta.top])[0],
        bottom: round([tooth.meta.bottom])[0],
        apex: round(tooth.meta.apex),
      },
    });
    triangles += indexBytes.length / 3;
    vertices += unique2;
  });

  json.buffers[0].byteLength = compressedLength;
  json.buffers[1].byteLength = fallbackLength;

  const jsonText = JSON.stringify(json);
  const jsonBytes = Buffer.alloc(pad4(Buffer.byteLength(jsonText)), 0x20);
  jsonBytes.write(jsonText);
  const binBytes = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
  const chunk = (length, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(length, 0); h.writeUInt32LE(type, 4); return h; };
  const glb = Buffer.concat([header, chunk(jsonBytes.length, 0x4e4f534a), jsonBytes, chunk(binBytes.length, 0x004e4942), binBytes]);

  const hash = createHash('sha256').update(glb).digest('hex').slice(0, 10);
  const file = `${fileStem}.${hash}.glb`;
  writeFileSync(join(OUT_DIR, file), glb);
  console.log(`  ${file}: ${teeth.length} teeth, ${vertices} vertices, ${triangles} triangles, ${(glb.length / 1024).toFixed(0)} KB`);
  return file;
}

/* ── The primary dentition, derived ───────────────────────────────────── */

/**
 * Each primary tooth from the permanent tooth closest to it in form, resized to
 * textbook dimensions (Wheeler's Dental Anatomy, in mm: crown mesiodistal width,
 * crown height, root length; `of` gives the same for the source tooth). Primary
 * upper second molars resemble permanent first molars, as do lower ones, and
 * first molars have no successor of the same shape, so they come from the
 * permanent second molars with their three or two roots.
 *
 * This is an illustration of a primary tooth at the right place in the mouth, and
 * the chart says so; it is not a scan.
 */
const PRIMARY_FROM = {
  1: { upper: { from: 1, width: 6.5, crown: 6.0, root: 10.0, of: [8.5, 10.5, 13.0] }, lower: { from: 1, width: 4.2, crown: 5.0, root: 9.0, of: [5.0, 9.0, 12.5] } },
  2: { upper: { from: 2, width: 5.1, crown: 5.6, root: 11.4, of: [6.5, 9.0, 13.0] }, lower: { from: 2, width: 4.1, crown: 5.2, root: 10.0, of: [5.5, 9.5, 14.0] } },
  3: { upper: { from: 3, width: 7.0, crown: 6.5, root: 13.5, of: [7.5, 10.0, 17.0] }, lower: { from: 3, width: 5.0, crown: 6.0, root: 11.5, of: [7.0, 11.0, 16.0] } },
  4: { upper: { from: 7, width: 7.1, crown: 5.1, root: 10.0, of: [9.8, 7.0, 12.0] }, lower: { from: 7, width: 7.7, crown: 6.0, root: 9.8, of: [10.5, 7.0, 13.0] } },
  5: { upper: { from: 6, width: 8.2, crown: 5.7, root: 11.7, of: [10.4, 7.5, 12.5] }, lower: { from: 6, width: 9.9, crown: 5.5, root: 11.4, of: [11.0, 7.5, 14.0] } },
};
const PRIMARY_QUADRANT = { 5: 1, 6: 2, 7: 3, 8: 4 };

function derivePrimary(permanent) {
  const teeth = new Map();
  const widthOf = new Map();
  for (const [q, sourceQuadrant] of Object.entries(PRIMARY_QUADRANT)) {
    const isUpper = q === '5' || q === '6';
    for (const position of [1, 2, 3, 4, 5]) {
      const spec = PRIMARY_FROM[position][isUpper ? 'upper' : 'lower'];
      const source = permanent.get(`${sourceQuadrant}${spec.from}`);
      const sx = spec.width / spec.of[0];
      const sCrown = spec.crown / spec.of[1];
      const sRoot = spec.root / spec.of[2];
      const molar = position >= 4;
      const L = source.L.map((l, i) => {
        const h = source.surface[i][2];
        // A little fuller at the neck, as primary crowns are; roots flare on the molars.
        const neck = h >= 0 ? Math.exp(-(((h - 0.25) / 0.3) ** 2)) : 0;
        const girth = sx * (1 + 0.1 * neck) * (h < 0 ? 0.92 : 1);
        const splay = molar && h < 0 ? 1 + 0.6 * (-h) ** 1.5 : 1;
        return [
          l[0] * girth * splay,
          l[1] * (h >= 0 ? sCrown : sRoot),
          l[2] * girth * splay,
        ];
      });
      const fdi = `${q}${position}`;
      const tooth = {
        fdi,
        L,
        P: L,
        LN: smoothNormals(L, source.indices, source.LN),
        // Whiter than permanent teeth, roots paler too.
        C: source.C.map((c, i) => {
          const toward = source.surface[i][2] >= 0 ? [247, 247, 243] : [238, 226, 206];
          const t = source.surface[i][2] >= 0 ? 0.55 : 0.35;
          return add(mul(c, 1 - t), mul(toward, t));
        }),
        indices: source.indices,
        surface: source.surface,
        occlusion: source.occlusion,
        frame: source.frame,
        origin: source.origin,
        meta: null,
      };
      const widths = L.filter((_, i) => source.surface[i][2] >= 0);
      const halfWidth = Math.max(...widths.map((l) => Math.abs(l[0])));
      tooth.meta = {
        halfWidth,
        halfDepth: Math.max(...widths.map((l) => Math.abs(l[2]))),
        crownHeight: source.meta.crownHeight * sCrown,
        rootLength: source.meta.rootLength * sRoot,
        top: Math.max(...L.map((l) => l[1])),
        bottom: Math.min(...L.map((l) => l[1])),
        apex: [source.meta.apex[0] * sx, source.meta.apex[1] * sRoot, source.meta.apex[2] * sx],
        mesialSign: source.mesialSign,
      };
      teeth.set(fdi, tooth);
      widthOf.set(fdi, halfWidth * 2);
    }
  }
  placePrimaryArches(teeth, permanent, widthOf);
  return teeth;
}

/** Lays the primary teeth along a smaller copy of the permanent arch, from the midline back. */
function placePrimaryArches(teeth, permanent, widthOf) {
  const SCALE = 0.8;
  const SPACING = 1.04;
  for (const [archKey, right, left] of [['upper', 5, 6], ['lower', 8, 7]]) {
    const chain = ARCH_ORDER[archKey].map((fdi) => permanent.get(fdi));
    for (const [quadrant, sign] of [[right, -1], [left, 1]]) {
      const half = sign < 0 ? chain.slice(0, 8).reverse() : chain.slice(8);
      const centreX = (chain[7].origin[0] + chain[8].origin[0]) / 2;
      const centreZ = (chain[7].origin[2] + chain[8].origin[2]) / 2;
      // The polyline of the permanent necks, shrunk towards the back of the arch.
      const backZ = chain[0].origin[2];
      const line = [[centreX, centreZ], ...half.map((t) => [t.origin[0], t.origin[2]])]
        .map(([x, z]) => [centreX + (x - centreX) * SCALE, backZ + (z - backZ) * SCALE]);
      let travelled = 0;
      for (let position = 1; position <= 5; position++) {
        const tooth = teeth.get(`${quadrant}${position}`);
        const width = widthOf.get(tooth.fdi) * SPACING;
        const at = pointAlong(line, travelled + width / 2);
        travelled += width;
        const source = PRIMARY_FROM[position][archKey];
        const permanentTooth = permanent.get(`${archKey === 'upper' ? (quadrant === 5 ? 1 : 2) : quadrant === 8 ? 4 : 3}${source.from}`);
        const ey = [0, permanentTooth.frame.ey[1] > 0 ? 1 : -1, 0];
        // Keep some of the permanent tooth's natural tilt out: a child's teeth stand upright.
        const outward = normalize([at.tangent[1] * (sign < 0 ? -1 : 1) * -1, 0, at.tangent[0] * (sign < 0 ? -1 : 1)]);
        const ez = normalize(sub(outward, mul(ey, dot(outward, ey))));
        const ex = cross(ey, ez);
        tooth.frame = { ex, ey, ez };
        const y = chain[7].origin[1] * 0.9 + chain[0].origin[1] * 0.1;
        tooth.origin = [at.point[0], archKey === 'upper' ? y - 0.02 : y + 0.02, at.point[1]];
      }
    }
  }
}

function pointAlong(line, distance) {
  let remaining = distance;
  for (let i = 0; i < line.length - 1; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dz = line[i + 1][1] - line[i][1];
    const segment = Math.hypot(dx, dz);
    if (remaining <= segment || i === line.length - 2) {
      const t = remaining / segment;
      return { point: [line[i][0] + dx * t, line[i][1] + dz * t], tangent: [dx / segment, dz / segment] };
    }
    remaining -= segment;
  }
  throw new Error('Empty arch line');
}

/** Normals after a non-uniform resize, keeping the source's hard edges out by welding on position. */
function smoothNormals(L, indices, fallback) {
  const out = L.map(() => [0, 0, 0]);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const n = cross(sub(L[b], L[a]), sub(L[c], L[a]));
    out[a] = add(out[a], n); out[b] = add(out[b], n); out[c] = add(out[c], n);
  }
  for (const group of positionGroups(L)) {
    if (group.length < 2) continue;
    const sum = group.reduce((s, i) => add(s, out[i]), [0, 0, 0]);
    for (const i of group) out[i] = sum;
  }
  return out.map((n, i) => (length(n) > 1e-12 ? normalize(n) : fallback[i]));
}

/* ── Main ─────────────────────────────────────────────────────────────── */

await MeshoptEncoder.ready;
console.log('Reading the source model');
const permanent = assignFdi(readTeeth());
const built = new Map([...permanent].map(([fdi, raw]) => [fdi, buildTooth(fdi, raw)]));
attachFrames(built);
for (const tooth of built.values()) localise(tooth);

console.log('Baking self-occlusion (about a minute)');
const started = Date.now();
for (const tooth of built.values()) tooth.occlusion = bakeOcclusion(tooth.L, tooth.LN, tooth.indices);
console.log(`  done in ${((Date.now() - started) / 1000).toFixed(0)} s`);

const sanity = [...built.values()].map((t) => ({
  fdi: t.fdi,
  verts: t.L.length,
  w: +(t.meta.halfWidth * 2).toFixed(3),
  crown: +t.meta.crownHeight.toFixed(3),
  root: +t.meta.rootLength.toFixed(3),
  ao: +(t.occlusion.reduce((a, b) => a + b, 0) / t.occlusion.length).toFixed(2),
  enamel: +(t.surface.filter((s) => s[2] >= 0).length / t.L.length).toFixed(2),
}));
console.table(sanity.sort((a, b) => Number(a.fdi) - Number(b.fdi)));

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log('Writing');
const order = (fdis) => fdis.map((fdi) => built.get(fdi));
const permanentFile = await writeGlb(order([...ARCH_ORDER.upper, ...ARCH_ORDER.lower]), 'permanent', { dentition: 'adult' });

const primary = derivePrimary(built);
const primaryOrder = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65', '85', '84', '83', '82', '81', '71', '72', '73', '74', '75'];
const primaryFile = await writeGlb(primaryOrder.map((fdi) => primary.get(fdi)), 'primary', { dentition: 'child' });

writeFileSync(join(OUT_DIR, 'LICENSE.txt'), `${readFileSync(join(SOURCE, 'license.txt'), 'utf8').trim()}

Changes made for OrthoFlow: geometry moved into per-tooth frames, textures replaced by
per-vertex colour, self-occlusion and surface data added, compressed. primary.*.glb is
derived from the same teeth, resized to textbook primary tooth dimensions: it is an
illustration, not a scan of primary teeth.
`);

writeFileSync(GENERATED, `// Written by tools/dentition/bake.mjs. Content-hashed, so these can be cached forever.
export const DENTITION_ASSETS = {
  adult: '3d/dentition/${permanentFile}',
  child: '3d/dentition/${primaryFile}',
} as const;
`);

console.log('Files now in public/3d/dentition:', readdirSync(OUT_DIR));
