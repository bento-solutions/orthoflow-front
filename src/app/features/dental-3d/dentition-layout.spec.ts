import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { ToothMetrics, fitDistance, layoutFor, rowOrder } from './dentition-layout';

const metrics = (fdi: string): ToothMetrics => {
  const quadrant = Number(fdi.charAt(0));
  const position = Number(fdi.charAt(1));
  const left = quadrant === 2 || quadrant === 3 || quadrant === 6 || quadrant === 7;
  const upper = quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
  return {
    fdi,
    position: [(left ? 1 : -1) * position * 0.15, upper ? 1.2 : 0.9, 3 - position * 0.2],
    quaternion: upper ? [0, 0, 1, 0] : [0, 0, 0, 1],
    halfWidth: 0.15, halfDepth: 0.15, crownHeight: 0.3, rootLength: 0.5, top: 0.3, bottom: -0.5, apex: [0, -0.5, 0],
  };
};

const ADULT = ['11', '12', '13', '14', '15', '16', '17', '18', '21', '22', '23', '24', '25', '26', '27', '28',
  '31', '32', '33', '34', '35', '36', '37', '38', '41', '42', '43', '44', '45', '46', '47', '48'].map(metrics);
const CHILD = ['51', '52', '53', '54', '55', '61', '62', '63', '64', '65', '71', '72', '73', '74', '75', '81', '82', '83', '84', '85'].map(metrics);

describe('rowOrder', () => {
  it('runs from the patient\'s right to their left, as a dentist reads a radiograph', () => {
    expect(rowOrder(ADULT, true).map((t) => t.fdi)).toEqual(['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28']);
    expect(rowOrder(ADULT, false).map((t) => t.fdi)).toEqual(['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38']);
    expect(rowOrder(CHILD, true).map((t) => t.fdi)).toEqual(['55', '54', '53', '52', '51', '61', '62', '63', '64', '65']);
  });
});

describe('layoutFor', () => {
  for (const view of ['panoramic', 'occlusal', 'lingual'] as const) {
    it(`${view}: every tooth has a place, upper above lower, right side on the left`, () => {
      const { poses } = layoutFor(view, ADULT);
      expect(poses.size).toBe(32);
      expect(poses.get('16')!.position.y).toBeGreaterThan(0);
      expect(poses.get('46')!.position.y).toBeLessThan(0);
      expect(poses.get('18')!.position.x).toBeLessThan(poses.get('11')!.position.x);
      expect(poses.get('11')!.position.x).toBeLessThan(poses.get('21')!.position.x);
      expect(poses.get('21')!.position.x).toBeLessThan(poses.get('28')!.position.x);
      expect(poses.get('48')!.position.x).toBeLessThan(poses.get('38')!.position.x);
    });
  }

  it('no two teeth of a row overlap', () => {
    const { poses } = layoutFor('panoramic', ADULT);
    for (const upper of [true, false]) {
      const row = rowOrder(ADULT, upper);
      for (let i = 1; i < row.length; i++) {
        const gap = poses.get(row[i].fdi)!.position.x - poses.get(row[i - 1].fdi)!.position.x;
        expect(gap).toBeGreaterThanOrEqual(row[i].halfWidth + row[i - 1].halfWidth);
      }
    }
  });

  it('turns upper crowns down and lower crowns up, tilted toward the viewer', () => {
    const { poses } = layoutFor('panoramic', ADULT);
    const occlusal = new Vector3(0, 1, 0);
    const upper = occlusal.clone().applyQuaternion(poses.get('16')!.quaternion);
    const lower = occlusal.clone().applyQuaternion(poses.get('46')!.quaternion);
    expect(upper.y).toBeLessThan(-0.8);
    expect(lower.y).toBeGreaterThan(0.8);
    expect(upper.z).toBeGreaterThan(0.1);
    expect(lower.z).toBeGreaterThan(0.1);
  });

  it('shows the cheek side by default and the tongue side in the lingual view', () => {
    const buccal = new Vector3(0, 0, 1);
    expect(buccal.clone().applyQuaternion(layoutFor('panoramic', ADULT).poses.get('46')!.quaternion).z).toBeGreaterThan(0.5);
    expect(buccal.clone().applyQuaternion(layoutFor('lingual', ADULT).poses.get('46')!.quaternion).z).toBeLessThan(-0.5);
  });

  it('faces the biting surfaces to the viewer in the occlusal view', () => {
    const occlusal = new Vector3(0, 1, 0);
    expect(occlusal.clone().applyQuaternion(layoutFor('occlusal', ADULT).poses.get('46')!.quaternion).z).toBeGreaterThan(0.9);
    expect(occlusal.clone().applyQuaternion(layoutFor('occlusal', ADULT).poses.get('16')!.quaternion).z).toBeGreaterThan(0.9);
  });

  it('keeps the natural positions for the arches, parted', () => {
    const { poses } = layoutFor('arch', ADULT);
    expect(poses.size).toBe(32);
    expect(poses.get('11')!.position.y).toBeGreaterThan(poses.get('41')!.position.y);
    expect(poses.get('16')!.position.x).toBeLessThan(0);
    expect(poses.get('26')!.position.x).toBeGreaterThan(0);
  });

  it('lays out a child\'s twenty teeth the same way', () => {
    const { poses } = layoutFor('panoramic', CHILD);
    expect(poses.size).toBe(20);
    expect(poses.get('55')!.position.x).toBeLessThan(poses.get('65')!.position.x);
    expect(poses.get('54')!.position.y).toBeGreaterThan(poses.get('84')!.position.y);
  });
});

