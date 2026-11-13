import { describe, expect, it } from 'vitest';
import { areaOfTooth, effectOfCondition, gumPaints, teethOfArea } from './gum-regions';
import { paintTooth } from './tooth-paint';
import { ADULT_TEETH, CHILD_TEETH } from '../models/patient.model';

describe('areaOfTooth', () => {
  it('puts the front six of each jaw in one part and each side\'s back teeth in its own', () => {
    expect(['13', '12', '11', '21', '22', '23'].map(areaOfTooth)).toEqual(Array(6).fill('UPPER_FRONT'));
    expect(['43', '42', '41', '31', '32', '33'].map(areaOfTooth)).toEqual(Array(6).fill('LOWER_FRONT'));
    expect(['14', '15', '16', '17', '18'].map(areaOfTooth)).toEqual(Array(5).fill('UPPER_RIGHT'));
    expect(['24', '28'].map(areaOfTooth)).toEqual(['UPPER_LEFT', 'UPPER_LEFT']);
    expect(['44', '48'].map(areaOfTooth)).toEqual(['LOWER_RIGHT', 'LOWER_RIGHT']);
    expect(['34', '38'].map(areaOfTooth)).toEqual(['LOWER_LEFT', 'LOWER_LEFT']);
  });

  it('puts a child\'s teeth in the same parts', () => {
    expect(areaOfTooth('53')).toBe('UPPER_FRONT');
    expect(areaOfTooth('55')).toBe('UPPER_RIGHT');
    expect(areaOfTooth('65')).toBe('UPPER_LEFT');
    expect(areaOfTooth('85')).toBe('LOWER_RIGHT');
    expect(areaOfTooth('75')).toBe('LOWER_LEFT');
  });

  it('shares every tooth of a chart out, once, among the six parts', () => {
    for (const teeth of [ADULT_TEETH, CHILD_TEETH]) {
      const parts = (['UPPER_RIGHT', 'UPPER_FRONT', 'UPPER_LEFT', 'LOWER_RIGHT', 'LOWER_FRONT', 'LOWER_LEFT'] as const)
        .flatMap((area) => teethOfArea(area, teeth));
      expect([...parts].sort()).toEqual([...teeth].sort());
    }
    expect(teethOfArea('WHOLE_MOUTH', ADULT_TEETH)).toHaveLength(32);
  });
});

describe('effectOfCondition', () => {
  it('does nothing for a healthy gum, inflames a gingivitis and worsens with the stage of a periodontitis', () => {
    expect(effectOfCondition('HEALTHY')).toEqual({});
    expect(effectOfCondition('GINGIVITIS').inflamed).toBeGreaterThan(0.5);
    const stageOne = effectOfCondition('PERIODONTITIS', 1);
    const stageFour = effectOfCondition('PERIODONTITIS', 4);
    expect(stageFour.perio).toBe(1);
    expect(stageOne.perio).toBeLessThan(stageFour.perio!);
    expect(stageOne.recession).toBeLessThan(stageFour.recession!);
    expect(effectOfCondition('PERIODONTITIS').perio).toBe(1);
  });
});

describe('gumPaints', () => {
  const paint = (fdi: string, findings: Array<{ findingCode: string; kind: 'CONDITION'; surface?: string | null; note?: string | null }>) =>
    paintTooth(fdi, 'present', findings.map((f) => ({ surface: null, ...f })));
  const teeth = ['16', '11', '26', '46'];

  it('draws the gum of a tooth from the assessment of its part of the mouth', () => {
    const paints = gumPaints(teeth, new Map(), [{ region: 'UPPER_RIGHT', condition: 'GINGIVITIS' }]);
    expect([...paints.keys()]).toEqual(['16']);
    expect(paints.get('16')!.inflamed).toBeGreaterThan(0.5);
  });

  it('applies the whole mouth\'s assessment where a part has none of its own', () => {
    const paints = gumPaints(teeth, new Map(), [
      { region: 'WHOLE_MOUTH', condition: 'GINGIVITIS' },
      { region: 'LOWER_RIGHT', condition: 'HEALTHY' },
    ]);
    expect([...paints.keys()].sort()).toEqual(['11', '16', '26']);
  });

  it('adds what was recorded on the tooth to its part\'s state, the strongest of each', () => {
    const paints = gumPaints(['16'], new Map([['16', paint('16', [{ findingCode: 'gingival_recession', kind: 'CONDITION', surface: 'buccal', note: '3 mm' }])]]), [
      { region: 'UPPER_RIGHT', condition: 'GINGIVITIS' },
    ]);
    expect(paints.get('16')!.inflamed).toBeGreaterThan(0.5);
    expect(paints.get('16')!.recessionMm).toBe(3);
    expect(paints.get('16')!.recession).toBe(0.5);
  });

  it('shows nothing where the tooth\'s own gum was recorded healthy, whatever its part says', () => {
    const paints = gumPaints(['16'], new Map([['16', paint('16', [{ findingCode: 'healthy_gingiva', kind: 'CONDITION' }])]]), [
      { region: 'UPPER_RIGHT', condition: 'PERIODONTITIS', stage: 3 },
    ]);
    expect(paints.size).toBe(0);
  });

  it('draws a gum nobody assessed only from what was recorded on its tooth', () => {
    const paints = gumPaints(teeth, new Map([['46', paint('46', [{ findingCode: 'gingival_abscess', kind: 'CONDITION' }])]]), []);
    expect([...paints.keys()]).toEqual(['46']);
    expect(paints.get('46')!.abscess).toBe(1);
    expect(paints.get('46')!.pus).toBe(1);
  });

  it('does not take a suspicion for a state of the gum', () => {
    const suspected = paintTooth('16', 'present', [{ findingCode: 'gingivitis', kind: 'CONDITION', surface: null, certainty: 'SUSPECTED' }]);
    expect(gumPaints(['16'], new Map([['16', suspected]]), []).size).toBe(0);
  });
});
