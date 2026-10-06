import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { DownloadService } from '../../core/services/download.service';
import { CashClosing, Cheque, Expense, ExpenseCategory, FinanceApi, FinanceDashboard } from '../../core/services/finance-api.service';
import { LanguageService } from '../../core/services/language.service';
import { PermissionService } from '../../core/services/permission.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { screenMocks } from '../../testing/screen-mocks';
import { CashClosingComponent, difference, shiftDay } from './pages/cash-closing.component';
import { ChequesComponent, chequeActions } from './pages/cheques.component';
import { DebtsComponent } from './pages/debts.component';
import { ExpensesComponent, categoryLabel, expenseRequest } from './pages/expenses.component';
import { equation } from './pages/finance-dashboard.component';
import { FINANCE_TABS, firstFinanceTab } from './finance-tabs';

const dashboard = (over: Partial<FinanceDashboard> = {}): FinanceDashboard => ({
  from: '2026-10-01', to: '2026-10-31', production: 9000, collections: 7000, patientDebt: 2500, operatingExpenses: 1500, salaries: 2000, socialCharges: 500,
  otherExpenses: 0, retrocessions: 300, result: 2700, collectionsByMethod: [], expensesByCategory: [], productionByPractitioner: [], collectionsByPractitioner: [], trend: [], ...over,
});

