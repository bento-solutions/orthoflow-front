import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AnalyticsApi, ProcedureActivity } from '../../core/services/analytics-api.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { Period, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { MoneyPipe, NumPipe, PctPipe } from '../../shared/pipes/money.pipe';
import { BreakdownComponent } from '../../shared/ui/breakdown.component';
import { ExportMenuComponent } from '../../shared/ui/export-menu.component';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';

const STATUSES = ['FINALIZED', 'DRAFT', 'CANCELLED', 'REFUNDED'] as const;

/** Margin as a share of revenue, 0 when nothing was earned (no division by zero). */
export function marginPercent(revenue: number, margin: number): number {
  return revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
}

/**
 * What was done, what it earned and what it cost: per treatment, category and doctor. Only finalised
 * sessions count unless other states are chosen. The cost is the stock consumed, so a margin here
 * is the margin on materials, before the doctor's time or the clinic's overheads.
 */
@Component({
  selector: 'app-procedures',
  standalone: true,
  imports: [FormsModule, TranslateModule, MoneyPipe, NumPipe, PctPipe, BreakdownComponent, ExportMenuComponent, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
        <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
          <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
          @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'ANA.PROC.CATEGORY' | translate }}</span>
        <input class="input w-40" type="search" [ngModel]="category()" (ngModelChange)="category.set($event)" /></label>
      <fieldset class="pb-2"><legend class="sr-only">{{ 'COMMON.STATUS' | translate }}</legend>
        <div class="flex flex-wrap gap-3 text-sm">@for (s of statuses; track s) { <label class="flex items-center gap-1.5"><input type="checkbox" [checked]="chosen().includes(s)" (change)="toggle(s)" /> {{ 'ANA.PROC.STATUSES.' + s | translate }}</label> }</div></fieldset>
      <app-export-menu class="ms-auto" path="/analytics/procedures/export" [query]="exportQuery()" fallbackName="procedures" [formats]="['xlsx', 'csv', 'pdf']" />
    </div>

    @if (data.data(); as d) {
      <section class="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" [attr.aria-busy]="data.loading()">
        <div class="tile p-4"><p class="kpi-label">{{ 'ANA.PROC.SESSIONS' | translate }}</p><p class="kpi-value">{{ d.total.sessions | num: 0 }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'ANA.PROC.REVENUE' | translate }}</p><p class="kpi-value">{{ d.total.revenue | money }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'ANA.PROC.COST' | translate }}</p><p class="kpi-value">{{ d.total.materialCost | money }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'ANA.PROC.MARGIN' | translate }}</p><p class="kpi-value">{{ d.total.grossMargin | money }}</p><p class="kpi-hint">{{ margin(d.total.revenue, d.total.grossMargin) | pct }}</p></div>
      </section>
      <div class="mb-5 grid gap-5 lg:grid-cols-2">
        <section class="card"><div class="card-head"><h2 class="card-title">{{ 'ANA.PROC.BY_CATEGORY' | translate }}</h2></div><div class="p-4"><app-breakdown [rows]="categoryRows()" /></div></section>
        <section class="card"><div class="card-head"><h2 class="card-title">{{ 'ANA.PROC.BY_DOCTOR' | translate }}</h2></div><div class="p-4"><app-breakdown [rows]="doctorRows()" /></div></section>
      </div>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th scope="col">{{ 'ANA.PROC.TREATMENT' | translate }}</th><th scope="col">{{ 'COMMON.PRACTITIONER' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'ANA.PROC.SESSIONS' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.PROC.REVENUE' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'ANA.PROC.COST' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.PROC.MARGIN' | translate }}</th><th scope="col" class="cell-num">%</th>
          </tr></thead>
          <tbody>
            @for (r of d.rows; track $index) {
              <tr>
                <td class="font-semibold">{{ r.treatmentName }}@if (r.category) { <span class="block text-xs font-normal text-ink-500">{{ r.category }}</span> }</td>
                <td>{{ r.practitionerName || '—' }}</td>
                <td class="cell-num">{{ r.sessions | num: 0 }}</td><td class="cell-num">{{ r.revenue | money }}</td><td class="cell-num">{{ r.materialCost | money }}</td>
                <td class="cell-num font-semibold" [class.text-critical-700]="r.grossMargin < 0">{{ r.grossMargin | money }}</td><td class="cell-num">{{ r.marginPercent | pct }}</td>
              </tr>
            } @empty { <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ 'ANA.PROC.EMPTY' | translate }}</td></tr> }
          </tbody>
        </table>
      </div></div>
    }
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .kpi-hint { margin-top: 0.25rem; font-size: var(--text-xs); color: var(--text-muted); }
    .card-title { font-size: var(--text-md); font-weight: 700; color: var(--text); }
  `],
})
export class ProceduresComponent {
  private readonly api = inject(AnalyticsApi);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly statuses = STATUSES;
  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly margin = marginPercent;
  protected readonly period = signal<Period>(periodFor('quarter'));
  protected readonly practitionerId = signal('');
  protected readonly category = signal('');
  protected readonly chosen = signal<string[]>(['FINALIZED']);
  protected readonly data = loadable<ProcedureActivity | null>(null);

  protected readonly categoryRows = computed(() => (this.data.data()?.byCategory ?? []).map(g => ({ label: g.label, amount: g.revenue })));
  protected readonly doctorRows = computed(() => (this.data.data()?.byPractitioner ?? []).map(g => ({ label: g.label, amount: g.revenue })));

  private readonly query = computed(() => ({
    ...this.period(), status: this.chosen(), practitionerId: this.practitionerId() || undefined, category: this.category().trim() || undefined,
  }));
  protected readonly exportQuery = computed(() => ({ ...this.query() }) as Record<string, string | readonly string[] | undefined>);

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.data.load(() => this.api.procedures(query)));
    });
  }

  protected toggle(status: string): void {
    this.chosen.update(c => (c.includes(status) ? c.filter(s => s !== status) : [...c, status]));
  }
}
