import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Carries the stock module's navigation over the two insight screens.
 *
 * <p>Those screens are shared with {@code /analytics}, where this nav would be wrong,
 * so it cannot live inside them. Without it a person who opened the forecast from the
 * stockroom had no way back to the catalogue — the screen rendered fine and was a dead
 * end, which is the kind of thing only clicking it finds.
 *
 * <p>The pills are written out again here because every stock page already writes its
 * own copy; extracting the shared one is worth doing, but not as a side effect of
 * adding a report.
 */
@Component({
  selector: 'app-stock-insights-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'STOCK.TITLE' | translate }}</h1>
      </div>
    </div>

    <div class="mb-6 flex max-w-max flex-wrap gap-2 rounded-xl border border-ortho-navy/5 bg-ortho-navy/[0.03] p-1.5 text-xs font-semibold">
      @for (t of tabs; track t.path) {
        <a
          [routerLink]="t.path"
          [routerLinkActiveOptions]="{ exact: true }"
          routerLinkActive="bg-white text-ink-900 shadow-sm"
          class="rounded-lg px-4 py-2 text-ink-600 transition hover:bg-white/50 hover:text-ink-900"
        >
          {{ t.key | translate }}
        </a>
      }
    </div>

    <router-outlet />
  `,
})
export class StockInsightsLayoutComponent {
  protected readonly tabs = [
    { path: '/stock', key: 'STOCK.CATALOG' },
    { path: '/stock/procurement', key: 'STOCK.PROCUREMENT' },
    { path: '/stock/direct-sales', key: 'STOCK.SALES' },
    { path: '/stock/treatment-sessions', key: 'STOCK.TREATMENT_SESSIONS' },
    { path: '/stock/leakage', key: 'STOCK.LEAKAGE' },
    { path: '/stock/forecast', key: 'STOCK.FORECAST' },
  ];
}
