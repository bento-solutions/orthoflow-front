import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { QueryValue, toParams } from './download.service';

export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'INSURANCE' | 'CHEQUE';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'INSURANCE'];

export type Account = Wire<'Account'>;
export type InvoiceBalance = Wire<'InvoiceBalance'>;
export type Receipt = Wire<'ReceiptView'>;
export type ReceiptInput = Req<'RecordReceipt'>;
export type CollectionsReport = Wire<'CollectionsReport'>;
export type CashClosing = Wire<'CashClosing'>;
export type CloseCashInput = Req<'CloseCash'>;
export type FinanceDashboard = Wire<'FinanceDashboard'>;
export type DebtSummary = Wire<'DebtSummary'>;
export type DebtRow = Wire<'DebtRow'>;
export type Cheque = Wire<'ChequeView'>;
export type ChequeInput = Req<'ChequeCreate'>;
export type ChequeStatus = Cheque['status'];
export type Expense = Wire<'ExpenseView'>;
export type ExpenseInput = Req<'ExpenseRequest'>;
export type ExpenseCategory = Wire<'CategoryView'>;
export type ExpenseCategoryInput = Req<'CategoryRequest'>;
export type PaymentPlan = Wire<'PlanView'>;
export type PaymentPlanInput = Req<'PaymentPlanCreate'>;
export type DueInstalment = Wire<'DueView'>;
export type TaxDocument = Wire<'TaxDocumentView'>;
export type TaxDocumentInput = Req<'Issue'>;

export const CATEGORY_KINDS = ['OPERATING', 'SALARY', 'SOCIAL', 'TAX', 'LAB', 'SUPPLIES'] as const;
export const RECURRENCES = ['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const PLAN_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY'] as const;

/** Money: the patient account, receipts and plans; collections, cash closing, debts, cheques, expenses, the dashboard and tax documents. */
@Injectable({ providedIn: 'root' })
export class FinanceApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  // ── patient account ────────────────────────────────────────────────
  account(patientId: string): Promise<Account> {
    return this.get(`/patients/${patientId}/account`);
  }
  recordReceipt(patientId: string, body: ReceiptInput): Promise<Receipt> {
    return this.post(`/patients/${patientId}/receipts`, body);
  }
  voidReceipt(id: string, reason: string): Promise<Receipt> {
    return this.post(`/receipts/${id}/void`, { reason });
  }
  applyCredit(patientId: string, invoiceId: string, amount: number): Promise<unknown> {
    return this.post(`/patients/${patientId}/credit/apply`, { invoiceId, amount });
  }

  // ── payment plans ──────────────────────────────────────────────────
  patientPlans(patientId: string): Promise<PaymentPlan[]> {
    return this.get(`/patients/${patientId}/payment-plans`);
  }
  createPlan(patientId: string, body: PaymentPlanInput): Promise<PaymentPlan> {
    return this.post(`/patients/${patientId}/payment-plans`, body);
  }
  cancelPlan(id: string): Promise<PaymentPlan> {
    return this.post(`/payment-plans/${id}/cancel`);
  }
  payInstalment(instalmentId: string, body: { amount: number; method: PaymentMethod; date?: string; reference?: string }): Promise<PaymentPlan> {
    return this.post(`/payment-plans/instalments/${instalmentId}/pay`, body);
  }
  duePlans(until?: string): Promise<DueInstalment[]> {
    return this.get('/payment-plans/due', { until });
  }

  // ── reports ────────────────────────────────────────────────────────
  collections(query: { from: string; to: string; method?: string; practitionerId?: string }): Promise<CollectionsReport> {
    return this.get('/finance/collections', query);
  }
  dashboard(from: string, to: string): Promise<FinanceDashboard> {
    return this.get('/finance/dashboard', { from, to });
  }
  debts(query: { from?: string; to?: string; debtOnly?: boolean; search?: string; sort?: string }): Promise<DebtSummary> {
    return this.get('/finance/debts', query);
  }
  cashClosing(date: string): Promise<CashClosing> {
    return this.get(`/finance/cash-closing/${date}`);
  }
  closeCash(body: CloseCashInput): Promise<CashClosing> {
    return this.post('/finance/cash-closing', body);
  }

  // ── cheques ────────────────────────────────────────────────────────
  cheques(query: { status?: string; patientId?: string; guarantee?: boolean; dueTo?: string }): Promise<Cheque[]> {
    return this.get('/cheques', query);
  }
  createCheque(body: ChequeInput): Promise<Cheque> {
    return this.post('/cheques', body);
  }
  chequeAction(id: string, action: 'deposit' | 'cash' | 'reject'): Promise<Cheque> {
    return this.post(`/cheques/${id}/${action}`);
  }
  deleteCheque(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/cheques/${id}`)));
  }

  // ── expenses ───────────────────────────────────────────────────────
  expenses(query: { from: string; to: string; categoryId?: string; status?: string; search?: string }): Promise<Expense[]> {
    return this.get('/finance/expenses', query);
  }
  createExpense(body: ExpenseInput): Promise<Expense> {
    return this.post('/finance/expenses', body);
  }
  updateExpense(id: string, body: ExpenseInput): Promise<Expense> {
    return firstValueFrom(this.http.put<Expense>(api(`/finance/expenses/${id}`), body));
  }
  attachExpenseReceipt(id: string, file: File): Promise<{ receiptFileId: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.post(`/finance/expenses/${id}/receipt`, form);
  }
  cancelExpense(id: string): Promise<Expense> {
    return this.post(`/finance/expenses/${id}/cancel`);
  }
  payExpense(id: string, body: { paidDate?: string; method: PaymentMethod }): Promise<Expense> {
    return this.post(`/finance/expenses/${id}/pay`, body);
  }
  expenseCategories(): Promise<ExpenseCategory[]> {
    return this.get('/finance/expenses/categories');
  }
  createCategory(body: ExpenseCategoryInput): Promise<ExpenseCategory> {
    return this.post('/finance/expenses/categories', body);
  }
  updateCategory(id: string, body: ExpenseCategoryInput): Promise<ExpenseCategory> {
    return firstValueFrom(this.http.put<ExpenseCategory>(api(`/finance/expenses/categories/${id}`), body));
  }

  // ── tax documents ──────────────────────────────────────────────────
  taxDocuments(query: { from?: string; to?: string; kind?: string; patientId?: string; status?: string; duplicates?: boolean }): Promise<TaxDocument[]> {
    return this.get('/tax-documents', query);
  }
  issueTaxDocument(body: TaxDocumentInput): Promise<TaxDocument> {
    return this.post('/tax-documents', body);
  }
  taxDocumentAction(id: string, action: 'deliver' | 'void'): Promise<TaxDocument> {
    return this.post(`/tax-documents/${id}/${action}`);
  }
  duplicateTaxDocument(id: string, lang: string): Promise<TaxDocument> {
    return firstValueFrom(this.http.post<TaxDocument>(api(`/tax-documents/${id}/duplicate`), {}, { params: { lang } }));
  }
}
