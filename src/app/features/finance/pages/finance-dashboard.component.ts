import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgApexchartsModule, ApexAxisChartSeries, ApexChart, ApexDataLabels, ApexGrid, ApexLegend, ApexPlotOptions, ApexStroke, ApexTooltip, ApexXAxis, ApexYAxis } from 'ng-apexcharts';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FinanceDashboard, FinanceApi } from '../../../core/services/finance-api.service';
import { LanguageService } from '../../../core/services/language.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { Period, formatMoney, periodFor } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { BreakdownComponent } from '../../../shared/ui/breakdown.component';
import { ExportMenuComponent } from '../../../shared/ui/export-menu.component';
import { PeriodPickerComponent } from '../../../shared/ui/period-picker.component';
import { PracticeProfileService } from '../../../core/services/practice-profile.service';

/* ApexCharts is configured in JavaScript and cannot read CSS custom properties, so the
   series colours are mirrored here (petrol-500, positive-500, caution-500). */
const PRODUCTION = '#2f8fa2';
const COLLECTIONS = '#1a9a5c';
const EXPENSES = '#cf7008';
const INK_500 = '#63747a';
const INK_100 = '#eaeef0';

export interface TrendChart {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  stroke: ApexStroke;
  dataLabels: ApexDataLabels;
  grid: ApexGrid;
  tooltip: ApexTooltip;
  legend: ApexLegend;
  plotOptions: ApexPlotOptions;
  colors: string[];
}

/** One line of the monthly equation: what it is, its amount, and whether it is added or taken off. */
export interface EquationLine {
  key: string;
  amount: number;
  sign: '+' | '−' | '=';
}

/** Collections, less every expense and the retrocessions, is the result: the server's own rule, laid out line by line. */
export function equation(d: FinanceDashboard): EquationLine[] {
  return [
    { key: 'FIN.DASH.EQ.COLLECTIONS', amount: d.collections, sign: '+' },
    { key: 'FIN.DASH.EQ.OPERATING', amount: d.operatingExpenses, sign: '−' },
    { key: 'FIN.DASH.EQ.SALARIES', amount: d.salaries, sign: '−' },
    { key: 'FIN.DASH.EQ.SOCIAL', amount: d.socialCharges, sign: '−' },
    { key: 'FIN.DASH.EQ.RETROCESSIONS', amount: d.retrocessions, sign: '−' },
    { key: 'FIN.DASH.EQ.RESULT', amount: d.result, sign: '=' },
  ];
}

/**
 * How the practice is doing over a period: what was produced (invoiced), what came in, what is
 * still owed, what went out, and the result. Everything is computed on the server from the
 * receipts and expenses, so the figures here are the ones the exports carry.
 */
