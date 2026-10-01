import { describe, expect, it } from 'vitest';
import { chartLine } from './consultation-chart';

const finding = (extra: Record<string, unknown> = {}) => ({
  intent: 'clinical.addFindings',
  entities: { fdi: '16', findings: [{ code: 'caries', surface: 'mesial-occlusal' }], ...extra },
  preview: 'Tooth 16 (upper right first molar) → Caries, mesial-occlusal',
});

describe('chartLine', () => {
  it('words a finding in French as it was read back to the doctor, not as the English audit text', () => {
    expect(chartLine(finding(), 'fr', 'Dent')).toBe('Dent 16 : Carie (mésio-occlusale)');
  });

  it('words it in English too', () => {
    expect(chartLine(finding(), 'en', 'Tooth')).toBe('Tooth 16 : Caries (mesial-occlusal)');
  });

  it('lists several findings on one tooth, with and without a surface', () => {
    const entry = finding({ findings: [{ code: 'caries', surface: 'occlusal' }, { code: 'fracture' }] });

    const line = chartLine(entry, 'fr', 'Dent');

    expect(line.startsWith('Dent 16 : ')).toBe(true);
    expect(line).toContain('(occlusale)');
    expect(line.split(', ')).toHaveLength(2);
  });

  it('copes with a tooth the pipeline stored as a number', () => {
    expect(chartLine(finding({ fdi: 16 }), 'fr', 'Dent')).toMatch(/^Dent 16 : /);
  });

  it('keeps the pipeline\'s own text for anything that is not a tooth finding', () => {
    const note = { intent: 'clinical.addNote', entities: { content: 'x' }, preview: 'Note : patient anxieux' };

    expect(chartLine(note, 'fr', 'Dent')).toBe('Note : patient anxieux');
  });

  it('keeps it too when a finding has no tooth or no codes', () => {
    expect(chartLine({ intent: 'clinical.addFindings', entities: { findings: [{ code: 'caries' }] }, preview: 'P' }, 'fr', 'Dent')).toBe('P');
    expect(chartLine({ intent: 'clinical.addFindings', entities: { fdi: '16' }, preview: 'P' }, 'fr', 'Dent')).toBe('P');
  });
});
