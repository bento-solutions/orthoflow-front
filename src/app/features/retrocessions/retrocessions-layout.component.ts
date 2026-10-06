import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/** What each doctor who is paid a share is owed: a simulation, the statements validated from it, the rules behind it and the advances against it. */
@Component({
  selector: 'app-retrocessions-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'NAV.RETROCESSIONS' | translate }}</h1>
        <p class="page-sub">{{ 'RETRO.SUBTITLE' | translate }}</p>
      </div>
    </div>
    <nav class="tabs mb-6" role="tablist" [attr.aria-label]="'NAV.RETROCESSIONS' | translate">
      @for (tab of tabs; track tab.path) {
        <a class="tab whitespace-nowrap" role="tab" [routerLink]="tab.path" routerLinkActive="is-active" #rla="routerLinkActive" [attr.aria-selected]="rla.isActive">{{ tab.key | translate }}</a>
      }
    </nav>
    <router-outlet />
  `,
})
export class RetrocessionsLayoutComponent {
  protected readonly tabs = [
    { path: 'simulation', key: 'RETRO.TABS.SIMULATION' },
    { path: 'statements', key: 'RETRO.TABS.STATEMENTS' },
    { path: 'rules', key: 'RETRO.TABS.RULES' },
    { path: 'advances', key: 'RETRO.TABS.ADVANCES' },
  ];
}