describe('finance logic', () => {
  it('lays the result out as collections less each outgoing, in the order the server subtracts them', () => {
    const lines = equation(dashboard());
    expect(lines.map(l => l.sign)).toEqual(['+', '−', '−', '−', '−', '=']);
    const signed = lines.slice(0, -1).reduce((sum, l) => sum + (l.sign === '+' ? l.amount : -l.amount), 0);
    expect(signed).toBe(lines.at(-1)!.amount);
  });

  it('measures a cash difference in whole cents', () => {
    expect(difference(100.1, 100)).toBe(0.1);
    expect(difference(0.3, 0.1 + 0.2)).toBe(0);
    expect(difference(null, 50)).toBe(-50);
  });

  it('steps a day at a time across a month and a clock change', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('offers a cheque only the step it is at', () => {
    expect(chequeActions({ status: 'PENDING', guarantee: false })).toEqual({ deposit: true, cash: false, reject: true, release: false });
    expect(chequeActions({ status: 'PENDING', guarantee: true }).release).toBe(true);
    expect(chequeActions({ status: 'DEPOSITED', guarantee: true })).toEqual({ deposit: false, cash: true, reject: true, release: false });
    expect(chequeActions({ status: 'CASHED', guarantee: false })).toEqual({ deposit: false, cash: false, reject: false, release: false });
    expect(chequeActions({ status: 'REJECTED', guarantee: false }).reject).toBe(false);
  });

  it('names a category in the language of the screen, falling back to French', () => {
    const c = { nameFr: 'Loyer', nameEn: 'Rent', nameAr: 'الإيجار' };
    expect(categoryLabel(c, 'fr')).toBe('Loyer');
    expect(categoryLabel(c, 'en')).toBe('Rent');
    expect(categoryLabel(c, 'ar')).toBe('الإيجار');
    expect(categoryLabel({ ...c, nameEn: '' }, 'en')).toBe('Loyer');
  });

  it('sends no blank strings for an expense', () => {
    const request = expenseRequest({ expenseDate: '2026-10-06', categoryId: 'c1', payee: ' ', description: '', amount: 800, dueDate: '', recurrence: 'MONTHLY', notes: ' ' });
    expect(request).toEqual({ expenseDate: '2026-10-06', categoryId: 'c1', payee: undefined, description: undefined, amount: 800, dueDate: undefined, recurrence: 'MONTHLY', notes: undefined });
  });

  it('opens the finance area on the first tab the person may use', () => {
    const can = (...needed: string[]) => needed.some(p => ['BILLING_READ'].includes(p));
    expect(firstFinanceTab({ can } as unknown as PermissionService)).toBe('debts');
    expect(firstFinanceTab({ can: () => true } as unknown as PermissionService)).toBe('dashboard');
    expect(firstFinanceTab({ can: () => false } as unknown as PermissionService)).toBe('debts');
    expect(FINANCE_TABS.every(t => t.permission.length > 0)).toBe(true);
  });
});

@Component({ standalone: true, template: '' })
class Empty {}

describe('finance pages', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;

  const base = (can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks(can);
    return [
      provideRouter([{ path: '**', component: Empty }]),
      { provide: FinanceApi, useValue: api },
      { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
      { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
      { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
      { provide: DownloadService, useValue: { open: vi.fn(async () => undefined), download: vi.fn(async () => undefined) } },
      ...mocks.providers,
    ];
  };
  const mount = async <T>(type: new () => T) => {
    const fixture = TestBed.createComponent(type);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // ngModel writes its value on a later microtask than the first render
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  const type = (el: Element | null, value: string) => {
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    confirmAnswer = true;
    document.body.innerHTML = '';
    api = {};
  });

  describe('CashClosingComponent', () => {
    const open = (): CashClosing => ({ id: '', date: new Date().toISOString().slice(0, 10), closed: false, lines: [{ method: 'CASH', expected: 500, counted: 0, difference: 0 }, { method: 'CARD', expected: 300, counted: 0, difference: 0 }], totalDifference: 0, notes: '', closedAt: '' });

    beforeEach(() => {
      api['cashClosing'] = vi.fn(async () => open());
      api['closeCash'] = vi.fn(async () => ({ ...open(), closed: true }));
      TestBed.configureTestingModule({ imports: [CashClosingComponent, TranslateModule.forRoot()], providers: base() });
    });

    it('starts each count at what the receipts say, so a balanced till needs no typing', async () => {
      const fixture = await mount(CashClosingComponent);
      const inputs = [...document.querySelectorAll('input[type=number]')] as HTMLInputElement[];
      expect(inputs.map(i => i.value)).toEqual(['500', '300']);
      expect(document.body.textContent).toContain('FIN.CASH.BALANCED');
      fixture.destroy();
    });

    it('sends the counted amounts for every method and the notes when closing', async () => {
      const fixture = await mount(CashClosingComponent);
      type(document.querySelector('input[aria-label="BILLING.METHODS.CASH"]'), '480');
      await settleUi(fixture);
      expect(document.body.textContent).toContain('FIN.CASH.OFF');
      buttonWith('FIN.CASH.CLOSE')!.click();
      await settleUi(fixture);
      await settleUi(fixture);
      expect(api['closeCash']).toHaveBeenCalledWith(expect.objectContaining({ counts: [{ method: 'CASH', counted: 480 }, { method: 'CARD', counted: 300 }] }));
      expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
    });

    it('does not close the day when the cashier declines the confirmation', async () => {
      confirmAnswer = false;
      const fixture = await mount(CashClosingComponent);
      buttonWith('FIN.CASH.CLOSE')!.click();
      await settleUi(fixture);
      expect(api['closeCash']).not.toHaveBeenCalled();
    });

    it('shows a closed day as a record, with no inputs and no close button', async () => {
      api['cashClosing'].mockResolvedValue({ ...open(), closed: true, closedAt: '2026-10-06T18:00:00Z', lines: [{ method: 'CASH', expected: 500, counted: 480, difference: -20 }] });
      const fixture = await mount(CashClosingComponent);
      expect(document.querySelectorAll('input[type=number]').length).toBe(0);
      expect(buttonWith('FIN.CASH.CLOSE')).toBeUndefined();
      expect(document.body.textContent).toContain('FIN.CASH.CLOSED');
      fixture.destroy();
    });

    it('cannot go past today', async () => {
      const fixture = await mount(CashClosingComponent);
      const next = document.querySelector('button[aria-label="FIN.CASH.NEXT_DAY"]') as HTMLButtonElement;
      expect(next.disabled).toBe(true);
      fixture.destroy();
    });
  });

  describe('ChequesComponent', () => {
    const cheque = (over: Partial<Cheque>): Cheque => ({
      id: 'c1', number: '0012', bank: 'BMCE', drawerName: '', patientId: 'p1', patientName: 'Sara Alami', amount: 800, dueDate: '2026-11-01', depositDate: '', cashedDate: '', status: 'PENDING',
      guarantee: false, receiptId: '', notes: '', postDated: false, ...over,
    });

    beforeEach(() => {
      api['cheques'] = vi.fn(async () => [cheque({}), cheque({ id: 'c2', number: '0013', status: 'DEPOSITED' })]);
      api['chequeAction'] = vi.fn(async () => ({}));
      api['createCheque'] = vi.fn(async () => ({}));
      api['releaseCheque'] = vi.fn(async () => undefined);
    });

    it('deposits a pending cheque and refreshes the register', async () => {
      TestBed.configureTestingModule({ imports: [ChequesComponent, TranslateModule.forRoot()], providers: base() });
      const fixture = await mount(ChequesComponent);
      buttonWith('FIN.CHQ.DEPOSIT')!.click();
      await settleUi(fixture);
      expect(api['chequeAction']).toHaveBeenCalledWith('c1', 'deposit');
      expect(api['cheques']).toHaveBeenCalledTimes(2);
    });

    it('shows the cash action only on a deposited cheque', async () => {
      TestBed.configureTestingModule({ imports: [ChequesComponent, TranslateModule.forRoot()], providers: base() });
      const fixture = await mount(ChequesComponent);
      const cashButtons = [...document.querySelectorAll('button')].filter(b => b.textContent?.includes('FIN.CHQ.CASH'));
      expect(cashButtons).toHaveLength(1);
      cashButtons[0].click();
      await settleUi(fixture);
      expect(api['chequeAction']).toHaveBeenCalledWith('c2', 'cash');
    });

    it('rejects with the reason that was typed', async () => {
      TestBed.configureTestingModule({ imports: [ChequesComponent, TranslateModule.forRoot()], providers: base() });
      const fixture = await mount(ChequesComponent);
      [...document.querySelectorAll('button')].find(b => b.textContent?.includes('FIN.CHQ.REJECT'))!.click();
      await settleUi(fixture);
      type(document.querySelector('textarea[name=reason]'), 'Provision insuffisante');
      await settleUi(fixture);
      (document.querySelector('#rej-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['chequeAction']).toHaveBeenCalledWith('c1', 'reject', { reason: 'Provision insuffisante' });
    });

    it('records a standalone cheque as a guarantee only', async () => {
      TestBed.configureTestingModule({ imports: [ChequesComponent, TranslateModule.forRoot()], providers: base() });
      const fixture = await mount(ChequesComponent);
      buttonWith('FIN.CHQ.NEW')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[name=number]'), '0099');
      type(document.querySelector('input[name=amount]'), '1500');
      await settleUi(fixture);
      (document.querySelector('#chq-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['createCheque']).toHaveBeenCalledWith(expect.objectContaining({ number: '0099', amount: 1500, guarantee: true }));
    });

    it('lets someone who can only read the register look but not act', async () => {
      TestBed.configureTestingModule({ imports: [ChequesComponent, TranslateModule.forRoot()], providers: base({ can: ['BILLING_READ'] }) });
      await mount(ChequesComponent);
      const labels = [...document.querySelectorAll('button')].map(b => b.textContent ?? '');
      expect(labels.some(t => t.includes('FIN.CHQ.DEPOSIT') || t.includes('FIN.CHQ.REJECT') || t.includes('FIN.CHQ.NEW'))).toBe(false);
    });
  });

  describe('ExpensesComponent', () => {
    const category = (id: string, name: string): ExpenseCategory => ({ id, code: name.toUpperCase(), nameFr: name, nameEn: name, nameAr: name, kind: 'OPERATING', active: true, displayOrder: 1 });
    const expense = (over: Partial<Expense>): Expense => ({
      id: 'e1', expenseDate: '2026-10-02', categoryId: 'k1', categoryName: 'Loyer', categoryKind: 'OPERATING', payee: 'Bailleur', description: '', amount: 5000, dueDate: '2026-10-05',
      paidDate: '', status: 'PENDING', method: 'CASH', receiptFileId: '', vendorInvoiceId: '', labOrderId: '', recurrence: 'NONE', recurrenceNext: '', notes: '', overdue: false, ...over,
    });

    beforeEach(() => {
      api['expenses'] = vi.fn(async () => [expense({}), expense({ id: 'e2', status: 'PAID', amount: 1200, paidDate: '2026-10-03' }), expense({ id: 'e3', status: 'CANCELLED', amount: 999 })]);
      api['expenseCategories'] = vi.fn(async () => [category('k1', 'Loyer'), category('k2', 'Fournitures')]);
      api['payExpense'] = vi.fn(async () => ({}));
      api['cancelExpense'] = vi.fn(async () => ({}));
      api['createExpense'] = vi.fn(async () => ({}));
      TestBed.configureTestingModule({ imports: [ExpensesComponent, TranslateModule.forRoot()], providers: base() });
    });

    it('totals what was spent without counting cancelled expenses', async () => {
      await mount(ExpensesComponent);
      const text = document.body.textContent!.replace(/\s+/g, '');
      expect(text).toContain('6200,00MAD');
      expect(text).not.toContain('7199');
    });

    it('marks a pending expense paid with the chosen method', async () => {
      const fixture = await mount(ExpensesComponent);
      buttonWith('FIN.EXP.MARK_PAID')!.click();
      await settleUi(fixture);
      (document.querySelector('select[name=method]') as HTMLSelectElement).value = 'BANK_TRANSFER';
      document.querySelector('select[name=method]')!.dispatchEvent(new Event('change', { bubbles: true }));
      await settleUi(fixture);
      (document.querySelector('#pay-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['payExpense']).toHaveBeenCalledWith('e1', expect.objectContaining({ method: 'BANK_TRANSFER' }));
    });

    it('records a new expense in the first active category', async () => {
      const fixture = await mount(ExpensesComponent);
      buttonWith('FIN.EXP.NEW')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[name=amount]'), '350');
      type(document.querySelector('input[name=payee]'), 'Papeterie');
      await settleUi(fixture);
      (document.querySelector('#exp-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['createExpense']).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'k1', amount: 350, payee: 'Papeterie', recurrence: 'NONE' }));
    });

    it('asks before cancelling, and leaves the expense alone when declined', async () => {
      confirmAnswer = false;
      const fixture = await mount(ExpensesComponent);
      (document.querySelector('button[aria-label^="COMMON.CANCEL"]') as HTMLButtonElement).click();
      await settleUi(fixture);
      expect(api['cancelExpense']).not.toHaveBeenCalled();
    });

    it('hides the write buttons from someone who can only see finance', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ imports: [ExpensesComponent, TranslateModule.forRoot()], providers: base({ can: ['FINANCE_VIEW'] }) });
      await mount(ExpensesComponent);
      const labels = [...document.querySelectorAll('button')].map(b => b.textContent ?? '');
      expect(labels.some(t => t.includes('FIN.EXP.NEW') || t.includes('FIN.EXP.MARK_PAID') || t.includes('FIN.EXP.CATEGORIES'))).toBe(false);
    });
  });

  describe('DebtsComponent', () => {
    it('lists who owes what and asks the server for debtors only by default', async () => {
      api['debts'] = vi.fn(async () => ({
        totalFees: 3000, totalPaid: 1000, totalOwed: 2000, totalCredit: 0, patientsOwing: 1,
        rows: [{ patientId: 'p1', patientCode: 'P-1', firstName: 'Sara', lastName: 'Alami', phone: '0600', fees: 3000, paid: 1000, balance: 2000, credit: 0, lastInvoice: '2026-09-01', lastPayment: '2026-09-15' }],
      }));
      TestBed.configureTestingModule({ imports: [DebtsComponent, TranslateModule.forRoot()], providers: base() });
      await mount(DebtsComponent);
      expect(api['debts']).toHaveBeenCalledWith(expect.objectContaining({ debtOnly: true, sort: 'balance' }));
      expect(document.body.textContent).toContain('Sara Alami');
    });
  });
});
