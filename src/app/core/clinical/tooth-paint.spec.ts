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

describe('the states of the clinical referential, on the tooth', () => {
  const paint = (findings: Array<Parameters<typeof f>>, status: 'present' | 'caries' = 'present', fdi = '46') =>
    paintTooth(fdi, status, findings.map((args) => f(...args)));

  it('draws a cusp or a crown fracture on the faces it names, and a root fracture in the root', () => {
    expect(paint([['cusp_fracture', 'CONDITION', 'mesial']]).zones.mesial).toEqual({ family: 'condition', pattern: 'jag' });
    expect(paint([['crown_fracture', 'CONDITION']]).zones.occlusal?.pattern).toBe('jag');
    const root = paint([['root_fracture', 'CONDITION', 'mesialroot']]);
    expect(root.zones.root).toEqual({ family: 'condition', pattern: 'jag' });
    expect(root.zones.occlusal).toBeUndefined();
  });

  it('draws the work of the referential where it stands', () => {
    expect(paint([['existing_onlay', 'EXISTING']]).zones.occlusal).toEqual({ family: 'existing', pattern: 'solid' });
    expect(paint([['existing_glass_ionomer', 'EXISTING', 'distal']]).zones.distal?.pattern).toBe('solid');
    expect(paint([['bridge_pontic', 'EXISTING']]).zones.buccal?.pattern).toBe('hatch');
    expect(paint([['temporary_crown', 'EXISTING']]).zones.occlusal?.pattern).toBe('hatch');
    // A crown on an implant is threads in the root as well; a post and crown has the post in the root.
    expect(paint([['implant_crown', 'EXISTING']]).zones.root?.pattern).toBe('bars');
    const post = paint([['post_and_crown', 'EXISTING']]);
    expect(post.zones.root?.pattern).toBe('endo');
    expect(post.zones.occlusal?.pattern).toBe('hatch');
  });

  it('shows what is wrong with a restoration, on the part it is wrong on', () => {
    expect(paint([['fractured_restoration', 'CONDITION', 'occlusal']]).zones.occlusal).toEqual({ family: 'condition', pattern: 'jag' });
    expect(paint([['restoration_overhang', 'CONDITION']]).zones.mesial?.pattern).toBe('bars');
    expect(paint([['restoration_overhang', 'CONDITION']]).zones.distal?.pattern).toBe('bars');
    expect(paint([['defective_restoration', 'CONDITION', 'buccal']]).zones.buccal?.pattern).toBe('hatch');
  });

  it('draws endodontic states in the root, and marks the lesions at its tip', () => {
    expect(paint([['endo_treatment_started', 'CONDITION']]).zones.root).toEqual({ family: 'condition', pattern: 'endo' });
    expect(paint([['internal_resorption', 'CONDITION']]).zones.root?.pattern).toBe('stipple');
    expect(paint([['canal_obstruction', 'CONDITION']]).zones.root?.pattern).toBe('bars');
    const owed = paint([['retreatment_required', 'TREATMENT_REQUIRED']]);
    expect(owed.zones.root).toEqual({ family: 'planned', pattern: 'owed' });
    expect(owed.planned).toBe(true);
    for (const code of ['apical_periodontitis', 'periapical_abscess', 'reversible_pulpitis', 'irreversible_pulpitis_symptomatic']) {
      expect(paint([[code, 'CONDITION']]).lesion, code).toBe(true);
    }
  });

  it('draws a tooth that never formed as absent, and one that has not come through as held', () => {
    expect(paint([['agenesis', 'CONDITION']]).absent).toBe(true);
    const unerupted = paint([['unerupted', 'CONDITION']]);
    expect(unerupted.zones.root?.pattern).toBe('bars');
    expect(unerupted.zones.occlusal?.pattern).toBe('bars');
  });

  it('flags what has no place on the tooth, and nothing that says all is well', () => {
    for (const code of ['crowding', 'rotation', 'open_bite', 'ankylosis', 'concussion', 'supernumerary', 'pulp_calcification']) {
      expect(paint([[code, 'CONDITION']]).flagged, code).toBe(true);
    }
    for (const code of ['healthy_gingiva', 'normal_pulp', 'permanent_tooth', 'normal']) {
      expect(paint([[code, 'OBSERVATION']]).flagged, code).toBe(false);
    }
  });

  it('keeps a derived status from being painted twice when a state of the referential explains it', () => {
    // A root fracture is a "fracture" on the server: the status is already explained, so it is not painted again over the crown.
    const { zones } = paint([['root_fracture', 'CONDITION']], 'present');
    expect(zones.occlusal).toBeUndefined();
  });
});

