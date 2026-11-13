import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { GUM_SLOT_OFFSET, buildGum, slotOfTooth, toothAtSlot } from './gum-geometry';
import { ToothMetrics } from './dentition-layout';

/**
 * A mouth like the bake's: each jaw a horseshoe of necks, every tooth with its crown toward the other
 * jaw, its cheek side away from the middle of the arch and its width along the arch.
 */
function mouth(chart: 'adult' | 'child'): ToothMetrics[] {
  const quadrants = chart === 'adult' ? [1, 2, 3, 4] : [5, 6, 7, 8];
  const perQuadrant = chart === 'adult' ? 8 : 5;
  const teeth: ToothMetrics[] = [];
  for (const quadrant of quadrants) {
    const upper = quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
    const left = quadrant === 2 || quadrant === 3 || quadrant === 6 || quadrant === 7;
    for (let position = 1; position <= perQuadrant; position++) {
      const angle = ((left ? 1 : -1) * (position - 0.5) * Math.PI * 0.46) / perQuadrant * (chart === 'adult' ? 1 : 1.1);
      const at = new Vector3(Math.sin(angle) * 1.1, upper ? 1.4 : 0.95, Math.cos(angle) * 1.4 + 1.2);
      const out = new Vector3(Math.sin(angle) / 1.1, 0, Math.cos(angle) / 1.4).normalize();
      const crown = new Vector3(0, upper ? -1 : 1, 0);
      const along = new Vector3().crossVectors(crown, out).normalize();
      const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(along, crown, out));
      teeth.push({
        fdi: `${quadrant}${position}`,
        position: at.toArray() as [number, number, number],
        quaternion: quaternion.toArray() as [number, number, number, number],
        halfWidth: 0.14, halfDepth: 0.16, crownHeight: 0.3, rootLength: 0.45, top: 0.3, bottom: -0.45, apex: [0, -0.45, 0],
      });
    }
  }
  return teeth;
}

const ADULT = mouth('adult');
const CHILD = mouth('child');

