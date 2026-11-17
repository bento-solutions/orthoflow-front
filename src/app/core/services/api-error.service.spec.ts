import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiErrors } from './api-error.service';
import { ToastService } from './toast.service';

describe('ApiErrors', () => {
  let errors: ApiErrors;
  let toast: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService({ defaultLanguage: 'en' })] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      COMMON: {
        ERROR_GENERIC: 'Something went wrong.',
        EXPORT_FAILED: 'The export failed.',
        ERROR_PROFILE_INCOMPLETE: 'Complete the clinic profile. Missing: {{fields}}.',
        OPEN_CLINIC_PROFILE: 'Open the clinic profile',
      },
      SET: { PROFILE: { ADDRESS: 'Address', PHONE: 'Phone' } },
    });
    translate.use('en');
    errors = TestBed.inject(ApiErrors);
    toast = TestBed.inject(ToastService);
  });

  it('names the clinic profile fields a refused document lacks, and links to the profile', () => {
    const refused = new HttpErrorResponse({
      status: 409,
      error: { detail: 'Complete the clinic profile before issuing this document. Missing: ice, taxId, address.',
        code: 'CLINIC_PROFILE_INCOMPLETE', missing: ['ice', 'taxId', 'address'] },
    });

    expect(errors.report(refused)).toBe('Complete the clinic profile. Missing: ICE, IF, Address.');
    expect(toast.toasts()[0].action).toEqual({ label: 'Open the clinic profile', link: '/settings/practice' });
  });

  it('keeps the server detail for any other refusal, with no link', () => {
    const conflict = new HttpErrorResponse({ status: 409, error: { detail: 'This invoice is already paid.' } });

    expect(errors.report(conflict)).toBe('This invoice is already paid.');
    expect(toast.toasts()[0].action).toBeUndefined();
  });

  it('says what failed when the server could not', () => {
    const crash = new HttpErrorResponse({ status: 500, error: null });

    expect(errors.message(crash, 'COMMON.EXPORT_FAILED')).toBe('The export failed.');
    expect(errors.message(crash)).toBe('Something went wrong.');
  });
});
