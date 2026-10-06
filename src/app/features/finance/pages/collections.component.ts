import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CollectionsReport, FinanceApi, PAYMENT_METHODS } from '../../../core/services/finance-api.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { PractitionerService } from '../../../core/services/practitioner.service';
import { Period, periodFor } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { BreakdownComponent } from '../../../shared/ui/breakdown.component';
import { PeriodPickerComponent } from '../../../shared/ui/period-picker.component';

/**
 * Money received in a period: how much, by which method, from whom, and how much of it is still
 * an advance (not yet spent on an invoice). Voided receipts are not counted.
 */
@Component({
  selector: 'app-collections',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, BreakdownComponent, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'FIN.COL.METHOD' | translate }}</span>
        <select class="select w-auto" [ngModel]="method()" (ngModelChange)="method.set($event)">
          <option value="">{{ 'FIN.COL.ALL_METHODS' | translate }}</option>
          @for (m of methods; track m) { <option [value]="m">{{ 'BILLING.METHODS.' + m | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
        <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
          <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
          @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
        </select></label>
    </div>

    @if (report.data(); as r) {
      <section class="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" [attr.aria-busy]="report.loading()">
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.COL.RECEIVED' | translate }}</p><p class="kpi-value">{{ r.received | money }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.COL.ALLOCATED' | translate }}</p><p class="kpi-value">{{ r.allocated | money }}</p><p class="kpi-hint">{{ 'FIN.COL.ALLOCATED_HINT' | translate }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.COL.ADVANCES_USED' | translate }}</p><p class="kpi-value">{{ r.advancesUsed | money }}</p><p class="kpi-hint">{{ 'FIN.COL.ADVANCES_USED_HINT' | translate }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.COL.CREDIT' | translate }}</p><p class="kpi-value">{{ r.creditAvailable | money }}</p><p class="kpi-hint">{{ 'FIN.COL.CREDIT_HINT' | translate }}</p></div>
      </section>

      <div class="grid gap-5 lg:grid-cols-3">
        <section class="card">
          <div class="card-head"><h2 class="card-title">{{ 'FIN.COL.BY_METHOD' | translate }}</h2></div>
          <div class="p-4"><app-breakdown [rows]="methodRows()" /></div>
        </section>
        <section class="card lg:col-span-2">
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th scope="col">{{ 'ACC.COL.DATE' | translate }}</th><th scope="col">{{ 'COMMON.PATIENT' | translate }}</th><th scope="col">{{ 'ACC.COL.METHOD' | translate }}</th>
                <th scope="col">{{ 'COMMON.PRACTITIONER' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.AVAILABLE' | translate }}</th>
              </tr></thead>
              <tbody>
                @for (row of r.rows; track row.receiptId) {
                  <tr>
                    <td>{{ row.date | date: 'mediumDate' }}</td>
                    <td><a class="font-semibold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', row.patientId]">{{ row.patientName }}</a><span class="block text-xs text-ink-500 mono">{{ row.patientCode }}</span></td>
                    <td>{{ 'BILLING.METHODS.' + row.method | translate }}@if (row.reference) { <span class="block text-xs text-ink-500">{{ row.reference }}</span> }</td>
                    <td>{{ row.practitionerName || '—' }}</td>
                    <td class="cell-num font-semibold">{{ row.amount | money }}</td>
                    <td class="cell-num">{{ row.unallocated > 0 ? (row.unallocated | money) : '—' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="py-8 text-center text-ink-500">{{ 'FIN.COL.EMPTY' | translate }}</td></tr>
                }
              </tbody>
            </table>
          </div></div>
        </section>
      </div>
    }
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .kpi-hint { margin-top: 0.25rem; font-size: var(--text-xs); color: var(--text-muted); }
    .card-title { font-size: var(--text-md); font-weight: 700; color: var(--text); }
  `],
})
export class CollectionsComponent {
  private readonly api = inject(FinanceApi);
  private readonly translate = inject(TranslateService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly presets: ('today' | 'week' | 'month' | 'lastMonth' | 'year')[] = ['today', 'week', 'month', 'lastMonth', 'year'];
  protected readonly period = signal<Period>(periodFor('today'));
  protected readonly method = signal('');
  protected readonly practitionerId = signal('');
  protected readonly report = loadable<CollectionsReport | null>(null);

  protected readonly methodRows = computed(() =>
    (this.report.data()?.byMethod ?? []).map(m => ({ label: this.translate.instant(`BILLING.METHODS.${m.method}`), amount: m.total })),
  );

  constructor() {
    effect(() => {
      const query = { ...this.period(), method: this.method(), practitionerId: this.practitionerId() };
      untracked(() => void this.report.load(() => this.api.collections(query)));
    });
    refreshOnLive(['finance'], () => void this.report.load(() => this.api.collections({ ...this.period(), method: this.method(), practitionerId: this.practitionerId() })));
  }
}
