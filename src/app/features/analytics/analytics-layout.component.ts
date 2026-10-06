import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PermissionService } from '../../core/services/permission.service';
import { ANALYTICS_TABS } from './analytics-tabs';

/** Reports on how the practice is doing: what is done and earned per procedure, how long doctors take, the yearly income statement and the revenue goal. */
@Component({
  selector: 'app-analytics-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'COMMON.ANALYTICS' | translate }}</h1>
        <p class="page-sub">{{ 'ANA.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6 overflow-x-auto" role="tablist" [attr.aria-label]="'COMMON.ANALYTICS' | translate">
      @for (tab of visible(); track tab.path) {
        <a class="tab whitespace-nowrap" role="tab" [routerLink]="tab.path" routerLinkActive="is-active" #rla="routerLinkActive" [attr.aria-selected]="rla.isActive">{{ tab.key | translate }}</a>
      }
    </nav>
    <router-outlet />
  `,
})
export class AnalyticsLayoutComponent {
  private readonly permissions = inject(PermissionService);
  protected readonly visible = computed(() => ANALYTICS_TABS.filter(t => this.permissions.can(...t.permission)));
}
