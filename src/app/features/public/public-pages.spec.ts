import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntakeApi } from '../../core/services/intake-api.service';
import { LanguageService } from '../../core/services/language.service';
import { PublicBookingComponent, slotMoment, typeName } from './public-booking.component';
import { BLANK_REGISTRATION, PublicRegistrationComponent, isMinor, registrationRequest } from './public-registration.component';
import { PublicSurveyComponent } from './public-survey.component';
import { useClinicLanguage } from './public-shell.component';

describe('public page helpers', () => {
  it('names an appointment type in the visitor\'s language, falling back to French', () => {
    const type = { nameFr: 'Contrôle', nameEn: 'Check-up', nameAr: 'فحص' };
    expect(typeName(type, 'en')).toBe('Check-up');
    expect(typeName(type, 'ar')).toBe('فحص');
    expect(typeName({ ...type, nameEn: '' }, 'en')).toBe('Contrôle');
  });

  it('sends a free time as a moment in the clinic\'s zone', () => {
    expect(slotMoment('2026-10-06', '09:30', 'Africa/Casablanca')).toBe('2026-10-06T09:30:00+01:00');
    expect(slotMoment('2026-03-01', '09:30', 'Africa/Casablanca')).toBe('2026-03-01T09:30:00+00:00');
    expect(slotMoment('2026-10-06', '09:30', null)).toBe('2026-10-06T09:30:00');
  });

  it('knows who is a minor on a given day', () => {
    const today = new Date('2026-10-06T12:00:00');
    expect(isMinor('2010-10-07', today)).toBe(true);
    expect(isMinor('2008-10-06', today)).toBe(false);
    expect(isMinor('2008-10-07', today)).toBe(true);
    expect(isMinor('', today)).toBe(false);
    expect(isMinor('not a date', today)).toBe(false);
  });

  it('builds the registration without blanks and drops a guardian for an adult', () => {
    const adult = registrationRequest({ ...BLANK_REGISTRATION, firstName: ' Sara ', lastName: 'Alami', dateOfBirth: '1990-05-01', guardianName: 'Someone', phone: ' ', consent: true }, 'fr', '');
    expect(adult).toMatchObject({ firstName: 'Sara', lastName: 'Alami', phone: undefined, guardianName: undefined, language: 'fr', consent: true, website: '' });
    const child = registrationRequest({ ...BLANK_REGISTRATION, firstName: 'Adam', lastName: 'Alami', dateOfBirth: new Date().getFullYear() - 8 + '-01-01', guardianName: 'Sara', guardianPhone: '0661', consent: true }, 'fr', '');
    expect(child.guardianName).toBe('Sara');
    expect(child.guardianPhone).toBe('0661');
  });

  it('uses the clinic\'s language only when the visitor has not chosen one', () => {
    const set = vi.fn();
    localStorage.removeItem('orthoflow_lang');
    useClinicLanguage({ setLanguage: set } as unknown as LanguageService, 'ar');
    expect(set).toHaveBeenCalledWith('ar');
    set.mockClear();
    localStorage.setItem('orthoflow_lang', 'en');
    useClinicLanguage({ setLanguage: set } as unknown as LanguageService, 'ar');
    expect(set).not.toHaveBeenCalled();
    useClinicLanguage({ setLanguage: set } as unknown as LanguageService, 'de');
    expect(set).not.toHaveBeenCalled();
    localStorage.removeItem('orthoflow_lang');
  });
});

