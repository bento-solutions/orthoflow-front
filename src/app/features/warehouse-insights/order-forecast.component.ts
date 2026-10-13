import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { loadable } from '../../core/utils/loadable';
import { MoneyPipe, NumPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { OrderForecast, OrderSuggestion, WarehouseInsightsApi } from './warehouse-insights-api.service';

/**
 * What to order next month, with the argument for each number attached.
 *
 * <p>Every line shows its working — the average it started from, the seasonal lean (or
 * why none was applied), the cover held for volatility, and what is already on the
 * shelf. A buying suggestion nobody can argue with is a buying suggestion nobody should
 * follow, so the rationale is part of the row rather than hidden behind a tooltip.
 */
@Component({
  selector: 'app-order-forecast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule, MoneyPipe, NumPipe, IconComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto">
        <span class="label">{{ 'WH.FC.MONTH' | translate }}</span>
        <input type="month" class="input w-auto" [ngModel]="month()" (ngModelChange)="onMonth($event)" />
      </label>
      @if (forecast.data(); as f) {
        <div class="ms-auto text-end">
          <p class="text-2xs font-bold uppercase tracking-wider text-ink-500">{{ 'WH.FC.TOTAL' | translate }}</p>
          <p class="text-2xl font-extrabold tabular-nums text-ink-900">{{ f.totalEstimatedCost | money }}</p>
        </div>
      }
    </div>

    @if (forecast.data(); as f) {
      @if (f.monthsOfHistory < 2) {
        <p class="mb-4 flex items-start gap-2 rounded-lg bg-caution-50 px-3 py-2 text-sm text-caution-800" role="status">
          <app-icon name="info" [size]="16" class="mt-0.5 shrink-0" />
          <span>{{ 'WH.FC.THIN_HISTORY' | translate: { months: f.monthsOfHistory } }}</span>
        </p>
      }

      <section class="card">
        <div class="card-head">
          <h2 class="text-lg font-bold text-ink-900">
            {{ 'WH.FC.TITLE' | translate }}
            <span class="pill pill-active ms-1">{{ f.suggestions.length }}</span>
          </h2>
          <p class="text-sm text-ink-500">{{ 'WH.FC.SUBTITLE' | translate: { months: f.monthsOfHistory } }}</p>
        </div>

        <div class="table-wrap"><div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>{{ 'WH.FC.ITEM' | translate }}</th>
              <th class="text-end">{{ 'WH.FC.ON_HAND' | translate }}</th>
              <th class="text-end">{{ 'WH.FC.DEMAND' | translate }}</th>
              <th class="text-end">{{ 'WH.FC.SEASON' | translate }}</th>
              <th class="text-end">{{ 'WH.FC.SAFETY' | translate }}</th>
              <th class="text-end">{{ 'WH.FC.ORDER' | translate }}</th>
              <th class="text-end">{{ 'WH.FC.COST' | translate }}</th>
              <th>{{ 'WH.FC.SUPPLIER' | translate }}</th>
            </tr></thead>
            <tbody>
              @for (s of f.suggestions; track s.stockItemId) {
                <tr>
                  <td>
                    <p class="font-bold text-ink-900">{{ s.itemName }}</p>
                    <p class="mt-0.5 max-w-xl text-2xs text-ink-500">{{ rationale(s) }}</p>
                  </td>
                  <td class="text-end tabular-nums" [class.text-caution-700]="s.onHand <= s.minimumStock">
                    {{ s.onHand | num }}
                  </td>
                  <td class="text-end tabular-nums">{{ s.forecastDemand | num }}</td>
                  <td class="text-end tabular-nums" [class.text-ink-400]="s.seasonalFactor === 1">
                    ×{{ s.seasonalFactor }}
                  </td>
                  <td class="text-end tabular-nums text-ink-500">{{ s.safetyStock | num }}</td>
                  <td class="text-end font-bold tabular-nums text-ink-900">
                    {{ s.suggestedOrder | num }} <span class="text-2xs font-normal text-ink-500">{{ s.unitOfMeasure }}</span>
                  </td>
                  <td class="text-end tabular-nums">{{ s.estimatedCost | money }}</td>
                  <td class="text-ink-500">{{ s.supplierName || '—' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="py-10 text-center text-sm text-ink-500">{{ 'WH.FC.NOTHING' | translate }}</td></tr>
              }
            </tbody>
          </table>
        </div></div>
      </section>
    } @else if (forecast.loading()) {
      <p class="px-5 py-10 text-center text-sm text-ink-500">{{ 'COMMON.LOADING' | translate }}</p>
    }
  `,
})
export class OrderForecastComponent {
  private readonly api = inject(WarehouseInsightsApi);
  private readonly translate = inject(TranslateService);

  /** Defaults to next month: this one is already being bought for. */
  protected readonly month = signal(nextMonth());
  protected readonly forecast = loadable<OrderForecast | null>(null);

  constructor() {
    void this.reload();
  }

  protected onMonth(value: string): void {
    this.month.set(value);
    void this.reload();
  }

  /**
   * The argument for a line, assembled here rather than on the server: the backend has
   * no idea whether this lands in a French, English or Arabic interface, and a reason
   * nobody can read is a reason nobody can challenge.
   */
  protected rationale(s: OrderSuggestion): string {
    const parts = [
      this.translate.instant('WH.FC.WHY.BASE', { mean: s.meanMonthly, months: s.monthsObserved }),
      s.seasonalFactor === 1
        ? this.translate.instant('WH.FC.WHY.NO_SEASON')
        : this.translate.instant('WH.FC.WHY.SEASON', { pct: Math.round((s.seasonalFactor - 1) * 100) }),
    ];
    if (s.safetyStock > 0) {
      parts.push(this.translate.instant('WH.FC.WHY.SAFETY', { qty: s.safetyStock }));
    }
    parts.push(this.translate.instant('WH.FC.WHY.ON_HAND', { qty: s.onHand }));
    return parts.join(' · ');
  }

  private async reload(): Promise<void> {
    const m = this.month();
    await this.forecast.load(() => this.api.forecast(m ? `${m}-01` : undefined));
  }
}

function nextMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
