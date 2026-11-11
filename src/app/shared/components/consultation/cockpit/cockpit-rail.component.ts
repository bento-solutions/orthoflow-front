import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CockpitModelService } from '../../../../core/consultation/cockpit-model.service';
import { ConsultationFocusService, StageView } from '../../../../core/consultation/consultation-focus.service';

/** The sections a doctor can put on the stage, in the order they come up in a consultation. */
export const RAIL_VIEWS: readonly StageView[] = ['chart', 'allergies', 'history', 'treatments', 'plan', 'appointment', 'patient', 'summary'];

const ICONS: Readonly<Record<StageView, string>> = {
  chart: 'grid_view', allergies: 'warning', history: 'history_edu', treatments: 'medication', plan: 'receipt_long',
  appointment: 'event', patient: 'badge', summary: 'notes', findings: 'list', transcript: 'forum', help: 'help_outline',
};

/**
 * One chip per section, with how many things are in it and a dot for what is
 * new since the doctor last looked. A tap shows it; so does saying its name.
 */
@Component({
  selector: 'app-cockpit-rail',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="ck-rail" [attr.aria-label]="'COCKPIT.RAIL' | translate">
      @for (view of views; track view) {
        <button type="button" class="ck-tab" [class.on]="focus.view() === view" [attr.aria-pressed]="focus.view() === view"
                [attr.data-view]="view" (click)="focus.show(view)"
                [attr.aria-label]="label(view)">
          <span class="material-icons" aria-hidden="true">{{ icon(view) }}</span>
          <span class="ck-tab-name">{{ 'COCKPIT.VIEW.' + view.toUpperCase() | translate }}</span>
          @if (count(view); as n) { <span class="ck-count" aria-hidden="true">{{ n }}</span> }
          @if (focus.unseen()[view]) { <span class="ck-new" aria-hidden="true"></span> }
        </button>
      }
      <button type="button" class="ck-pin" [class.on]="focus.pinned()" [attr.aria-pressed]="focus.pinned()"
              (click)="focus.pinned() ? focus.unpin() : focus.pin()"
              [attr.aria-label]="(focus.pinned() ? 'COCKPIT.UNPIN' : 'COCKPIT.PIN') | translate"
              [title]="(focus.pinned() ? 'COCKPIT.UNPIN' : 'COCKPIT.PIN') | translate">
        <span class="material-icons" aria-hidden="true">push_pin</span>
      </button>
    </nav>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ck-rail { display: flex; gap: .375rem; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; }
    .ck-tab, .ck-pin { position: relative; display: inline-flex; align-items: center; gap: .3rem; min-height: 2.5rem; padding: 0 .75rem; border-radius: 999px; border: 1px solid rgb(var(--ink-200)); background: var(--surface); color: rgb(var(--ink-700)); font-weight: 600; font-size: .875rem; white-space: nowrap; flex: none; }
    .ck-tab .material-icons, .ck-pin .material-icons { font-size: 1.1rem; }
    .ck-tab.on { background: var(--action); border-color: var(--action); color: #fff; }
    .ck-pin.on { background: rgb(var(--caution-100)); border-color: rgb(var(--caution-400)); color: rgb(var(--caution-800)); }
    .ck-count { font-size: .75rem; font-variant-numeric: tabular-nums; padding: 0 .35rem; border-radius: 999px; background: rgb(var(--ink-100)); color: rgb(var(--ink-800)); }
    .ck-tab.on .ck-count { background: rgb(255 255 255 / .2); color: #fff; }
    .ck-new { position: absolute; top: .2rem; inset-inline-end: .2rem; width: .5rem; height: .5rem; border-radius: 50%; background: rgb(var(--critical-600)); }
  `],
})
export class CockpitRailComponent {
  protected readonly focus = inject(ConsultationFocusService);
  private readonly model = inject(CockpitModelService);
  private readonly translate = inject(TranslateService);
  protected readonly views = RAIL_VIEWS;

  protected icon(view: StageView): string {
    return ICONS[view];
  }

  protected count(view: StageView): number {
    return this.model.counts()[view] ?? 0;
  }

  /** "Allergies, 3, nouveau" — what the chip says without its icon. */
  protected label(view: StageView): string {
    const parts = [this.translate.instant(`COCKPIT.VIEW.${view.toUpperCase()}`)];
    const n = this.count(view);
    if (n) parts.push(String(n));
    if (this.focus.unseen()[view]) parts.push(this.translate.instant('COCKPIT.NEW'));
    return parts.join(', ');
  }
}
