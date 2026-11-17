import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { FirstRunService } from '../../core/help/first-run';
import { ModalComponent } from '../../shared/ui/modal.component';

/**
 * The welcome card of the first-login guide: what it is, how long it takes, and three ways out.
 * Closing it (Escape, the cross, a click outside) is "Later", never "Don't show again".
 */
@Component({
  selector: 'app-first-run-dialog',
  standalone: true,
  imports: [TranslateModule, ModalComponent],
  template: `
    @if (firstRun.offer(); as offer) {
      <app-modal [open]="true" size="sm" [title]="(offer === 'resume' ? 'FIRST_RUN.RESUME_TITLE' : 'FIRST_RUN.TITLE') | translate" (closed)="firstRun.later()">
        <p class="text-base leading-relaxed text-ink-700">{{ (offer === 'resume' ? 'FIRST_RUN.RESUME_TEXT' : 'FIRST_RUN.TEXT') | translate }}</p>
        @if (offer === 'start') {
          <ol class="mt-3 list-decimal space-y-1 ps-5 text-sm text-ink-700">
            <li>{{ 'FIRST_RUN.CHAPTER_DASHBOARD' | translate }}</li>
            <li>{{ 'FIRST_RUN.CHAPTER_DOSSIER' | translate }}</li>
            <li>{{ 'FIRST_RUN.CHAPTER_VOICE' | translate }}</li>
          </ol>
        }
        <p class="mt-3 text-xs text-ink-500">{{ 'FIRST_RUN.REPLAY_HINT' | translate }}</p>
        <div modal-footer class="flex w-full flex-wrap items-center justify-between gap-2">
          <button type="button" class="btn btn-ghost btn-sm" (click)="firstRun.never()">{{ 'FIRST_RUN.NEVER' | translate }}</button>
          <span class="flex gap-2">
            <button type="button" class="btn btn-secondary" (click)="firstRun.later()">{{ 'FIRST_RUN.LATER' | translate }}</button>
            <button type="button" class="btn btn-primary" (click)="firstRun.accept()">{{ (offer === 'resume' ? 'FIRST_RUN.CONTINUE' : 'FIRST_RUN.START') | translate }}</button>
          </span>
        </div>
      </app-modal>
    }
  `,
})
export class FirstRunDialogComponent {
  protected readonly firstRun = inject(FirstRunService);
}