describe('buildGum', () => {
  const model = buildGum(ADULT);
  const attribute = (jaw: 'upper' | 'lower', name: string) => model[jaw]!.geometry.getAttribute(name);

  it('builds a gum for each jaw, and a palate for the upper one only', () => {
    expect(model.upper).not.toBeNull();
    expect(model.lower).not.toBeNull();
    const palate = (jaw: 'upper' | 'lower') => {
      const marks = attribute(jaw, '_g');
      let count = 0;
      for (let i = 0; i < marks.count; i++) if (marks.getW(i) === 1) count++;
      return count;
    };
    expect(palate('upper')).toBeGreaterThan(100);
    expect(palate('lower')).toBe(0);
  });

  it('is a sound mesh: finite, every triangle on real vertices', () => {
    for (const jaw of ['upper', 'lower'] as const) {
      const position = attribute(jaw, 'position');
      const index = model[jaw]!.geometry.getIndex()!;
      for (let i = 0; i < position.count * 3; i++) expect(Number.isFinite(position.array[i])).toBe(true);
      expect(index.count % 3).toBe(0);
      let highest = 0;
      for (let i = 0; i < index.count; i++) highest = Math.max(highest, index.getX(i));
      expect(highest).toBeLessThan(position.count);
    }
  });

  it('knows each tooth of each jaw, from the patient\'s right round to their left', () => {
    expect(model.upper!.fdis).toEqual(['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28']);
    expect(model.lower!.fdis[0]).toBe('48');
    expect(model.lower!.offset).toBe(GUM_SLOT_OFFSET.lower);
    expect(slotOfTooth(model, '16')).toBe(2);
    expect(slotOfTooth(model, '46')).toBe(GUM_SLOT_OFFSET.lower + 2);
    expect(slotOfTooth(model, '99')).toBe(-1);
    expect(toothAtSlot(model, 2.2)).toBe('16');
    expect(toothAtSlot(model, GUM_SLOT_OFFSET.lower + 7.4)).toBe('41');
  });

  it('places every vertex along the arch within the slots of its own jaw', () => {
    for (const jaw of ['upper', 'lower'] as const) {
      const marks = attribute(jaw, '_g');
      const offset = model[jaw]!.offset;
      for (let i = 0; i < marks.count; i++) {
        expect(marks.getX(i)).toBeGreaterThanOrEqual(offset - 1e-6);
        expect(marks.getX(i)).toBeLessThanOrEqual(offset + 15 + 1e-6);
      }
    }
  });

  it('looks out of the gum: the cheek side away from the arch, the tongue side into the mouth', () => {
    for (const jaw of ['upper', 'lower'] as const) {
      const position = attribute(jaw, 'position');
      const normal = attribute(jaw, 'normal');
      const marks = attribute(jaw, '_g');
      const centre = new Vector3(0, 0, 1.2 + 1.4 * 0.35);
      let cheek = 0, cheekOut = 0, tongue = 0, tongueIn = 0;
      for (let i = 0; i < marks.count; i++) {
        if (marks.getW(i) !== 0 || marks.getY(i) < 0.25 || marks.getY(i) > 0.75) continue;
        const away = new Vector3().fromBufferAttribute(position, i).sub(centre);
        away.y = 0;
        const facing = new Vector3().fromBufferAttribute(normal, i).dot(away.normalize());
        if (marks.getZ(i) > 0) { cheek++; if (facing > 0) cheekOut++; }
        if (marks.getZ(i) < 0) { tongue++; if (facing < 0) tongueIn++; }
      }
      expect(cheek).toBeGreaterThan(50);
      expect(cheekOut / cheek, `${jaw} cheek`).toBeGreaterThan(0.95);
      expect(tongueIn / tongue, `${jaw} tongue`).toBeGreaterThan(0.95);
    }
  });

  it('turns the palate down toward the bite', () => {
    const position = attribute('upper', 'position');
    const normal = attribute('upper', 'normal');
    const marks = attribute('upper', '_g');
    const toBite = new Vector3(0, -1, 0);
    let palate = 0, facing = 0;
    for (let i = 0; i < position.count; i++) {
      if (marks.getW(i) !== 1) continue;
      palate++;
      if (new Vector3().fromBufferAttribute(normal, i).dot(toBite) > 0) facing++;
    }
    expect(facing / palate).toBeGreaterThan(0.95);
  });

  it('rises into a papilla between two teeth and falls to the neck at each one', () => {
    const position = attribute('upper', 'position');
    const marks = attribute('upper', '_g');
    const axis = attribute('upper', '_axis');
    const necks = ADULT.filter((t) => t.fdi.charAt(0) === '1' || t.fdi.charAt(0) === '2');
    const heightOf = (i: number) => {
      const here = new Vector3().fromBufferAttribute(position, i);
      const neck = necks.reduce((best, t) => {
        const d = here.distanceTo(new Vector3(...t.position));
        return d < best.d ? { d, at: new Vector3(...t.position) } : best;
      }, { d: Infinity, at: new Vector3() }).at;
      return here.sub(neck).dot(new Vector3().fromBufferAttribute(axis, i));
    };
    const atTooth: number[] = [];
    const atPapilla: number[] = [];
    for (let i = 0; i < marks.count; i++) {
      if (marks.getW(i) !== 0 || marks.getY(i) !== 0 || marks.getZ(i) <= 0) continue;
      const fraction = marks.getX(i) - Math.floor(marks.getX(i));
      if (fraction < 0.03 || fraction > 0.97) atTooth.push(heightOf(i));
      if (Math.abs(fraction - 0.5) < 0.03) atPapilla.push(heightOf(i));
    }
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(atTooth.length).toBeGreaterThan(10);
    expect(atPapilla.length).toBeGreaterThan(10);
    expect(mean(atPapilla)).toBeGreaterThan(mean(atTooth) + 0.08);
    // The margin stands at the neck, not far above or below it.
    expect(Math.abs(mean(atTooth))).toBeLessThan(0.08);
  });

  it('reaches past the roots', () => {
    const position = attribute('lower', 'position');
    const marks = attribute('lower', '_g');
    const lowest = ADULT.filter((t) => t.fdi.charAt(0) === '4' || t.fdi.charAt(0) === '3');
    let deepest = 0;
    for (let i = 0; i < marks.count; i++) {
      if (marks.getY(i) < 1 || marks.getZ(i) !== 0) continue;
      const here = new Vector3().fromBufferAttribute(position, i);
      // Lower crowns point up, so the roots go down: depth below the neck's height.
      const neck = lowest.reduce((best, t) => (here.distanceTo(new Vector3(...t.position)) < best.distanceTo(here) ? new Vector3(...t.position) : best), new Vector3(...lowest[0].position));
      deepest = Math.max(deepest, neck.y - here.y);
    }
    expect(deepest).toBeGreaterThan(0.45);
  });

  it('builds the child\'s ten teeth a jaw the same way', () => {
    const child = buildGum(CHILD);
    expect(child.upper!.fdis).toEqual(['55', '54', '53', '52', '51', '61', '62', '63', '64', '65']);
    expect(child.lower!.fdis).toHaveLength(10);
    expect(child.upper!.geometry.getAttribute('position').count).toBeGreaterThan(500);
  });

  it('builds nothing for a jaw with nothing to hold', () => {
    const upperOnly = buildGum(ADULT.filter((t) => ['1', '2'].includes(t.fdi.charAt(0))));
    expect(upperOnly.upper).not.toBeNull();
    expect(upperOnly.lower).toBeNull();
  });
});
