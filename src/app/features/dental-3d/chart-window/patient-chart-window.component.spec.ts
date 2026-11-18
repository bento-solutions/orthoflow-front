import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DentalChartState, ToothState } from '../../../core/models/patient.model';
import { ToothFinding } from '../../../core/models/clinical-record.model';
import { PatientTreatment } from '../../../core/models/patient-treatment.model';
import { PatientService } from '../../../core/services/patient.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { PatientTreatmentService } from '../../../core/services/patient-treatment.service';
import { StockService } from '../../../core/services/stock.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { Dental3dViewService } from '../../../core/services/dental-3d-view.service';
import { ChartSyncService } from '../../../core/services/chart-sync.service';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PatientChartWindowComponent, ageOn } from './patient-chart-window.component';

const finding = (fdi: string, findingCode: string, kind: ToothFinding['kind'], extra: Partial<ToothFinding> = {}): ToothFinding =>
  ({ id: `${fdi}-${findingCode}`, fdi, findingCode, kind, status: 'ACTIVE', ...extra }) as ToothFinding;

const ADULT = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];

describe('ageOn', () => {
  it('counts the birthday only once it has come', () => {
    expect(ageOn('1994-11-20', new Date('2026-11-17'))).toBe(31);
    expect(ageOn('1994-11-17', new Date('2026-11-17'))).toBe(32);
    expect(ageOn(null)).toBeNull();
    expect(ageOn('not a date')).toBeNull();
  });
});

