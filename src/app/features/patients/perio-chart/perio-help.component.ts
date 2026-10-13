import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PerioMode } from '../../../core/clinical/perio/perio.model';
import { PERIO, modeKey } from './perio-palette';

/** The "?" of the chart: how to chart, in the order a clinician needs it. */
@Component({
  selector: 'app-perio-help',
  standalone: true,
  imports: [TranslateModule, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" [title]="'PERIO.HELP.TITLE' | translate" size="lg" (closed)="closed.emit()">
      <p class="intro">{{ 'PERIO.HELP.INTRO' | translate }}</p>
      <div class="sections">
        <section>
          <h3>{{ 'PERIO.HELP.START_TITLE' | translate }}</h3>
          <ul>
            <li>{{ 'PERIO.HELP.START_PICK' | translate }}</li>
            <li>{{ 'PERIO.HELP.START_WALK' | translate }}</li>
            <li>{{ 'PERIO.HELP.START_FOCUS' | translate }}</li>
          </ul>
        </section>
        <section>
          <h3>{{ 'PERIO.HELP.ENTRY_TITLE' | translate }}</h3>
          <p class="mode">{{ 'PERIO.HELP.ENTRY_MODE' | translate: { mode: ('PERIO.LABEL.' + modeName() | translate) } }}</p>
          <ul class="keys">
            <li><span class="combo"><kbd class="kbd">Enter</kbd><kbd class="kbd">→</kbd></span> {{ 'PERIO.HELP.ENTRY_NEXT' | translate }}</li>
            <li><span class="combo"><kbd class="kbd">←</kbd></span> {{ 'PERIO.HELP.ENTRY_PREV' | translate }}</li>
            <li><span class="combo"><kbd class="kbd">⌫</kbd></span> {{ 'PERIO.HELP.ENTRY_CLEAR' | translate }}</li>
            <li><span class="combo"><kbd class="kbd">1</kbd><kbd class="kbd">2</kbd></span> {{ 'PERIO.HELP.ENTRY_TWO_DIGITS' | translate }}</li>
            <li><span class="combo"><kbd class="kbd">−</kbd></span> {{ 'PERIO.HELP.ENTRY_MINUS' | translate }}</li>
            <li>
              <span class="combo">
                <kbd class="kbd">B</kbd><kbd class="kbd">P</kbd><kbd class="kbd">S</kbd>
                <i class="swatch" [style.background]="p.recession"></i><i class="swatch" style="background:#6d28d9"></i><i class="swatch" style="background:#d97706"></i>
              </span>
              {{ 'PERIO.HELP.ENTRY_FLAGS' | translate }}
            </li>
          </ul>
          <ul>
            <li>{{ 'PERIO.HELP.ENTRY_AUTO' | translate }}</li>
            <li>{{ 'PERIO.HELP.ENTRY_CLICK' | translate }}</li>
          </ul>
        </section>
        <section>
          <h3>{{ 'PERIO.HELP.TEETH_TITLE' | translate }}</h3>
          <ul>
            <li>{{ 'PERIO.HELP.TEETH_HOW' | translate }}</li>
            <li>{{ 'PERIO.HELP.TEETH_SKIP' | translate }}</li>
            <li>{{ 'PERIO.HELP.TEETH_FADED' | translate }}</li>
            <li>{{ 'PERIO.HELP.TEETH_CLEARS' | translate }}</li>
            <li>{{ 'PERIO.HELP.TEETH_NUMBERING' | translate: { fdi: 'FDI', universal: '1-32' } }}</li>
          </ul>
        </section>
        <section>
          <h3>{{ 'PERIO.HELP.NAV_TITLE' | translate }}</h3>
          <ul>
            <li>{{ 'PERIO.HELP.NAV_FOCUS' | translate }}</li>
            <li>{{ 'PERIO.HELP.NAV_MODE' | translate }}</li>
            <li>{{ 'PERIO.HELP.NAV_REVIEW' | translate }}</li>
            <li>{{ 'PERIO.HELP.NAV_PER_TOOTH' | translate }}</li>
          </ul>
        </section>
        <section class="wide">
          <h3>{{ 'PERIO.HELP.LEGEND_TITLE' | translate }}</h3>
          <ul class="legend">
            <li><span class="chip" [style.borderColor]="p.probing" [style.background]="p.probingTint" [style.color]="p.probing">4</span>{{ 'PERIO.HELP.LEGEND_POCKET' | translate }}</li>
            <li><span class="chip" [style.borderColor]="p.recession" [style.background]="p.recessionTint" [style.color]="p.recession">2</span>{{ 'PERIO.HELP.LEGEND_RECESSION' | translate }}</li>
            <li><span class="chip" [style.borderColor]="p.emptyStroke" [style.background]="p.emptyFill" [style.color]="p.emptyText">—</span>{{ 'PERIO.HELP.LEGEND_EMPTY' | translate }}</li>
            <li><i class="dot" style="background:#dc2626"></i>{{ 'PERIO.HELP.LEGEND_BLEEDING' | translate }}</li>
            <li><i class="dot" style="background:#6d28d9"></i>{{ 'PERIO.HELP.LEGEND_PLAQUE' | translate }}</li>
            <li><i class="dot" style="background:#d97706"></i>{{ 'PERIO.HELP.LEGEND_SUPPURATION' | translate }}</li>
            <li><i class="dot ring"></i>{{ 'PERIO.HELP.LEGEND_ABSENT' | translate }}</li>
          </ul>
          <p class="note">{{ 'PERIO.HELP.LEGEND_THRESHOLD' | translate }}</p>
        </section>
      </div>
      <p class="saved">{{ 'PERIO.HELP.SAVED_NOTE' | translate }}</p>
    </app-modal>
  `,
  styles: [`
    p, h3, ul { margin: 0; }
    .intro { color: var(--text-muted); font-size: var(--text-sm); margin-bottom: 1rem; }
    .sections { display: grid; gap: 1rem 1.5rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @media (max-width: 719px) { .sections { grid-template-columns: minmax(0, 1fr); } }
    .wide { grid-column: 1 / -1; }
    h3 { font-size: var(--text-sm); font-weight: 700; margin-bottom: .5rem; }
    ul { padding: 0; list-style: none; display: flex; flex-direction: column; gap: .375rem; font-size: var(--text-xs); color: var(--text-muted); }
    ul + ul { margin-top: .5rem; }
    .mode { font-size: var(--text-xs); font-weight: 600; margin-bottom: .5rem; }
    .keys li { display: flex; align-items: center; gap: .5rem; }
    .combo { display: inline-flex; align-items: center; gap: .25rem; min-width: 5.5rem; }
    .swatch { width: .5rem; height: .5rem; border-radius: 9999px; display: inline-block; margin-inline-start: .125rem; }
    .legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: .5rem 1rem; }
    .legend li { display: flex; align-items: center; gap: .5rem; }
    .chip { display: inline-flex; width: 1.5rem; height: 1.25rem; align-items: center; justify-content: center; border: 1px solid; border-radius: 2px;
            font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600; }
    .dot { width: .625rem; height: .625rem; border-radius: 9999px; display: inline-block; }
    .dot.ring { border: 1.25px solid #fca5a5; }
    .note { margin-top: .5rem; font-size: var(--text-xs); color: var(--text-muted); }
    .saved { margin-top: 1rem; padding: .75rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-sunken);
             font-size: var(--text-xs); color: var(--text-muted); }
  `],
})
export class PerioHelpComponent {
  readonly open = input(false);
  readonly mode = input<PerioMode>('pocketDepth');
  readonly closed = output<void>();
  protected readonly p = PERIO;

  protected modeName(): string {
    return modeKey(this.mode());
  }
}
