import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApexOptions, NgApexchartsModule } from 'ng-apexcharts';
import { map } from 'rxjs';
import { PerioChartListItem } from '../../../core/clinical/perio/perio.model';
import { Trend, hasProgression, progressionPoints, trendsOf } from './perio-progression';

/* ApexCharts is configured in JavaScript and cannot read CSS custom properties: the grey of the axes and
   gridlines is mirrored here from tokens.css (ink-500, ink-100). */
const INK_500 = '#63747a';
const INK_100 = '#eaeef0';

interface TrendView {
  readonly key: Trend['key'];
  readonly options: ApexOptions;
}

/** The charts of a patient side by side in time: bleeding, plaque, pocket depth, attachment loss. */
@Component({
  selector: 'app-perio-progression',
  standalone: true,
  imports: [TranslateModule, NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enough()) {
      <section class="progression">
        <header>
          <h3>{{ 'PERIO.PROGRESSION.TITLE' | translate }}</h3>
          <p>{{ 'PERIO.PROGRESSION.SUBTITLE' | translate: { count: count(), from: range().from, to: range().to } }}</p>
        </header>
        <div class="grid">
          @for (t of views(); track t.key) {
            <article class="trend">
              <h4>{{ 'PERIO.PROGRESSION.' + t.key + '_TITLE' | translate }}</h4>
              <p class="desc">{{ 'PERIO.PROGRESSION.' + t.key + '_DESC' | translate }}</p>
              <apx-chart [series]="t.options.series!" [chart]="t.options.chart!" [xaxis]="t.options.xaxis!" [yaxis]="t.options.yaxis!"
                         [stroke]="t.options.stroke!" [colors]="t.options.colors!" [dataLabels]="t.options.dataLabels!" [grid]="t.options.grid!"
                         [tooltip]="t.options.tooltip!" [legend]="t.options.legend!" [markers]="t.options.markers!"/>
            </article>
          }
        </div>
      </section>
    } @else {
      <section class="few" role="status">
        <h3>{{ 'PERIO.PROGRESSION.NOT_ENOUGH_TITLE' | translate }}</h3>
        <p>{{ 'PERIO.PROGRESSION.NOT_ENOUGH_TEXT' | translate }}</p>
        @if (count() === 1) { <p class="one">{{ 'PERIO.PROGRESSION.ONE_AVAILABLE' | translate }}</p> }
      </section>
    }
  `,
  styles: [`
    h3, h4, p { margin: 0; }
    .progression { display: flex; flex-direction: column; gap: 1rem; }
    header h3 { font-size: var(--text-md); font-weight: 700; }
    header p, .desc { margin-top: .125rem; font-size: var(--text-xs); color: var(--text-muted); }
    .grid { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    .trend { padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
    .trend h4 { font-size: var(--text-sm); font-weight: 700; }
    .few { display: flex; flex-direction: column; gap: .5rem; padding: 2rem 1rem; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); text-align: center; color: var(--text-muted); }
    .few h3 { font-size: var(--text-md); color: var(--text); }
    .few p { font-size: var(--text-sm); }
    .few .one { font-weight: 600; }
  `],
})
export class PerioProgressionComponent {
  readonly charts = input.required<readonly PerioChartListItem[]>();

  private readonly translate = inject(TranslateService);
  /* `currentLang` is a plain property: the labels have to be tracked through onLangChange. */
  private readonly lang = toSignal(this.translate.onLangChange.pipe(map((e) => e.lang)), {
    initialValue: this.translate.currentLang || this.translate.getDefaultLang() || 'fr',
  });

  private readonly points = computed(() => progressionPoints(this.charts()));
  protected readonly enough = computed(() => hasProgression(this.points()));
  protected readonly count = computed(() => this.points().length);

  private date(iso: string): string {
    return new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium' }).format(new Date(`${iso}T12:00:00`));
  }

  protected readonly range = computed(() => {
    const points = this.points();
    return points.length ? { from: this.date(points[0].date), to: this.date(points[points.length - 1].date) } : { from: '', to: '' };
  });

  protected readonly views = computed<readonly TrendView[]>(() => {
    const points = this.points();
    const categories = points.map((p) => this.date(p.date));
    this.lang();
    return trendsOf(points).map((trend) => ({
      key: trend.key,
      options: {
        series: trend.series.map((s) => ({ name: this.translate.instant(`PERIO.PROGRESSION.METRIC_${s.metric}`), data: [...s.values] })),
        colors: trend.series.map((s) => s.color),
        chart: {
          type: 'line', height: 220, toolbar: { show: false }, zoom: { enabled: false }, parentHeightOffset: 0,
          fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif', animations: { enabled: false },
        },
        stroke: { curve: 'straight', width: 2.5 },
        markers: { size: 4, hover: { size: 6 } },
        dataLabels: { enabled: false },
        xaxis: {
          categories, axisBorder: { show: false }, axisTicks: { show: false },
          labels: { style: { colors: INK_500, fontSize: '11px', fontWeight: 600 }, rotate: -30, hideOverlappingLabels: true },
        },
        yaxis: {
          min: 0, forceNiceScale: true,
          labels: { style: { colors: INK_500, fontSize: '11px', fontWeight: 600 }, formatter: (v: number) => `${Math.round(v * 10) / 10}${trend.unit === '%' ? '%' : ''}` },
        },
        grid: { borderColor: INK_100, strokeDashArray: 4, padding: { left: 8, right: 8, top: 0 }, xaxis: { lines: { show: false } } },
        tooltip: { theme: 'light', y: { formatter: (v: number) => (v == null ? '—' : `${v}${trend.unit === '%' ? '%' : ' mm'}`) } },
        legend: { show: trend.series.length > 1, position: 'bottom', fontSize: '12px', markers: { size: 6 } },
      } as ApexOptions,
    }));
  });
}