describe('layoutFor on a portrait stage', () => {
  it('gives each quadrant a row, in the order a dentist counts them', () => {
    const { poses } = layoutFor('panoramic', ADULT, true);
    expect(poses.size).toBe(32);
    const y = (fdi: string) => poses.get(fdi)!.position.y;
    expect(y('16')).toBeGreaterThan(y('26'));
    expect(y('26')).toBeGreaterThan(y('46'));
    expect(y('46')).toBeGreaterThan(y('36'));
    expect(y('16')).toBeCloseTo(y('11'));
    expect(y('36')).toBeCloseTo(y('31'));
  });

  it('keeps upper teeth above the line and lower teeth below it', () => {
    const { poses } = layoutFor('panoramic', ADULT, true);
    for (const fdi of ['11', '18', '21', '28']) expect(poses.get(fdi)!.position.y).toBeGreaterThan(0);
    for (const fdi of ['31', '38', '41', '48']) expect(poses.get(fdi)!.position.y).toBeLessThan(0);
  });

  it('runs each row from the back of the mouth on the patient\'s right to the back on their left', () => {
    const { poses } = layoutFor('panoramic', ADULT, true);
    expect(poses.get('18')!.position.x).toBeLessThan(poses.get('11')!.position.x);
    expect(poses.get('21')!.position.x).toBeLessThan(poses.get('28')!.position.x);
  });

  it('gives each tooth more room than one long row does', () => {
    const wide = layoutFor('panoramic', ADULT, false);
    const tall = layoutFor('panoramic', ADULT, true);
    expect(tall.halfWidth).toBeLessThan(wide.halfWidth * 0.6);
    expect(tall.halfHeight).toBeGreaterThan(wide.halfHeight);
  });

  it('lays out a child\'s quadrants too, and leaves the natural arches alone', () => {
    expect(layoutFor('panoramic', CHILD, true).poses.size).toBe(20);
    const arch = layoutFor('arch', ADULT, true);
    expect(arch.poses.get('16')!.position.toArray()).toEqual(layoutFor('arch', ADULT, false).poses.get('16')!.position.toArray());
  });
});