describe('public pages', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  const setup = (component: unknown) => {
    TestBed.configureTestingModule({
      imports: [component as never, TranslateModule.forRoot()],
      providers: [
        { provide: IntakeApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'tok123' } } } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr', setLanguage: vi.fn() } },
      ],
    });
  };
  const mount = async <T>(type: new () => T) => {
    const fixture = TestBed.createComponent(type);
    document.body.appendChild(fixture.nativeElement);
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  };
  const type = (el: Element | null, value: string) => {
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    api = {};
  });

  describe('booking', () => {
    const info = {
      clinicName: 'Cabinet Atlas', phone: '0522000000', city: 'Casablanca', maxDaysAhead: 30, defaultLanguage: 'fr', timeZone: 'Africa/Casablanca',
      types: [{ id: 'ty1', nameFr: 'Contrôle', nameEn: 'Check-up', nameAr: 'فحص', color: '#2f8fa2', durationMinutes: 30 }],
      practitioners: [{ id: 'd1', name: 'Dr Tazi', color: '#1a9a5c' }],
    };

    beforeEach(() => {
      api['publicBookingInfo'] = vi.fn(async () => info);
      api['publicAvailability'] = vi.fn(async () => ({ '2026-10-07': ['09:00', '09:30'], '2026-10-08': ['14:00'] }));
      api['submitBooking'] = vi.fn(async () => ({ reference: 'RDV-4821' }));
    });

    const goToDetails = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
      buttonWith('Contrôle')!.click();
      await settleUi(fixture);
      buttonWith('PUB.BOOK.ANY_DOCTOR')!.click();
      await settleUi(fixture);
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '09:30')!.click();
      await settleUi(fixture);
    };
    const fillDetails = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
      type(document.querySelector('input[name=firstName]'), 'Nadia');
      type(document.querySelector('input[name=lastName]'), 'Zniber');
      type(document.querySelector('input[name=phone]'), '0655443322');
      (document.querySelector('input[name=consent]') as HTMLInputElement).click();
      await settleUi(fixture);
    };

    it('walks from the reason to a request, sending the time as a moment in the clinic\'s zone', async () => {
      setup(PublicBookingComponent);
      const fixture = await mount(PublicBookingComponent);
      await goToDetails(fixture);
      expect(api['publicAvailability']).toHaveBeenCalledWith('tok123', 'ty1', undefined, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 14);
      expect(document.body.textContent).toContain('09:30');
      await fillDetails(fixture);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);

      expect(api['submitBooking']).toHaveBeenCalledWith('tok123', expect.objectContaining({
        appointmentTypeId: 'ty1', practitionerId: undefined, startsAt: '2026-10-07T09:30:00+01:00', firstName: 'Nadia', lastName: 'Zniber', phone: '0655443322',
        consent: true, website: '', language: 'fr',
      }));
      expect(document.body.textContent).toContain('RDV-4821');
    });

    it('cannot be sent without consent', async () => {
      setup(PublicBookingComponent);
      const fixture = await mount(PublicBookingComponent);
      await goToDetails(fixture);
      type(document.querySelector('input[name=firstName]'), 'Nadia');
      type(document.querySelector('input[name=lastName]'), 'Zniber');
      type(document.querySelector('input[name=phone]'), '0655443322');
      await settleUi(fixture);
      expect((document.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('goes back to the free times when the slot was just taken', async () => {
      api['submitBooking'].mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
      setup(PublicBookingComponent);
      const fixture = await mount(PublicBookingComponent);
      await goToDetails(fixture);
      await fillDetails(fixture);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(document.querySelector('[role=alert]')!.textContent).toContain('PUB.BOOK.SLOT_TAKEN');
      expect(document.body.textContent).toContain('PUB.BOOK.STEP_TIME');
      expect(api['publicAvailability'].mock.calls.length).toBe(2);
    });

    it('says the link is not valid when the server does not know it', async () => {
      api['publicBookingInfo'].mockRejectedValue(new HttpErrorResponse({ status: 404 }));
      setup(PublicBookingComponent);
      await mount(PublicBookingComponent);
      expect(document.body.textContent).toContain('PUB.INVALID_TITLE');
    });

    it('offers a way to call when nothing is free', async () => {
      api['publicAvailability'].mockResolvedValue({});
      setup(PublicBookingComponent);
      const fixture = await mount(PublicBookingComponent);
      buttonWith('Contrôle')!.click();
      await settleUi(fixture);
      buttonWith('PUB.BOOK.ANY_DOCTOR')!.click();
      await settleUi(fixture);
      expect(document.body.textContent).toContain('PUB.BOOK.NO_SLOTS');
    });
  });

  describe('registration', () => {
    beforeEach(() => {
      api['publicRegistrationInfo'] = vi.fn(async () => ({ clinicName: 'Cabinet Atlas', phone: '0522000000', defaultLanguage: 'fr' }));
      api['submitRegistration'] = vi.fn(async () => ({ ok: true }));
    });

    it('asks for the guardian only when the date of birth makes the patient a minor', async () => {
      setup(PublicRegistrationComponent);
      const fixture = await mount(PublicRegistrationComponent);
      expect(document.querySelector('input[name=guardianName]')).toBeNull();
      type(document.querySelector('input[name=dob]'), `${new Date().getFullYear() - 6}-03-01`);
      await settleUi(fixture);
      expect(document.querySelector('input[name=guardianName]')).not.toBeNull();
    });

    it('needs the data consent, and sends the optional contact consents separately', async () => {
      setup(PublicRegistrationComponent);
      const fixture = await mount(PublicRegistrationComponent);
      type(document.querySelector('input[name=firstName]'), 'Sara');
      type(document.querySelector('input[name=lastName]'), 'Alami');
      await settleUi(fixture);
      const submit = document.querySelector('button[type=submit]') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      (document.querySelector('input[name=consent]') as HTMLInputElement).click();
      (document.querySelector('input[name=consentWhatsapp]') as HTMLInputElement).click();
      await settleUi(fixture);
      expect(submit.disabled).toBe(false);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['submitRegistration']).toHaveBeenCalledWith('tok123', expect.objectContaining({ firstName: 'Sara', consent: true, consentWhatsapp: true, consentEmail: false, website: '' }));
      expect(document.body.textContent).toContain('PUB.REG.DONE_TITLE');
    });

    it('explains a link that was already used', async () => {
      api['submitRegistration'].mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
      setup(PublicRegistrationComponent);
      const fixture = await mount(PublicRegistrationComponent);
      type(document.querySelector('input[name=firstName]'), 'Sara');
      type(document.querySelector('input[name=lastName]'), 'Alami');
      (document.querySelector('input[name=consent]') as HTMLInputElement).click();
      await settleUi(fixture);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(document.querySelector('[role=alert]')!.textContent).toContain('PUB.REG.ALREADY');
    });
  });

  describe('survey', () => {
    beforeEach(() => {
      api['publicSurveyInfo'] = vi.fn(async () => ({ clinicName: 'Cabinet Atlas', practitionerName: 'Dr Tazi' }));
      api['submitSurvey'] = vi.fn(async () => ({ ok: true }));
    });

    it('needs a rating before it can be sent', async () => {
      setup(PublicSurveyComponent);
      const fixture = await mount(PublicSurveyComponent);
      const submit = document.querySelector('button[type=submit]') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      (document.querySelectorAll('input[name=rating]')[3] as HTMLInputElement).click();
      await settleUi(fixture);
      expect(submit.disabled).toBe(false);
    });

    it('sends the rating, the comment and the call-back request', async () => {
      setup(PublicSurveyComponent);
      const fixture = await mount(PublicSurveyComponent);
      (document.querySelectorAll('input[name=rating]')[1] as HTMLInputElement).click();
      type(document.querySelector('textarea[name=comment]'), 'Attente trop longue');
      (document.querySelector('input[name=callMe]') as HTMLInputElement).click();
      await settleUi(fixture);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['submitSurvey']).toHaveBeenCalledWith('tok123', { rating: 2, comment: 'Attente trop longue', callMe: true, website: '' });
      expect(document.body.textContent).toContain('PUB.SURVEY.DONE_TITLE');
    });

    it('says so when the link was already used', async () => {
      api['publicSurveyInfo'].mockRejectedValue(new HttpErrorResponse({ status: 404 }));
      setup(PublicSurveyComponent);
      await mount(PublicSurveyComponent);
      expect(document.body.textContent).toContain('PUB.SURVEY.USED');
    });
  });
});
