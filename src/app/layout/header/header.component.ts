import { Component, Input, Output, EventEmitter, inject, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { CommandRegistryService } from '../../core/services/command-registry.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { HelpPanelService } from '../../core/services/help-panel.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from './notification-bell.component';
import { BreadcrumbsComponent } from '../breadcrumbs/breadcrumbs.component';
import { CanDirective } from '../../shared/directives/can.directive';
import { NavCounts } from '../../core/services/nav-counts.service';

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
  imports: [TranslateModule, IconComponent, NotificationBellComponent, BreadcrumbsComponent, RouterLink, CanDirective],
  template: `
    <header
      class="z-20 flex h-16 flex-nowrap items-center justify-between gap-x-3 border-b border-ink-100 bg-surface/85 px-4 backdrop-blur-md md:sticky md:top-0 md:gap-x-4 md:px-6"
    >
      <!-- One row at every width: the trail truncates, the search folds to an icon under 1280 px
           and the date goes under 1024 px, rather than the bar wrapping and clipping (P0-6). -->
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          (click)="menuToggle.emit()"
          class="btn btn-ghost btn-icon shrink-0 lg:hidden"
          data-menu-toggle
          [attr.aria-label]="'NAV.MAIN' | translate"
          [attr.aria-expanded]="menuOpen"
        >
          <app-icon name="menu" [size]="20" />
        </button>

        <div class="min-w-0">
          <!-- Where this screen is. Screens carry no title of their own: this trail is it. -->
          <app-breadcrumbs />
          <p class="hidden truncate text-xs font-medium text-ink-500 lg:block">{{ today() }}</p>
        </div>
      </div>

      <div class="flex shrink-0 flex-nowrap items-center gap-1 sm:gap-2">
        <!-- Search is the command palette's affordance. Showing the shortcut
             on the control is how the shortcut gets learned. -->
        <button
          type="button"
          (click)="commandRegistry.open()"
          data-tour="search"
          class="hidden items-center gap-2 rounded-md border border-ink-200 bg-app-bg px-2.5 py-1.5 text-sm text-ink-500 transition-colors duration-1 ease-out hover:border-ink-300 hover:text-ink-900 xl:flex"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <app-icon name="search" [size]="15" />
          <span class="pe-6">{{ 'COMMON.SEARCH' | translate }}</span>
          <kbd class="kbd" aria-hidden="true">{{ shortcut }}</kbd>
        </button>

        <button
          type="button"
          (click)="commandRegistry.open()"
          class="btn btn-ghost btn-icon xl:hidden"
          [attr.aria-label]="'COMMON.OPEN_SEARCH' | translate"
        >
          <app-icon name="search" [size]="18" />
        </button>

        <button type="button" class="btn btn-ghost btn-icon hidden sm:inline-flex" data-tour="theme" (click)="theme.toggle()" [attr.aria-label]="'COMMON.TOGGLE_THEME' | translate" [title]="'COMMON.TOGGLE_THEME' | translate">
          <app-icon [name]="theme.effective() === 'dark' ? 'sun' : 'moon'" [size]="18" />
        </button>
        <button type="button" class="btn btn-ghost btn-icon hidden sm:inline-flex" (click)="help.toggle()" [attr.aria-label]="'COMMON.HELP' | translate" [title]="'COMMON.HELP' | translate"
          data-tour="help">
          <app-icon name="help-circle" [size]="18" />
        </button>
        <a *appCan="'TASKS_MANAGE'" routerLink="/tasks" class="btn btn-ghost btn-icon relative" [title]="'NAV.TASKS' | translate"
          [attr.aria-label]="('NAV.TASKS' | translate) + (counts.tasksDue() ? ' (' + counts.tasksDue() + ')' : '')">
          <app-icon name="clipboard" [size]="18" />
          @if (counts.tasksDue() > 0) {
            <span class="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-xs font-bold leading-4 text-white"
              [class.bg-critical-500]="counts.tasks().overdue > 0" [class.bg-petrol-600]="counts.tasks().overdue === 0">{{ counts.tasksDue() > 9 ? '9+' : counts.tasksDue() }}</span>
          }
        </a>
        <app-notification-bell data-tour="bell" />

        <div class="mx-1 hidden h-6 w-px bg-ink-200 sm:block"></div>

        <!-- Account -->
        <a routerLink="/account" class="flex items-center gap-2.5 rounded-md py-0.5 pe-1 hover:bg-ink-50">
          <span class="sr-only">{{ 'NAV.ACCOUNT' | translate }}</span>
          <div
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-petrol-100 text-xs font-bold text-petrol-700"
            aria-hidden="true"
          >
            {{ initials() }}
          </div>
          <div class="hidden min-w-0 leading-tight sm:block">
            <p class="truncate text-sm font-bold text-ink-900">{{ displayName() }}</p>
            @if (roleLabel(); as role) {
              <!-- The role in the person's language, not the server's code (UI V2 audit M5). -->
              <p class="truncate text-2xs font-semibold uppercase tracking-wider text-ink-500">{{ ('SET.USERS.ROLES.' + role) | translate }}</p>
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
  /** Whether the navigation drawer is out, on a screen small enough to have one. */
  @Input() menuOpen = false;
  @Output() menuToggle = new EventEmitter<void>();

  private auth = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  readonly commandRegistry = inject(CommandRegistryService);
  readonly theme = inject(ThemeService);
  readonly help = inject(HelpPanelService);
  readonly counts = inject(NavCounts);
  /** ⌘K on a Mac, iPhone or iPad; Ctrl K everywhere else (UI V2 audit L3). */
  readonly shortcut = /Mac|iPhone|iPad|iPod/i.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '') ? '⌘K' : 'Ctrl K';

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
