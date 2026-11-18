import { describe, expect, it } from 'vitest';
import { ToothFinding } from '../models/clinical-record.model';
import { ToothState } from '../models/patient.model';
import { paintChart } from './tooth-paint';
import { summarizeMouth } from './mouth-summary';

const finding = (fdi: string, findingCode: string, kind: ToothFinding['kind'], surface?: string): ToothFinding =>
  ({ id: `${fdi}-${findingCode}`, fdi, findingCode, kind, surface, status: 'ACTIVE' }) as ToothFinding;

describe('summarizeMouth', () => {
  const order = ['18', '17', '16', '26', '36', '46', '48'];

  it('puts each tooth in every state it is in, in chart order, and leaves out empty states', () => {
    const teeth: Record<string, ToothState> = Object.fromEntries(order.map((fdi) => [fdi, { id: fdi, status: 'present' } as ToothState]));
    teeth['18'] = { id: '18', status: 'extracted' };
    teeth['48'] = { id: '48', status: 'extracted' };
    const paints = paintChart(teeth, [
      finding('46', 'caries', 'CONDITION', 'occlusal'),
      finding('46', 'crown_required', 'TREATMENT_REQUIRED'),
      finding('16', 'deep_caries', 'CONDITION', 'occlusal'),
      finding('16', 'root_canal_required', 'TREATMENT_REQUIRED'),
      finding('36', 'existing_crown', 'EXISTING'),
    ]);
    const groups = summarizeMouth(order, new Map(paints.map((p) => [p.fdi, p])));

    expect(Object.fromEntries(groups.map((g) => [g.kind, g.teeth]))).toEqual({
      condition: ['16', '46'],
      planned: ['16', '46'],
      existing: ['36'],
      absent: ['18', '48'],
    });
    expect(groups.find((g) => g.kind === 'condition')?.key).toBe('DENTAL_3D.GROUP.CONDITION');
  });

  it('says nothing about a mouth with nothing recorded', () => {
    const paints = paintChart(Object.fromEntries(order.map((fdi) => [fdi, { id: fdi, status: 'present' } as ToothState])), []);
    expect(summarizeMouth(order, new Map(paints.map((p) => [p.fdi, p])))).toEqual([]);
  });
});
