import { describe, expect, it } from 'vitest';
import { ENAMEL, GUM, crownSide, occlusalAxis, toothGumColors } from './scan-shading';

/**
 * A rough lower arch as an open surface, the way a scanner leaves it: a horseshoe-shaped ridge of
 * gum with a bump (a crown) every few degrees, open underneath. Heights run along +Z, the crowns up.
 */
function arch(): { positions: number[]; index: number[] } {
  const positions: number[] = [];
  const index: number[] = [];
  const around = 120; // steps along the horseshoe
  const across = 24;  // steps from the cheek side to the tongue side
  for (let i = 0; i <= around; i++) {
    const a = Math.PI * (i / around);           // 0..π: a horseshoe
    const crown = Math.max(0, Math.cos(i * 1.4)); // a tooth every few steps
    for (let j = 0; j <= across; j++) {
      const s = j / across;                       // 0 cheek .. 1 tongue
      const r = 25 - 8 * s;
      const ridge = Math.sin(Math.PI * s);        // 0 at both edges, 1 on top
      const z = 6 * ridge + 7 * crown * Math.pow(ridge, 6);
      positions.push(r * Math.cos(a), r * Math.sin(a), z);
    }
  }
  const row = across + 1;
  for (let i = 0; i < around; i++) {
    for (let j = 0; j < across; j++) {
      const p = i * row + j, q = p + row;
      // Wound so the faces look up and out, away from the open underside.
      index.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  return { positions, index };
}

/** Rotates every point about X then Y, as a scan saved in some other orientation would be. */
function rotated(positions: number[], ax: number, ay: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    const y1 = y * Math.cos(ax) - z * Math.sin(ax);
    const z1 = y * Math.sin(ax) + z * Math.cos(ax);
    out.push(x * Math.cos(ay) + z1 * Math.sin(ay), y1, -x * Math.sin(ay) + z1 * Math.cos(ay));
  }
  return out;
}

/** Red minus blue (linear): about 0.17 on enamel, about 0.42 on gum. */
function redOverBlue(colors: Float32Array, v: number): number {
  return colors[v * 3] - colors[v * 3 + 2];
}

function highestAndLowest(positions: number[], axisZ: (i: number) => number): { top: number; bottom: number } {
  let top = 0, bottom = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    if (axisZ(v) > axisZ(top)) top = v;
    if (axisZ(v) < axisZ(bottom)) bottom = v;
  }
  return { top, bottom };
}

describe('tooth and gum shading for colourless scans', () => {
  it('finds the axis from the gums to the biting edge', () => {
    const { positions } = arch();
    const n = positions.length / 3;
    const axis = occlusalAxis(positions, n, [0, 0, 0]);
    expect(Math.abs(axis[2])).toBeGreaterThan(0.95);
  });

  it('puts the crowns on the side away from the open underside', () => {
    const { positions, index } = arch();
    expect(crownSide(positions, index, positions.length / 3, [0, 0, 1])).toBe(1);
    expect(crownSide(positions, index, positions.length / 3, [0, 0, -1])).toBe(-1);
  });

  it('colours the crowns enamel and the base of the gum pink', () => {
    const { positions, index } = arch();
    const colors = toothGumColors(positions, index);
    const { top, bottom } = highestAndLowest(positions, (v) => positions[v * 3 + 2]);
    expect(redOverBlue(colors, top)).toBeLessThan(0.2);
    expect(redOverBlue(colors, bottom)).toBeGreaterThan(0.35);
  });

  it('gets it right whichever way the scan was saved', () => {
    const { positions, index } = arch();
    const turned = rotated(positions, 2.4, -0.9); // more than a quarter turn: the crowns face down-ish
    const colors = toothGumColors(turned, index);
    // Judge top and bottom on the original heights, which the rotation does not change.
    const { top, bottom } = highestAndLowest(positions, (v) => positions[v * 3 + 2]);
    expect(redOverBlue(colors, top)).toBeLessThan(0.2);
    expect(redOverBlue(colors, bottom)).toBeGreaterThan(0.35);
  });

  it('works on unindexed triangles, as a large STL stays', () => {
    const { positions, index } = arch();
    const flat: number[] = [];
    for (const v of index) flat.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const colors = toothGumColors(flat, null);
    const { top, bottom } = highestAndLowest(flat, (v) => flat[v * 3 + 2]);
    expect(redOverBlue(colors, top)).toBeLessThan(0.2);
    expect(redOverBlue(colors, bottom)).toBeGreaterThan(0.35);
  });

  it('uses two distinct colours', () => {
    expect(ENAMEL).not.toBe(GUM);
    expect(toothGumColors([], null).length).toBe(0);
  });
});
