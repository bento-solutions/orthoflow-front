import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { Patient } from '../../../core/models/patient.model';
import { ClinicalRecordService, MedicalAlert } from '../../../core/services/clinical-record.service';
import { IntakeApi } from '../../../core/services/intake-api.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { expectNoA11yViolations } from '../../../testing/axe';
import { screenMocks } from '../../../testing/screen-mocks';
import { PatientBannerComponent } from './patient-banner.component';

const alerts: MedicalAlert[] = [
  { id: 'a', kind: 'ALLERGY', label: 'Pénicilline', detail: null, tone: 'critical', severity: 'SEVERE' },
  { id: 'c', kind: 'CONDITION', label: 'Diabète type 2', detail: null, tone: 'attention', severity: null },
  { id: 'm', kind: 'MEDICATION', label: 'Aspirine', detail: null, tone: 'attention', severity: null },
];

describe('PatientBannerComponent', () => {
  let state: ReturnType<typeof signal<'alerts' | 'none' | 'not-asked' | 'loading'>>;

  const mount = async (compact = false, can: true | string[] = true) => {
    const mocks = screenMocks({ can: can as never });
    TestBed.configureTestingModule({
      imports: [PatientBannerComponent],
      providers: [
        provideTranslateService(), provideRouter([]), ...mocks.providers,
        { provide: ClinicalRecordService, useValue: { medicalAlerts: signal(alerts), alertsState: state } },
        { provide: VoiceSessionService, useValue: { isActive: signal(false), reviewing: signal(false), busy: signal(false) } },
        { provide: ConsultationService, useValue: { isOpen: signal(false), intro: signal(false), available: signal(true), introHidden: signal(false), setIntroHidden: vi.fn() } },
        { provide: IntakeApi, useValue: { inviteToRegister: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(PatientBannerComponent);
    fixture.componentRef.setInput('patient', { id: 'p1', firstName: 'Houssam', lastName: 'Chakir', dateOfBirth: '1980-05-02', status: 'ACTIVE' } as Patient);
    fixture.componentRef.setInput('state', { key: 'PATIENTS.DOSSIER.STATE.IN_TREATMENT', pill: 'pill-active' });
    fixture.componentRef.setInput('compact', compact);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    state = signal<'alerts' | 'none' | 'not-asked' | 'loading'>('alerts');
  });

  it('shows the three medical alerts beside the name, allergy in red', async () => {
    const fixture = await mount();
    const chips = [...fixture.nativeElement.querySelectorAll('.chip')] as HTMLElement[];
    expect(chips.map(c => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['ALERTS.ALLERGY Pénicilline', 'Diabète type 2', 'Aspirine']);
    expect(chips[0].classList).toContain('critical');
  });

  it('still shows the alerts in its compact, scrolled form', async () => {
    const fixture = await mount(true);
    expect(fixture.nativeElement.textContent).toContain('Pénicilline');
    expect(fixture.nativeElement.querySelector('.pb-more')).toBeNull();
  });

  it('says when nobody has asked yet, instead of showing nothing', async () => {
    state.set('not-asked');
    const fixture = await mount();
    expect(fixture.nativeElement.textContent).toContain('ALERTS.NOT_ASKED');
  });

  it('keeps Archive last in the More menu, apart from the daily actions', async () => {
    const fixture = await mount();
    (fixture.nativeElement.querySelector('.pb-more [aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = [...fixture.nativeElement.querySelectorAll('.pb-menu [role="menuitem"]')] as HTMLElement[];
    expect(items.at(-1)?.textContent).toContain('PATIENTS.DOSSIER.UI.ARCHIVE');
    expect(items.at(-1)?.classList).toContain('pb-danger');
  });

  it('hides Book appointment and Archive from someone who may not do them', async () => {
    const fixture = await mount(false, ['PATIENT_READ']);
    expect(fixture.nativeElement.textContent).not.toContain('PATIENTS.DOSSIER.BOOK');
    (fixture.nativeElement.querySelector('.pb-more [aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('PATIENTS.DOSSIER.UI.ARCHIVE');
  });

  it('has no accessibility violations', async () => {
    const fixture = await mount();
    await expectNoA11yViolations(fixture.nativeElement);
  });
});
