import { Component, signal, inject, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CabinetService } from '../../core/services/cabinet.service';
import { IconComponent, IconName } from '../../shared/ui/icon.component';
import { Permission } from '../../core/models/permission';
import { PermissionService } from '../../core/services/permission.service';
import { NavCounts } from '../../core/services/nav-counts.service';

interface NavItem {
  key: string;
  path: string;
  icon: IconName;
  exact?: boolean;
  /** Shown only to someone holding at least one of these. No list means everyone. */
  permission?: Permission[];
  /** Which small count to show beside the label. */
  badge?: 'tasks' | 'messages' | 'inbox' | 'intake';
}

/**
 * Primary navigation.
 *
 * The rail is dark (petrol-900) against light content. That does three
 * things a white-on-white sidebar cannot: it separates chrome from data at
 * a glance, it carries the brand on every screen without a logo lockup
 * shouting on each page, and it makes the dark 3D odontogram panel read as
 * part of the visual language rather than an intrusion.
 *
 * The eight destinations are grouped rather than listed flat. A flat list
 * of eight makes the user read all eight labels to find one; grouping by
 * what they are doing — clinical work vs. running the practice — means they
 * read one heading and then three items.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslateModule, IconComponent],
  template: `
    <aside
      class="sidebar on-inverse sticky top-0 z-20 flex h-screen flex-col bg-petrol-900"
      [class.sidebar-collapsed]="isCollapsed()"
    >
      <!-- Brand -->
      <div class="flex h-16 shrink-0 items-center gap-3 overflow-hidden border-b border-white/10 px-4">
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-petrol-600 text-base font-extrabold text-white ring-1 ring-white/15"
        >
          @if (cabinet.cabinetInfo()?.logoUrl) {
            <img [src]="cabinet.cabinetInfo()?.logoUrl" alt="" class="h-full w-full bg-white object-contain" />
          } @else {
            {{ initial() }}
          }
        </div>
        <div
          class="min-w-0 transition-[opacity,transform] duration-3 ease-out"
          [class.opacity-0]="isCollapsed()"
          [class.-translate-x-2]="isCollapsed()"
        >
          <p class="truncate text-base font-bold leading-tight text-white">
            {{ cabinet.cabinetInfo()?.name || 'OrthoFlow' }}
          </p>
          <p class="truncate text-2xs font-bold uppercase tracking-[0.08em] text-petrol-300">
            {{ 'NAV.PRACTICE_LABEL' | translate }}
          </p>
        </div>
      </div>

      <!-- Navigation -->
      <nav
        class="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
        data-tour="nav"
        [attr.aria-label]="'NAV.MAIN' | translate"
      >
        @for (group of visibleGroups(); track group.key) {
          <p class="nav-section" [class.sr-only]="isCollapsed()">{{ group.key | translate }}</p>
          <ul class="space-y-0.5">
            @for (item of group.items; track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  routerLinkActive="nav-link-active"
                  [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
                  class="nav-link"
                  [title]="isCollapsed() ? (item.key | translate) : ''"
                >
                  <app-icon [name]="item.icon" [size]="18" />
                  <span
                    class="truncate transition-[opacity,transform] duration-3 ease-out"
                    [class.opacity-0]="isCollapsed()"
                    [class.-translate-x-2]="isCollapsed()"
                  >{{ item.key | translate }}</span>
                  @if (count(item.badge); as n) {
                    <span class="nav-badge" [attr.aria-label]="n + ''">{{ n > 99 ? '99+' : n }}</span>
                  }
                </a>
              </li>
            }
          </ul>
        }
      </nav>

      <!-- Collapse -->
      <div class="shrink-0 border-t border-white/10 p-2">
        <button
          type="button"
          (click)="toggleCollapse()"
          class="nav-link w-full justify-center"
          [attr.aria-label]="(isCollapsed() ? 'COMMON.EXPAND_SIDEBAR' : 'COMMON.COLLAPSE_SIDEBAR') | translate"
          [attr.aria-pressed]="isCollapsed()"
        >
          <span
            class="inline-flex transition-transform duration-4 ease-in-out"
            [class.rotate-180]="isCollapsed()"
          >
            <app-icon name="chevrons-left" [size]="18" />
          </span>
        </button>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  readonly isCollapsed = signal(false);
  readonly cabinet = inject(CabinetService);
  private readonly permissions = inject(PermissionService);
  private readonly counts = inject(NavCounts);

  protected count(badge: NavItem['badge']): number {
    return badge === 'tasks' ? this.counts.tasksDue() : badge === 'messages' ? this.counts.messages() : badge === 'inbox' ? this.counts.inbox() : badge === 'intake' ? this.counts.intakeTotal() : 0;
  }

  readonly initial = computed(() => {
    const name = this.cabinet.cabinetInfo()?.name?.trim();
    return name ? name.charAt(0).toUpperCase() : 'O';
  });

  readonly navGroups: { key: string; items: NavItem[] }[] = [
    {
      key: 'NAV.CLINICAL',
      items: [
        { key: 'COMMON.OVERVIEW', path: '/', icon: 'grid', exact: true },
        { key: 'COMMON.PATIENTS', path: '/patients', icon: 'users', permission: ['PATIENT_READ'] },
        { key: 'COMMON.SCHEDULE', path: '/schedule', icon: 'calendar', permission: ['AGENDA_VIEW'] },
        { key: 'NAV.FRONT_DESK', path: '/front-desk', icon: 'clock', permission: ['AGENDA_VIEW', 'WAITING_ROOM_MANAGE'] },
        { key: 'NAV.RECALLS', path: '/recalls', icon: 'phone', permission: ['AGENDA_VIEW'] },
        { key: 'COMMON.TREATMENTS', path: '/treatments', icon: 'activity' },
        { key: 'NAV.LAB_ORDERS', path: '/lab-orders', icon: 'flask', permission: ['LAB_ORDERS_MANAGE'] },
        { key: 'NAV.STERILIZATION', path: '/sterilization', icon: 'shield', permission: ['STERILIZATION_MANAGE'] },
        { key: 'NAV.TASKS', path: '/tasks', icon: 'clipboard', permission: ['TASKS_MANAGE'], badge: 'tasks' },
      ],
    },
    {
      key: 'NAV.PRACTICE',
      items: [
        { key: 'COMMON.BILLING', path: '/billing', icon: 'receipt', permission: ['BILLING_READ'] },
        { key: 'NAV.FINANCE', path: '/finance', icon: 'wallet', permission: ['FINANCE_VIEW', 'BILLING_READ'] },
        { key: 'NAV.RETROCESSIONS', path: '/retrocessions', icon: 'percent', permission: ['RETROCESSION_VIEW'] },
        { key: 'COMMON.STOCK', path: '/stock', icon: 'box', permission: ['STOCK_READ'] },
        { key: 'COMMON.ANALYTICS', path: '/analytics', icon: 'chart', permission: ['ANALYTICS_VIEW', 'FINANCE_VIEW'] },
      ],
    },
    {
      key: 'NAV.COMMUNICATION',
      items: [
        { key: 'NAV.MESSAGES', path: '/messages', icon: 'message', badge: 'messages' },
        { key: 'NAV.COMMUNICATION', path: '/communication', icon: 'send', permission: ['MESSAGING_VIEW'], badge: 'inbox' },
        { key: 'NAV.BOOKING', path: '/booking', icon: 'inbox', permission: ['BOOKING_REVIEW'], badge: 'intake' },
        { key: 'NAV.SURVEYS', path: '/surveys', icon: 'check-circle', permission: ['SURVEYS_VIEW'] },
      ],
    },
    {
      key: 'NAV.SYSTEM',
      items: [
        { key: 'COMMON.SETTINGS', path: '/settings', icon: 'settings', permission: ['SETTINGS_MANAGE', 'USERS_MANAGE'] },
        { key: 'NAV.ACCOUNT', path: '/account', icon: 'user' },
      ],
    },
  ];

  /** The groups this person may see, with empty ones dropped so no heading hangs over nothing. */
  readonly visibleGroups = computed(() =>
    this.navGroups
      .map(group => ({ ...group, items: group.items.filter(item => this.permissions.can(...(item.permission ?? []))) }))
      .filter(group => group.items.length > 0),
  );

  toggleCollapse(): void {
    this.isCollapsed.set(!this.isCollapsed());
  }
}
