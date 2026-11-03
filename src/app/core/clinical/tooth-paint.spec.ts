import { describe, expect, it } from 'vitest';
import { ToothFinding } from '../models/clinical-record.model';
import { ToothState } from '../models/patient.model';
import { PAINT_ZONES, paintChart, paintTooth, surfaceOfZone, zoneAt } from './tooth-paint';

const f = (findingCode: string, kind: ToothFinding['kind'], surface?: string) => ({ findingCode, kind, surface });

describe('paintTooth', () => {
  it('a sound tooth has nothing on it', () => {
    const paint = paintTooth('16', 'present', []);
    expect(paint.zones).toEqual({});
    expect(paint.absent).toBe(false);
  });

  it('a caries on named faces paints those faces and no others', () => {
    const { zones } = paintTooth('16', 'caries', [f('caries', 'CONDITION', 'mesial-occlusal')]);
    expect(zones.mesial).toEqual({ family: 'condition', pattern: 'stipple' });
    expect(zones.occlusal).toEqual({ family: 'condition', pattern: 'stipple' });
    expect(zones.distal).toBeUndefined();
    expect(zones.root).toBeUndefined();
  });

  it('a crown covers the crown and leaves the root alone', () => {
    const { zones } = paintTooth('26', 'crown', [f('existing_crown', 'EXISTING')]);
    for (const zone of ['cervical', 'occlusal', 'mesial', 'distal', 'buccal', 'lingual'] as const) {
      expect(zones[zone]?.pattern).toBe('hatch');
    }
    expect(zones.root).toBeUndefined();
  });

  it('a root canal treatment is in the root, and a crown over it stays on the crown', () => {
    const { zones } = paintTooth('26', 'crown', [f('existing_crown', 'EXISTING'), f('existing_root_canal', 'EXISTING')]);
    expect(zones.root?.pattern).toBe('endo');
    expect(zones.occlusal?.pattern).toBe('hatch');
  });

  it('an implant is threads in the root', () => {
    const { zones } = paintTooth('36', 'implant', [f('existing_implant', 'EXISTING')]);
    expect(zones.root?.pattern).toBe('bars');
  });

  it('a veneer covers only the side that shows', () => {
    const { zones } = paintTooth('21', 'veneer', [f('existing_veneer', 'EXISTING')]);
    expect(Object.keys(zones)).toEqual(['buccal']);
  });

  it('a part takes the strongest thing recorded on it', () => {
    const { zones } = paintTooth('16', 'caries', [
      f('filling_required', 'TREATMENT_REQUIRED', 'mesial'),
      f('existing_amalgam', 'EXISTING', 'mesial'),
      f('caries', 'CONDITION', 'mesial'),
    ]);
    expect(zones.mesial?.family).toBe('condition');
  });

  it('work still owed is owed, and drawn as such', () => {
    const paint = paintTooth('34', 'present', [f('filling_required', 'TREATMENT_REQUIRED', 'occlusal')]);
    expect(paint.planned).toBe(true);
    expect(paint.zones.occlusal).toEqual({ family: 'planned', pattern: 'owed' });
  });

  it('an extracted or missing tooth is absent', () => {
    expect(paintTooth('46', 'extracted', [f('extracted', 'CONDITION')]).absent).toBe(true);
    expect(paintTooth('18', 'missing', []).absent).toBe(true);
  });

  it('an abscess is a lesion at the root, not a colour on the crown', () => {
    const paint = paintTooth('24', 'present', [f('abscess', 'CONDITION')]);
    expect(paint.lesion).toBe(true);
    expect(paint.zones).toEqual({});
  });

  it('a retained root has lost its crown', () => {
    const paint = paintTooth('14', 'fracture', [f('retained_root', 'CONDITION')]);
    expect(paint.crownLost).toBe(true);
    expect(paint.zones.root?.family).toBe('condition');
  });

  it('a finding with no place on the tooth is flagged rather than lost', () => {
    const paint = paintTooth('14', 'present', [f('mobility', 'CONDITION')]);
    expect(paint.flagged).toBe(true);
    expect(paint.zones).toEqual({});
    expect(paintTooth('14', 'present', [f('some_future_code', 'CONDITION')]).flagged).toBe(true);
  });

  it('a status with no finding behind it still shows, on the part it belongs to', () => {
    expect(paintTooth('16', 'crown', []).zones.occlusal?.pattern).toBe('hatch');
    expect(paintTooth('16', 'root_canal', []).zones.root?.pattern).toBe('endo');
    expect(paintTooth('16', 'caries', []).zones.buccal?.family).toBe('condition');
  });

  it('a status explained by findings on named faces does not also paint the whole crown', () => {
    const { zones } = paintTooth('16', 'caries', [f('caries', 'CONDITION', 'mesial')]);
    expect(zones.buccal).toBeUndefined();
  });

  it('what was dictated and not saved is drawn too, and marked as such', () => {
    const paint = paintTooth('16', 'present', [], [{ fdi: '16', code: 'caries', surface: 'distal' }]);
    expect(paint.staged).toBe(true);
    expect(paint.zones.distal?.family).toBe('condition');
    expect(paintTooth('16', 'present', [], [{ fdi: '16', code: 'crown_required', surface: null }]).planned).toBe(true);
  });
});

