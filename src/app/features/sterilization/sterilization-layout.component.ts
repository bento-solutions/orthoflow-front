import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/** Sterilization traceability: what is clean, what was used on whom, what went through the autoclave and how the control came out. */
@Component({
  selector: 'app-sterilization-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'NAV.STERILIZATION' | translate }}</h1>
        <p class="page-sub">{{ 'STER.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6 overflow-x-auto" role="tablist" [attr.aria-label]="'NAV.STERILIZATION' | translate">
      @for (tab of tabs; track tab.path) {
        <a class="tab whitespace-nowrap" role="tab" [routerLink]="tab.path" routerLinkActive="is-active" #rla="routerLinkActive" [attr.aria-selected]="rla.isActive">{{ tab.key | translate }}</a>
      }
    </nav>
    <router-outlet />
  `,
})
export class SterilizationLayoutComponent {
  protected readonly tabs = [
    { path: 'dashboard', key: 'STER.TABS.DASHBOARD' },
    { path: 'scan', key: 'STER.TABS.SCAN' },
    { path: 'items', key: 'STER.TABS.ITEMS' },
    { path: 'cycles', key: 'STER.TABS.CYCLES' },
    { path: 'trace', key: 'STER.TABS.TRACE' },
    { path: 'endo', key: 'STER.TABS.ENDO' },
  ];
}
