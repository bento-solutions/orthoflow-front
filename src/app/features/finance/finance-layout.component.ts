import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PermissionService } from '../../core/services/permission.service';
import { FINANCE_TABS } from './finance-tabs';

@Component({
  selector: 'app-finance-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'NAV.FINANCE' | translate }}</h1>
        <p class="page-sub">{{ 'FIN.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6 overflow-x-auto" data-tour="finance-tabs" role="tablist" [attr.aria-label]="'NAV.FINANCE' | translate">
      @for (tab of visible(); track tab.path) {
        <a class="tab whitespace-nowrap" role="tab" [routerLink]="tab.path" routerLinkActive="is-active" #rla="routerLinkActive" [attr.aria-selected]="rla.isActive">{{ tab.key | translate }}</a>
      }
    </nav>
    <router-outlet />
  `,
})
export class FinanceLayoutComponent {
  private readonly permissions = inject(PermissionService);
  protected readonly visible = computed(() => FINANCE_TABS.filter(t => this.permissions.can(...t.permission)));
}