describe('a suspicion on the tooth', () => {
  const suspected = (code: string, kind: ToothFinding['kind'], surface?: string) => ({ ...f(code, kind, surface), certainty: 'SUSPECTED' });

  it('is drawn on the part it concerns, in its own colour, and the tooth says it holds one', () => {
    const paint = paintTooth('16', 'present', [suspected('caries', 'CONDITION', 'mesial')]);
    expect(paint.zones.mesial).toEqual({ family: 'suspected', pattern: 'suspect' });
    expect(paint.suspected).toBe(true);
    expect(paintTooth('16', 'present', [f('caries', 'CONDITION', 'mesial')]).suspected).toBe(false);
  });

  it('is under what is confirmed on the same part', () => {
    const paint = paintTooth('16', 'present', [suspected('caries', 'CONDITION', 'occlusal'), f('existing_amalgam', 'EXISTING', 'occlusal')]);
    expect(paint.zones.occlusal).toEqual({ family: 'existing', pattern: 'solid' });
    const other = paintTooth('16', 'present', [f('existing_amalgam', 'EXISTING', 'occlusal'), suspected('caries', 'CONDITION', 'occlusal')]);
    expect(other.zones.occlusal).toEqual({ family: 'existing', pattern: 'solid' });
  });

  it('is never a tooth that is gone, a lesion at the root, tartar or an effect on the gum', () => {
    const gone = paintTooth('16', 'present', [suspected('extracted', 'CONDITION')]);
    expect(gone.absent).toBe(false);
    expect(gone.flagged).toBe(true);
    const lesion = paintTooth('16', 'present', [suspected('necrosis', 'CONDITION')]);
    expect(lesion.lesion).toBe(false);
    expect(lesion.suspected).toBe(true);
    const tartar = paintTooth('16', 'present', [suspected('calculus', 'CONDITION')]);
    expect(tartar.deposit).toEqual({ calculus: 0, plaque: 0 });
    expect(paintTooth('16', 'present', [suspected('gingivitis', 'CONDITION')]).gum).toBeNull();
  });

  it('is drawn when it was only dictated, too', () => {
    const paint = paintTooth('16', 'present', [], [{ fdi: '16', code: 'caries', surface: 'distal', certainty: 'SUSPECTED' }]);
    expect(paint.zones.distal?.family).toBe('suspected');
    expect(paint.staged).toBe(true);
  });
});

describe('tartar and plaque on the tooth', () => {
  it('covers every face unless the finding names some', () => {
    expect(paintTooth('36', 'present', [f('calculus', 'CONDITION')]).deposit).toEqual({ calculus: 15, plaque: 0 });
    expect(paintTooth('36', 'present', [f('calculus', 'CONDITION', 'buccal')]).deposit).toEqual({ calculus: 4, plaque: 0 });
    expect(paintTooth('36', 'present', [f('calculus', 'CONDITION', 'mesial-lingual')]).deposit).toEqual({ calculus: 9, plaque: 0 });
    expect(paintTooth('36', 'present', [f('plaque', 'CONDITION')]).deposit).toEqual({ calculus: 0, plaque: 15 });
  });

  it('is both for the combined state, as it was before the two were told apart', () => {
    expect(paintTooth('36', 'present', [f('plaque_calculus', 'CONDITION')]).deposit).toEqual({ calculus: 15, plaque: 15 });
  });

  it('is a crust and a film, not a red mark on the neck, and not a flag', () => {
    const paint = paintTooth('36', 'present', [f('calculus', 'CONDITION')]);
    expect(paint.zones.cervical).toBeUndefined();
    expect(paint.flagged).toBe(false);
  });
});

describe('what the gum of a tooth shows', () => {
  const gum = (...findings: Array<ReturnType<typeof f> & { note?: string }>) => paintTooth('16', 'present', findings).gum;

  it('is nothing until something is recorded about it', () => {
    expect(paintTooth('16', 'present', []).gum).toBeNull();
    expect(gum(f('caries', 'CONDITION'))).toBeNull();
  });

  it('is what each recorded state does, the strongest of each', () => {
    expect(gum(f('gingivitis', 'CONDITION'))).toMatchObject({ inflamed: 0.75, swollen: 0.4 });
    expect(gum(f('gingivitis', 'CONDITION'), f('gingival_enlargement', 'CONDITION'))).toMatchObject({ inflamed: 0.75, swollen: 0.8 });
    expect(gum(f('gingival_abscess', 'CONDITION'))).toMatchObject({ abscess: 1, pus: 1 });
    expect(gum(f('gingival_ulceration', 'CONDITION'))?.ulcer).toBe(1);
    expect(gum(f('gingival_pigmentation', 'CONDITION'))?.pigment).toBe(1);
  });

  it('knows how far a recession was measured', () => {
    expect(gum({ ...f('gingival_recession', 'CONDITION', 'buccal'), note: '3 mm' })).toMatchObject({ recession: 0.5, recessionMm: 3 });
    expect(gum({ ...f('gingival_recession', 'CONDITION', 'buccal'), note: '4.5 mm · patient anxieux' })?.recessionMm).toBe(4.5);
    expect(gum(f('gingival_recession', 'CONDITION'))?.recessionMm).toBeUndefined();
  });

  it('is an empty gum when it was recorded healthy: someone looked', () => {
    expect(gum(f('healthy_gingiva', 'OBSERVATION'))).toEqual({});
  });
});

describe('a root named for a state is the root', () => {
  it('reads "racine mésiale" as the root, for a state that goes by surface too', () => {
    const { zones } = paintTooth('46', 'present', [f('caries', 'CONDITION', 'mesialroot')]);
    expect(zones.root?.family).toBe('condition');
    expect(zones.mesial).toBeUndefined();
  });
});

