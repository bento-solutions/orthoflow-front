import { Component, Output, EventEmitter, inject, computed } from '@angular/core';
import { Router, NavigationEnd, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { CommandRegistryService } from '../../core/services/command-registry.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { HelpPanelService } from '../../core/services/help-panel.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from './notification-bell.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { NavCounts } from '../../core/services/nav-counts.service';

/* Route prefix → section label. Longest prefix wins, so `/patients/12`
   still resolves to Patients. */
const SECTION_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['/patients', 'COMMON.PATIENTS'],
  ['/recalls', 'NAV.RECALLS'],
  ['/schedule', 'COMMON.SCHEDULE'],
  ['/front-desk', 'NAV.FRONT_DESK'],
  ['/billing', 'COMMON.BILLING'],
  ['/finance', 'NAV.FINANCE'],
  ['/retrocessions', 'NAV.RETROCESSIONS'],
  ['/lab-orders', 'NAV.LAB_ORDERS'],
  ['/sterilization', 'NAV.STERILIZATION'],
  ['/tasks', 'NAV.TASKS'],
  ['/messages', 'NAV.MESSAGES'],
  ['/communication', 'NAV.COMMUNICATION'],
  ['/booking', 'NAV.BOOKING'],
  ['/surveys', 'NAV.SURVEYS'],
  ['/stock', 'COMMON.STOCK'],
  ['/treatments', 'COMMON.TREATMENTS'],
  ['/analytics', 'COMMON.ANALYTICS'],
  ['/settings', 'COMMON.SETTINGS'],
  ['/account', 'NAV.ACCOUNT'],
];

