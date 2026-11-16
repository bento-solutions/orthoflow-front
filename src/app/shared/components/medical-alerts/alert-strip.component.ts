import { Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { AlertsState, MedicalAlert } from '../../../core/services/clinical-record.service';
import { IconComponent } from '../../ui/icon.component';

/**
 * The patient's medical alerts as a row of chips: red for allergies, amber for conditions and
 * current medications. An empty list is never silent: it says "No known alerts" when the patient
 * was asked, and "Not asked yet" when nobody has. One press opens the medical history.
 *
 * Shown in the patient banner on every tab, in its compact sticky form, and in the cockpit.
 */
@Component({
  selector: 'app-alert-strip',
  standalone: true,
  imports: [TranslateModule, IconComponent],
  template: `
    <button type="button" class="strip" [class.compact]="compact()" [disabled]="!editable()" (click)="open.emit()"
            [title]="editable() ? ('ALERTS.OPEN' | translate) : ''">
      <span class="sr-only">{{ 'ALERTS.TITLE' | translate }}:</span>
      @switch (state()) {
        @case ('alerts') {
          @for (a of shown(); track a.id) {
            <span class="chip" [class.critical]="a.tone === 'critical'" [class.attention]="a.tone === 'attention'">
              <app-icon [name]="a.tone === 'critical' ? 'alert-triangle' : 'alert-circle'" [size]="14" [strokeWidth]="2" />
              <span class="chip-label">
                @if (a.kind === 'ALLERGY') { <span class="chip-kind">{{ 'ALERTS.ALLERGY' | translate }}</span> }
                {{ a.label }}
              </span>
            </span>
          }
          @if (hidden() > 0) {
            <span class="chip more" aria-hidden="true">+{{ hidden() }}</span>
            <!-- Counted on screen, named for a screen reader. -->
            @for (a of rest(); track a.id) { <span class="sr-only">{{ a.label }}</span> }
          }
        }
        @case ('none') {
          <span class="chip quiet"><app-icon name="check-circle" [size]="14" [strokeWidth]="2" />{{ 'ALERTS.NONE' | translate }}</span>
        }
        @case ('not-asked') {
          <span class="chip unknown"><app-icon name="help-circle" [size]="14" [strokeWidth]="2" />{{ 'ALERTS.NOT_ASKED' | translate }}</span>
        }
        @default {
          <span class="chip quiet">{{ 'ALERTS.LOADING' | translate }}</span>
        }
      }
      @if (editable()) { <span class="sr-only">— {{ 'ALERTS.OPEN' | translate }}</span> }
    </button>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .strip {
      display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; min-width: 0; max-width: 100%;
      padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: start; cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .strip:disabled { cursor: default; }
    .strip.compact { flex-wrap: nowrap; overflow: hidden; }
    .chip {
      display: inline-flex; align-items: center; gap: .3125rem; min-height: 1.75rem; padding: .1875rem .625rem;
      border-radius: var(--radius-full); border: 1px solid; font-size: var(--text-sm); font-weight: 650; line-height: 1.2;
      white-space: nowrap;
    }
    .compact .chip { min-height: 1.5rem; padding-block: .125rem; }
    .chip.critical { background: var(--status-critical-tint); color: var(--status-critical-text); border-color: rgb(var(--critical-300)); }
    .chip.attention { background: var(--status-attention-tint); color: var(--status-attention-text); border-color: rgb(var(--caution-300)); }
    .chip.quiet { background: var(--surface); color: var(--text-muted); border-color: var(--border); font-weight: 600; }
    .chip.unknown { background: var(--status-attention-tint); color: var(--status-attention-text); border-color: rgb(var(--caution-200)); border-style: dashed; }
    .chip.more { background: var(--surface-sunken); color: var(--text-muted-on-tint); border-color: var(--border); }
    .chip-kind { font-weight: 800; text-transform: uppercase; letter-spacing: .03em; font-size: var(--text-xs); margin-inline-end: .1875rem; }
    .strip:not(:disabled):hover .chip:not(.more) { filter: brightness(.97); }
  `],
})
export class AlertStripComponent {
  readonly alerts = input<readonly MedicalAlert[]>([]);
  readonly state = input<AlertsState>('loading');
  /** One row, as many chips as fit in `max`, the rest counted. */
  readonly compact = input(false);
  readonly max = input(6);
  /** Whether a press opens the medical history (off in the cockpit's read-only view). */
  readonly editable = input(true);
  readonly open = output<void>();

  protected readonly shown = computed(() => this.alerts().slice(0, this.compact() ? Math.min(3, this.max()) : this.max()));
  protected readonly hidden = computed(() => this.alerts().length - this.shown().length);
  protected readonly rest = computed(() => this.alerts().slice(this.shown().length));
}
