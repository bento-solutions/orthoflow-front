import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NavCounts } from '../../core/services/nav-counts.service';

/** Requests that come from outside the clinic: online booking and self-registration, each waiting for a person to decide. */
@Component({
  selector: 'app-intake-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'NAV.BOOKING' | translate }}</h1>
        <p class="page-sub">{{ 'INT.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6" role="tablist" [attr.aria-label]="'NAV.BOOKING' | translate">
      <a class="tab" role="tab" routerLink="requests" routerLinkActive="is-active" #a="routerLinkActive" [attr.aria-selected]="a.isActive">
        {{ 'INT.TABS.REQUESTS' | translate }}
        @if (counts.bookingRequests() > 0) { <span class="ms-1.5 rounded-full bg-critical-500 px-1.5 text-2xs font-bold leading-4 text-white">{{ counts.bookingRequests() }}</span> }
      </a>
      <a class="tab" role="tab" routerLink="registrations" routerLinkActive="is-active" #b="routerLinkActive" [attr.aria-selected]="b.isActive">
        {{ 'INT.TABS.REGISTRATIONS' | translate }}
        @if (counts.registrations() > 0) { <span class="ms-1.5 rounded-full bg-critical-500 px-1.5 text-2xs font-bold leading-4 text-white">{{ counts.registrations() }}</span> }
      </a>
    </nav>
    <router-outlet />
  `,
})
export class IntakeLayoutComponent {
  protected readonly counts = inject(NavCounts);
}
