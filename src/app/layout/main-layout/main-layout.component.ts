import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { HeaderComponent } from '../header/header.component';
import { TranslateModule } from '@ngx-translate/core';
import { HelpPanelComponent } from '../help-panel/help-panel.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, HeaderComponent, HelpPanelComponent, TranslateModule],
  template: `
    <a href="#main-content" class="skip-link">{{ 'COMMON.SKIP_TO_CONTENT' | translate }}</a>

    <div class="relative flex min-h-screen bg-app-bg">
      <app-sidebar class="no-print hidden md:block" [class.mobile-open]="isMobileMenuOpen()" />

      @if (isMobileMenuOpen()) {
        <div
          class="animate-fade fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] md:hidden"
          (click)="toggleMobileMenu()"
          aria-hidden="true"
        ></div>
      }

      <div class="flex w-full min-w-0 flex-1 flex-col">
        <app-header class="no-print" (menuToggle)="toggleMobileMenu()" />
        <main id="main-content" class="flex-1 p-4 md:p-6 lg:p-8">
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

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.set(!this.isMobileMenuOpen());
  }
}
