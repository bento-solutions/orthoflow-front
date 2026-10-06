import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { DownloadService } from '../../../core/services/download.service';
import {
  CATEGORY_KINDS, Expense, ExpenseCategory, ExpenseInput, FinanceApi, PAYMENT_METHODS, PaymentMethod, RECURRENCES,
} from '../../../core/services/finance-api.service';
import { LanguageService } from '../../../core/services/language.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { Period, isoDate, periodFor } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { ExportMenuComponent } from '../../../shared/ui/export-menu.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PeriodPickerComponent } from '../../../shared/ui/period-picker.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';

/** A category's name in the interface language, falling back to French (the one every clinic fills in first). */
export function categoryLabel(category: Pick<ExpenseCategory, 'nameFr' | 'nameEn' | 'nameAr'>, lang: string): string {
  return (lang === 'ar' ? category.nameAr : lang === 'en' ? category.nameEn : category.nameFr) || category.nameFr;
}

export interface ExpenseForm {
  expenseDate: string;
  categoryId: string;
  payee: string;
  description: string;
  amount: number;
  dueDate: string;
  recurrence: (typeof RECURRENCES)[number];
  notes: string;
}

export function expenseRequest(f: ExpenseForm): ExpenseInput {
  return {
    expenseDate: f.expenseDate, categoryId: f.categoryId, payee: f.payee.trim() || undefined, description: f.description.trim() || undefined,
    amount: f.amount, dueDate: f.dueDate || undefined, recurrence: f.recurrence, notes: f.notes.trim() || undefined,
  };
}

const blankExpense = (categoryId = ''): ExpenseForm => ({ expenseDate: isoDate(new Date()), categoryId, payee: '', description: '', amount: 0, dueDate: '', recurrence: 'NONE', notes: '' });
const blankCategory = () => ({ code: '', nameFr: '', nameEn: '', nameAr: '', kind: 'OPERATING' as (typeof CATEGORY_KINDS)[number], active: true, displayOrder: 100 });

/**
 * What the practice spends: rent, salaries, CNSS, lab fees, supplies. Reading is for those who may
 * see finance; recording, paying and cancelling is for those who manage expenses. A paid expense
 * cannot be cancelled, only corrected. Validated vendor invoices and lab orders create their
 * expenses on their own.
 */