describe('fitDistance', () => {
  it('backs off for whichever side is the tighter one', () => {
    const wide = fitDistance(3, 1, 20, 2);
    const tall = fitDistance(1, 3, 20, 2);
    expect(wide).toBeCloseTo(3 / (Math.tan((10 * Math.PI) / 180) * 2));
    expect(tall).toBeCloseTo(3 / Math.tan((10 * Math.PI) / 180));
  });
});

describe('the mouth view', () => {
  // Natural-looking arches: a horseshoe of necks for each jaw, upper above lower, crowns toward each other.
  const horseshoe = (fdi: string): ToothMetrics => {
    const quadrant = Number(fdi.charAt(0));
    const position = Number(fdi.charAt(1));
    const left = quadrant === 2 || quadrant === 3;
    const upper = quadrant === 1 || quadrant === 2;
    const angle = ((left ? 1 : -1) * (position - 0.5) * Math.PI) / 17;
    return {
      fdi,
      position: [Math.sin(angle) * 1.1, upper ? 1.4 : 0.95, 1.3 + Math.cos(angle) * 1.5],
      quaternion: upper ? [0, 0, 1, 0] : [0, 0, 0, 1],
      halfWidth: 0.14, halfDepth: 0.16, crownHeight: 0.3, rootLength: 0.45, top: 0.3, bottom: -0.45, apex: [0, -0.45, 0],
    };
  };
  const MOUTH = ADULT.map((t) => horseshoe(t.fdi));

  it('is the chart\'s view by default, and the unrolled one is another view', () => {
    const mouth = layoutFor('overview', MOUTH);
    const unrolled = layoutFor('panoramic', MOUTH);
    expect(mouth.jaws).not.toBeNull();
    expect(unrolled.jaws).toBeNull();
    expect(mouth.poses.get('16')!.position.toArray()).not.toEqual(unrolled.poses.get('16')!.position.toArray());
  });

  it('keeps the teeth on the natural arches, parted a little more than the arches view parts them', () => {
    const mouth = layoutFor('overview', MOUTH);
    const arch = layoutFor('arch', MOUTH);
    const gap = (layout: typeof mouth) => layout.poses.get('11')!.position.y - layout.poses.get('41')!.position.y;
    expect(gap(mouth)).toBeGreaterThan(gap(arch));
    expect(mouth.poses.get('16')!.position.x).toBeLessThan(0);
    expect(mouth.poses.get('26')!.position.x).toBeGreaterThan(0);
  });

  it('moves each jaw as one: a gum riding on its matrix lands where the teeth went', () => {
    const mouth = layoutFor('overview', MOUTH);
    for (const [fdi, jaw] of [['16', mouth.jaws!.upper], ['27', mouth.jaws!.upper], ['46', mouth.jaws!.lower], ['38', mouth.jaws!.lower]] as const) {
      const natural = new Vector3(...MOUTH.find((t) => t.fdi === fdi)!.position);
      const moved = natural.clone().applyMatrix4(jaw as Matrix4);
      expect(moved.distanceTo(mouth.poses.get(fdi)!.position), fdi).toBeLessThan(1e-6);
    }
  });

  it('frames more than the teeth: the gums go past the roots', () => {
    const mouth = layoutFor('overview', MOUTH);
    const arch = layoutFor('arch', MOUTH);
    expect(mouth.halfHeight).toBeGreaterThan(arch.halfHeight);
    expect(mouth.halfWidth).toBeGreaterThan(arch.halfWidth);
  });

  it('can be turned all the way round, like the arches', () => {
    expect(layoutFor('overview', MOUTH).orbit.azimuth).toBe(Infinity);
  });

  it('is the same on a portrait stage: the mouth is not cut into rows', () => {
    expect(layoutFor('overview', MOUTH, true).poses.get('16')!.position.toArray()).toEqual(layoutFor('overview', MOUTH, false).poses.get('16')!.position.toArray());
  });
});
