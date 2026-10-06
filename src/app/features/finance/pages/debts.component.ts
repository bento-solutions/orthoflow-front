import { Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { DebtSummary, FinanceApi } from '../../../core/services/finance-api.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { Period, periodFor } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { MoneyPipe, NumPipe } from '../../../shared/pipes/money.pipe';
import { ExportMenuComponent } from '../../../shared/ui/export-menu.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { PeriodPickerComponent } from '../../../shared/ui/period-picker.component';

/**
 * What each patient was charged, has paid and still owes. The period narrows the invoices
 * counted; with none chosen it is the whole history. A patient who has paid ahead shows a credit
 * instead of a debt.
 */
@Component({
  selector: 'app-debts',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, NumPipe, ExportMenuComponent, IconComponent, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="search">
        <span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span>
        <app-icon name="search" [size]="16" />
        <input class="input" type="search" [placeholder]="'PATIENTS.SEARCH_PLACEHOLDER' | translate" [ngModel]="searchInput()" (ngModelChange)="searchInput.set($event)" />
      </label>
      <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="debtOnly()" (ngModelChange)="debtOnly.set($event)" /> {{ 'FIN.DEBT.ONLY' | translate }}</label>
      <label class="field w-auto"><span class="label">{{ 'PAT.SORT' | translate }}</span>
        <select class="select w-auto" [ngModel]="sort()" (ngModelChange)="sort.set($event)">
          @for (s of sorts; track s) { <option [value]="s">{{ 'FIN.DEBT.SORTS.' + s | translate }}</option> }
        </select></label>
      <app-export-menu class="ms-auto" path="/finance/debts/export" [query]="exportQuery()" fallbackName="patient-balances" />
    </div>
    <details class="mb-4 text-sm" [open]="!!period()">
      <summary class="cursor-pointer text-ink-600">{{ 'FIN.DEBT.PERIOD' | translate }}@if (period()) { : {{ period()!.from | date: 'mediumDate' }} → {{ period()!.to | date: 'mediumDate' }} }</summary>
      <div class="mt-2 flex flex-wrap items-end gap-3">
        <app-period-picker [value]="period() ?? defaultPeriod" (valueChange)="period.set($event)" [presets]="presets" />
        @if (period()) { <button type="button" class="btn btn-ghost btn-sm" (click)="period.set(null)">{{ 'COMMON.CLEAR_FILTERS' | translate }}</button> }
      </div>
    </details>

    @if (summary.data(); as s) {
      <section class="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" [attr.aria-busy]="summary.loading()">
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DEBT.FEES' | translate }}</p><p class="kpi-value">{{ s.totalFees | money }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DEBT.PAID' | translate }}</p><p class="kpi-value">{{ s.totalPaid | money }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DEBT.OWED' | translate }}</p><p class="kpi-value text-critical-700">{{ s.totalOwed | money }}</p><p class="kpi-hint">{{ 'FIN.DEBT.PATIENTS_OWING' | translate: { count: s.patientsOwing } }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DEBT.CREDIT' | translate }}</p><p class="kpi-value text-positive-700">{{ s.totalCredit | money }}</p></div>
      </section>

      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th scope="col">{{ 'COMMON.PATIENT' | translate }}</th><th scope="col">{{ 'COMMON.PHONE' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'FIN.DEBT.FEES' | translate }}</th><th scope="col" class="cell-num">{{ 'FIN.DEBT.PAID' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'ACC.COL.BALANCE' | translate }}</th><th scope="col" class="cell-num">{{ 'FIN.DEBT.CREDIT' | translate }}</th>
            <th scope="col">{{ 'FIN.DEBT.LAST_INVOICE' | translate }}</th><th scope="col">{{ 'FIN.DEBT.LAST_PAYMENT' | translate }}</th>
          </tr></thead>
          <tbody>
            @for (r of s.rows; track r.patientId) {
              <tr>
                <td><a class="font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', r.patientId]">{{ r.firstName }} {{ r.lastName }}</a><span class="block text-xs text-ink-500 mono">{{ r.patientCode }}</span></td>
                <td>@if (r.phone) { <a class="text-ink-700" [href]="'tel:' + r.phone">{{ r.phone }}</a> } @else { — }</td>
                <td class="cell-num">{{ r.fees | money }}</td>
                <td class="cell-num">{{ r.paid | money }}</td>
                <td class="cell-num" [class.font-bold]="r.balance > 0" [class.text-critical-700]="r.balance > 0">{{ r.balance > 0 ? (r.balance | money) : '—' }}</td>
                <td class="cell-num text-positive-700">{{ r.credit > 0 ? (r.credit | money) : '—' }}</td>
                <td>{{ r.lastInvoice ? (r.lastInvoice | date: 'mediumDate') : '—' }}</td>
                <td>{{ r.lastPayment ? (r.lastPayment | date: 'mediumDate') : '—' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="py-8 text-center text-ink-500">{{ 'FIN.DEBT.EMPTY' | translate }}</td></tr>
            }
          </tbody>
        </table>
      </div></div>
      <p class="mt-3 text-xs text-ink-500">{{ s.rows.length | num: 0 }} {{ 'COMMON.PATIENTS' | translate }}</p>
    }
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .kpi-hint { margin-top: 0.25rem; font-size: var(--text-xs); color: var(--text-muted); }
  `],
})
export class DebtsComponent {
  private readonly api = inject(FinanceApi);

  protected readonly sorts = ['balance', 'name', 'lastPayment'] as const;
  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly defaultPeriod = periodFor('year');
  protected readonly searchInput = signal('');
  private readonly search = signal('');
  protected readonly debtOnly = signal(true);
  protected readonly sort = signal<string>('balance');
  protected readonly period = signal<Period | null>(null);
  protected readonly summary = loadable<DebtSummary | null>(null);

  protected readonly exportQuery = () => ({ ...this.query(), sort: undefined });

  private query() {
    return { from: this.period()?.from, to: this.period()?.to, debtOnly: this.debtOnly(), search: this.search(), sort: this.sort() };
  }

  constructor() {
    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const typed = this.searchInput();
      pause = setTimeout(() => untracked(() => this.search.set(typed)), 300);
      onCleanup(() => clearTimeout(pause));
    });
    effect(() => {
      const query = this.query();
      untracked(() => void this.summary.load(() => this.api.debts(query)));
    });
    refreshOnLive(['finance'], () => void this.summary.load(() => this.api.debts(this.query())));
  }
}