@Component({
  selector: 'app-finance-dashboard',
  standalone: true,
  imports: [NgApexchartsModule, TranslateModule, MoneyPipe, BreakdownComponent, ExportMenuComponent, PeriodPickerComponent],
  template: `
    <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <app-export-menu path="/finance/dashboard/export" [query]="{ from: period().from, to: period().to }" fallbackName="finance-dashboard" [formats]="['pdf', 'xlsx', 'csv']" />
    </div>

    @if (data.data(); as d) {
      <section class="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" [attr.aria-busy]="data.loading()">
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DASH.PRODUCTION' | translate }}</p><p class="kpi-value">{{ d.production | money }}</p><p class="kpi-hint">{{ 'FIN.DASH.PRODUCTION_HINT' | translate }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DASH.COLLECTIONS' | translate }}</p><p class="kpi-value">{{ d.collections | money }}</p><p class="kpi-hint">{{ 'FIN.DASH.COLLECTIONS_HINT' | translate }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DASH.DEBT' | translate }}</p><p class="kpi-value" [class.text-critical-700]="d.patientDebt > 0">{{ d.patientDebt | money }}</p><p class="kpi-hint">{{ 'FIN.DASH.DEBT_HINT' | translate }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'FIN.DASH.RESULT' | translate }}</p><p class="kpi-value" [class.text-critical-700]="d.result < 0" [class.text-positive-700]="d.result > 0">{{ d.result | money }}</p><p class="kpi-hint">{{ 'FIN.DASH.RESULT_HINT' | translate }}</p></div>
      </section>

      <div class="mb-5 grid gap-5 xl:grid-cols-3">
        <section class="card xl:col-span-2">
          <div class="card-head"><h2 class="card-title">{{ 'FIN.DASH.TREND' | translate }}</h2></div>
          <div class="p-4">
            @if (d.trend.length) {
              <apx-chart [series]="trend().series" [chart]="trend().chart" [xaxis]="trend().xaxis" [yaxis]="trend().yaxis" [stroke]="trend().stroke" [colors]="trend().colors"
                [dataLabels]="trend().dataLabels" [grid]="trend().grid" [tooltip]="trend().tooltip" [legend]="trend().legend" [plotOptions]="trend().plotOptions"></apx-chart>
            } @else {
              <p class="py-10 text-center text-ink-500">{{ 'COMMON.NOTHING_TO_SHOW' | translate }}</p>
            }
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="card-title">{{ 'FIN.DASH.EQUATION' | translate }}</h2></div>
          <dl class="divide-y divide-ink-100 px-4 py-1 text-sm">
            @for (line of lines(); track line.key) {
              <div class="flex items-baseline justify-between gap-3 py-2" [class.font-bold]="line.sign === '='">
                <dt class="text-ink-700"><span class="me-2 inline-block w-3 text-center text-ink-400" aria-hidden="true">{{ line.sign }}</span>{{ line.key | translate }}</dt>
                <dd class="tabular-nums" [class.text-critical-700]="line.sign === '=' && line.amount < 0" [class.text-positive-700]="line.sign === '=' && line.amount > 0">{{ line.amount | money }}</dd>
              </div>
            }
          </dl>
        </section>
      </div>

      <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <section class="card"><div class="card-head"><h2 class="card-title">{{ 'FIN.DASH.BY_METHOD' | translate }}</h2></div><div class="p-4"><app-breakdown [rows]="methodRows()" /></div></section>
        <section class="card"><div class="card-head"><h2 class="card-title">{{ 'FIN.DASH.BY_CATEGORY' | translate }}</h2></div><div class="p-4"><app-breakdown [rows]="d.expensesByCategory" /></div></section>
        <section class="card"><div class="card-head"><h2 class="card-title">{{ 'FIN.DASH.PRODUCTION_BY_DOCTOR' | translate }}</h2></div><div class="p-4"><app-breakdown [rows]="d.productionByPractitioner" /></div></section>
        <section class="card"><div class="card-head"><h2 class="card-title">{{ 'FIN.DASH.COLLECTIONS_BY_DOCTOR' | translate }}</h2></div><div class="p-4"><app-breakdown [rows]="d.collectionsByPractitioner" /></div></section>
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
export class FinanceDashboardComponent {
  private readonly api = inject(FinanceApi);
  private readonly language = inject(LanguageService);
  private readonly profile = inject(PracticeProfileService);
  private readonly translate = inject(TranslateService);

  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly period = signal<Period>(periodFor('month'));
  protected readonly data = loadable<FinanceDashboard | null>(null);

  protected readonly lines = computed(() => {
    const d = this.data.data();
    return d ? equation(d) : [];
  });
  protected readonly methodRows = computed(() =>
    (this.data.data()?.collectionsByMethod ?? []).map(b => ({ label: this.translate.instant(`BILLING.METHODS.${b.key}`), amount: b.amount })),
  );

  protected readonly trend = computed<TrendChart>(() => {
    const d = this.data.data();
    const lang = this.language.currentLang();
    const currency = this.profile.currency();
    const points = d?.trend ?? [];
    const month = (key: string) => new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit' }).format(new Date(`${key.slice(0, 7)}-01T00:00:00`));
    return {
      series: [
        { name: this.translate.instant('FIN.DASH.PRODUCTION'), data: points.map(p => p.production) },
        { name: this.translate.instant('FIN.DASH.COLLECTIONS'), data: points.map(p => p.collections) },
        { name: this.translate.instant('FIN.DASH.EXPENSES'), data: points.map(p => p.expenses) },
      ],
      chart: { type: 'bar', height: 280, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif', parentHeightOffset: 0, animations: { enabled: false } },
      colors: [PRODUCTION, COLLECTIONS, EXPENSES],
      plotOptions: { bar: { columnWidth: '60%', borderRadius: 3 } },
      dataLabels: { enabled: false },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      xaxis: { categories: points.map(p => month(p.month)), axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: INK_500, fontSize: '11px', fontWeight: 600 } } },
      yaxis: { labels: { style: { colors: INK_500, fontSize: '11px', fontWeight: 600 }, formatter: (v: number) => formatMoney(v, currency, lang).replace(/[.,]00(?=\D*$)/, '') } },
      grid: { borderColor: INK_100, strokeDashArray: 4, padding: { left: 8, right: 8, top: 0 }, xaxis: { lines: { show: false } } },
      tooltip: { theme: 'light', y: { formatter: (v: number) => formatMoney(v, currency, lang) } },
      legend: { position: 'top', horizontalAlign: 'left', fontSize: '12px', labels: { colors: INK_500 } },
    };
  });

  constructor() {
    effect(() => {
      const { from, to } = this.period();
      untracked(() => void this.data.load(() => this.api.dashboard(from, to)));
    });
    refreshOnLive(['finance'], () => void this.data.load(() => this.api.dashboard(this.period().from, this.period().to)));
  }
}
