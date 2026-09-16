import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { sessionStatusKey } from './voice-session-panel.component';

/**
 * The recording control, pinned to the bottom of the screen for as long as a
 * session runs.
 *
 * It replaces the floating voice HUD, which on a phone sat on top of the
 * dossier's content, expanded into a panel taller than the viewport, and put
 * the microphone button where a thumb could not reliably reach it. The dock
 * is one row: a microphone button whose ring moves with the input level (the
 * proof, at a glance, that it hears), what the assistant is doing and last
 * understood, and End. It is the persistent recording indicator the room
 * needs, and it stays reachable from any tab of the dossier.
 */
@Component({
  selector: 'app-voice-session-dock',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (session.isActive()) {
      <div class="dock no-print" role="region" [attr.aria-label]="'VOICE.PANEL_TITLE' | translate">
        <button type="button" class="dock-mic"
                [class.live]="live()" [class.off]="!voice.examinationMode() || voice.paused()"
                [style.--level]="live() ? voice.inputLevel() : 0"
                (click)="toggle()"
                [attr.aria-label]="micLabel() | translate">
          <span class="material-icons" aria-hidden="true">{{ micIcon() }}</span>
        </button>

        <button type="button" class="dock-status" (click)="openPanel.emit()"
                [attr.aria-current]="onVoiceTab() ? 'page' : null">
          <span class="dock-line1">{{ statusKey() | translate }}</span>
          @if (ticker(); as text) {
            <span class="dock-line2">{{ text }}</span>
          }
        </button>

        @if (voice.buffered().length) {
          <span class="dock-count" [attr.aria-label]="'VOICE.ENTRIES' | translate: { count: voice.buffered().length }">
            {{ voice.buffered().length }}
          </span>
        }

        <button type="button" class="dock-end" (click)="end()" [disabled]="session.busy()">
          <span class="material-icons" aria-hidden="true">stop</span>
          <span class="dock-end-label">{{ (session.busy() ? 'VOICE.ENDING' : 'VOICE.END') | translate }}</span>
        </button>
      </div>
    }
  `,
  styles: [`
    .dock {
      position: fixed; z-index: 1100;
      inset-inline: .5rem; bottom: calc(.5rem + env(safe-area-inset-bottom, 0px));
      margin-inline: auto; max-width: 44rem;
      display: flex; align-items: center; gap: .5rem;
      padding: .5rem; border-radius: 18px;
      background: rgb(var(--ink-900)); color: #fff;
      box-shadow: 0 16px 40px -12px rgba(15, 23, 42, .5);
    }

    .dock-mic {
      --level: 0;
      width: 3.25rem; height: 3.25rem; border-radius: 50%; border: none; flex-shrink: 0; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      background: rgb(var(--critical-600)); color: #fff;
      box-shadow: 0 0 0 calc(var(--level) * 12px) rgba(248, 113, 113, .45);
      transition: box-shadow 80ms linear, background .15s;
    }
    .dock-mic.off { background: rgb(var(--ink-600)); box-shadow: none; }
    .dock-mic .material-icons { font-size: 1.5rem; }

    .dock-status {
      flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: .0625rem;
      background: none; border: none; color: inherit; cursor: pointer; text-align: start; padding: .25rem;
      min-height: 2.75rem; justify-content: center;
    }
    .dock-line1 { font-weight: 700; font-size: .875rem; line-height: 1.25; }
    .dock-line2 {
      font-size: .8125rem; color: rgb(var(--ink-300)); line-height: 1.3; max-width: 100%;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .dock-count {
      min-width: 1.75rem; height: 1.75rem; border-radius: 999px; padding: 0 .375rem; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: #d97706; color: #fff; font-weight: 800; font-size: .8125rem; font-variant-numeric: tabular-nums;
    }

    .dock-end {
      display: inline-flex; align-items: center; gap: .25rem; flex-shrink: 0; cursor: pointer;
      min-height: 2.75rem; padding: 0 .875rem; border-radius: 12px; border: none;
      background: #fff; color: rgb(var(--ink-900)); font-weight: 700; font-size: .875rem;
    }
    .dock-end:disabled { opacity: .7; cursor: default; }
    .dock-end .material-icons { font-size: 1.125rem; color: rgb(var(--critical-600)); }

    .dock button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

    @media (max-width: 380px) { .dock-end-label { display: none; } }
    @media (prefers-reduced-motion: reduce) { .dock-mic { transition: none; } }
  `],
})
export class VoiceSessionDockComponent {
  voice = inject(VoiceOrchestratorService);
  session = inject(VoiceSessionService);

  /** The voice tab is showing, so the status button is already where it leads. */
  onVoiceTab = input(false);
  openPanel = output<void>();
  /** The microphone is off and the dentist tapped it — resume, inside the tap. */
  resume = output<void>();

  private now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  live = computed(() => this.voice.examinationMode() && !this.voice.paused() && !this.voice.microphoneSuspended());

  statusKey = computed(() =>
    sessionStatusKey(this.voice, (this.voice.awakeUntil() ?? 0) > this.now()));

  /** The last result if it is fresh, otherwise what was last heard. */
  ticker = computed(() => {
    const question = this.voice.clarification()?.question ?? this.voice.confirmation()?.preview;
    if (question) return question;
    const outcome = this.voice.outcome();
    if (outcome && this.now() - outcome.at < 12_000) return outcome.message;
    return this.voice.transcript() || null;
  });

  micIcon = computed(() => {
    if (!this.voice.examinationMode()) return 'mic_off';
    if (this.voice.microphoneSuspended()) return 'touch_app';
    return this.voice.paused() ? 'play_arrow' : 'mic';
  });

  micLabel = computed(() => {
    if (!this.voice.examinationMode()) return 'VOICE.RESUME';
    if (this.voice.microphoneSuspended()) return 'VOICE.MIC_SUSPENDED';
    return this.voice.paused() ? 'VOICE.RESUME_SHORT' : 'VOICE.PAUSE';
  });

  toggle(): void {
    if (!this.voice.examinationMode()) {
      this.resume.emit();
      return;
    }
    if (this.voice.microphoneSuspended()) {
      this.voice.resumeMicrophone();
      return;
    }
    this.voice.setPaused(!this.voice.paused());
  }

  end(): void {
    this.openPanel.emit();
    void this.session.end();
  }
}
