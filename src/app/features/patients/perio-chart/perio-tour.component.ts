import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PerioIconComponent } from './perio-icon.component';

const STEPS = ['PICK', 'TYPE', 'TEETH', 'SAVE'] as const;

/**
 * Four cards the first time a clinician opens the chart: choose a measurement, type, set a tooth's
 * status, and that it saves itself. Skippable, shown once.
 */
@Component({
  selector: 'app-perio-tour',
  standalone: true,
  imports: [TranslateModule, ModalComponent, PerioIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" [title]="'PERIO.TOUR.TITLE' | translate" size="sm" (closed)="finish()">
      <div class="step" [attr.aria-label]="'PERIO.TOUR.STEP_OF' | translate: { current: index() + 1, total: steps.length }">
        <h3>{{ 'PERIO.TOUR.' + current() + '_TITLE' | translate }}</h3>
        <p>{{ 'PERIO.TOUR.' + current() + '_TEXT' | translate }}</p>
        @if (current() === 'TYPE') {
          <p class="keys"><kbd class="kbd">←</kbd><kbd class="kbd">→</kbd> {{ 'PERIO.TOUR.CHANGE_SITE' | translate }}</p>
        }
        @if (current() === 'TEETH') {
          <p class="status">
            <span class="s missing">12 <app-perio-icon name="missing" [size]="12"/></span>
            <span class="s pontic">14 <app-perio-icon name="pontic" [size]="12"/></span>
            <span class="s implant">15 <app-perio-icon name="implant" [size]="12"/></span>
          </p>
        }
      </div>
      <div class="dots" aria-hidden="true">
        @for (s of steps; track s; let i = $index) { <i [class.on]="i === index()"></i> }
      </div>
      <div modal-footer>
        @if (index() === 0) {
          <button type="button" class="btn btn-ghost btn-sm" (click)="finish()">{{ 'PERIO.TOUR.SKIP' | translate }}</button>
        } @else {
          <button type="button" class="btn btn-ghost btn-sm" (click)="index.set(index() - 1)">{{ 'PERIO.TOUR.BACK' | translate }}</button>
        }
        @if (last()) {
          <button type="button" class="btn btn-primary btn-sm" (click)="finish()">{{ 'PERIO.TOUR.START' | translate }}</button>
        } @else {
          <button type="button" class="btn btn-primary btn-sm" (click)="index.set(index() + 1)">{{ 'PERIO.TOUR.NEXT' | translate }}</button>
        }
      </div>
    </app-modal>
  `,
  styles: [`
    h3 { margin: 0 0 .5rem; font-size: var(--text-md); font-weight: 700; }
    p { margin: 0; color: var(--text-muted); font-size: var(--text-sm); line-height: 1.5; }
    .keys { margin-top: .75rem; display: flex; align-items: center; gap: .375rem; }
    .status { margin-top: .75rem; display: flex; gap: .5rem; }
    .s { display: inline-flex; align-items: center; gap: .125rem; height: 22px; padding: 0 .375rem; border-radius: 6px; font-size: 14px; font-weight: 500; }
    .s.missing { background: #fecaca; color: #7f1d1d; } .s.pontic { background: #fde68a; color: #78350f; } .s.implant { background: #bfdbfe; color: #1e3a8a; }
    .dots { margin-top: 1rem; display: flex; gap: .25rem; }
    .dots i { width: .375rem; height: .375rem; border-radius: 9999px; background: var(--border-strong); }
    .dots i.on { width: 1rem; background: var(--text); }
  `],
})
export class PerioTourComponent {
  readonly open = input(false);
  readonly done = output<void>();

  protected readonly steps = STEPS;
  protected readonly index = signal(0);
  protected readonly current = computed(() => STEPS[this.index()]);
  protected readonly last = computed(() => this.index() === STEPS.length - 1);

  protected finish(): void {
    this.index.set(0);
    this.done.emit();
  }
}