/**
 * Application header.
 *
 * The section label is derived from the router. It was previously a static
 * `@Input` defaulted to "DASHBOARD" that `main-layout` never set, so every
 * screen in the product — Patients, Billing, Stock — was captioned
 * "DASHBOARD" (audit VIII.8).
 *
 * With navigation living in the rail, the header's job is context and
 * account: where am I, how do I search, who am I signed in as.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [TranslateModule, IconComponent, NotificationBellComponent, RouterLink, CanDirective],
  template: `
    <header
      class="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-ink-100 bg-surface/85 px-4 backdrop-blur-md md:px-6"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          (click)="menuToggle.emit()"
          class="btn btn-ghost btn-icon md:hidden"
          [attr.aria-label]="'NAV.MAIN' | translate"
        >
          <app-icon name="menu" [size]="20" />
        </button>

        <div class="min-w-0">
          <h1 class="truncate text-lg font-bold leading-tight tracking-[-0.014em] text-ink-900">
            {{ sectionTitle() | translate }}
          </h1>
          <p class="truncate text-xs font-medium text-ink-500">{{ today() }}</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <!-- Search is the command palette's affordance. Showing the shortcut
             on the control is how the shortcut gets learned. -->
        <button
          type="button"
          (click)="commandRegistry.open()"
          data-tour="search"
          class="hidden items-center gap-2 rounded-md border border-ink-200 bg-app-bg px-2.5 py-1.5 text-sm text-ink-500 transition-colors duration-1 ease-out hover:border-ink-300 hover:text-ink-900 lg:flex"
          [attr.aria-label]="'COMMON.OPEN_SEARCH' | translate"
        >
          <app-icon name="search" [size]="15" />
          <span class="pe-6">{{ 'COMMON.SEARCH' | translate }}</span>
          <kbd class="kbd">⌘K</kbd>
        </button>

        <button
          type="button"
          (click)="commandRegistry.open()"
          class="btn btn-ghost btn-icon lg:hidden"
          [attr.aria-label]="'COMMON.OPEN_SEARCH' | translate"
        >
          <app-icon name="search" [size]="18" />
        </button>

        <button type="button" class="btn btn-ghost btn-icon" data-tour="theme" (click)="theme.toggle()" [attr.aria-label]="'COMMON.TOGGLE_THEME' | translate" [title]="'COMMON.TOGGLE_THEME' | translate">
          <app-icon [name]="theme.effective() === 'dark' ? 'sun' : 'moon'" [size]="18" />
        </button>
        <button type="button" class="btn btn-ghost btn-icon" (click)="help.toggle()" [attr.aria-label]="'COMMON.HELP' | translate" [title]="'COMMON.HELP' | translate"
          data-tour="help">
          <app-icon name="help-circle" [size]="18" />
        </button>
        <a *appCan="'TASKS_MANAGE'" routerLink="/tasks" class="btn btn-ghost btn-icon relative" [title]="'NAV.TASKS' | translate"
          [attr.aria-label]="('NAV.TASKS' | translate) + (counts.tasksDue() ? ' (' + counts.tasksDue() + ')' : '')">
          <app-icon name="clipboard" [size]="18" />
          @if (counts.tasksDue() > 0) {
            <span class="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-4 text-white"
              [class.bg-critical-500]="counts.tasks().overdue > 0" [class.bg-petrol-600]="counts.tasks().overdue === 0">{{ counts.tasksDue() > 9 ? '9+' : counts.tasksDue() }}</span>
          }
        </a>
        <app-notification-bell data-tour="bell" />

        <div class="mx-1 hidden h-6 w-px bg-ink-200 sm:block"></div>

        <!-- Account -->
        <a routerLink="/account" class="flex items-center gap-2.5 rounded-md py-0.5 pe-1 hover:bg-ink-50" [attr.aria-label]="'NAV.ACCOUNT' | translate">
          <div
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-petrol-100 text-xs font-bold text-petrol-700"
            aria-hidden="true"
          >
            {{ initials() }}
          </div>
          <div class="hidden min-w-0 leading-tight sm:block">
            <p class="truncate text-sm font-bold text-ink-900">{{ displayName() }}</p>
            @if (roleLabel(); as role) {
              <p class="truncate text-2xs font-semibold uppercase tracking-wider text-ink-500">{{ role }}</p>
            }
          </div>
        </a>
        <div class="flex items-center">
          <button
            type="button"
            (click)="logout()"
            class="btn btn-ghost btn-icon"
            [attr.aria-label]="'COMMON.LOGOUT' | translate"
            [title]="'COMMON.LOGOUT' | translate"
          >
            <app-icon name="log-out" [size]="18" />
          </button>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent {
  @Output() menuToggle = new EventEmitter<void>();

  private auth = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  readonly commandRegistry = inject(CommandRegistryService);
  readonly theme = inject(ThemeService);
  readonly help = inject(HelpPanelService);
  readonly counts = inject(NavCounts);

  /** Current section, tracked from the router rather than passed in. */
  readonly sectionTitle = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
      map((url) => SECTION_TITLES.find(([prefix]) => url.startsWith(prefix))?.[1] ?? 'COMMON.OVERVIEW'),
    ),
    { initialValue: 'COMMON.OVERVIEW' },
  );

  readonly displayName = computed(() => {
    const user = this.auth.currentUser();
    return user ? `${user.firstName} ${user.lastName}`.trim() : this.translate.instant('COMMON.WELCOME');
  });

  readonly initials = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return '—';
    return `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '—';
  });

  readonly roleLabel = computed(() => this.auth.currentUser()?.role ?? '');

  /* Formatted in the active locale — the product ships fr/en/ar and a
     hardcoded en-US date would be wrong in two of the three.
     `currentLang` is a plain property, not a signal, so the language has to
     be tracked through onLangChange or the date stays in the previous
     locale until the next full reload. */
  private readonly lang = toSignal(
    this.translate.onLangChange.pipe(map((e) => e.lang)),
    { initialValue: this.translate.currentLang || this.translate.getDefaultLang() || 'fr' },
  );

  readonly today = computed(() =>
    new Intl.DateTimeFormat(this.lang(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date()),
  );

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
