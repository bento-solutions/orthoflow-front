import { IconComponent } from '../../ui/icon.component';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { ConsultationMode } from '../../../core/consultation/consultation.model';
import { InputLanguageService } from '../../../core/voice/input-language.service';
import { INPUT_LANGUAGES } from '../../../core/voice/language-filter';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';

/** What the drawer shows: before the start, while recording, while the end is analysed. */
export type DrawerState = 'ready' | 'recording' | 'analysing';

/** The one line under the controls while recording, the most serious first. */
type RecordingAlert = 'mic-off' | 'suspended' | 'error' | 'service' | 'paused' | null;

/**
 * The consultation's controls, in one bar floating along the bottom of the screen.
 *
 * It replaces the "before we start" card, which put a page of text between the doctor and
 * the first word: how the consultation acts (at the end or live), the dictation language,
 * the one attestation the server needs, and Start — every explanation is behind the ⓘ.
 * Started, the same bar holds the timer, the microphone, the last sentence heard, Pause,
 * the language and End; once the consultation ends it shows the analysis, then leaves the
 * screen to the review.
 *
 * Styled like the dictation dock, so the two recording bars look alike. Start and Resume
 * call the service from inside the tap: iOS only opens the microphone in a gesture.
 */
@Component({
  selector: 'app-consultation-drawer',
  standalone: true,
  imports: [IconComponent, NgTemplateOutlet, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state(); as s) {
      <div class="cd no-print" role="region" [attr.data-drawer]="s" [attr.aria-label]="'CONSULTATION.TITLE' | translate">
        @switch (s) {
          <!-- ── Before the start ─────────────────────────────────────── -->
          @case ('ready') {
            <span class="cd-badge" aria-hidden="true"><app-icon class="mi" name="mic" size="1em" /></span>

            <label class="cd-chip cd-select" [title]="'CONSULTATION.MODE_TITLE' | translate">
              <span class="sr-only">{{ 'CONSULTATION.MODE_TITLE' | translate }}</span>
              <select data-drawer-mode (change)="chooseMode($event)" [disabled]="c.starting()">
                <option value="DEFERRED" [selected]="c.chosenMode() === 'DEFERRED'">{{ 'CONSULTATION.DRAWER.MODE_DEFERRED' | translate }}</option>
                <option value="LIVE" [selected]="c.chosenMode() === 'LIVE'">{{ 'CONSULTATION.DRAWER.MODE_LIVE' | translate }}</option>
              </select>
              <app-icon class="mi cd-caret" name="expand_more" size="1em" />
            </label>

            <ng-container *ngTemplateOutlet="language" />

            <label class="cd-ack">
              <input #ack type="checkbox" data-drawer-informed [checked]="informed()" (change)="informed.set(ack.checked)"
                     [disabled]="c.starting()" aria-describedby="cd-ack-full" />
              <span>{{ 'CONSULTATION.DRAWER.INFORMED' | translate }}</span>
            </label>
            <span id="cd-ack-full" class="sr-only">{{ ackKey() | translate }}</span>
            <button type="button" class="cd-icon" data-drawer-info (click)="infoOpen.set(!infoOpen())"
                    [attr.aria-expanded]="infoOpen()" aria-controls="cd-info"
                    [attr.aria-label]="'CONSULTATION.DRAWER.INFO' | translate" [title]="'CONSULTATION.DRAWER.INFO' | translate">
              <app-icon class="mi" name="info" size="1em" />
            </button>

            <span class="cd-spacer"></span>

            @if (voice.error(); as error) {
              <span class="cd-line critical" role="alert">{{ error }}</span>
            }
            <button type="button" class="cd-start" data-drawer-start (click)="start()" [disabled]="!informed() || c.starting()">
              <app-icon class="mi" name="mic" size="1em" />
              {{ (c.starting() ? 'CONSULTATION.STARTING' : 'CONSULTATION.DRAWER.START') | translate }}
            </button>
            <button type="button" class="cd-icon" data-drawer-close (click)="close()" [disabled]="c.starting()"
                    [attr.aria-label]="'COMMON.CLOSE' | translate" [title]="'COMMON.CLOSE' | translate">
              <app-icon class="mi" name="close" size="1em" />
            </button>

            @if (infoOpen()) {
              <div id="cd-info" class="cd-info" role="region" [attr.aria-label]="'CONSULTATION.DRAWER.INFO' | translate">
                <p>{{ (c.retainTranscript() ? 'CONSULTATION.INTRO_NOTICE' : 'CONSULTATION.INTRO_NOTICE_NOT_KEPT') | translate }}
                  @if (c.keepAudio()) { {{ 'CONSULTATION.INTRO_NOTICE_AUDIO' | translate }} }</p>
                <p><strong>{{ 'CONSULTATION.DRAWER.INFORMED' | translate }} :</strong> {{ ackKey() | translate }}</p>
                <dl>
                  <dt>{{ 'CONSULTATION.MODE_DEFERRED' | translate }}</dt><dd>{{ 'CONSULTATION.MODE_DEFERRED_HINT' | translate }}</dd>
                  <dt>{{ 'CONSULTATION.MODE_LIVE' | translate }}</dt><dd>{{ 'CONSULTATION.MODE_LIVE_HINT' | translate }}</dd>
                </dl>
                <!-- For a doctor who tells every patient anyway: the next consultations start at once. -->
                <label class="cd-minor">
                  <input #hide type="checkbox" data-drawer-hide [checked]="dontAskAgain()" (change)="dontAskAgain.set(hide.checked)" />
                  <span>{{ 'CONSULTATION.HIDE_INTRO' | translate }}</span>
                </label>
              </div>
            }
          }

          <!-- ── Recording ───────────────────────────────────────────── -->
          @case ('recording') {
            <span class="cd-rec" [class.live]="live()">
              <span class="cd-dot" aria-hidden="true"></span>
              <span class="cd-time">{{ elapsed() }}</span>
              <span class="sr-only">{{ (c.listening() ? 'COCKPIT.RECORDING' : 'CONSULTATION.MIC_OFF') | translate }}</span>
            </span>
            <span class="cd-meter" aria-hidden="true"><span [style.transform]="'scaleY(' + (live() ? voice.inputLevel() : 0) + ')'"></span></span>

            <div class="cd-now" [class.is-alert]="alert() !== null" aria-live="polite">
              @switch (alert()) {
                @case ('mic-off') {
                  <span class="cd-line caution" role="alert"><app-icon class="mi" name="mic_off" size="1em" />{{ 'CONSULTATION.MIC_OFF' | translate }}</span>
                  <button type="button" class="cd-chip strong" data-drawer-resume (click)="c.resumeRecording()">{{ 'CONSULTATION.MIC_RESUME' | translate }}</button>
                }
                @case ('suspended') {
                  <button type="button" class="cd-line caution action" role="alert" (click)="voice.resumeMicrophone()">
                    <app-icon class="mi" name="touch_app" size="1em" />{{ 'VOICE.MIC_SUSPENDED' | translate }}
                  </button>
                }
                @case ('error') { <span class="cd-line critical" role="alert"><app-icon class="mi" name="error" size="1em" />{{ voice.error() }}</span> }
                @case ('service') { <span class="cd-line caution" role="status"><app-icon class="mi" name="cloud_off" size="1em" />{{ voice.transcriptionIssue() }}</span> }
                @case ('paused') { <span class="cd-line" role="status"><app-icon class="mi" name="pause_circle" size="1em" />{{ 'COCKPIT.PAUSED' | translate }}</span> }
                @default {
                  @if (lastLine(); as line) {
                    <span class="cd-heard" data-drawer-heard>« {{ line }} »</span>
                  } @else {
                    <span class="cd-heard muted">{{ 'CONSULTATION.LISTENING' | translate }}</span>
                  }
                }
              }
            </div>

            <button type="button" class="cd-chip" data-drawer-pause (click)="togglePause()" [disabled]="!c.listening() || c.busy()"
                    [attr.aria-label]="(voice.paused() ? 'VOICE.RESUME_SHORT' : 'CONSULTATION.DRAWER.PAUSE') | translate">
              <app-icon class="mi" [name]="voice.paused() ? 'play_arrow' : 'pause_circle'" size="1em" />
              <span class="cd-label">{{ (voice.paused() ? 'VOICE.RESUME_SHORT' : 'CONSULTATION.DRAWER.PAUSE') | translate }}</span>
            </button>
            <ng-container *ngTemplateOutlet="language" />
            <button type="button" class="cd-end" data-drawer-end (click)="c.end()" [disabled]="c.busy()">
              <app-icon class="mi" name="stop_circle" size="1em" />
              <span class="cd-label">{{ endKey() | translate }}</span>
            </button>
          }

          <!-- ── The end-of-consultation analysis ──────────────────────── -->
          @case ('analysing') {
            @if (c.analysis(); as a) {
              <div class="cd-analysis" role="status" aria-live="polite" data-analysis [attr.data-step]="a.step">
                <app-icon class="mi cd-spin" name="autorenew" size="1em" />
                <strong>{{ 'CONSULTATION.ANALYSIS_TITLE' | translate }}</strong>
                <span class="cd-step">
                  @switch (a.step) {
                    @case ('finishing') { {{ 'CONSULTATION.ANALYSIS_FINISHING' | translate }} }
                    @case ('commands') { {{ 'CONSULTATION.ANALYSIS_COMMANDS' | translate: { done: a.done, total: a.total } }} }
                    @case ('reading') { {{ 'CONSULTATION.ANALYSIS_READING' | translate }} }
                    @default { {{ 'CONSULTATION.ANALYSIS_REPORT' | translate }} }
                  }
                </span>
                @if (a.step === 'commands' && a.total > 0) {
                  <progress [value]="a.done" [max]="a.total" [attr.aria-label]="'CONSULTATION.ANALYSIS_TITLE' | translate"></progress>
                }
              </div>
            }
          }
        }
      </div>
    }

    <!-- The dictation language: a chip that steps through them, as in the cockpit. -->
    <ng-template #language>
      <button type="button" class="cd-chip" data-drawer-language (click)="cycleLanguage()" [title]="'VOICE.LANG_TITLE' | translate"
              [attr.aria-label]="('VOICE.LANG_TITLE' | translate) + ' : ' + ('VOICE.LANG.' + inputLanguage.language() | translate)">
        {{ inputLanguage.language().toUpperCase() }}
      </button>
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }
    .cd {
      position: fixed; z-index: var(--z-drawer);
      inset-inline: .5rem; bottom: calc(.5rem + env(safe-area-inset-bottom, 0px));
      margin-inline: auto; max-width: 56rem; box-sizing: border-box;
      display: flex; align-items: center; flex-wrap: wrap; gap: .5rem;
      padding: .5rem .625rem; border-radius: var(--radius-xl);
      background: var(--surface-inverse); color: var(--text-inverse);
      box-shadow: var(--shadow-lg); font-size: var(--text-base);
    }
    .cd-spacer { flex: 1; }
    .cd-badge { display: inline-grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; flex: none;
      background: rgb(var(--on-inverse) / .12); }
    .cd-badge app-icon.mi { font-size: var(--text-lg); }

    .cd-chip, .cd-icon, .cd-start, .cd-end { font: inherit; cursor: pointer; flex: none; }
    .cd-chip {
      display: inline-flex; align-items: center; gap: .3rem; min-height: 2.5rem; padding: 0 .625rem;
      border-radius: var(--radius-md); border: 1px solid rgb(var(--on-inverse) / .35);
      background: transparent; color: inherit; font-weight: 600; font-size: var(--text-sm);
    }
    .cd-chip.strong { border-color: rgb(var(--on-inverse)); }
    .cd-chip app-icon.mi { font-size: var(--text-lg); }
    .cd-chip:hover:not(:disabled), .cd-icon:hover:not(:disabled) { background: rgb(var(--on-inverse) / .12); }
    .cd-chip:disabled, .cd-icon:disabled { opacity: .5; cursor: default; }

    /* The mode is a native select, dressed as a chip: the keyboard and screen readers get the real thing. */
    .cd-select { position: relative; padding: 0; }
    .cd-select select {
      appearance: none; background: transparent; color: inherit; border: 0; font: inherit; font-weight: 600;
      min-height: 2.5rem; padding-block: 0; padding-inline: .625rem 1.75rem; cursor: pointer; border-radius: var(--radius-md);
    }
    .cd-select select option { background: var(--surface); color: rgb(var(--ink-900)); }
    .cd-caret { position: absolute; inset-inline-end: .375rem; pointer-events: none; }

    .cd-icon { display: inline-grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: var(--radius-md);
      border: 0; background: transparent; color: inherit; }
    .cd-icon app-icon.mi { font-size: var(--text-lg); }

    .cd-ack { display: inline-flex; align-items: center; gap: .5rem; min-height: 2.5rem; font-weight: 600; cursor: pointer; }
    .cd-ack input { width: 1.25rem; height: 1.25rem; accent-color: rgb(var(--on-inverse)); flex: none; cursor: pointer; }

    .cd-start {
      display: inline-flex; align-items: center; gap: .375rem; min-height: 2.75rem; padding: 0 1.125rem;
      border-radius: var(--radius-lg); border: 0; font-weight: 700;
      background: rgb(var(--on-inverse)); color: rgb(var(--petrol-900));
    }
    .cd-start:disabled { opacity: .55; cursor: not-allowed; }
    .cd-start app-icon.mi { font-size: var(--text-lg); }

    .cd-info {
      position: absolute; inset-inline: 0; bottom: calc(100% + .5rem); box-sizing: border-box;
      max-height: min(60dvh, 28rem); overflow-y: auto; padding: .875rem 1rem; display: grid; gap: .625rem;
      border-radius: var(--radius-lg); background: var(--surface); color: rgb(var(--ink-900));
      border: 1px solid var(--border); box-shadow: var(--shadow-lg); font-size: var(--text-sm); line-height: 1.45;
    }
    .cd-info p, .cd-info dl, .cd-info dd { margin: 0; }
    .cd-info dl { display: grid; gap: .25rem; }
    .cd-info dt { font-weight: 700; }
    .cd-info dd { color: rgb(var(--ink-700)); margin-bottom: .25rem; }
    .cd-minor { display: flex; gap: .5rem; align-items: flex-start; color: rgb(var(--ink-700)); cursor: pointer; }
    .cd-minor input { margin-top: .15rem; flex: none; }

    /* Recording */
    .cd-rec { display: inline-flex; align-items: center; gap: .375rem; font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
    .cd-dot { width: .625rem; height: .625rem; border-radius: 50%; background: rgb(var(--on-inverse-muted)); }
    .cd-rec.live .cd-dot { background: rgb(var(--critical-500)); animation: cd-pulse 1.6s ease-in-out infinite; }
    @keyframes cd-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
    .cd-meter { width: .375rem; height: 1.5rem; border-radius: var(--radius-full); background: rgb(var(--on-inverse) / .2);
      overflow: hidden; display: flex; align-items: flex-end; flex: none; }
    .cd-meter span { display: block; width: 100%; height: 100%; background: rgb(var(--positive-500)); transform-origin: bottom; transition: transform .1s linear; }

    .cd-now { flex: 1; min-width: 0; display: flex; align-items: center; gap: .5rem; }
    .cd-heard { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cd-heard.muted { color: rgb(var(--on-inverse-muted)); }
    .cd-line { display: inline-flex; align-items: center; gap: .375rem; min-width: 0; font-weight: 600; text-align: start;
      background: none; border: 0; color: inherit; font: inherit; padding: 0; }
    .cd-line app-icon.mi { font-size: var(--text-lg); flex: none; }
    .cd-line.caution app-icon.mi { color: rgb(var(--caution-400)); }
    .cd-line.critical app-icon.mi { color: rgb(var(--critical-400)); }
    .cd-line.action { cursor: pointer; text-decoration: underline; }
    .cd > .cd-line.critical { flex-basis: 100%; order: 10; }

    .cd-end {
      display: inline-flex; align-items: center; gap: .375rem; min-height: 2.75rem; padding: 0 1rem;
      border-radius: var(--radius-lg); border: 0; font-weight: 700; white-space: nowrap;
      background: rgb(var(--critical-600)); color: rgb(var(--on-inverse));
    }
    .cd-end:disabled { opacity: .6; cursor: default; }
    .cd-end app-icon.mi { font-size: var(--text-lg); }

    /* Analysing */
    .cd-analysis { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: .25rem .625rem; min-height: 2.75rem; }
    .cd-step { color: rgb(var(--on-inverse-muted)); }
    .cd-analysis progress { flex: 1 1 8rem; height: .5rem; accent-color: rgb(var(--positive-500)); }
    .cd-spin { font-size: var(--text-xl); animation: cd-spin 1.4s linear infinite; }
    @keyframes cd-spin { to { transform: rotate(360deg); } }

    .cd button:focus-visible, .cd select:focus-visible, .cd input:focus-visible { outline: 2px solid var(--focus-ring-inverse); outline-offset: 2px; }
    .cd-info input:focus-visible { outline-color: var(--focus-ring); }

    /* A phone: the last sentence is in the cockpit's own strip; alerts take a row of their own; Start and End fill theirs. */
    @media (max-width: 639.98px) {
      .cd { gap: .375rem; padding: .375rem .5rem; }
      .cd-badge { display: none; }
      .cd[data-drawer='ready'] .cd-spacer { flex-basis: 100%; height: 0; }
      .cd[data-drawer='ready'] .cd-start { flex: 1; justify-content: center; }
      .cd-now:not(.is-alert) { display: none; }
      .cd-now.is-alert { flex-basis: 100%; order: 10; }
      .cd[data-drawer='recording'] .cd-end { flex: 1 1 0; min-width: 0; justify-content: center; white-space: normal; line-height: 1.2; }
    }
    @media (max-width: 379.98px) { .cd-chip .cd-label { display: none; } }
    @media (prefers-reduced-motion: reduce) { .cd-rec.live .cd-dot, .cd-spin { animation: none; } .cd-meter span { transition: none; } }
  `],
})
export class ConsultationDrawerComponent {
  protected readonly c = inject(ConsultationService);
  protected readonly voice = inject(VoiceOrchestratorService);
  protected readonly inputLanguage = inject(InputLanguageService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** The doctor told this patient. The server refuses to start without it and records when. */
  readonly informed = signal(false);
  /** Remembered when the recording starts, never before: the box alone attests nothing. */
  readonly dontAskAgain = signal(false);
  readonly infoOpen = signal(false);

  private readonly ack = viewChild<ElementRef<HTMLInputElement>>('ack');
  private readonly now = signal(Date.now());

  readonly state = computed<DrawerState | null>(() => {
    if (this.c.analysis()) return 'analysing';
    if (this.c.isRecording()) return 'recording';
    if (this.c.intro() && !this.c.isOpen()) return 'ready';
    return null;
  });

  constructor() {
    const timer = setInterval(() => { if (this.c.isRecording()) this.now.set(Date.now()); }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // Each consultation is attested afresh: the boxes are blank whenever the bar opens.
    effect(() => {
      if (this.state() !== 'ready') {
        untracked(() => { this.informed.set(false); this.dontAskAgain.set(false); this.infoOpen.set(false); });
      }
    });
    // Opened from the menu, the keyboard lands on the one thing to do before Start.
    effect(() => this.ack()?.nativeElement.focus());
  }

  protected readonly live = computed(() => this.c.listening() && !this.voice.paused() && !this.voice.microphoneSuspended());

  protected readonly elapsed = computed(() => {
    const started = this.c.consultation()?.startedAt;
    if (!started) return '0:00';
    const seconds = Math.max(0, Math.floor((this.now() - new Date(started).getTime()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  protected readonly lastLine = computed(() => this.c.lines().at(-1)?.text ?? null);

  /** One line at a time, the most serious first — the same order as the cockpit's. */
  protected readonly alert = computed<RecordingAlert>(() => {
    if (!this.c.listening()) return 'mic-off';
    if (this.voice.microphoneSuspended()) return 'suspended';
    if (this.voice.error()) return 'error';
    if (this.voice.transcriptionIssue()) return 'service';
    if (this.voice.paused()) return 'paused';
    return null;
  });

  /** The attestation in full, for screen readers and the ⓘ: it names what is kept. */
  protected readonly ackKey = computed(() => !this.c.retainTranscript() ? 'CONSULTATION.INTRO_ACK_NOT_KEPT'
    : this.c.keepAudio() ? 'CONSULTATION.INTRO_ACK_AUDIO' : 'CONSULTATION.INTRO_ACK');

  protected readonly endKey = computed(() => this.c.busy() ? 'VOICE.ENDING'
    : this.c.deferred() ? 'CONSULTATION.END_DEFERRED' : 'CONSULTATION.END');

  protected chooseMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ConsultationMode;
    if (value === 'LIVE' || value === 'DEFERRED') this.c.chooseMode(value);
  }

  /** Reached synchronously from the tap: the service opens the microphone before it awaits anything. */
  protected start(): void {
    if (!this.informed() || this.c.starting()) return;
    if (this.dontAskAgain()) this.c.setIntroHidden(true);
    if (this.voice.needsConsent()) this.voice.grantMicrophoneConsent();
    void this.c.start();
  }

  protected close(): void {
    this.c.closeIntro();
  }

  protected togglePause(): void {
    this.voice.setPaused(!this.voice.paused());
  }

  protected cycleLanguage(): void {
    const order = INPUT_LANGUAGES;
    this.inputLanguage.set(order[(order.indexOf(this.inputLanguage.language()) + 1) % order.length]);
  }

  /** Escape folds the explanations away; a click outside the bar does too. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.infoOpen()) this.infoOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.infoOpen() && !(this.host.nativeElement as HTMLElement).contains(event.target as Node)) this.infoOpen.set(false);
  }
}
