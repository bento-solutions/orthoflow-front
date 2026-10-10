import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { InsuranceForm, InsuranceFormsApi } from '../../../core/services/insurance-forms-api.service';
import { PrescriptionsApi } from '../../../core/services/prescriptions-api.service';
import { StockService } from '../../../core/services/stock.service';
import { screenMocks } from '../../../testing/screen-mocks';
import { PatientDocumentsComponent, actLines } from './patient-documents.component';

const form = (over: Partial<InsuranceForm> = {}): InsuranceForm => ({
  id: 'f1', number: 'FSA-2026-00001', patientId: 'p1', patientName: 'Yasmine Bennani', insurerId: 'i1', insurerName: 'CNOPS',
  formCode: 'cnops-dentaire', formName: 'CNOPS — Feuille de soins dentaires', official: true, singleUse: false, purpose: 'EXECUTION',
  source: 'CONSULTATION', consultationId: 'c1', careDate: '2026-10-09', total: 250, status: 'TO_PRINT', taskId: 't1',
  lines: [{ date: '2026-10-09', teeth: '', code: 'C', label: 'Consultation', cotation: 'C 1', amount: 250 }],
  printedAt: '', handedOverAt: '', createdAt: '2026-10-09T10:00:00Z', notes: '', missing: [], ...over,
}) as InsuranceForm;

describe('act lines of a hand-made form', () => {
  it('keeps the acts that name something, trimmed, and leaves the empty ones out', () => {
    expect(actLines([
      { treatmentId: 'T1', code: '', label: '', teeth: ' 11 21 ', amount: 3000 },
      { treatmentId: '', code: '', label: '  ', teeth: '', amount: null },
      { treatmentId: '', code: 'C', label: 'Consultation', teeth: '', amount: null },
    ])).toEqual([
      { treatmentId: 'T1', code: undefined, label: undefined, teeth: '11 21', amount: 3000 },
      { treatmentId: undefined, code: 'C', label: 'Consultation', teeth: undefined, amount: undefined },
    ]);
  });
});

describe('PatientDocumentsComponent', () => {
  let forms: Record<string, ReturnType<typeof vi.fn>>;
  let rx: Record<string, ReturnType<typeof vi.fn>>;

  const mount = async (can: Parameters<typeof screenMocks>[0] = {}) => {
    const mocks = screenMocks(can);
    TestBed.configureTestingModule({
      imports: [PatientDocumentsComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: InsuranceFormsApi, useValue: forms },
        { provide: PrescriptionsApi, useValue: rx },
        { provide: StockService, useValue: { getTreatments: () => of([]) } },
        { provide: ConfirmDialogService, useValue: { confirm: async () => true } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(PatientDocumentsComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    // The lists load in an effect; let those promises land before looking.
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();
    }
    return fixture;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    forms = {
      preview: vi.fn(async () => ({ insurerId: 'i1', insurerName: 'CNOPS', formCode: 'cnops-dentaire', formName: 'CNOPS — Feuille de soins dentaires',
        official: true, singleUse: false, missing: ['INSURANCE_NUMBER', 'PRACTITIONER_INPE'] })),
      list: vi.fn(async () => [form()]),
      open: vi.fn(async () => undefined),
      action: vi.fn(async () => form({ status: 'HANDED_OVER' })),
      send: vi.fn(async () => form()),
    };
    rx = { list: vi.fn(async () => []), templates: vi.fn(async () => []), library: vi.fn(async () => []) };
  });

  it('shows the front desk the forms and what the record lacks, without the prescriptions', async () => {
    await mount({ can: ['BILLING_READ', 'BILLING_WRITE'] });
    const text = document.body.textContent!;
    expect(text).toContain('FSA-2026-00001');
    expect(text).toContain('INSURANCE.MISSING.INSURANCE_NUMBER');
    expect(text).toContain('INSURANCE.MISSING.PRACTITIONER_INPE');
    expect(text).not.toContain('RX.TITLE');
    expect(rx['list']).not.toHaveBeenCalled();
  });

  it('opens the filled form and its overlay for a numbered paper form', async () => {
    const fixture = await mount();
    const buttons = [...document.querySelectorAll('button')];
    buttons.find(b => b.textContent?.includes('INSURANCE.OPEN'))!.click();
    buttons.find(b => b.textContent?.includes('INSURANCE.OVERLAY'))!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(forms['open']).toHaveBeenCalledWith('f1', false);
    expect(forms['open']).toHaveBeenCalledWith('f1', true);
  });

  it('marks a form handed over', async () => {
    const fixture = await mount();
    [...document.querySelectorAll('button')].find(b => b.textContent?.includes('INSURANCE.MARK_HANDED'))!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(forms['action']).toHaveBeenCalledWith('f1', 'handed-over');
    expect(document.body.textContent).toContain('INSURANCE.STATUS.HANDED_OVER');
  });

  it('shows the clinical team the prescriptions too', async () => {
    rx['list'] = vi.fn(async () => [{ id: 'rx1', number: 'ORD-2026-00001', issuedAt: '2026-10-09T10:00:00Z', status: 'ISSUED',
      lines: [{ drug: 'ELUDRIL' }], warnings: [], practitionerName: 'Dr Amrani' }]);
    await mount({ can: ['CLINICAL_READ', 'CLINICAL_WRITE'] });
    const text = document.body.textContent!;
    expect(text).toContain('ORD-2026-00001');
    expect(text).toContain('ELUDRIL');
    expect(text).not.toContain('INSURANCE.TITLE');
  });
});
