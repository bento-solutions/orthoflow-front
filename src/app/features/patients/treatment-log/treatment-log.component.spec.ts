import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TreatmentPassport } from '../../../core/api/contract';
import { LanguageService } from '../../../core/services/language.service';
import { TreatmentPassportService } from '../../../core/services/treatment-passport.service';
import { expectNoA11yViolations } from '../../../testing/axe';
import { screenMocks } from '../../../testing/screen-mocks';
import { TreatmentLogComponent } from './treatment-log.component';

const passport: TreatmentPassport = {
  format: 'orthoflow.treatment-passport', version: 1, issuedAt: '2026-10-10T10:00:00Z',
  clinic: { name: 'Cabinet Atlas' }, patient: { firstName: 'Sara', lastName: 'Benziane', dateOfBirth: '1990-05-12', sex: 'F' },
  allergies: [{ substance: 'Penicillin', reaction: 'Rash' }],
  medicalHistory: [{ category: 'CONDITION', label: 'Diabetes type 2' }],
  teeth: [],
  planned: [{ type: 'FINDING', teeth: ['36'], code: 'filling_required', surfaces: ['mesial', 'occlusal', 'distal', 'buccal'], outcome: 'REQUIRED' }],
  log: [
    { date: '2024-09-12', type: 'FINDING', teeth: ['26'], code: 'existing_crown', surfaces: [], origin: 'EXTERNAL', provider: 'Dr Alaoui', outcome: 'IN_PLACE' },
    { date: '2019-04-02', type: 'FINDING', teeth: ['16'], code: 'existing_amalgam', surfaces: ['occlusal'], origin: 'EXTERNAL', provider: 'Dr Benani', outcome: 'IN_PLACE' },
    { type: 'TREATMENT', teeth: ['37'], name: 'Scaling', actCode: 'D 20', surfaces: [], origin: 'THIS_CLINIC', outcome: 'COMPLETED' },
  ],
  gums: [{ region: 'LOWER_LEFT', condition: 'PERIODONTITIS', stage: 2 }],
};

describe('TreatmentLogComponent', () => {
  let service: {
    passport: ReturnType<typeof signal<TreatmentPassport | null>>; loading: ReturnType<typeof signal<boolean>>; failed: ReturnType<typeof signal<boolean>>;
    load: ReturnType<typeof vi.fn>; downloadPdf: ReturnType<typeof vi.fn>; downloadJson: ReturnType<typeof vi.fn>;
  };
  let mocks: ReturnType<typeof screenMocks>;
  let appLang: ReturnType<typeof signal<string>>;

  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
  };
  const mount = async () => {
    mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [TreatmentLogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: TreatmentPassportService, useValue: service },
        { provide: LanguageService, useValue: { currentLang: appLang } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(TreatmentLogComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    document.body.appendChild(fixture.nativeElement);
    await flush(fixture);
    return fixture;
  };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement;
  const consent = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    const box = document.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.click();
    await flush(fixture);
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    appLang = signal('fr');
    service = {
      passport: signal<TreatmentPassport | null>(passport), loading: signal(false), failed: signal(false),
      load: vi.fn(), downloadPdf: vi.fn(async () => undefined), downloadJson: vi.fn(async () => undefined),
    };
  });

  it('loads the passport of the patient', async () => {
    await mount();
    expect(service.load).toHaveBeenCalledWith('p1');
  });

  it('shows the work done newest first, attributing what was done elsewhere', async () => {
    await mount();

    const entries = [...document.querySelectorAll('.timeline')[0].querySelectorAll('.entry')].map(e => e.textContent!.replace(/\s+/g, ' '));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toContain('Existing crown');
    expect(entries[0]).toContain('Dr Alaoui');
    expect(entries[1]).toContain('Existing amalgam');
    expect(entries[1]).toContain('O');
    expect(entries[1]).toContain('Dr Benani');
    expect(entries[2]).toContain('Scaling');
    expect(entries[2]).toContain('TOOTH_DETAIL.DATE_UNKNOWN');
  });

  it('shows the allergies first, what is still owed and the gums', async () => {
    await mount();

    expect(document.querySelector('.chip.alert')!.textContent).toContain('Penicillin');
    expect(document.querySelectorAll('.timeline')[1].textContent).toContain('MODB');
    expect(document.body.textContent).toContain('GUMS.REGION.LOWER_LEFT');
  });

  it('will not hand anything over until the patient has asked for it', async () => {
    const fixture = await mount();

    expect(button('TREATMENT_LOG.PDF').disabled).toBe(true);
    expect(button('TREATMENT_LOG.JSON').disabled).toBe(true);

    await consent(fixture);
    expect(button('TREATMENT_LOG.PDF').disabled).toBe(false);
  });

  it('prints in the application’s language unless another is chosen for the next practitioner', async () => {
    const fixture = await mount();
    await consent(fixture);

    button('TREATMENT_LOG.PDF').click();
    await flush(fixture);
    expect(service.downloadPdf).toHaveBeenCalledWith('p1', 'fr');

    const select = document.querySelector('select') as HTMLSelectElement;
    select.value = 'ar';
    select.dispatchEvent(new Event('change'));
    await flush(fixture);
    button('TREATMENT_LOG.PDF').click();
    await flush(fixture);
    expect(service.downloadPdf).toHaveBeenLastCalledWith('p1', 'ar');
  });

  it('hands over the data file too', async () => {
    const fixture = await mount();
    await consent(fixture);

    button('TREATMENT_LOG.JSON').click();
    await flush(fixture);

    expect(service.downloadJson).toHaveBeenCalledWith('p1');
  });

  it('tells the doctor when a copy could not be made', async () => {
    service.downloadPdf.mockRejectedValue(new Error('server down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await mount();
    await consent(fixture);

    button('TREATMENT_LOG.PDF').click();
    await flush(fixture);

    expect(mocks.toasts.map(t => t.kind)).toEqual(['error']);
    expect(button('TREATMENT_LOG.PDF').disabled).toBe(false);
  });

  it('says so when the log could not be loaded', async () => {
    service.passport.set(null);
    service.failed.set(true);
    await mount();
    expect(document.querySelector('[role=alert]')!.textContent).toContain('TREATMENT_LOG.LOAD_FAILED');
  });

  it('has no accessibility violations', async () => {
    await mount();
    await expectNoA11yViolations(document.body);
  });
});
