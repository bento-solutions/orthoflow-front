import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaConfigService } from '../../core/services/agenda-config.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { BookingRequest, IntakeApi, PendingRegistration } from '../../core/services/intake-api.service';
import { LanguageService } from '../../core/services/language.service';
import { NavCounts } from '../../core/services/nav-counts.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { screenMocks } from '../../testing/screen-mocks';
import { PatientDirectoryApi } from '../patients/patient-directory-api.service';
import { BookingRequestsComponent, matchTerm, toLocalInput } from './booking-requests.component';
import { RegistrationsComponent } from './registrations.component';
import { SurveysComponent, shares, stars } from './surveys.component';

const request = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  id: 'r1', appointmentTypeId: 'ty', typeName: 'Contrôle', practitionerId: '' as never, practitionerName: '', startsAt: '2026-10-07T07:00:00Z', durationMinutes: 20,
  firstName: 'Nadia', lastName: 'Zniber', phone: '0655443322', email: '', dateOfBirth: '' as never, note: 'Attache décollée', language: 'fr', status: 'PENDING',
  patientId: '' as never, appointmentId: '' as never, declineReason: '', createdAt: '2026-10-06T10:00:00Z', slotStillFree: true, ...over,
});

describe('intake helpers', () => {
  it('writes a moment for the datetime-local input on the viewer\'s own clock', () => {
    const local = new Date(2026, 9, 7, 9, 5);
    expect(toLocalInput(local.toISOString())).toBe('2026-10-07T09:05');
    expect(toLocalInput('')).toBe('');
    expect(toLocalInput('garbage')).toBe('');
  });

  it('searches the register by phone and surname, skipping what is too short to mean anything', () => {
    expect(matchTerm({ phone: '0655443322', lastName: 'Zniber' })).toEqual(['0655443322', 'Zniber']);
    expect(matchTerm({ phone: '', lastName: 'Al' })).toEqual([]);
  });

  it('draws a rating out of five, clamped', () => {
    expect(stars(4)).toBe('★★★★☆');
    expect(stars(4.6)).toBe('★★★★★');
    expect(stars(9)).toBe('★★★★★');
    expect(stars(null)).toBe('☆☆☆☆☆');
  });

  it('turns the spread of ratings into shares of the whole', () => {
    expect(shares([0, 0, 1, 1, 2])).toEqual([0, 0, 25, 25, 50]);
    expect(shares([0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('intake screens', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;
  let refreshIntake: ReturnType<typeof vi.fn>;

  const setup = (component: unknown, extra: unknown[] = []) => {
    mocks = screenMocks();
    refreshIntake = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [component as never, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: IntakeApi, useValue: api },
        { provide: NavCounts, useValue: { refreshIntake } },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
        { provide: AgendaConfigService, useValue: { chairs: signal([{ id: 'c1', name: 'Fauteuil 1' }]) } },
        ...extra as never[],
        ...mocks.providers,
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
  // A zoneless fixture is "stable" while promises are still chaining; a macrotask turn lets them finish.
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmAnswer = true;
    api = {};
  });

  describe('booking requests', () => {
    let directory: { list: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      api['bookingRequests'] = vi.fn(async () => [request(), request({ id: 'r2', firstName: 'Omar', slotStillFree: false })]);
      api['confirmBooking'] = vi.fn(async () => ({}));
      api['declineBooking'] = vi.fn(async () => undefined);
      directory = { list: vi.fn(async () => ({ content: [{ id: 'p9', firstName: 'Nadia', lastName: 'Zniber', patientCode: 'P-0009', phone: '0655443322' }] })) };
      setup(BookingRequestsComponent, [{ provide: PatientDirectoryApi, useValue: directory }]);
    });

    it('asks for pending requests first and warns about one whose time was taken', async () => {
      await mount(BookingRequestsComponent);
      expect(api['bookingRequests']).toHaveBeenCalledWith('PENDING');
      expect(document.body.textContent).toContain('INT.BOOK.SLOT_TAKEN');
    });

    it('offers existing patients that might be this one, and defaults to creating a new patient', async () => {
      const fixture = await mount(BookingRequestsComponent);
      buttonWith('INT.BOOK.CONFIRM')!.click();
      await settleUi(fixture);
      expect(directory.list).toHaveBeenCalledWith({ search: '0655443322', size: 5 });
      expect(document.querySelector('[role=dialog]')!.textContent).toContain('P-0009');
      expect((document.querySelectorAll('input[name=who]')[0] as HTMLInputElement).checked).toBe(true);
    });

    it('confirms into a chosen patient, at the time shown, then refreshes the counters', async () => {
      const fixture = await mount(BookingRequestsComponent);
      buttonWith('INT.BOOK.CONFIRM')!.click();
      await settleUi(fixture);
      (document.querySelectorAll('input[name=who]')[1] as HTMLInputElement).click();
      await settleUi(fixture);
      (document.querySelector('#confirm-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['confirmBooking']).toHaveBeenCalledWith('r1', expect.objectContaining({ patientId: 'p9', startsAt: '2026-10-07T07:00:00.000Z', ignoreBlocks: false }));
      expect(refreshIntake).toHaveBeenCalled();
      expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
    });

    it('declines with the reason typed', async () => {
      const fixture = await mount(BookingRequestsComponent);
      buttonWith('INT.BOOK.DECLINE')!.click();
      await settleUi(fixture);
      const box = document.querySelector('textarea[name=reason]') as HTMLTextAreaElement;
      box.value = 'Cabinet fermé ce jour';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await settleUi(fixture);
      (document.querySelector('#decline-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['declineBooking']).toHaveBeenCalledWith('r1', 'Cabinet fermé ce jour');
    });

    it('reports a refused confirmation and keeps the dialog open', async () => {
      api['confirmBooking'].mockRejectedValueOnce(new Error('conflict'));
      const fixture = await mount(BookingRequestsComponent);
      buttonWith('INT.BOOK.CONFIRM')!.click();
      await settleUi(fixture);
      (document.querySelector('#confirm-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(mocks.errors).toHaveLength(1);
      expect(document.querySelector('[role=dialog]')).not.toBeNull();
    });
  });

  describe('registrations', () => {
    const pending = (over: Partial<PendingRegistration> = {}): PendingRegistration => ({
      id: 'g1', firstName: 'Sarah', lastName: 'Benziane', gender: 'F', dateOfBirth: '1990-04-01', phone: '0662987654', email: '', address: '', cin: '', guardianName: '', guardianPhone: '',
      insuranceProvider: 'CNSS', insuranceNumber: '', occupation: '', language: 'ar', createdAt: '2026-10-06T10:00:00Z', invitedPatientId: '' as never, status: 'PENDING',
      possibleDuplicates: [{ id: 'p2', patientCode: 'P-2', fullName: 'Sara Benziane', dateOfBirth: '1990-04-01', phone: '0662987654', cin: '', reason: 'PHONE' }], ...over,
    });

    beforeEach(() => {
      api['pendingRegistrations'] = vi.fn(async () => [pending()]);
      api['approveRegistration'] = vi.fn(async () => ({}));
      api['rejectRegistration'] = vi.fn(async () => undefined);
      setup(RegistrationsComponent);
    });

    it('lists only the answered fields and the records it might duplicate', async () => {
      await mount(RegistrationsComponent);
      const text = document.body.textContent!;
      expect(text).toContain('CNSS');
      expect(text).toContain('Sara Benziane');
      expect(text).toContain('PAT.DUP.REASONS.PHONE');
      expect(text).not.toContain('PUB.REG.CIN');
    });

    it('creates a new patient, or merges into the one that already exists', async () => {
      const fixture = await mount(RegistrationsComponent);
      buttonWith('INT.REG.APPROVE_NEW')!.click();
      await settleUi(fixture);
      expect(api['approveRegistration']).toHaveBeenLastCalledWith('g1', undefined);
      buttonWith('INT.REG.MERGE_INTO')!.click();
      await settleUi(fixture);
      expect(api['approveRegistration']).toHaveBeenLastCalledWith('g1', 'p2');
      expect(refreshIntake).toHaveBeenCalled();
    });

    it('rejects only after confirmation', async () => {
      confirmAnswer = false;
      const fixture = await mount(RegistrationsComponent);
      buttonWith('INT.REG.REJECT')!.click();
      await settleUi(fixture);
      expect(api['rejectRegistration']).not.toHaveBeenCalled();
      confirmAnswer = true;
      buttonWith('INT.REG.REJECT')!.click();
      await settleUi(fixture);
      expect(api['rejectRegistration']).toHaveBeenCalledWith('g1');
    });
  });

  describe('surveys', () => {
    const report = {
      summary: { responses: 4, average: 3.5, distribution: [0, 1, 1, 1, 1], callBacksPending: 1 },
      rows: [
        { id: 's1', appointmentId: 'a1', patientId: 'p1', patientName: 'Sara Alami', practitionerName: 'Dr Tazi', rating: 2, comment: 'Attente trop longue', callMe: true, submittedAt: '2026-10-05T10:00:00Z', handledAt: '' },
        { id: 's2', appointmentId: 'a2', patientId: 'p2', patientName: 'Karim Alaoui', practitionerName: 'Dr Tazi', rating: 5, comment: '', callMe: false, submittedAt: '2026-10-04T10:00:00Z', handledAt: '' },
      ],
    };

    beforeEach(() => {
      api['surveys'] = vi.fn(async () => report);
      api['surveyHandled'] = vi.fn(async () => undefined);
      setup(SurveysComponent);
    });

    it('shows the average, the spread and each answer', async () => {
      await mount(SurveysComponent);
      const text = document.body.textContent!;
      expect(text).toContain('Attente trop longue');
      expect(text).toContain('SURV.CALL_ME');
      expect(document.querySelectorAll('section ul li').length).toBe(5);
    });

    it('offers "handled" only on a call-back request that is still open', async () => {
      const fixture = await mount(SurveysComponent);
      const handled = [...document.querySelectorAll('button')].filter(b => b.textContent?.includes('COM.INBOX.MARK_HANDLED'));
      expect(handled).toHaveLength(1);
      handled[0].click();
      await settleUi(fixture);
      expect(api['surveyHandled']).toHaveBeenCalledWith('s1');
    });

    it('asks only for the answers at or under the chosen rating', async () => {
      const fixture = await mount(SurveysComponent);
      const select = document.querySelector('select') as HTMLSelectElement;
      select.value = '2: 2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await settleUi(fixture);
      expect(api['surveys']).toHaveBeenLastCalledWith(expect.objectContaining({ maxRating: 2 }));
    });
  });
});
