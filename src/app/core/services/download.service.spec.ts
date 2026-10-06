import { describe, expect, it } from 'vitest';
import { filenameFromDisposition, toParams } from './download.service';

describe('filenameFromDisposition', () => {
  it('reads the encoded form the backend sends for names with accents', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''activit%C3%A9-par-acte.xlsx", 'x')).toBe('activité-par-acte.xlsx');
  });

  it('reads the plain quoted form', () => {
    expect(filenameFromDisposition('attachment; filename="cpc-2026-03-01.pdf"', 'x')).toBe('cpc-2026-03-01.pdf');
    expect(filenameFromDisposition('attachment; filename=etiquettes.pdf', 'x')).toBe('etiquettes.pdf');
  });

  it('prefers the encoded form when both are present', () => {
    expect(filenameFromDisposition("attachment; filename=\"fallback.pdf\"; filename*=UTF-8''vrai%20nom.pdf", 'x')).toBe('vrai nom.pdf');
  });

  it('falls back when there is no usable header', () => {
    expect(filenameFromDisposition(null, 'export')).toBe('export');
    expect(filenameFromDisposition('inline', 'export')).toBe('export');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'export')).toBe('export');
  });
});

describe('toParams', () => {
  it('leaves out what is empty and repeats a list', () => {
    const params = toParams({ from: '2026-03-01', practitionerId: null, search: '', method: ['CASH', 'CARD'], debtOnly: false, page: 0 });
    expect(params.get('from')).toBe('2026-03-01');
    expect(params.has('practitionerId')).toBe(false);
    expect(params.has('search')).toBe(false);
    expect(params.getAll('method')).toEqual(['CASH', 'CARD']);
    expect(params.get('debtOnly')).toBe('false');
    expect(params.get('page')).toBe('0');
  });

  it('copes with no query at all', () => {
    expect(toParams(undefined).keys()).toEqual([]);
  });
});
