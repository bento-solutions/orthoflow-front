import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Period, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { MoneyPipe, NumPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';
import { LeakageByDoctor, LeakageReport, WarehouseInsightsApi } from './warehouse-insights-api.service';

/**
 * Where the stock went: what the bill of materials expected, against what really left
 * the shelf, with the difference attributed.
 *
 * <p>The screen is laid out to be read in the order the number was built, because a
 * figure that names a doctor should show its working. Expected, then the tolerated
 * ceiling, then what was actually used, then what was explained away — and only what
 * survives all of that is called unexplained.
 *
 * <p>Coverage sits at the top rather than the bottom on purpose: when little of the
 * month's consumption could be tied to a treatment at all, every other figure here is
 * weaker than it looks, and burying that would be the dishonest way round.
 */
@Component({
  selector: 'app-leakage-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MoneyPipe, NumPipe, IconComponent, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="onPeriod($event)" [presets]="presets" />
    </div>

    @if (report.data(); as r) {
      <!-- ── How much of the month this report can actually see ── -->
      @if (r.attributionCoveragePct < 80) {
        <p class="mb-4 flex items-start gap-2 rounded-lg bg-caution-50 px-3 py-2 text-sm text-caution-800" role="status">
          <app-icon name="alert-triangle" [size]="16" class="mt-0.5 shrink-0" />
          <span>{{ 'WH.LEAK.LOW_COVERAGE' | translate: { pct: r.attributionCoveragePct } }}</span>
        </p>
      }

      <section class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" [attr.aria-label]="'WH.LEAK.TITLE' | translate">
        @for (k of kpis(); track k.key) {
          <div class="tile p-4">
            <p class="text-2xs font-bold uppercase tracking-wider text-ink-500">{{ k.key | translate }}</p>
            <p class="mt-1 text-2xl font-extrabold tabular-nums" [class.text-critical-700]="k.alarm">{{ k.value }}</p>
            <p class="mt-0.5 text-2xs text-ink-400">{{ k.hint | translate }}</p>
          </div>
        }
      </section>

      <!-- ── By doctor ── -->
      <section class="card">
        <div class="card-head"><h2 class="text-lg font-bold text-ink-900">{{ 'WH.LEAK.BY_DOCTOR' | translate }}</h2></div>

        @for (d of r.byDoctor; track d.practitionerId) {
          <div class="border-b border-ink-100 last:border-0">
            <button type="button" class="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-start hover:bg-ink-50"
                    (click)="toggle(d.practitionerId)" [attr.aria-expanded]="isOpen(d.practitionerId)">
              <app-icon [name]="isOpen(d.practitionerId) ? 'chevron-down' : 'chevron-right'" [size]="16" />
              <span class="min-w-0 flex-1 truncate font-bold text-ink-900">{{ d.practitionerName }}</span>
              <span class="text-sm text-ink-500">{{ d.treatments }} {{ 'WH.LEAK.TREATMENTS' | translate }}</span>
              @if (d.retreatments > 0) {
                <span class="pill pill-idle" [title]="'WH.LEAK.RETREATMENT_HINT' | translate">
                  {{ d.retreatments }} {{ 'WH.LEAK.RETX' | translate }}
                </span>
              }
              <span class="w-28 text-end text-sm font-bold tabular-nums"
                    [class.text-critical-700]="d.unexplainedPctOfExpected >= 20">
                {{ d.unexplainedPctOfExpected }}%
              </span>
              <span class="w-32 text-end font-bold tabular-nums"
                    [class.text-critical-700]="d.unexplainedPctOfExpected >= 20">{{ d.unexplainedCost | money }}</span>
            </button>

            @if (isOpen(d.practitionerId)) {
              <div class="table-wrap px-5 pb-4"><div class="table-scroll">
                <table class="data-table">
                  <thead><tr>
                    <th>{{ 'WH.LEAK.ITEM' | translate }}</th>
                    <th class="text-end">{{ 'WH.LEAK.EXPECTED' | translate }}</th>
                    <th class="text-end">{{ 'WH.LEAK.TOLERATED' | translate }}</th>
                    <th class="text-end">{{ 'WH.LEAK.ACTUAL' | translate }}</th>
                    <th class="text-end">{{ 'WH.LEAK.EXPLAINED' | translate }}</th>
                    <th class="text-end">{{ 'WH.LEAK.UNEXPLAINED' | translate }}</th>
                    <th class="text-end">{{ 'WH.LEAK.COST' | translate }}</th>
                  </tr></thead>
                  <tbody>
                    @for (l of d.lines; track l.stockItemId) {
                      <tr [class.bg-critical-50]="l.unexplained > 0">
                        <td>{{ l.itemName }}</td>
                        <td class="text-end tabular-nums">{{ l.expected | num }} {{ l.unitOfMeasure }}</td>
                        <td class="text-end tabular-nums text-ink-500">{{ l.tolerated | num }}</td>
                        <td class="text-end tabular-nums">{{ l.actual | num }}</td>
                        <td class="text-end tabular-nums text-ink-500">{{ l.explained | num }}</td>
                        <td class="text-end font-bold tabular-nums" [class.text-critical-700]="l.unexplained > 0">
                          {{ l.unexplained | num }}
                        </td>
                        <td class="text-end tabular-nums">{{ l.unexplainedCost | money }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div></div>
            }
          </div>
        } @empty {
          <p class="px-5 py-10 text-center text-sm text-ink-500">{{ 'WH.LEAK.NOTHING' | translate }}</p>
        }
      </section>

      <!-- ── Stock that left with no treatment behind it ── -->
      @if (r.unattributed.length) {
        <section class="card mt-6">
          <div class="card-head">
            <h2 class="text-lg font-bold text-ink-900">{{ 'WH.LEAK.UNATTRIBUTED' | translate }}</h2>
            <p class="text-sm text-ink-500">{{ 'WH.LEAK.UNATTRIBUTED_HINT' | translate }}</p>
          </div>
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th>{{ 'WH.LEAK.ITEM' | translate }}</th>
                <th>{{ 'WH.LEAK.SOURCE' | translate }}</th>
                <th class="text-end">{{ 'WH.LEAK.QUANTITY' | translate }}</th>
                <th class="text-end">{{ 'WH.LEAK.COST' | translate }}</th>
              </tr></thead>
              <tbody>
                @for (u of r.unattributed; track $index) {
                  <tr>
                    <td>{{ u.itemName }}</td>
                    <td class="text-ink-500">{{ u.sourceType }}</td>
                    <td class="text-end tabular-nums">{{ u.quantity | num }} {{ u.unitOfMeasure }}</td>
                    <td class="text-end tabular-nums">{{ u.cost | money }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div></div>
        </section>
      }
    } @else if (report.loading()) {
      <p class="px-5 py-10 text-center text-sm text-ink-500">{{ 'COMMON.LOADING' | translate }}</p>
    }
  `,
})
export class LeakageReportComponent {
  private readonly api = inject(WarehouseInsightsApi);

  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] =
    ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly period = signal<Period>(periodFor('month'));
  protected readonly report = loadable<LeakageReport | null>(null);
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly kpis = computed(() => {
    const r = this.report.data();
    if (!r) {
      return [];
    }
    return [
      { key: 'WH.LEAK.KPI.UNEXPLAINED', hint: 'WH.LEAK.KPI.UNEXPLAINED_HINT', value: money(r.totalUnexplainedCost), alarm: r.totalUnexplainedCost > 0 },
      { key: 'WH.LEAK.KPI.EXPLAINED', hint: 'WH.LEAK.KPI.EXPLAINED_HINT', value: money(r.totalExplainedCost), alarm: false },
      { key: 'WH.LEAK.KPI.RETREATMENT', hint: 'WH.LEAK.KPI.RETREATMENT_HINT', value: money(r.totalRetreatmentCost), alarm: false },
      { key: 'WH.LEAK.KPI.UNATTRIBUTED', hint: 'WH.LEAK.KPI.UNATTRIBUTED_HINT', value: money(r.totalUnattributedCost), alarm: false },
      { key: 'WH.LEAK.KPI.COVERAGE', hint: 'WH.LEAK.KPI.COVERAGE_HINT', value: `${r.attributionCoveragePct}%`, alarm: r.attributionCoveragePct < 80 },
    ];
  });

  constructor() {
    void this.reload();
  }

  protected onPeriod(p: Period): void {
    this.period.set(p);
    void this.reload();
  }

  private async reload(): Promise<void> {
    const p = this.period();
    await this.report.load(() => this.api.leakage(p.from, p.to));
  }

  protected toggle(id: string): void {
    this.open.update(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  protected isOpen(id: string): boolean {
    return this.open().has(id);
  }
}

/** Whole dirhams: a leakage figure to the centime invites an argument about the centime. */
function money(v: number | null | undefined): string {
  return `${Math.round(v ?? 0).toLocaleString('fr-MA')} DH`;
}