describe('paintChart', () => {
  const teeth: Record<string, ToothState> = { '16': { id: '16', status: 'caries' }, '26': { id: '26', status: 'present' } };
  const finding = (fdi: string, status: ToothFinding['status']): ToothFinding =>
    ({ fdi, findingCode: 'caries', kind: 'CONDITION', status, surface: 'mesial' } as ToothFinding);

  it('history is not the tooth as it is now', () => {
    const paints = paintChart({ '26': { id: '26', status: 'present' } }, [finding('26', 'RESOLVED'), finding('26', 'RETRACTED')]);
    expect(paints[0].zones).toEqual({});
  });

  it('gives every tooth its own findings', () => {
    const paints = paintChart(teeth, [finding('16', 'ACTIVE')]);
    expect(paints.find((p) => p.fdi === '16')?.zones.mesial).toBeDefined();
    expect(paints.find((p) => p.fdi === '26')?.zones.mesial).toBeUndefined();
  });

  it('rings a tooth with what is under way before what is planned before what is done', () => {
    const paints = paintChart(teeth, [], [], [
      { teeth: '16, 26', status: 'COMPLETED' },
      { teeth: '16', status: 'ACTIVE' },
      { teeth: '26', status: 'PLANNED' },
      { teeth: '26', status: 'CANCELLED' },
    ]);
    expect(paints.find((p) => p.fdi === '16')?.treatment).toBe('ACTIVE');
    expect(paints.find((p) => p.fdi === '26')?.treatment).toBe('PLANNED');
  });
});

describe('zoneAt', () => {
  it('splits a back tooth like the five-part drawing', () => {
    expect(zoneAt(0, 0, 0.9, false)).toBe('occlusal');
    expect(zoneAt(0.9, 0.2, 0.4, false)).toBe('mesial');
    expect(zoneAt(-0.9, 0.2, 0.4, false)).toBe('distal');
    expect(zoneAt(0.2, 0.9, 0.4, false)).toBe('buccal');
    expect(zoneAt(0.2, -0.9, 0.4, false)).toBe('lingual');
  });

  it('gives a front tooth an edge, not a table', () => {
    expect(zoneAt(0, 0, 0.9, true)).toBe('occlusal');
    expect(zoneAt(0, 0.8, 0.6, true)).toBe('buccal');
  });

  it('knows the neck and the root', () => {
    expect(zoneAt(0.9, 0, 0.05, false)).toBe('cervical');
    expect(zoneAt(0.9, 0, -0.5, false)).toBe('root');
  });

  it('has a column for every zone it can return', () => {
    expect(PAINT_ZONES).toEqual(['root', 'cervical', 'occlusal', 'mesial', 'distal', 'buccal', 'lingual']);
  });
});

describe('surfaceOfZone', () => {
  it('calls the top of a front tooth incisal and of a back tooth occlusal', () => {
    expect(surfaceOfZone('occlusal', '11')).toBe('incisal');
    expect(surfaceOfZone('occlusal', '16')).toBe('occlusal');
    expect(surfaceOfZone('occlusal', '53')).toBe('incisal');
    expect(surfaceOfZone('occlusal', '54')).toBe('occlusal');
  });

  it('has no surface word for the root', () => {
    expect(surfaceOfZone('root', '16')).toBeNull();
  });
});
