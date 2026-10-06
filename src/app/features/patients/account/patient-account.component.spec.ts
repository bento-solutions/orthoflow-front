import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screenMocks } from '../../../testing/screen-mocks';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { Account, FinanceApi, PaymentPlan } from '../../../core/services/finance-api.service';
import { LanguageService } from '../../../core/services/language.service';
import { PracticeProfileService } from '../../../core/services/practice-profile.service';
import { PatientAccountComponent } from './patient-account.component';

const account = (over: Partial<Account> = {}): Account => ({
  patientId: 'p1',
  invoices: [
    { id: 'i1', invoiceNumber: 'FA-1', issueDate: '2026-01-10', status: 'SENT', total: 1000, paid: 0, balance: 1000 },
    { id: 'i2', invoiceNumber: 'FA-2', issueDate: '2026-02-10', status: 'PAID', total: 500, paid: 500, balance: 0 },
  ],
  receipts: [
    { id: 'r1', patientId: 'p1', amount: 500, allocated: 500, unallocated: 0, method: 'CASH', receiptDate: '2026-02-11', practitionerId: '', reference: 'REC-1', notes: '', voided: false, voidedAt: '', voidReason: '', chequeId: '', allocations: [{ paymentId: 'x', invoiceId: 'i2', invoiceNumber: 'FA-2', amount: 500, date: '2026-02-11' }], createdAt: '2026-02-11T10:00:00Z' },
  ],
  totalInvoiced: 1500, totalPaid: 500, balanceDue: 1000, creditAvailable: 0, net: 1000, ...over,
});

describe('PatientAccountComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;

  const mount = async (can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks(can);
    TestBed.configureTestingModule({
      imports: [PatientAccountComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: FinanceApi, useValue: api },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(PatientAccountComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    confirmAnswer = true;
    api = {
      account: vi.fn(async () => account()),
      patientPlans: vi.fn(async () => [] as PaymentPlan[]),
      recordReceipt: vi.fn(async () => ({})),
      voidReceipt: vi.fn(async () => ({})),
      applyCredit: vi.fn(async () => ({})),
      createPlan: vi.fn(async () => ({})),
      cancelPlan: vi.fn(async () => ({})),
      payInstalment: vi.fn(async () => ({})),
    };
  });

  it('shows what is owed and how each payment was spread', async () => {
    const fixture = await mount();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('FA-1');
    expect(text).toContain('FA-2 : ');
    expect(api.account).toHaveBeenCalledWith('p1');
  });

  it('takes a payment spread over the oldest invoices by default', async () => {
    const fixture = await mount();
    button('ACC.RECORD')!.click();
    await settleUi(fixture);
    type(document.querySelector('input[name=amount]') as HTMLInputElement, '400');
    await settleUi(fixture);
    (document.querySelector('#receipt-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);

    expect(api.recordReceipt).toHaveBeenCalledTimes(1);
    const [patientId, body] = api.recordReceipt.mock.calls[0];
    expect(patientId).toBe('p1');
    expect(body).toMatchObject({ amount: 400, method: 'CASH', autoAllocate: true, allocations: [] });
    expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
    // the account was read again after the payment
    expect(api.account).toHaveBeenCalledTimes(2);
  });

  it('starts a payment from an invoice row for that invoice\'s balance, applied to that invoice only', async () => {
    const fixture = await mount();
    const rowPay = [...document.querySelectorAll('tbody button')].find(b => b.getAttribute('aria-label')?.includes('ACC.PAY_INVOICE')) as HTMLButtonElement;
    rowPay.click();
    await settleUi(fixture);
    expect((document.querySelector('input[name=amount]') as HTMLInputElement).value).toBe('1000');

    (document.querySelector('#receipt-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(api.recordReceipt.mock.calls[0][1]).toMatchObject({
      amount: 1000, autoAllocate: false, allocations: [{ invoiceId: 'i1', amount: 1000 }],
    });
  });

  it('refuses to submit a payment that assigns more than was received', async () => {
    const fixture = await mount();
    const rowPay = [...document.querySelectorAll('tbody button')].find(b => b.getAttribute('aria-label')?.includes('ACC.PAY_INVOICE')) as HTMLButtonElement;
    rowPay.click();
    await settleUi(fixture);
    // started from invoice FA-1 for 1000: choose mode, amount lowered under what is assigned
    type(document.querySelector('input[name=amount]') as HTMLInputElement, '300');
    await settleUi(fixture);
    const submit = document.querySelector('button[form=receipt-form]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(document.querySelector('[role=dialog]')!.textContent).toContain('ACC.FORM.OVER');
  });

  it('asks for a reason before voiding a payment and sends it', async () => {
    const fixture = await mount({ can: ['BILLING_READ', 'FINANCE_MANAGE'] });
    button('ACC.VOID')!.click();
    await settleUi(fixture);
    const confirm = document.querySelector('button[form=void-form]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    type(document.querySelector('textarea[name=reason]') as HTMLTextAreaElement, 'Saisi deux fois');
    await settleUi(fixture);
    expect(confirm.disabled).toBe(false);
    (document.querySelector('#void-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(api.voidReceipt).toHaveBeenCalledWith('r1', 'Saisi deux fois');
  });

  it('offers no payment, void or plan buttons to someone who can only read', async () => {
    const fixture = await mount({ can: ['BILLING_READ'] });
    const labels = [...fixture.nativeElement.querySelectorAll('button, a.btn')].map((b: Element) => b.textContent ?? '');
    expect(labels.some(t => t.includes('ACC.RECORD'))).toBe(false);
    expect(labels.some(t => t.includes('ACC.VOID'))).toBe(false);
    expect(labels.some(t => t.includes('ACC.PLAN.NEW'))).toBe(false);
  });

  it('offers to use credit only when there is some and an invoice to settle', async () => {
    api.account.mockResolvedValue(account({ creditAvailable: 300 }));
    const fixture = await mount();
    expect(button('ACC.APPLY_CREDIT')).toBeDefined();
    button('ACC.APPLY_CREDIT')!.click();
    await settleUi(fixture);
    (document.querySelector('#credit-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(api.applyCredit).toHaveBeenCalledWith('p1', 'i1', 300);
  });

  it('keeps the dialog open and reports the error when the server refuses', async () => {
    api.recordReceipt.mockRejectedValueOnce(new Error('conflict'));
    const fixture = await mount();
    button('ACC.RECORD')!.click();
    await settleUi(fixture);
    type(document.querySelector('input[name=amount]') as HTMLInputElement, '100');
    await settleUi(fixture);
    (document.querySelector('#receipt-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(mocks.errors).toHaveLength(1);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(mocks.toasts).toEqual([]);
  });
});
