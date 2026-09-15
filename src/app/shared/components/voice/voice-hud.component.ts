import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { VoiceContextService } from '../../../core/voice/voice-context.service';
import { VoiceCommandRegistryService } from '../../../core/voice/voice-command-registry.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { SpeechFeedbackService } from '../../../core/voice/speech-feedback.service';

/**
 * The always-visible state of the voice assistant.
 *
 * Audit XII.4 §8: the user must always know whether the microphone is hot,
 * what was heard, and what the system decided it meant. Everything the
 * pipeline resolves surfaces here — the live partial transcript, the final
 * utterance, the *interpreted* command in application terms, the pending
 * confirmation, and the undo window.
 *
 * The typed-command box is not a fallback afterthought. It runs the identical
 * pipeline, which makes the whole system exercisable without a microphone
 * (and usable in browsers with no SpeechRecognition at all) — the same
 * argument audit XII.6 makes for shipping the command palette before voice.
 */
@Component({
  selector: 'app-voice-hud',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible()) {
      <div class="voice-hud" [class.expanded]="expanded()" [attr.data-state]="voice.state()">

        <!-- Transcript / interpretation / prompts -->
        @if (expanded()) {
          <div class="hud-body">
            <div class="hud-header">
              <span class="hud-title">
                <span class="material-icons" aria-hidden="true">graphic_eq</span>
                Voice assistant
              </span>
              <div class="hud-header-actions">
                <button type="button" class="icon-btn" (click)="feedback.toggle()"
                        [attr.aria-label]="feedback.enabled() ? 'Mute spoken confirmations' : 'Unmute spoken confirmations'"
                        [title]="feedback.enabled() ? 'Spoken confirmations on' : 'Spoken confirmations off'">
                  <span class="material-icons">{{ feedback.enabled() ? 'volume_up' : 'volume_off' }}</span>
                </button>
                <button type="button" class="icon-btn" (click)="showHelp.set(!showHelp())"
                        aria-label="What can I say?" title="What can I say?">
                  <span class="material-icons">help_outline</span>
                </button>
                <button type="button" class="icon-btn" (click)="expanded.set(false)" aria-label="Collapse">
                  <span class="material-icons">expand_more</span>
                </button>
              </div>
            </div>

            @if (voice.needsConsent()) {
              <div class="hud-consent" role="region" aria-label="Microphone consent">
                <p class="consent-title">Before turning on the microphone</p>
                <p class="consent-body">
                  A consultation-room microphone picks up everything said nearby, not only your
                  commands — including information about the patient and anyone else present.
                  @if (!voice.recognitionIsLocal()) {
                    <strong>This browser sends the captured audio to a cloud speech service to be
                    transcribed.</strong> Safari keeps recognition on this device.
                  } @else {
                    This browser performs recognition on this device.
                  }
                </p>
                <p class="consent-body">
                  Typed commands work without the microphone and disclose nothing.
                </p>
                <button type="button" class="btn-confirm" (click)="voice.grantMicrophoneConsent()">
                  <span class="material-icons">mic</span> I understand — enable the microphone
                </button>
              </div>
            }

            <p class="hud-status" aria-live="polite">{{ statusLine() }}</p>

            @if (voice.interimTranscript()) {
              <p class="hud-interim">{{ voice.interimTranscript() }}</p>
            }

            @if (voice.transcript() && !voice.interimTranscript()) {
              <p class="hud-heard"><span class="label">Heard</span>{{ voice.transcript() }}</p>
            }

            <!-- The resolved reading, never an echo of the words -->
            @if (voice.interpretation(); as interpretation) {
              <p class="hud-interpretation"><span class="label">Understood as</span>{{ interpretation }}</p>
            }

            <!-- Confirmation gate for every clinical write -->
            @if (voice.confirmation(); as pending) {
              <div class="hud-confirm" role="alertdialog" aria-live="assertive">
                <p class="confirm-preview">{{ pending.preview }}</p>
                @if (pending.reason === 'low-confidence') {
                  <p class="confirm-reason">I'm not fully confident I heard that correctly.</p>
                }
                <div class="confirm-actions">
                  <button type="button" class="btn-confirm" (click)="voice.confirmPending()">
                    <span class="material-icons">check</span> Confirm
                  </button>
                  <button type="button" class="btn-discard" (click)="voice.rejectPending()">
                    <span class="material-icons">close</span> Discard
                  </button>
                </div>
                <p class="confirm-hint">Say “yes” to confirm or “no” to discard.</p>
              </div>
            }

            <!-- A question, rather than a guess -->
            @if (voice.clarification(); as clarification) {
              <div class="hud-clarify" role="alertdialog" aria-live="assertive">
                <p class="clarify-question">{{ clarification.question }}</p>
                @if (clarification.options.length) {
                  <div class="clarify-options">
                    @for (option of clarification.options; track option.value) {
                      <button type="button" class="chip"
                              (click)="voice.answerClarificationOption(option.value)">
                        {{ option.label }}
                      </button>
                    }
                  </div>
                }
                <button type="button" class="link-btn" (click)="voice.dismissClarification()">Never mind</button>
              </div>
            }

            @if (voice.error(); as error) {
              <p class="hud-error">{{ error }}</p>
            }

            @if (voice.undoAvailable(); as undo) {
              <button type="button" class="hud-undo" (click)="voice.undoLast()">
                <span class="material-icons">undo</span> Undo “{{ undo.label }}”
              </button>
            }

            @if (showHelp()) {
              <div class="hud-help">
                <p class="help-title">You can say, here:</p>
                <ul>
                  @for (entry of help(); track entry.command.id) {
                    <li>
                      <span class="help-example">“{{ entry.examples[0] }}”</span>
                      @if (entry.command.risk === 'CONFIRM') { <span class="tag">confirms first</span> }
                      @if (entry.command.risk === 'BLOCKED') { <span class="tag blocked">on screen only</span> }
                    </li>
                  }
                </ul>
                @if (!voice.recognitionIsLocal()) {
                  <p class="help-note">
                    <span class="material-icons">info</span>
                    This browser sends audio to a cloud speech service. Safari keeps recognition
                    on this device.
                  </p>
                }
                @if (!voice.needsConsent() && voice.isSupported()) {
                  <button type="button" class="link-btn" (click)="voice.revokeMicrophoneConsent()">
                    Turn the microphone off and require consent again
                  </button>
                }
              </div>
            }

            <!-- Identical pipeline, no microphone required -->
            <form class="hud-typed" (submit)="submitTyped($event)">
              <input type="text" [(ngModel)]="typed" name="typed"
                     [placeholder]="typedPlaceholder()"
                     aria-label="Type a command instead of speaking" autocomplete="off" />
              <button type="submit" class="icon-btn" aria-label="Send command">
                <span class="material-icons">send</span>
              </button>
            </form>
          </div>
        }

        <!-- Control bar -->
        <div class="hud-bar">
          <div class="mic-wrap">
            <button type="button"
                    class="mic-btn"
                    [class.listening]="voice.isListening()"
                    [class.session]="voice.examinationMode()"
                    [class.processing]="voice.state() === 'processing' || voice.state() === 'executing'"
                    [disabled]="!voice.isSupported()"
                    (click)="toggleMic()"
                    [attr.aria-label]="voice.isListening() ? 'Stop listening' : 'Start listening'"
                    [title]="micTitle()">
              <span class="material-icons">{{ voice.isListening() ? 'mic' : 'mic_none' }}</span>
            </button>

            <!-- Waveform: shown only while listening -->
            @if (voice.isListening()) {
              <div class="waveform" aria-hidden="true">
                <span class="bar"></span>
                <span class="bar"></span>
                <span class="bar"></span>
                <span class="bar"></span>
                <span class="bar"></span>
              </div>
            }

            <!-- Processing spinner: shown while the NLU or execute is running -->
            @if (voice.state() === 'processing' || voice.state() === 'executing') {
              <div class="proc-ring" aria-hidden="true"></div>
            }
          </div>

          <button type="button" class="bar-label" (click)="expanded.set(!expanded())">
            <span class="dot" [attr.data-state]="voice.state()"></span>
            {{ shortStatus() }}
          </button>

          @if (session.isActive()) {
            <button type="button" class="exam-pill" (click)="session.openSummary()" title="Examination in progress">
              <span class="material-icons">fiber_manual_record</span> Examining
            </button>
          } @else if (hasPatient()) {
            <button type="button" class="exam-pill start" (click)="startExamination()"
                    title="Start a dictated examination">
              <span class="material-icons">play_arrow</span> Examine
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .voice-hud {
      position: fixed;
      bottom: 1.5rem;
      left: 1.5rem;
      z-index: 1100;
      width: min(23rem, calc(100vw - 3rem));
      font-size: 0.875rem;
      color: rgb(var(--ink-900));
    }
    :host-context([dir='rtl']) .voice-hud { left: auto; right: 1.5rem; }

    .hud-body {
      background: #fff;
      border: 1px solid rgb(var(--ink-200));
      border-radius: 16px 16px 12px 12px;
      box-shadow: 0 18px 40px -12px rgba(15, 23, 42, 0.28);
      padding: 0.875rem 1rem;
      margin-bottom: 0.5rem;
      max-height: 60vh;
      overflow-y: auto;
    }
    .hud-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
    .hud-title { display: flex; align-items: center; gap: 0.375rem; font-weight: 700; font-size: 0.8125rem; }
    .hud-title .material-icons { font-size: 1.125rem; color: rgb(var(--petrol-600)); }
    .hud-header-actions { display: flex; gap: 0.125rem; }

    .icon-btn {
      background: none; border: none; cursor: pointer; color: rgb(var(--ink-500));
      display: flex; align-items: center; padding: 0.25rem; border-radius: 6px;
    }
    .icon-btn:hover { background: rgb(var(--ink-100)); color: rgb(var(--ink-900)); }
    .icon-btn .material-icons { font-size: 1.125rem; }

    .hud-status { margin: 0 0 0.5rem; color: rgb(var(--ink-500)); font-size: 0.8125rem; }
    .hud-interim { margin: 0 0 0.5rem; color: rgb(var(--ink-400)); font-style: italic; min-height: 1.2em; }
    .hud-heard, .hud-interpretation { margin: 0 0 0.5rem; line-height: 1.45; }
    .label {
      display: block; font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
      color: rgb(var(--ink-400)); font-weight: 700; margin-bottom: 0.125rem;
    }
    .hud-interpretation { color: rgb(var(--petrol-700)); font-weight: 600; }

    .hud-confirm {
      border: 1px solid rgb(var(--caution-300)); background: rgb(var(--caution-50));
      border-radius: 10px; padding: 0.75rem; margin: 0.5rem 0;
    }
    .confirm-preview { margin: 0 0 0.5rem; font-weight: 600; line-height: 1.45; }
    .confirm-reason { margin: 0 0 0.5rem; font-size: 0.8125rem; color: rgb(var(--caution-700)); }
    .confirm-actions { display: flex; gap: 0.5rem; }
    .btn-confirm, .btn-discard {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.25rem;
      border-radius: 8px; padding: 0.5rem; font-weight: 600; cursor: pointer; font-size: 0.8125rem;
      border: 1px solid transparent;
    }
    .btn-confirm { background: rgb(var(--positive-600)); color: #fff; }
    .btn-confirm:hover { background: rgb(var(--positive-700)); }
    .btn-discard { background: #fff; color: rgb(var(--ink-600)); border-color: rgb(var(--ink-300)); }
    .btn-discard:hover { background: rgb(var(--ink-50)); }
    .btn-confirm .material-icons, .btn-discard .material-icons { font-size: 1rem; }
    .confirm-hint { margin: 0.5rem 0 0; font-size: 0.75rem; color: rgb(var(--caution-700)); }

    .hud-clarify {
      border: 1px solid rgb(var(--petrol-300)); background: rgb(var(--petrol-50));
      border-radius: 10px; padding: 0.75rem; margin: 0.5rem 0;
    }
    .clarify-question { margin: 0 0 0.5rem; font-weight: 600; line-height: 1.45; }
    .clarify-options { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-bottom: 0.5rem; }
    .chip {
      border: 1px solid rgb(var(--petrol-200)); background: #fff; color: rgb(var(--petrol-700));
      border-radius: 999px; padding: 0.25rem 0.625rem; font-size: 0.75rem; cursor: pointer; font-weight: 600;
    }
    .chip:hover { background: rgb(var(--petrol-100)); }
    .link-btn {
      background: none; border: none; color: rgb(var(--ink-500)); cursor: pointer;
      font-size: 0.75rem; text-decoration: underline; padding: 0;
    }

    .hud-consent {
      border: 1px solid rgb(var(--petrol-200)); background: rgb(var(--petrol-50));
      border-radius: 10px; padding: 0.75rem; margin-bottom: 0.625rem;
    }
    .consent-title { margin: 0 0 0.375rem; font-weight: 700; font-size: 0.8125rem; }
    .consent-body { margin: 0 0 0.5rem; font-size: 0.8125rem; line-height: 1.45; color: rgb(var(--ink-700)); }
    .hud-consent .btn-confirm { width: 100%; background: rgb(var(--petrol-600)); }
    .hud-consent .btn-confirm:hover { background: rgb(var(--petrol-700)); }

    .hud-error {
      margin: 0.5rem 0 0; padding: 0.5rem 0.625rem; border-radius: 8px;
      background: rgb(var(--critical-50)); border: 1px solid rgb(var(--critical-200)); color: rgb(var(--critical-700)); font-size: 0.8125rem;
    }

    .hud-undo {
      display: flex; align-items: center; gap: 0.375rem; width: 100%;
      margin-top: 0.5rem; padding: 0.5rem 0.625rem;
      border: 1px dashed rgb(var(--ink-300)); border-radius: 8px; background: rgb(var(--ink-50));
      color: rgb(var(--ink-600)); cursor: pointer; font-size: 0.8125rem; font-weight: 600;
    }
    .hud-undo:hover { background: rgb(var(--ink-100)); }
    .hud-undo .material-icons { font-size: 1rem; }

    .hud-help { margin-top: 0.75rem; border-top: 1px solid rgb(var(--ink-200)); padding-top: 0.625rem; }
    .help-title { margin: 0 0 0.375rem; font-size: 0.75rem; font-weight: 700; color: rgb(var(--ink-600)); }
    .hud-help ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .hud-help li { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
    .help-example { color: rgb(var(--ink-700)); font-size: 0.8125rem; }
    .tag {
      font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
      background: rgb(var(--caution-100)); color: rgb(var(--caution-700)); border-radius: 4px; padding: 0.0625rem 0.25rem;
    }
    .tag.blocked { background: rgb(var(--critical-100)); color: rgb(var(--critical-700)); }
    .help-note {
      display: flex; gap: 0.375rem; margin: 0.5rem 0 0; font-size: 0.75rem; color: rgb(var(--ink-500)); line-height: 1.4;
    }
    .help-note .material-icons { font-size: 0.9375rem; flex-shrink: 0; }

    .hud-typed { display: flex; gap: 0.375rem; margin-top: 0.75rem; }
    .hud-typed input {
      flex: 1; border: 1px solid rgb(var(--ink-300)); border-radius: 8px;
      padding: 0.4375rem 0.625rem; font-size: 0.8125rem; font-family: inherit; color: rgb(var(--ink-900));
    }
    .hud-typed input:focus { outline: 2px solid rgb(var(--petrol-300)); outline-offset: -1px; border-color: rgb(var(--petrol-400)); }

    .hud-bar {
      display: flex; align-items: center; gap: 0.5rem;
      background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 999px;
      padding: 0.3125rem 0.75rem 0.3125rem 0.3125rem;
      box-shadow: 0 8px 20px -6px rgba(15, 23, 42, 0.22);
    }

    .mic-wrap {
      position: relative; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }

    .mic-btn {
      width: 2.25rem; height: 2.25rem; border-radius: 50%; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      background: rgb(var(--ink-900)); color: #fff; transition: background 0.15s;
      position: relative; z-index: 1;
    }
    .mic-btn:hover:not(:disabled) { background: rgb(var(--ink-700)); }
    .mic-btn:disabled { background: rgb(var(--ink-300)); cursor: not-allowed; }
    .mic-btn.listening { background: rgb(var(--critical-600)); animation: mic-pulse 1.6s ease-in-out infinite; }
    .mic-btn.session { background: rgb(var(--critical-600)); }
    .mic-btn.processing { background: rgb(var(--petrol-600)); }
    .mic-btn .material-icons { font-size: 1.25rem; }

    /* Animated waveform: five bars that bounce at staggered delays */
    .waveform {
      position: absolute; left: calc(100% + 0.375rem);
      display: flex; align-items: center; gap: 2px; height: 1.25rem;
    }
    .bar {
      width: 3px; border-radius: 999px;
      background: rgb(var(--critical-500));
      animation: bar-bounce 0.9s ease-in-out infinite;
    }
    .bar:nth-child(1) { height: 0.4rem; animation-delay: 0s; }
    .bar:nth-child(2) { height: 0.75rem; animation-delay: 0.1s; }
    .bar:nth-child(3) { height: 1.1rem; animation-delay: 0.2s; }
    .bar:nth-child(4) { height: 0.7rem; animation-delay: 0.3s; }
    .bar:nth-child(5) { height: 0.45rem; animation-delay: 0.4s; }

    /* Processing/executing ring spinner around the mic button */
    .proc-ring {
      position: absolute; inset: -3px; border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: rgb(var(--petrol-500));
      border-right-color: rgb(var(--petrol-300));
      animation: spin 0.8s linear infinite;
      pointer-events: none;
    }

    .bar-label {
      flex: 1; display: flex; align-items: center; gap: 0.375rem;
      background: none; border: none; cursor: pointer; padding: 0;
      font-size: 0.8125rem; color: rgb(var(--ink-600)); font-weight: 600; text-align: start;
    }
    .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: rgb(var(--ink-400)); flex-shrink: 0; }
    .dot[data-state='listening'] { background: rgb(var(--critical-600)); }
    .dot[data-state='processing'], .dot[data-state='executing'] { background: rgb(var(--petrol-600)); }
    .dot[data-state='awaiting-confirmation'] { background: rgb(var(--caution-400)); }
    .dot[data-state='awaiting-clarification'] { background: rgb(var(--petrol-500)); }
    .dot[data-state='error'] { background: rgb(var(--critical-700)); }

    .exam-pill {
      display: flex; align-items: center; gap: 0.1875rem; border: none; cursor: pointer;
      border-radius: 999px; padding: 0.25rem 0.5rem; font-size: 0.6875rem; font-weight: 700;
      background: rgb(var(--critical-100)); color: rgb(var(--critical-700)); text-transform: uppercase; letter-spacing: 0.03em;
    }
    .exam-pill.start { background: rgb(var(--petrol-50)); color: rgb(var(--petrol-700)); }
    .exam-pill .material-icons { font-size: 0.75rem; }

    @keyframes mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5); }
      50% { box-shadow: 0 0 0 0.5rem rgba(220, 38, 38, 0); }
    }
    @keyframes bar-bounce {
      0%, 100% { transform: scaleY(0.5); opacity: 0.6; }
      50%       { transform: scaleY(1.3); opacity: 1; }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .mic-btn.listening, .bar, .proc-ring { animation: none; }
    }
  `],
})
export class VoiceHudComponent {
  voice = inject(VoiceOrchestratorService);
  context = inject(VoiceContextService);
  session = inject(VoiceSessionService);
  feedback = inject(SpeechFeedbackService);
  private registry = inject(VoiceCommandRegistryService);

  expanded = signal(false);
  showHelp = signal(false);
  typed = '';

  /**
   * Shown even where recognition is unavailable: the typed box still drives
   * the full pipeline, and hiding the assistant entirely would leave the
   * doctor with no explanation of why it is missing.
   */
  visible = computed(() => true);

  help = computed(() => this.registry.helpFor(this.context.snapshot()).slice(0, 8));
  hasPatient = computed(() => this.context.snapshot().patientId !== null);

  statusLine = computed(() => {
    if (!this.voice.isSupported()) {
      return 'Speech recognition isn\'t available in this browser — type a command instead.';
    }
    if (this.voice.needsConsent()) {
      return 'Microphone off until you enable it. Typed commands work now.';
    }
    switch (this.voice.state()) {
      case 'listening':
        return this.voice.examinationMode()
          ? 'Examination mode — dictate findings, say “end examination” when done.'
          : 'Listening…';
      case 'processing': return 'Working out what you meant…';
      case 'executing': return 'Recording…';
      case 'awaiting-confirmation': return 'Waiting for you to confirm.';
      case 'awaiting-clarification': return 'I need one more detail.';
      case 'error': return 'Something went wrong.';
      default: return 'Tap the microphone, or type a command.';
    }
  });

  shortStatus = computed(() => {
    switch (this.voice.state()) {
      case 'listening': return this.voice.examinationMode() ? 'Examining' : 'Listening';
      case 'processing': return 'Thinking';
      case 'executing': return 'Saving';
      case 'awaiting-confirmation': return 'Confirm?';
      case 'awaiting-clarification': return 'Question';
      case 'error': return 'Error';
      default: return 'Voice';
    }
  });

  toggleMic(): void {
    if (this.voice.needsConsent()) {
      this.expanded.set(true);
      return;
    }
    this.voice.toggleListening();
  }

  micTitle = computed(() =>
    this.voice.isSupported()
      ? (this.voice.isListening() ? 'Stop listening (⌘⇧V)' : 'Start listening (⌘⇧V)')
      : 'Speech recognition is not available in this browser',
  );

  typedPlaceholder = computed(() =>
    this.hasPatient()
      ? 'e.g. upper right first molar: recurrent caries'
      : 'e.g. open the schedule',
  );

  submitTyped(event: Event): void {
    event.preventDefault();
    const text = this.typed.trim();
    if (!text) return;
    this.typed = '';
    this.expanded.set(true);
    void this.voice.handleTranscript(text);
  }

  startExamination(): void {
    this.expanded.set(true);
    void this.voice.handleTranscript('start examination');
  }
}