@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, MoneyPipe, ExportMenuComponent, IconComponent, ModalComponent, PeriodPickerComponent, StatusPillComponent, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'FIN.EXP.CATEGORY' | translate }}</span>
        <select class="select w-auto" [ngModel]="categoryId()" (ngModelChange)="categoryId.set($event)">
          <option value="">{{ 'FIN.EXP.ALL_CATEGORIES' | translate }}</option>
          @for (c of categories(); track c.id) { <option [value]="c.id">{{ label(c) }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'COMMON.STATUS' | translate }}</span>
        <select class="select w-auto" [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (s of statuses; track s) { <option [value]="s">{{ 'STATUS.' + s | translate }}</option> }
        </select></label>
      <label class="search"><span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span><app-icon name="search" [size]="16" />
        <input class="input" type="search" [placeholder]="'FIN.EXP.SEARCH' | translate" [ngModel]="search()" (ngModelChange)="search.set($event)" /></label>
      <span class="ms-auto flex gap-2">
        <app-export-menu path="/finance/expenses/export" [query]="exportQuery()" fallbackName="expenses" />
        <button *appCan="'EXPENSES_MANAGE'" type="button" class="btn btn-secondary btn-sm" (click)="openCategories()">{{ 'FIN.EXP.CATEGORIES' | translate }}</button>
        <button *appCan="'EXPENSES_MANAGE'" type="button" class="btn btn-primary btn-sm" (click)="openNew()"><app-icon name="plus" [size]="15" /> {{ 'FIN.EXP.NEW' | translate }}</button>
      </span>
    </div>

    <section class="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div class="tile p-4"><p class="kpi-label">{{ 'FIN.EXP.TOTAL' | translate }}</p><p class="kpi-value">{{ totals().all | money }}</p></div>
      <div class="tile p-4"><p class="kpi-label">{{ 'STATUS.PAID' | translate }}</p><p class="kpi-value text-positive-700">{{ totals().paid | money }}</p></div>
      <div class="tile p-4"><p class="kpi-label">{{ 'STATUS.PENDING' | translate }}</p><p class="kpi-value">{{ totals().pending | money }}</p></div>
      <div class="tile p-4"><p class="kpi-label">{{ 'STATUS.OVERDUE' | translate }}</p><p class="kpi-value" [class.text-critical-700]="totals().overdue > 0">{{ totals().overdueCount }}</p></div>
    </section>

    <div class="table-wrap" [attr.aria-busy]="expenses.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'ACC.COL.DATE' | translate }}</th><th scope="col">{{ 'FIN.EXP.CATEGORY' | translate }}</th><th scope="col">{{ 'FIN.EXP.PAYEE' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th><th scope="col">{{ 'ACC.PLAN.COL.DUE' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
          <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (e of expenses.data(); track e.id) {
            <tr [class.opacity-60]="e.status === 'CANCELLED'">
              <td>{{ e.expenseDate | date: 'mediumDate' }}</td>
              <td>{{ e.categoryName }}@if (e.recurrence !== 'NONE') { <span class="block text-xs text-ink-500">{{ 'FIN.EXP.RECURRENCES.' + e.recurrence | translate }}</span> }</td>
              <td>{{ e.payee || '—' }}@if (e.description) { <span class="block text-xs text-ink-500">{{ e.description }}</span> }</td>
              <td class="cell-num font-semibold" [class.line-through]="e.status === 'CANCELLED'">{{ e.amount | money }}</td>
              <td>{{ e.dueDate ? (e.dueDate | date: 'mediumDate') : '—' }}</td>
              <td>
                <span class="flex flex-wrap items-center gap-1.5">
                  <app-status-pill [status]="e.overdue ? 'OVERDUE' : e.status" />
                  @if (e.status === 'PAID' && e.method) { <span class="text-xs text-ink-500">{{ 'BILLING.METHODS.' + e.method | translate }}@if (e.paidDate) { · {{ e.paidDate | date: 'shortDate' }} }</span> }
                </span>
              </td>
              <td class="cell-actions">
                <span class="inline-flex flex-wrap justify-end gap-1">
                  @if (e.receiptFileId) { <button type="button" class="btn btn-ghost btn-icon" (click)="viewReceipt(e)" [title]="'FIN.EXP.VIEW_RECEIPT' | translate" [attr.aria-label]="'FIN.EXP.VIEW_RECEIPT' | translate"><app-icon name="file-text" [size]="16" /></button> }
                  <ng-container *appCan="'EXPENSES_MANAGE'">
                    @if (e.status === 'PENDING') { <button type="button" class="btn btn-secondary btn-sm" (click)="openPay(e)">{{ 'FIN.EXP.MARK_PAID' | translate }}</button> }
                    @if (e.status !== 'CANCELLED') {
                      <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(e)" [title]="'COMMON.EDIT' | translate" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + (e.payee || e.categoryName)"><app-icon name="edit" [size]="16" /></button>
                      <label class="btn btn-ghost btn-icon cursor-pointer" [title]="'FIN.EXP.ATTACH' | translate">
                        <app-icon name="upload" [size]="16" /><span class="sr-only">{{ 'FIN.EXP.ATTACH' | translate }}</span>
                        <input type="file" class="sr-only" accept="application/pdf,image/*" (change)="attach(e, $event)" />
                      </label>
                    }
                    @if (e.status === 'PENDING') { <button type="button" class="btn btn-ghost btn-icon" (click)="cancel(e)" [title]="'COMMON.CANCEL' | translate" [attr.aria-label]="('COMMON.CANCEL' | translate) + ' ' + (e.payee || e.categoryName)"><app-icon name="x-circle" [size]="16" /></button> }
                  </ng-container>
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ 'FIN.EXP.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="editing() !== null" [title]="(editing()?.id ? 'FIN.EXP.EDIT' : 'FIN.EXP.NEW') | translate" size="lg" [dismissable]="!busy()" (closed)="editing.set(null)">
      <form id="exp-form" class="space-y-4" (ngSubmit)="save()">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">{{ 'ACC.COL.DATE' | translate }}</span><input class="input" type="date" name="date" required [ngModel]="form.value().expenseDate" (ngModelChange)="form.set('expenseDate', $event)" /></label>
          <label class="field"><span class="label label-required">{{ 'FIN.EXP.CATEGORY' | translate }}</span>
            <select class="select" name="category" required [ngModel]="form.value().categoryId" (ngModelChange)="form.set('categoryId', $event)">
              @for (c of activeCategories(); track c.id) { <option [value]="c.id">{{ label(c) }}</option> }
            </select></label>
          <label class="field"><span class="label label-required">{{ 'ACC.COL.AMOUNT' | translate }}</span><input class="input" type="number" min="0.01" step="0.01" name="amount" required [ngModel]="form.value().amount || null" (ngModelChange)="form.set('amount', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'FIN.EXP.PAYEE' | translate }}</span><input class="input" name="payee" maxlength="200" [ngModel]="form.value().payee" (ngModelChange)="form.set('payee', $event)" /></label>
          <label class="field"><span class="label">{{ 'ACC.PLAN.COL.DUE' | translate }}</span><input class="input" type="date" name="due" [ngModel]="form.value().dueDate" (ngModelChange)="form.set('dueDate', $event)" /></label>
          <label class="field"><span class="label">{{ 'FIN.EXP.RECURRENCE' | translate }}</span>
            <select class="select" name="recurrence" [ngModel]="form.value().recurrence" (ngModelChange)="form.set('recurrence', $event)">
              @for (r of recurrences; track r) { <option [value]="r">{{ 'FIN.EXP.RECURRENCES.' + r | translate }}</option> }
            </select></label>
        </div>
        <label class="field"><span class="label">{{ 'FIN.EXP.DESCRIPTION' | translate }}</span><input class="input" name="description" maxlength="500" [ngModel]="form.value().description" (ngModelChange)="form.set('description', $event)" /></label>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="exp-form" class="btn btn-primary" [disabled]="busy() || !form.value().categoryId || form.value().amount <= 0">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="paying() !== null" [title]="'FIN.EXP.MARK_PAID' | translate" size="sm" [dismissable]="!busy()" (closed)="paying.set(null)">
      <form id="pay-form" class="space-y-4" (ngSubmit)="pay()">
        <label class="field"><span class="label">{{ 'FIN.EXP.PAID_ON' | translate }}</span><input class="input" type="date" name="paidDate" [max]="today" [ngModel]="payForm.value().paidDate" (ngModelChange)="payForm.set('paidDate', $event)" /></label>
        <label class="field"><span class="label">{{ 'ACC.FORM.METHOD' | translate }}</span>
          <select class="select" name="method" [ngModel]="payForm.value().method" (ngModelChange)="payForm.set('method', $event)">
            @for (m of methods; track m) { <option [value]="m">{{ 'BILLING.METHODS.' + m | translate }}</option> }
          </select></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="paying.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="pay-form" class="btn btn-primary" [disabled]="busy()">{{ 'FIN.EXP.MARK_PAID' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="categoriesOpen()" [title]="'FIN.EXP.CATEGORIES' | translate" size="lg" (closed)="categoriesOpen.set(false)">
      <div class="table-wrap mb-4"><div class="table-scroll">
        <table class="data-table">
          <thead><tr><th scope="col">{{ 'COMMON.NAME' | translate }}</th><th scope="col">{{ 'FIN.EXP.KIND' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th></tr></thead>
          <tbody>
            @for (c of categories(); track c.id) {
              <tr>
                <td class="font-semibold">{{ label(c) }}<span class="block text-xs font-normal text-ink-500 mono">{{ c.code }}</span></td>
                <td>{{ 'FIN.EXP.KINDS.' + c.kind | translate }}</td>
                <td>{{ (c.active ? 'COMMON.ACTIVE' : 'COMMON.INACTIVE') | translate }}</td>
                <td class="cell-actions"><button type="button" class="btn btn-ghost btn-icon" (click)="editCategory(c)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + label(c)"><app-icon name="edit" [size]="16" /></button></td>
              </tr>
            }
          </tbody>
        </table>
      </div></div>
      <form id="cat-form" class="space-y-3 rounded-lg border border-ink-200 p-4" (ngSubmit)="saveCategory()">
        <h3 class="text-sm font-bold text-ink-900">{{ (categoryId2() ? 'FIN.EXP.EDIT_CATEGORY' : 'FIN.EXP.NEW_CATEGORY') | translate }}</h3>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="field"><span class="label label-required">Français</span><input class="input" name="nameFr" required maxlength="120" [ngModel]="category.value().nameFr" (ngModelChange)="category.set('nameFr', $event)" /></label>
          <label class="field"><span class="label label-required">English</span><input class="input" name="nameEn" required maxlength="120" [ngModel]="category.value().nameEn" (ngModelChange)="category.set('nameEn', $event)" /></label>
          <label class="field"><span class="label label-required">العربية</span><input class="input" name="nameAr" required maxlength="120" dir="rtl" [ngModel]="category.value().nameAr" (ngModelChange)="category.set('nameAr', $event)" /></label>
          <label class="field"><span class="label">{{ 'FIN.EXP.KIND' | translate }}</span>
            <select class="select" name="kind" [ngModel]="category.value().kind" (ngModelChange)="category.set('kind', $event)">
              @for (k of kinds; track k) { <option [value]="k">{{ 'FIN.EXP.KINDS.' + k | translate }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'FIN.EXP.ORDER' | translate }}</span><input class="input" type="number" min="0" name="order" [ngModel]="category.value().displayOrder" (ngModelChange)="category.set('displayOrder', +$event || 0)" /></label>
          <label class="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" [ngModel]="category.value().active" (ngModelChange)="category.set('active', $event)" /> {{ 'COMMON.ACTIVE' | translate }}</label>
        </div>
        <div class="flex justify-end gap-2">
          @if (categoryId2()) { <button type="button" class="btn btn-secondary btn-sm" (click)="editCategory(null)">{{ 'COMMON.CANCEL' | translate }}</button> }
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !category.value().nameFr.trim() || !category.value().nameEn.trim() || !category.value().nameAr.trim()">{{ 'COMMON.SAVE' | translate }}</button>
        </div>
      </form>
      <div modal-footer><button type="button" class="btn btn-secondary" (click)="categoriesOpen.set(false)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
  `],
})
export class ExpensesComponent {
  private readonly api = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly downloads = inject(DownloadService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly kinds = CATEGORY_KINDS;
  protected readonly recurrences = RECURRENCES;
  protected readonly statuses = ['PENDING', 'PAID', 'CANCELLED'] as const;
  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly today = isoDate(new Date());

  protected readonly period = signal<Period>(periodFor('month'));
  protected readonly categoryId = signal('');
  protected readonly status = signal('');
  protected readonly search = signal('');
  protected readonly expenses = loadable<Expense[]>([]);
  protected readonly categories = signal<ExpenseCategory[]>([]);
  protected readonly activeCategories = computed(() => this.categories().filter(c => c.active));

  protected readonly totals = computed(() => {
    const live = this.expenses.data().filter(e => e.status !== 'CANCELLED');
    const sum = (rows: Expense[]) => rows.reduce((s, e) => s + e.amount, 0);
    const overdue = live.filter(e => e.overdue);
    return {
      all: sum(live), paid: sum(live.filter(e => e.status === 'PAID')), pending: sum(live.filter(e => e.status === 'PENDING')),
      overdue: sum(overdue), overdueCount: overdue.length,
    };
  });

  protected readonly busy = signal(false);
  protected readonly editing = signal<{ id: string | null } | null>(null);
  protected readonly form = formState<ExpenseForm>(blankExpense());
  protected readonly paying = signal<Expense | null>(null);
  protected readonly payForm = formState<{ paidDate: string; method: PaymentMethod }>({ paidDate: this.today, method: 'CASH' });
  protected readonly categoriesOpen = signal(false);
  protected readonly categoryId2 = signal<string | null>(null);
  protected readonly category = formState(blankCategory());

  private readonly query = computed(() => ({ ...this.period(), categoryId: this.categoryId(), status: this.status(), search: this.search() }));
  protected readonly exportQuery = computed(() => ({ ...this.period(), categoryId: this.categoryId(), status: this.status() }));

  constructor() {
    void this.loadCategories();
    effect(() => {
      const query = this.query();
      untracked(() => void this.expenses.load(() => this.api.expenses(query)));
    });
    refreshOnLive(['finance'], () => void this.expenses.load(() => this.api.expenses(this.query())));
  }

  protected label(category: ExpenseCategory): string {
    return categoryLabel(category, this.language.currentLang());
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories.set(await this.api.expenseCategories());
    } catch (error) {
      this.errors.report(error);
    }
  }

  // ── an expense ────────────────────────────────────────────────────
  protected openNew(): void {
    this.form.reset(blankExpense(this.activeCategories()[0]?.id));
    this.editing.set({ id: null });
  }

  protected openEdit(e: Expense): void {
    this.form.reset({
      expenseDate: e.expenseDate, categoryId: e.categoryId, payee: e.payee ?? '', description: e.description ?? '', amount: e.amount,
      dueDate: e.dueDate ?? '', recurrence: e.recurrence, notes: e.notes ?? '',
    });
    this.editing.set({ id: e.id });
  }

  protected async save(): Promise<void> {
    const target = this.editing();
    const f = this.form.value();
    if (!target || this.busy() || !f.categoryId || f.amount <= 0) {
      return;
    }
    await this.run(async () => {
      await (target.id ? this.api.updateExpense(target.id, expenseRequest(f)) : this.api.createExpense(expenseRequest(f)));
      this.editing.set(null);
    });
  }

  protected openPay(e: Expense): void {
    this.payForm.reset({ paidDate: this.today, method: 'CASH' });
    this.paying.set(e);
  }

  protected async pay(): Promise<void> {
    const e = this.paying();
    if (!e || this.busy()) {
      return;
    }
    await this.run(async () => {
      await this.api.payExpense(e.id, { paidDate: this.payForm.value().paidDate || undefined, method: this.payForm.value().method });
      this.paying.set(null);
    });
  }

  protected async cancel(e: Expense): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('FIN.EXP.CANCEL_CONFIRM'), { danger: true }))) {
      return;
    }
    await this.run(() => this.api.cancelExpense(e.id).then(() => undefined));
  }

  protected async attach(e: Expense, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.run(async () => {
      await this.api.attachExpenseReceipt(e.id, file);
      this.toast.success(this.translate.instant('FIN.EXP.ATTACHED'));
    });
  }

  protected async viewReceipt(e: Expense): Promise<void> {
    try {
      await this.downloads.open(`/files/${e.receiptFileId}`);
    } catch (error) {
      this.errors.report(error);
    }
  }

  // ── categories ────────────────────────────────────────────────────
  protected openCategories(): void {
    this.editCategory(null);
    this.categoriesOpen.set(true);
  }

  protected editCategory(c: ExpenseCategory | null): void {
    this.categoryId2.set(c?.id ?? null);
    this.category.reset(c ? { code: c.code, nameFr: c.nameFr, nameEn: c.nameEn, nameAr: c.nameAr, kind: c.kind, active: c.active, displayOrder: c.displayOrder } : blankCategory());
  }

  protected async saveCategory(): Promise<void> {
    const id = this.categoryId2();
    const f = this.category.value();
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const body = { ...f, code: f.code.trim().toUpperCase() || undefined };
      await (id ? this.api.updateCategory(id, body) : this.api.createCategory(body));
      await this.loadCategories();
      this.editCategory(null);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.expenses.load(() => this.api.expenses(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
