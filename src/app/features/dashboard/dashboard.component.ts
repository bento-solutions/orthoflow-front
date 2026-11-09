import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgApexchartsModule } from 'ng-apexcharts';
import type {
  ApexAxisChartSeries, ApexChart, ApexXAxis, ApexYAxis, ApexDataLabels,
  ApexStroke, ApexGrid, ApexTooltip, ApexLegend, ApexFill, ApexMarkers,
} from 'ng-apexcharts';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { PatientService } from '../../core/services/patient.service';
import { PatientDirectoryApi, DirectoryKpis } from '../patients/patient-directory-api.service';
import { ScheduleService } from '../../core/services/schedule.service';
import { Appointment } from '../../core/models/patient.model';
import { IconComponent, IconName } from '../../shared/ui/icon.component';
import { StatusPillComponent } from '../../shared/ui/status-pill.component';
import { describedChart } from '../../core/utils/chart-summary';

/* ApexCharts is configured in JavaScript and cannot resolve CSS custom
   properties, so these three token values are mirrored here. They are the
   only hardcoded colours left in the screen; if the palette in
   `tokens.css` moves, these move with it. */
const PETROL_500 = '#2f8fa2';  // --petrol-500
const INK_500 = '#63747a';     // --ink-500
const INK_100 = '#eaeef0';     // --ink-100

export type ChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  stroke: ApexStroke;
  dataLabels: ApexDataLabels;
  grid: ApexGrid;
  tooltip: ApexTooltip;
  colors: string[];
  legend: ApexLegend;
  fill: ApexFill;
  markers: ApexMarkers;
};

