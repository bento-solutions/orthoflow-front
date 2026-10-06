import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NavCounts } from '../../core/services/nav-counts.service';
import { PermissionService } from '../../core/services/permission.service';

/** Messages to patients: what was sent, what came back on WhatsApp, the wording, and when reminders go out. */
@Component({
  selector: 'app-communication-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'NAV.COMMUNICATION' | translate }}</h1>
        <p class="page-sub">{{ 'COM.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6" role="tablist" [attr.aria-label]="'NAV.COMMUNICATION' | translate">
      @for (tab of tabs; track tab.path) {
        <a class="tab whitespace-nowrap" role="tab" [routerLink]="tab.path" routerLinkActive="is-active" #rla="routerLinkActive" [attr.aria-selected]="rla.isActive">
          {{ tab.key | translate }}
          @if (tab.path === 'inbox' && counts.inbox() > 0) { <span class="ms-1.5 rounded-full bg-critical-500 px-1.5 text-2xs font-bold leading-4 text-white">{{ counts.inbox() }}</span> }
        </a>
      }
    </nav>
    <router-outlet />
  `,
})
export class CommunicationLayoutComponent {
  protected readonly counts = inject(NavCounts);
  private readonly permissions = inject(PermissionService);
  protected readonly tabs = [
    { path: 'logs', key: 'COM.TABS.LOGS' },
    { path: 'inbox', key: 'COM.TABS.INBOX' },
    { path: 'templates', key: 'COM.TABS.TEMPLATES' },
    { path: 'settings', key: 'COM.TABS.SETTINGS' },
  ];
  protected readonly canView = computed(() => this.permissions.can('MESSAGING_VIEW'));
}
