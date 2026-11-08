import { Component, DestroyRef, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AnnouncerService } from '../../core/services/announcer.service';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { HeaderComponent } from '../header/header.component';
import { TranslateModule } from '@ngx-translate/core';
import { HelpPanelComponent } from '../help-panel/help-panel.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, HeaderComponent, HelpPanelComponent, TranslateModule],
  template: `
    <!-- A real link would leave the app: the address has a <base>, so #main-content would resolve against it. -->
    <a href="#main-content" class="skip-link" (click)="skipToContent($event)">{{ 'COMMON.SKIP_TO_CONTENT' | translate }}</a>

    <div class="relative flex min-h-screen bg-app-bg">
      <app-sidebar #sidebar class="no-print hidden md:block" [class.mobile-open]="isMobileMenuOpen()" />

      @if (isMobileMenuOpen()) {
        <div
          class="animate-fade fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] md:hidden"
          (click)="closeMobileMenu()"
          aria-hidden="true"
        ></div>
      }

      <div class="flex w-full min-w-0 flex-1 flex-col">
        <app-header class="no-print" [menuOpen]="isMobileMenuOpen()" (menuToggle)="toggleMobileMenu()" />
        <main #main id="main-content" tabindex="-1" class="flex-1 p-4 md:p-6 lg:p-8">
          <div class="mx-auto max-w-[88rem]">
            <router-outlet />
          </div>
        </main>
      </div>
    </div>
    <app-help-panel class="no-print" />
  `,
  styles: [`
    :host ::ng-deep .mobile-open {
      display: block !important;
      position: fixed;
      inset-inline-start: 0;
      top: 0;
      bottom: 0;
      z-index: var(--z-drawer);
      width: 248px;
      /* The drawer docks at inset-inline-start, which resolves to the right
         edge in RTL — so "off-screen" is +100% in RTL and -100% in LTR.
         translateX has no logical equivalent, so direction is picked from
         the document dir instead. */
      --slide-offset: -100%;
      animation: slide-in var(--dur-4) var(--ease-out);
    }

    :host-context([dir='rtl']) ::ng-deep .mobile-open {
      --slide-offset: 100%;
    }

    @keyframes slide-in {
      from { transform: translateX(var(--slide-offset)); }
      to   { transform: translateX(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      :host ::ng-deep .mobile-open { animation: none; }
    }
  `],
})
export class MainLayoutComponent {
  readonly isMobileMenuOpen = signal(false);

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly sidebar = viewChild.required('sidebar', { read: ElementRef<HTMLElement> });
  private readonly announcer = inject(AnnouncerService);
  private currentPath = '';

  constructor() {
    inject(Router).events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe((event) => this.onNavigated(event));
  }

  /**
   * A browser moves focus and reads the title when a page loads; a route change does neither on
   * its own, and focus would stay on a link in the rail, or be lost with a button that is gone.
   * The very first navigation is a real page load, which the browser has already taken care of.
   * A change of query alone is the same screen.
   */
  private onNavigated(event: NavigationEnd): void {
    const path = event.urlAfterRedirects.split(/[?#]/)[0];
    const samePage = path === this.currentPath;
    this.currentPath = path;
    if (samePage || event.id === 1) return;
    this.isMobileMenuOpen.set(false);
    this.main().nativeElement.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    this.announcer.announce(document.title);
  }

  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  toggleMobileMenu(): void {
    if (this.isMobileMenuOpen()) {
      this.closeMobileMenu();
      return;
    }
    this.isMobileMenuOpen.set(true);
    // Into the drawer, which comes first in the page and would otherwise be behind where focus is.
    queueMicrotask(() => this.sidebar().nativeElement.querySelector('a')?.focus());
  }

  @HostListener('document:keydown.escape')
  protected closeMobileMenu(): void {
    if (!this.isMobileMenuOpen()) return;
    this.isMobileMenuOpen.set(false);
    document.querySelector<HTMLElement>('[data-menu-toggle]')?.focus();
  }
}