/**
 * Practice overview.
 *
 * Organised around the three questions a practice owner opens this screen
 * to answer — what is happening today, what needs me, and how is the
 * practice trending — rather than four identically-weighted counters
 * (audit VIII.7).
 *
 * Every figure on this screen is derived from data the API actually
 * returned. Nothing is seeded, estimated or placeheld: on a clinical
 * screen an invented number is indistinguishable from a real one, and the
 * previous build shipped hardcoded series alongside live ones.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, RouterLink, TranslateModule, NgApexchartsModule,
    IconComponent, StatusPillComponent,
  ],
  template: `
    <h1 class="sr-only">{{ 'COMMON.OVERVIEW' | translate }}</h1>
    <div class="space-y-6 anim-rise">

      <!-- ── Key figures ──────────────────────────────────────────────────
           The first tile is the primary one and is weighted accordingly:
           equal-weight tiles make the user decide what matters, which is
           the screen's job, not theirs. -->
      <section class="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        @for (kpi of kpis(); track kpi.key) {
          <a
            class="card card-interactive group flex flex-col gap-3 p-4"
            [routerLink]="kpi.link"
          >
            <div class="flex items-start justify-between gap-3">
              <p class="text-xs font-bold uppercase tracking-wider text-ink-500">
                {{ kpi.key | translate }}
              </p>
              <span
                class="grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors duration-2 ease-out"
                [class]="kpi.tone === 'attention'
                  ? 'bg-caution-50 text-caution-700'
                  : 'bg-petrol-50 text-petrol-700 group-hover:bg-petrol-100'"
              >
                <app-icon [name]="kpi.icon" [size]="16" />
              </span>
            </div>

            <div class="flex items-baseline gap-2">
              <strong class="text-3xl font-extrabold leading-none tracking-tight text-ink-900 tabular-nums">
                {{ kpi.value | number }}
              </strong>
              @if (kpi.suffix) {
                <span class="text-sm font-semibold text-ink-500">{{ kpi.suffix }}</span>
              }
            </div>

            @if (kpi.caption) {
              <p class="text-xs text-ink-500">{{ kpi.caption }}</p>
            }
          </a>
        }
      </section>

      <div class="grid gap-6 lg:grid-cols-3">

        <!-- ── Today ─────────────────────────────────────────────────────
             The single most-asked question of the day, so it gets the
             widest column and sits above the fold. -->
        <section class="card lg:col-span-2">
          <header class="card-head">
            <div>
              <h2 class="text-lg font-bold text-ink-900">{{ 'DASHBOARD.TODAY_TITLE' | translate }}</h2>
              <p class="text-xs text-ink-500">{{ todayLabel() }}</p>
            </div>
            <a routerLink="/schedule" class="btn btn-secondary btn-sm">
              {{ 'DASHBOARD.OPEN_SCHEDULE' | translate }}
              <app-icon name="arrow-right" [size]="14" />
            </a>
          </header>

          @if (todaysAppointments().length) {
            <ul class="divide-y divide-ink-100">
              @for (appt of todaysAppointments(); track appt.id) {
                <li class="flex items-center gap-3 px-4 py-2.5 transition-colors duration-1 ease-out hover:bg-ink-50">
                  <!-- Time is the scan column: fixed width and tabular so
                       the whole day reads as one vertical ruler. -->
                  <span class="w-14 shrink-0 text-sm font-bold tabular-nums text-ink-900">
                    {{ appt.dateTime | date: 'HH:mm' }}
                  </span>
                  <span class="h-8 w-px shrink-0 bg-ink-200" aria-hidden="true"></span>
                  <span class="flex min-w-0 flex-1 flex-col leading-tight">
                    <span class="truncate font-semibold text-ink-900">{{ nameFor(appt) }}</span>
                    <span class="truncate text-xs text-ink-500">
                      {{ appt.type }} · {{ appt.durationMinutes }} {{ 'DASHBOARD.MIN' | translate }}
                    </span>
                  </span>
                  <app-status-pill [status]="appt.status" />
                </li>
              }
            </ul>
          } @else {
            <div class="empty">
              <span class="empty-icon"><app-icon name="calendar" [size]="20" /></span>
              <p class="empty-title">{{ 'DASHBOARD.NO_APPOINTMENTS_TODAY' | translate }}</p>
              <p class="empty-text">{{ 'DASHBOARD.NO_APPOINTMENTS_TODAY_HINT' | translate }}</p>
            </div>
          }
        </section>

        <!-- ── Needs attention ───────────────────────────────────────────
             The only place on the dashboard permitted to use amber and red.
             It stays empty when nothing is wrong — an alert panel that
             always has something in it stops being read. -->
        <section class="card">
          <header class="card-head">
            <h2 class="text-lg font-bold text-ink-900">{{ 'DASHBOARD.ATTENTION_TITLE' | translate }}</h2>
            @if (attentionItems().length) {
              <span class="pill pill-attention pill-nodot tabular-nums">{{ attentionItems().length }}</span>
            }
          </header>

          @if (attentionItems().length) {
            <ul class="divide-y divide-ink-100">
              @for (item of attentionItems(); track item.key) {
                <li>
                  <a [routerLink]="item.link" class="flex items-start gap-3 px-4 py-3 transition-colors duration-1 ease-out hover:bg-ink-50">
                    <span
                      class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md"
                      [class]="item.tone === 'critical' ? 'bg-critical-50 text-critical-700' : 'bg-caution-50 text-caution-700'"
                    >
                      <app-icon [name]="item.icon" [size]="14" />
                    </span>
                    <span class="flex min-w-0 flex-col leading-tight">
                      <span class="font-semibold text-ink-900">{{ item.key | translate: item.params }}</span>
                      <span class="text-xs text-ink-500">{{ item.hintKey | translate }}</span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <div class="empty">
              <span class="empty-icon bg-positive-50 text-positive-700">
                <app-icon name="check-circle" [size]="20" />
              </span>
              <p class="empty-title">{{ 'DASHBOARD.ALL_CLEAR' | translate }}</p>
              <p class="empty-text">{{ 'DASHBOARD.ALL_CLEAR_HINT' | translate }}</p>
            </div>
          }
        </section>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <!-- ── Admissions trend ──────────────────────────────────────── -->
        <section class="card lg:col-span-2">
          <header class="card-head">
            <div>
              <h2 class="text-lg font-bold text-ink-900">{{ 'DASHBOARD.PATIENT_ANALYTICS' | translate }}</h2>
              <p class="text-xs text-ink-500">{{ 'DASHBOARD.ANALYTICS_SUBTITLE' | translate }}</p>
            </div>
            <!-- Wired to the series below. It previously rendered two
                 buttons where only the inactive one had a hover state and
                 neither did anything. -->
            <div class="seg" role="group" [attr.aria-label]="'DASHBOARD.GRANULARITY' | translate">
              @for (g of granularities; track g.value) {
                <button
                  type="button"
                  class="seg-item"
                  [class.is-active]="granularity() === g.value"
                  [attr.aria-pressed]="granularity() === g.value"
                  (click)="granularity.set(g.value)"
                >{{ g.key | translate }}</button>
              }
            </div>
          </header>

          <div class="px-2 pb-2 pt-4">
            @if (hasAdmissionData()) {
              <apx-chart
                [series]="chartOptions().series"
                [chart]="chartOptions().chart"
                [xaxis]="chartOptions().xaxis"
                [yaxis]="chartOptions().yaxis"
                [stroke]="chartOptions().stroke"
                [colors]="chartOptions().colors"
                [dataLabels]="chartOptions().dataLabels"
                [grid]="chartOptions().grid"
                [tooltip]="chartOptions().tooltip"
                [legend]="chartOptions().legend"
                [fill]="chartOptions().fill"
                [markers]="chartOptions().markers"
              ></apx-chart>
            } @else {
              <div class="empty">
                <span class="empty-icon"><app-icon name="trending-up" [size]="20" /></span>
                <p class="empty-title">{{ 'DASHBOARD.NO_TREND_DATA' | translate }}</p>
                <p class="empty-text">{{ 'DASHBOARD.NO_TREND_DATA_HINT' | translate }}</p>
              </div>
            }
          </div>
        </section>

        <!-- ── Quick actions ─────────────────────────────────────────── -->
        <section class="card">
          <header class="card-head">
            <h2 class="text-lg font-bold text-ink-900">{{ 'DASHBOARD.QUICK_ACTIONS' | translate }}</h2>
          </header>
          <div class="p-2">
            @for (action of quickActions; track action.link) {
              <a
                [routerLink]="action.link"
                class="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-1 ease-out hover:bg-petrol-50"
              >
                <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink-100 text-ink-600 transition-colors duration-2 ease-out group-hover:bg-petrol-100 group-hover:text-petrol-700">
                  <app-icon [name]="action.icon" [size]="16" />
                </span>
                <span class="flex-1 text-sm font-semibold text-ink-900">{{ action.key | translate }}</span>
                <span class="text-ink-300 transition-transform duration-2 ease-out group-hover:translate-x-0.5 group-hover:text-petrol-700 rtl:group-hover:-translate-x-0.5">
                  <app-icon name="chevron-right" [size]="16" />
                </span>
              </a>
            }
          </div>
        </section>
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  readonly patientService = inject(PatientService);
  private readonly directory = inject(PatientDirectoryApi);
  private readonly scheduleService = inject(ScheduleService);

  /**
   * The patient figures, counted by the server over every patient. They were counted here over the
   * patient list the app keeps, which is the first page of 200: past that, every tile was wrong (audit P1).
   */
  private readonly patientKpis = signal<DirectoryKpis | null>(null);
  private readonly translate = inject(TranslateService);

  readonly granularity = signal<'monthly' | 'quarterly'>('monthly');
  readonly granularities = [
    { value: 'monthly', key: 'DASHBOARD.MONTHLY' },
    { value: 'quarterly', key: 'DASHBOARD.QUARTERLY' },
  ] as const;

  readonly quickActions: { key: string; link: string; icon: IconName }[] = [
    { key: 'DASHBOARD.ACTION_NEW_PATIENT', link: '/patients/register', icon: 'user-plus' },
    { key: 'DASHBOARD.ACTION_SCHEDULE', link: '/schedule', icon: 'calendar' },
    { key: 'DASHBOARD.ACTION_NEW_INVOICE', link: '/billing/invoices/create', icon: 'receipt' },
    { key: 'DASHBOARD.ACTION_STOCK', link: '/stock', icon: 'box' },
  ];

  ngOnInit(): void {
    this.directory.kpis().then((k) => this.patientKpis.set(k)).catch(() => undefined);
    this.scheduleService.refreshAppointments();
  }

  // ── Derived figures ──────────────────────────────────────────────────

  private readonly activePatients = computed(() => this.patientKpis()?.active ?? 0);
  private readonly completedPatients = computed(() => this.patientKpis()?.completed ?? 0);
  private readonly onHoldPatients = computed(() => this.patientKpis()?.onHold ?? 0);
  private readonly newThisMonth = computed(() => this.patientKpis()?.newThisMonth ?? 0);
  private readonly totalPatients = computed(() => this.patientKpis()?.total ?? 0);

  private readonly completionRate = computed(() => {
    const total = this.totalPatients();
    return total ? Math.round((this.completedPatients() / total) * 100) : 0;
  });

  readonly todaysAppointments = computed(() => {
    const today = new Date().toDateString();
    return this.scheduleService
      .appointments()
      .filter((a) => new Date(a.dateTime).toDateString() === today)
      .sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime));
  });

  readonly kpis = computed(() => {
    const onHold = this.onHoldPatients();
    return [
      {
        key: 'DASHBOARD.KPI_IN_TREATMENT',
        value: this.activePatients(),
        icon: 'users' as IconName,
        link: '/patients',
        tone: 'neutral' as const,
        suffix: '',
        caption: this.t('DASHBOARD.KPI_IN_TREATMENT_CAPTION', { count: this.totalPatients() }),
      },
      {
        key: 'DASHBOARD.TODAYS_VISITS',
        value: this.todaysAppointments().filter((a) => a.status !== 'CANCELLED').length,
        icon: 'calendar' as IconName,
        link: '/schedule',
        tone: 'neutral' as const,
        suffix: '',
        caption: this.t('DASHBOARD.KPI_VISITS_CAPTION', { count: this.upcomingThisWeek() }),
      },
      {
        key: 'DASHBOARD.KPI_NEW_THIS_MONTH',
        value: this.newThisMonth(),
        icon: 'user-plus' as IconName,
        link: '/patients',
        tone: 'neutral' as const,
        suffix: '',
        caption: '',
      },
      {
        // The only tile that can turn amber, and only when there is
        // genuinely something paused that a human should look at.
        key: 'DASHBOARD.KPI_ON_HOLD',
        value: onHold,
        icon: onHold > 0 ? ('alert-triangle' as IconName) : ('check-circle' as IconName),
        link: '/patients',
        tone: onHold > 0 ? ('attention' as const) : ('neutral' as const),
        suffix: '',
        caption: this.t('DASHBOARD.KPI_COMPLETION_CAPTION', { rate: this.completionRate() }),
      },
    ];
  });

  private readonly upcomingThisWeek = computed(() => {
    const now = Date.now();
    const week = now + 7 * 86400000;
    return this.scheduleService.appointments().filter((a) => {
      const t = +new Date(a.dateTime);
      return t >= now && t <= week && a.status !== 'CANCELLED';
    }).length;
  });

  /** Only real, actionable conditions — never a placeholder row. */
  readonly attentionItems = computed(() => {
    const items: {
      key: string; hintKey: string; params: Record<string, unknown>;
      icon: IconName; tone: 'attention' | 'critical'; link: string;
    }[] = [];

    const noShows = this.scheduleService.appointments().filter((a) => a.status === 'NO_SHOW').length;
    if (noShows > 0) {
      items.push({
        key: 'DASHBOARD.ATTENTION_NO_SHOWS', hintKey: 'DASHBOARD.ATTENTION_NO_SHOWS_HINT',
        params: { count: noShows }, icon: 'calendar', tone: 'attention', link: '/schedule',
      });
    }

    const onHold = this.onHoldPatients();
    if (onHold > 0) {
      items.push({
        key: 'DASHBOARD.ATTENTION_ON_HOLD', hintKey: 'DASHBOARD.ATTENTION_ON_HOLD_HINT',
        params: { count: onHold }, icon: 'users', tone: 'attention', link: '/patients',
      });
    }

    const unscheduled = this.patientKpis()?.activeWithoutUpcoming ?? 0;
    if (unscheduled > 0) {
      items.push({
        key: 'DASHBOARD.ATTENTION_UNSCHEDULED', hintKey: 'DASHBOARD.ATTENTION_UNSCHEDULED_HINT',
        params: { count: unscheduled }, icon: 'clock', tone: 'critical', link: '/patients',
      });
    }

    return items;
  });

  readonly todayLabel = computed(() =>
    new Intl.DateTimeFormat(this.locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
  );

  /** The appointment names its patient; the loaded patient list is only the first 200. */
  nameFor(appt: Appointment): string {
    return appt.patientName || this.patientService.nameFor(appt.patientId) || '—';
  }

  // ── Chart ────────────────────────────────────────────────────────────

  private readonly admissionsByMonth = computed(() => {
    const months = this.patientKpis()?.admissionsByMonth ?? [];
    return Array.from({ length: 12 }, (_, i) => months[i] ?? 0);
  });

  readonly hasAdmissionData = computed(() => this.admissionsByMonth().some((v) => v > 0));

  readonly chartOptions = computed<ChartOptions>(() => {
    const monthly = this.admissionsByMonth();
    const quarterly = [0, 1, 2, 3].map((q) => monthly.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0));
    const isQuarterly = this.granularity() === 'quarterly';

    const locale = this.locale();
    const monthLabels = Array.from({ length: 12 }, (_, m) =>
      new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2026, m, 1)),
    );

    return describedChart(this.t('DASHBOARD.PATIENT_ANALYTICS'), {
      series: [{ name: this.t('DASHBOARD.SERIES_ADMISSIONS'), data: isQuarterly ? quarterly : monthly }],
      chart: {
        height: 300,
        type: 'area',
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif',
        animations: { enabled: true, speed: 240, animateGradually: { enabled: false } },
        parentHeightOffset: 0,
      },
      /* petrol-500 — the action colour. The chart is brand surface, not
         status, so it must not borrow green/amber/red. */
      colors: [PETROL_500],
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2.5 },
      markers: { size: 0, hover: { size: 5 } },
      xaxis: {
        categories: isQuarterly ? ['Q1', 'Q2', 'Q3', 'Q4'] : monthLabels,
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { colors: INK_500, fontSize: '11px', fontWeight: 600 } },
      },
      yaxis: {
        labels: {
          style: { colors: INK_500, fontSize: '11px', fontWeight: 600 },
          formatter: (v: number) => String(Math.round(v)),
        },
      },
      grid: {
        borderColor: INK_100,
        strokeDashArray: 4,
        padding: { left: 8, right: 8, top: 0 },
        xaxis: { lines: { show: false } },
      },
      tooltip: { theme: 'light', x: { show: true } },
      legend: { show: false },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.02, stops: [0, 100] },
      },
    });
  });

  /* `currentLang` is a plain property, so the locale has to be tracked
     through onLangChange for these computeds to re-run on a switch. */
  private readonly lang = toSignal(
    this.translate.onLangChange.pipe(map((e) => e.lang)),
    { initialValue: this.translate.currentLang || this.translate.getDefaultLang() || 'fr' },
  );

  private locale(): string {
    return this.lang();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }
}
