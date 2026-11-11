import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/** The groups of the cheat sheet (docs/VOICE-COCKPIT-PLAN.md appendix A §7), in the order a consultation needs them. */
export const HELP_GROUPS = ['DICTATE', 'SEE', 'INSPECT', 'CALYPSO', 'LISTEN', 'END'] as const;

/** What can be said, on the stage: "Calypso, aide" and the help button show it. */
@Component({
  selector: 'app-cockpit-help',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ck-help">
      <h2>{{ 'COCKPIT.HELP' | translate }}</h2>
      <p class="ck-help-lead">{{ 'COCKPIT.HELP_LEAD' | translate }}</p>
      <dl>
        @for (group of groups; track group) {
          <div class="ck-help-row">
            <dt>{{ 'COCKPIT.HELP_GROUP.' + group | translate }}</dt>
            <dd>{{ 'COCKPIT.HELP_SAY.' + group | translate }}</dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: [`
    .ck-help { padding: 1rem 1.25rem; }
    .ck-help h2 { margin: 0 0 .25rem; font-size: 1.25rem; font-weight: 800; color: rgb(var(--ink-900)); }
    .ck-help-lead { margin: 0 0 1rem; color: rgb(var(--ink-700)); }
    dl { margin: 0; display: flex; flex-direction: column; gap: .625rem; }
    .ck-help-row { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: .75rem; }
    dt { font-weight: 800; color: rgb(var(--petrol-800)); }
    dd { margin: 0; color: rgb(var(--ink-900)); }
    @media (max-width: 640px) { .ck-help-row { grid-template-columns: 1fr; gap: .125rem; } }
  `],
})
export class CockpitHelpComponent {
  protected readonly groups = HELP_GROUPS;
}
