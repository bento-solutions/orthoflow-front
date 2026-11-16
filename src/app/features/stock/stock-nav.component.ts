import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Stock's sections, as the product's one tab style (underline). It replaces the pill bar each stock
 * page carried a copy of; the views inside a page are a segmented control, so the two levels never
 * look alike (UI V2 audit M5).
 */
@Component({
  selector: 'app-stock-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslateModule],
  template: `
    <nav class="tabs" [attr.aria-label]="'COMMON.STOCK' | translate">
      @for (link of links; track link.path) {
        <a class="tab" [routerLink]="link.path" routerLinkActive="is-active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }">{{ link.key | translate }}</a>
      }
    </nav>
  `,
})
export class StockNavComponent {
  protected readonly links = [
    { path: '/stock', key: 'STOCK.CATALOG' },
    { path: '/stock/procurement', key: 'STOCK.PROCUREMENT' },
    { path: '/stock/direct-sales', key: 'STOCK.SALES' },
    { path: '/stock/treatment-sessions', key: 'STOCK.TREATMENT_SESSIONS' },
    { path: '/stock/leakage', key: 'STOCK.LEAKAGE' },
    { path: '/stock/forecast', key: 'STOCK.FORECAST' },
  ];
}
