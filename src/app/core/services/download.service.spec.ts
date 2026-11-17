import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { filenameFromDisposition, readableError, toParams } from './download.service';

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

describe('readableError', () => {
  it('turns a problem document sent as a blob back into JSON the error toast can read', async () => {
    const problem = { detail: 'Complete the clinic profile', code: 'CLINIC_PROFILE_INCOMPLETE', missing: ['ice'] };
    const failed = new HttpErrorResponse({
      status: 409, error: new Blob([JSON.stringify(problem)], { type: 'application/problem+json' }),
    });

    const readable = await readableError(failed) as HttpErrorResponse;

    expect(readable).toBeInstanceOf(HttpErrorResponse);
    expect(readable.status).toBe(409);
    expect(readable.error).toEqual(problem);
  });

  it('leaves alone what is not a JSON blob', async () => {
    const pdf = new HttpErrorResponse({ status: 500, error: new Blob(['%PDF'], { type: 'application/pdf' }) });
    const other = new Error('boom');

    expect(await readableError(pdf)).toBe(pdf);
    expect(await readableError(other)).toBe(other);
  });
});
