import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationFocusService } from '../../../../core/consultation/consultation-focus.service';
import { VoiceOrchestratorService } from '../../../../core/voice/voice-orchestrator.service';

/**
 * The last thing that changed, always in view: what it was, what it replaced,
 * the words it came from, and how to take it back. A status region, so a
 * screen reader hears each new action once.
 */
@Component({
  selector: 'app-cockpit-last-action',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ck-last" [attr.data-kind]="focus.lastAction()?.kind ?? 'none'" role="status" aria-live="polite" aria-atomic="true">
      <h3 class="ck-last-head">{{ 'COCKPIT.LAST_ACTION' | translate }}</h3>
      @if (focus.lastAction(); as last) {
        <p class="ck-last-title">
          <span class="material-icons" aria-hidden="true">{{ icon(last.kind, last.status) }}</span>
          <span>{{ last.title }}</span>
        </p>
        @if (last.detail) { <p class="ck-last-detail">{{ last.detail }}</p> }
        @if (last.status && last.status !== 'noted') {
          <span class="ck-status" [attr.data-status]="last.status">{{ 'COCKPIT.STATUS.' + statusKey(last.status) | translate }}</span>
        }
        @if (last.heard) { <p class="ck-last-heard">« {{ last.heard }} »</p> }
        @if (voice.undoAvailable() && last.undoable) {
          <p class="ck-last-undo">{{ 'COCKPIT.SAY_UNDO' | translate }}
            <button type="button" class="ck-undo" (click)="voice.undoLast()">{{ 'VOICE.UNDO' | translate }}</button>
          </p>
        }
      } @else {
        <p class="ck-last-empty">{{ 'COCKPIT.LAST_EMPTY' | translate }}</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ck-last { padding: .75rem .875rem; border-radius: .75rem; background: var(--surface); border: 1px solid rgb(var(--ink-200)); border-inline-start: 4px solid rgb(var(--positive-600)); }
    .ck-last[data-kind='unsure'] { border-inline-start-color: rgb(var(--caution-500)); }
    .ck-last[data-kind='view'], .ck-last[data-kind='control'] { border-inline-start-color: rgb(var(--petrol-500)); }
    .ck-last[data-kind='none'] { border-inline-start-color: rgb(var(--ink-300)); }
    .ck-last-head { margin: 0 0 .25rem; font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: rgb(var(--ink-600)); }
    .ck-last-title { display: flex; align-items: flex-start; gap: .375rem; margin: 0; font-size: 1.0625rem; font-weight: 700; color: rgb(var(--ink-900)); overflow-wrap: anywhere; }
    .ck-last-title .material-icons { font-size: 1.25rem; color: rgb(var(--positive-700)); }
    .ck-last[data-kind='unsure'] .ck-last-title .material-icons { color: rgb(var(--caution-700)); }
    .ck-last-detail { margin: .125rem 0 0; color: rgb(var(--ink-700)); }
    .ck-last-heard { margin: .25rem 0 0; font-size: .8125rem; color: rgb(var(--ink-600)); font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ck-last-undo { margin: .375rem 0 0; font-size: .8125rem; color: rgb(var(--ink-700)); }
    .ck-undo { margin-inline-start: .375rem; font-weight: 700; text-decoration: underline; color: rgb(var(--petrol-800)); }
    .ck-last-empty { margin: 0; color: rgb(var(--ink-600)); font-size: .875rem; }
    .ck-status { display: inline-block; margin-top: .25rem; font-size: .75rem; font-weight: 700; padding: .05rem .45rem; border-radius: 999px; background: rgb(var(--ink-100)); color: rgb(var(--ink-800)); }
    .ck-status[data-status='to-confirm'], .ck-status[data-status='not-understood'] { background: rgb(var(--caution-100)); color: rgb(var(--caution-900)); }
    .ck-status[data-status='proposed'] { background: rgb(var(--petrol-50)); color: rgb(var(--petrol-900)); }
  `],
})
export class CockpitLastActionComponent {
  protected readonly focus = inject(ConsultationFocusService);
  protected readonly voice = inject(VoiceOrchestratorService);

  protected icon(kind: string, status: string | null): string {
    if (kind === 'unsure') return 'help';
    if (status === 'removed') return 'remove_circle';
    if (kind === 'view') return 'visibility';
    if (kind === 'control') return 'tune';
    return 'check_circle';
  }

  protected statusKey(status: string): string {
    return status.replace('-', '_').toUpperCase();
  }
}
