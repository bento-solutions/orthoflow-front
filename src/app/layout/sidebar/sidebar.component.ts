import { Component, signal, inject, computed, input, DestroyRef } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { TranslateModule } from '@ngx-translate/core';
import { CabinetService } from '../../core/services/cabinet.service';
import { IconComponent, IconName } from '../../shared/ui/icon.component';
import { Permission } from '../../core/models/permission';
import { PermissionService } from '../../core/services/permission.service';
import { NavCounts } from '../../core/services/nav-counts.service';

const MORE_KEY = 'orthoflow_nav_more';
function readMoreOpen(): boolean {
  try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; }
}

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
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, TranslateModule, IconComponent],
  template: `
    <nav
      class="sidebar on-inverse sticky top-0 z-20 flex h-screen flex-col bg-petrol-900"
      [class.sidebar-collapsed]="isCollapsed()"
      [attr.aria-label]="'NAV.MAIN' | translate"
    >
      <!-- Brand -->
      <div class="flex h-16 shrink-0 items-center gap-3 overflow-hidden border-b border-white/10 px-4">
        <div
          aria-hidden="true"
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
      <div
        class="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
        data-tour="nav"
      >
        <!-- What this person does every day, in the order they do it (P2-8). -->
        <p class="nav-section" id="nav-group-daily" [class.sr-only]="isCollapsed()">{{ 'NAV.DAILY' | translate }}</p>
        <ul class="space-y-0.5" role="list" aria-labelledby="nav-group-daily">
          @for (item of primaryItems(); track item.path) {
            <li><ng-container *ngTemplateOutlet="link; context: { $implicit: item }" /></li>
          }
        </ul>

        <!-- Everything else, a press away; open by itself when the current screen is in it. -->
        @if (moreGroups().length) {
          <button type="button" class="nav-link mt-3 w-full" (click)="toggleMore()" [attr.aria-expanded]="moreShown()" aria-controls="nav-more"
                  [title]="isCollapsed() ? ('NAV.MORE' | translate) : ''">
            <app-icon name="more" [size]="18" />
            <span class="truncate" [class.opacity-0]="isCollapsed()">{{ 'NAV.MORE' | translate }}</span>
            <app-icon [name]="moreShown() ? 'chevron-up' : 'chevron-down'" [size]="14" class="ms-auto" [class.hidden]="isCollapsed()" />
          </button>
          @if (moreShown()) {
            <div id="nav-more">
              @for (group of moreGroups(); track group.key) {
                <p class="nav-section" [id]="'nav-group-' + $index" [class.sr-only]="isCollapsed()">{{ group.key | translate }}</p>
                <ul class="space-y-0.5" role="list" [attr.aria-labelledby]="'nav-group-' + $index">
                  @for (item of group.items; track item.path) {
                    <li><ng-container *ngTemplateOutlet="link; context: { $implicit: item }" /></li>
                  }
                </ul>
              }
            </div>
          }
        }

        <ng-template #link let-item>
          <a
            [routerLink]="item.path"
            routerLinkActive="nav-link-active"
            ariaCurrentWhenActive="page"
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
              <span class="nav-badge">{{ n > 99 ? '99+' : n }}</span>
            }
          </a>
        </ng-template>
      </div>

      <!-- Collapse (not in the drawer, which is always full width) -->
      @if (!drawer()) {
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
      }
    </nav>
  `,
})
export class SidebarComponent {
  /** Out as the drawer on a narrow screen: always full width there. */
  readonly drawer = input(false);
  /** The person's own choice, which wins over the width until the next reload. */
  private readonly userCollapsed = signal<boolean | null>(null);
  /** Under 1280 px the rail shows icons only, unless the person opened it. */
  private readonly narrow = signal(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1279.98px)').matches);
  readonly isCollapsed = computed(() => !this.drawer() && (this.userCollapsed() ?? this.narrow()));

  constructor() {
    const query = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 1279.98px)') : undefined;
    if (!query) return;
    const listener = (e: MediaQueryListEvent) => { this.narrow.set(e.matches); this.userCollapsed.set(null); };
    query.addEventListener?.('change', listener);
    inject(DestroyRef).onDestroy(() => query.removeEventListener?.('change', listener));
  }
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
        { key: 'NAV.PRESCRIPTION_TEMPLATES', path: '/prescription-templates', icon: 'file-text', permission: ['CLINICAL_WRITE'] },
      ],
    },
    {
      key: 'NAV.PRACTICE',
      items: [
        { key: 'COMMON.BILLING', path: '/billing', icon: 'receipt', permission: ['BILLING_READ'] },
        { key: 'NAV.INSURANCE_FORMS', path: '/insurance-forms', icon: 'shield', permission: ['BILLING_READ'] },
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

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** The destinations each role uses every day, in that order; the rest go under More (P2-8). */
  private static readonly DAILY: Readonly<Record<string, readonly string[]>> = {
    ASSISTANT: ['/', '/schedule', '/front-desk', '/patients', '/billing'],
    DOCTOR: ['/', '/patients', '/schedule', '/treatments'],
    ADMIN: ['/', '/patients', '/schedule', '/treatments', '/billing'],
  };

  readonly primaryItems = computed(() => {
    const daily = SidebarComponent.DAILY[this.auth.currentUser()?.role ?? 'DOCTOR'] ?? SidebarComponent.DAILY['DOCTOR'];
    const all = this.visibleGroups().flatMap(g => g.items);
    return daily.map(path => all.find(item => item.path === path)).filter((item): item is NavItem => !!item);
  });

  readonly moreGroups = computed(() => {
    const primary = new Set(this.primaryItems().map(item => item.path));
    return this.visibleGroups()
      .map(group => ({ ...group, items: group.items.filter(item => !primary.has(item.path)) }))
      .filter(group => group.items.length > 0);
  });

  private readonly url = toSignal(this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map(e => e.urlAfterRedirects),
  ), { initialValue: this.router.url });

  private readonly moreOpen = signal(readMoreOpen());
  /** Open when asked, or when the screen on show is one of its entries. */
  readonly moreShown = computed(() => this.moreOpen() || this.moreGroups().some(g => g.items.some(item =>
    item.path !== '/' && (this.url() ?? '').split(/[?#]/)[0].startsWith(item.path))));

  toggleMore(): void {
    const next = !this.moreShown();
    this.moreOpen.set(next);
    try { localStorage.setItem(MORE_KEY, next ? '1' : '0'); } catch { /* storage blocked: it stays for this visit */ }
  }

  toggleCollapse(): void {
    this.userCollapsed.set(!this.isCollapsed());
  }
}
