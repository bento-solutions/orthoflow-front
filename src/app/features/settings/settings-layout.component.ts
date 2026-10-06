import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Permission } from '../../core/models/permission';
import { PermissionService } from '../../core/services/permission.service';

interface Tab {
  path: string;
  key: string;
  permission: Permission[];
}

const TABS: Tab[] = [
  { path: 'practice', key: 'SET.TABS.PRACTICE', permission: ['SETTINGS_MANAGE'] },
  { path: 'hours', key: 'SET.TABS.HOURS', permission: ['SETTINGS_MANAGE'] },
  { path: 'team', key: 'SET.TABS.TEAM', permission: ['SETTINGS_MANAGE'] },
  { path: 'users', key: 'SET.TABS.USERS', permission: ['USERS_MANAGE'] },
  { path: 'booking', key: 'SET.TABS.BOOKING', permission: ['SETTINGS_MANAGE'] },
  { path: 'help-notes', key: 'SET.TABS.HELP', permission: ['SETTINGS_MANAGE'] },
];

/** The frame around the settings pages: a heading and the tabs this person may open. */
@Component({
  selector: 'app-settings-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'COMMON.SETTINGS' | translate }}</h1>
        <p class="page-sub">{{ 'SETTINGS.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6" role="tablist" [attr.aria-label]="'COMMON.SETTINGS' | translate">
      @for (tab of visible(); track tab.path) {
        <a class="tab" role="tab" [routerLink]="tab.path" routerLinkActive="is-active" #rla="routerLinkActive" [attr.aria-selected]="rla.isActive">{{ tab.key | translate }}</a>
      }
    </nav>
    <router-outlet />
  `,
})
export class SettingsLayoutComponent {
  private readonly permissions = inject(PermissionService);
  protected readonly visible = computed(() => TABS.filter(t => this.permissions.can(...t.permission)));
}