describe('PatientChartWindowComponent', () => {
  let fixture: ComponentFixture<PatientChartWindowComponent>;
  let window_: PatientChartWindowComponent;
  let navigate: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let force: ReturnType<typeof vi.fn>;

  const teeth: Record<string, ToothState> = Object.fromEntries(ADULT.map((fdi) => [fdi, { id: fdi, status: 'present' } as ToothState]));
  teeth['18'] = { id: '18', status: 'extracted' };
  teeth['48'] = { id: '48', status: 'extracted' };
  const chart: DentalChartState = { patientId: 'p1', chartType: 'adult', lastUpdated: '2026-11-15T10:00:00Z', teeth };

  const findings = [
    finding('46', 'cracked_tooth', 'CONDITION', { severity: 'MODERATE' }),
    finding('46', 'crown_required', 'TREATMENT_REQUIRED'),
    finding('16', 'deep_caries', 'CONDITION', { surface: 'occlusal', severity: 'SEVERE' }),
    finding('16', 'root_canal_required', 'TREATMENT_REQUIRED'),
    finding('36', 'existing_crown', 'EXISTING'),
    finding('24', 'filling_required', 'TREATMENT_REQUIRED', { status: 'RESOLVED' }),
  ];
  const treatments = [
    { id: 't1', status: 'COMPLETED', progress: 100, teeth: '31,41', treatment: { name: 'Scaling' } },
    { id: 't2', status: 'PLANNED', progress: 0, teeth: '16, 26', treatment: { name: 'Molar band fitting' } },
    { id: 't3', status: 'ACTIVE', progress: 60, teeth: '13,12,11,21,22,23', treatment: { name: 'Ceramic brackets' } },
    { id: 't4', status: 'CANCELLED', progress: 0, teeth: '38', treatment: { name: 'Extraction' } },
  ] as PatientTreatment[];

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => Array.from(el().querySelectorAll(selector)).map((n) => n.textContent?.replace(/\s+/g, ' ').trim());

  beforeEach(async () => {
    navigate = vi.fn(async () => true);
    create = vi.fn(() => of({}));
    force = vi.fn();
    TestBed.configureTestingModule({
      imports: [PatientChartWindowComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'p1' })) } },
        { provide: Router, useValue: { navigate } },
        { provide: PatientService, useValue: { setCurrentPatient: () => of({ id: 'p1', firstName: 'Salma', lastName: 'Bennani', dateOfBirth: '1994-05-02', gender: 'FEMALE', cin: 'BK123456' }) } },
        { provide: DentalChartService, useValue: { currentChart: signal(chart), loadChart: vi.fn(), reloadChart: vi.fn() } },
        { provide: ClinicalRecordService, useValue: { findings: () => findings, refresh: vi.fn(), loadPeriodontal: vi.fn(), loadCatalogOnce: vi.fn() } },
        { provide: PatientTreatmentService, useValue: { getPatientTreatments: () => of(treatments), createPatientTreatment: create } },
        { provide: StockService, useValue: { getTreatments: () => of([{ id: 'cat-1', name: 'Root canal', consumables: [{ stockItem: { id: 'file-25' }, quantityUsed: 2 }, { stockItem: null, quantityUsed: 1 }] }]) } },
        { provide: ThemeService, useValue: { force } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: Dental3dViewService, useValue: { reset: vi.fn() } },
        { provide: ChartSyncService, useValue: { changes: () => NEVER } },
      ],
    });
    // The 3D chart and the X-ray pane are tested on their own; here they are only placeholders.
    TestBed.overrideComponent(PatientChartWindowComponent, {
      set: { imports: [DatePipe, FormsModule, TranslateModule, ModalComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    fixture = TestBed.createComponent(PatientChartWindowComponent);
    window_ = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('is dark whatever the person chose, and gives their theme back when it goes', () => {
    expect(force).toHaveBeenCalledWith('dark');
    fixture.destroy();
    expect(force).toHaveBeenLastCalledWith(null);
  });

  it('names the patient and says a treatment is under way', () => {
    expect(el().querySelector('h1')?.textContent).toContain('Salma Bennani');
    expect(el().querySelector('.cw-avatar')?.textContent?.trim()).toBe('SB');
    expect(el().querySelector('.cw-pill')).not.toBeNull();
  });

  it('counts the teeth in each state, and lists them', () => {
    const tiles = Object.fromEntries(window_.tiles().map((t) => [t.kind, t.teeth]));
    expect(tiles).toEqual({ condition: ['16', '46'], planned: ['16', '46'], existing: ['36'], absent: ['18', '48'] });
    expect(text('.cw-tile-count')).toEqual(['2', '2', '1', '2']);
  });

  it('lists the work to be done in chart order, each with what calls for it, and not what is resolved', () => {
    expect(window_.toDo().map((t) => t.fdi)).toEqual(['16', '46']);
    expect(window_.toDo()[0].why).toContain('PATIENTS.DOSSIER.UI.SEVERE'.toLowerCase());
    expect(el().querySelectorAll('.cw-row').length).toBe(2);
  });

  it('puts the treatments under way first and leaves out the cancelled ones', () => {
    expect(window_.plan().map((t) => t.id)).toEqual(['t3', 't2', 't1']);
  });

  it('picks the tooth a row is about', () => {
    el().querySelectorAll<HTMLButtonElement>('.cw-row')[1].click();
    fixture.detectChanges();
    expect(window_.selected()).toBe('46');
    expect(el().querySelectorAll('.cw-row')[1].classList).toContain('on');
  });

  it('lets go of the tooth on Escape first, then goes back to the patient file', () => {
    window_.selected.set('16');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(window_.selected()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(navigate).toHaveBeenCalledWith(['/patients', 'p1']);
  });

  it('assigns a treatment to the tooth with the materials the catalogue lists for it', () => {
    window_.openAssign('16');
    window_.assignTreatmentId = 'cat-1';
    window_.saveAssign();
    expect(create).toHaveBeenCalledWith('p1', expect.objectContaining({
      treatmentId: 'cat-1', teeth: '16', status: 'PLANNED', progress: 0,
      consumables: [{ stockItemId: 'file-25', quantityUsed: 2 }],
    }));
    expect(window_.assignOpen()).toBe(false);
  });
});
