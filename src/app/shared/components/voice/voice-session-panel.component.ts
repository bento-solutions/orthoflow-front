import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { VoiceOrchestratorService, BufferedEntry } from '../../../core/voice/voice-orchestrator.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { VoiceContextService } from '../../../core/voice/voice-context.service';
import { SpeechFeedbackService } from '../../../core/voice/speech-feedback.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { COMMAND_EXAMPLES, spokenFindingLabel, spokenLanguage } from '../../../core/voice/voice-vocabulary';
import { entityString, stagedFindingCodes } from '../../../core/voice/voice-intent.model';
import { findingKind } from '../../../core/voice/clinical-lexicon';
import { describeFdi } from '../../../core/voice/tooth-lexicon';
import { DentalChartComponent } from '../../../features/dental-chart/dental-chart.component';
import { SessionReviewComponent } from '../../../features/patients/session-review/session-review.component';
import { DentalChartState, ToothState } from '../../../core/models/patient.model';
import { ToothFinding } from '../../../core/models/clinical-record.model';
import { PatientTreatment } from '../../../core/models/patient-treatment.model';

/**
 * The status line both the panel and the dock show, as a translation key.
 * One function so the two can never disagree about what the microphone is
 * doing.
 */
export function sessionStatusKey(voice: VoiceOrchestratorService, awake: boolean): string {
  if (!voice.examinationMode()) return 'VOICE.STATUS_MIC_OFF';
  if (voice.state() === 'error') return 'VOICE.STATUS_ERROR';
  if (voice.microphoneSuspended()) return 'VOICE.STATUS_SUSPENDED';
  if (voice.paused()) return 'VOICE.STATUS_PAUSED';
  if (voice.confirmation()) return 'VOICE.STATUS_CONFIRM';
  if (voice.clarification()) return 'VOICE.STATUS_QUESTION';
  if (voice.userSpeaking()) return 'VOICE.STATUS_HEARING';
  if (voice.pendingTranscriptions() > 0 || voice.state() === 'processing') return 'VOICE.STATUS_TRANSCRIBING';
  return awake ? 'VOICE.STATUS_AWAKE' : 'VOICE.STATUS_LISTENING';
}

type Phase = 'consent' | 'idle' | 'interrupted' | 'live' | 'review' | 'saved';

interface ToothGroup {
  fdi: string;
  description: string;
  entries: BufferedEntry[];
}

/**
 * Where a dictated examination is shown — all of it, inside the dossier.
 *
 * Voice used to scatter its results: a selected tooth switched the dossier
 * to its Clinical tab and the 3D viewer, and ending the session navigated to
 * a separate review page. For a dentist who cannot touch the screen that is
 * the worst possible behaviour — the view they were verifying against moved
 * without them. This panel keeps one stable workspace for the whole
 * consultation: the chart with what is staged drawn on it, the list of what
 * was dictated grouped by tooth, whatever the assistant is asking, and then
 * the review, in the same place.
 *
 * Mobile-first: one column, large targets, the chart first because it is
 * what a glance should confirm. The controls a dentist needs mid-examination
 * live in the dock pinned to the bottom of the screen.
 */
@Component({
  selector: 'app-voice-session-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, DentalChartComponent, SessionReviewComponent],
  template: `
    <section class="vs" [attr.data-phase]="phase()">
      <header class="vs-head">
        <div class="vs-title">
          <span class="vs-dot" [class.live]="phase() === 'live' && !voice.paused()" aria-hidden="true"></span>
          <h2>{{ (phase() === 'review' ? 'VOICE.REVIEW_TITLE' : 'VOICE.PANEL_TITLE') | translate }}</h2>
          @if (elapsed(); as time) {
            <span class="vs-elapsed">{{ time }}</span>
          }
        </div>
        <div class="vs-head-actions">
          <button type="button" class="icon-btn" (click)="feedback.toggle()"
                  [attr.aria-label]="(feedback.enabled() ? 'VOICE.AUDIO_ON' : 'VOICE.AUDIO_OFF') | translate"
                  [attr.aria-pressed]="feedback.enabled()"
                  [title]="(feedback.enabled() ? 'VOICE.AUDIO_ON' : 'VOICE.AUDIO_OFF') | translate">
            <span class="material-icons" aria-hidden="true">{{ feedback.enabled() ? 'volume_up' : 'volume_off' }}</span>
          </button>
          <button type="button" class="icon-btn" [class.active]="showHelp()" (click)="showHelp.set(!showHelp())"
                  [attr.aria-label]="'VOICE.HELP' | translate" [attr.aria-expanded]="showHelp()"
                  [title]="'VOICE.HELP' | translate">
            <span class="material-icons" aria-hidden="true">help_outline</span>
          </button>
        </div>
      </header>

      @if (showHelp()) {
        <div class="card vs-help">
          <p class="vs-help-title">{{ 'VOICE.HELP_TITLE' | translate }}</p>
          <ul class="vs-examples">
            @for (example of examples(); track example) {
              <li>“{{ example }}”</li>
            }
          </ul>
          <p class="vs-note"><span class="material-icons" aria-hidden="true">record_voice_over</span>{{ 'VOICE.HOW_WAKE' | translate }}</p>
          <p class="vs-note"><span class="material-icons" aria-hidden="true">bolt</span>{{ 'VOICE.HOW_DIRECT' | translate }}</p>
          @if (!voice.needsConsent() && phase() !== 'live') {
            <button type="button" class="link-btn" (click)="voice.revokeMicrophoneConsent()">{{ 'VOICE.REVOKE' | translate }}</button>
          }
        </div>
      }

      @switch (phase()) {
        @case ('consent') {
          <div class="card vs-intro">
            <span class="material-icons vs-intro-icon" aria-hidden="true">mic</span>
            <h3>{{ 'VOICE.CONSENT_TITLE' | translate }}</h3>
            <p>{{ 'VOICE.CONSENT_BODY' | translate }}</p>
            <ul class="vs-how">
              <li>{{ 'VOICE.HOW_WAKE' | translate }}</li>
              <li>{{ 'VOICE.HOW_DIRECT' | translate }}</li>
            </ul>
            <button type="button" class="btn-big primary" (click)="consent()" [disabled]="starting()">
              <span class="material-icons" aria-hidden="true">mic</span>
              {{ (starting() ? 'VOICE.STARTING' : 'VOICE.CONSENT_ACCEPT') | translate }}
            </button>
          </div>
        }

        @case ('idle') {
          <div class="card vs-intro">
            <span class="material-icons vs-intro-icon" aria-hidden="true">mic</span>
            <p>{{ 'VOICE.IDLE_BODY' | translate }}</p>
            <ul class="vs-how">
              <li>{{ 'VOICE.HOW_WAKE' | translate }}</li>
              <li>{{ 'VOICE.HOW_DIRECT' | translate }}</li>
            </ul>
            <button type="button" class="btn-big primary" (click)="begin.emit()" [disabled]="starting()">
              <span class="material-icons" aria-hidden="true">mic</span>
              {{ (starting() ? 'VOICE.STARTING' : 'VOICE.START') | translate }}
            </button>
            @if (voice.error(); as error) {
              <p class="vs-alert critical" role="alert">{{ error }}</p>
            }
          </div>
        }

        @case ('saved') {
          <div class="card vs-intro done">
            <span class="material-icons vs-intro-icon" aria-hidden="true">task_alt</span>
            <h3>{{ 'VOICE.SAVED_TITLE' | translate }}</h3>
            <p>{{ 'VOICE.SAVED_BODY' | translate }}</p>
            <button type="button" class="btn-big primary" (click)="begin.emit()" [disabled]="starting()">
              <span class="material-icons" aria-hidden="true">mic</span>
              {{ (starting() ? 'VOICE.STARTING' : 'VOICE.NEW_SESSION') | translate }}
            </button>
          </div>
          <ng-container *ngTemplateOutlet="chartCard" />
        }

        @case ('interrupted') {
          <div class="card vs-intro warn">
            <span class="material-icons vs-intro-icon" aria-hidden="true">mic_off</span>
            <h3>{{ 'VOICE.INTERRUPTED_TITLE' | translate }}</h3>
            <p>{{ 'VOICE.INTERRUPTED_BODY' | translate }}</p>
            @if (voice.error(); as error) {
              <p class="vs-alert critical" role="alert">{{ error }}</p>
            }
            <div class="vs-actions">
              <button type="button" class="btn-big primary" (click)="begin.emit()" [disabled]="starting()">
                <span class="material-icons" aria-hidden="true">mic</span>
                {{ (starting() ? 'VOICE.STARTING' : 'VOICE.RESUME') | translate }}
              </button>
              <button type="button" class="btn-big" (click)="endSession()" [disabled]="session.busy()">
                <span class="material-icons" aria-hidden="true">fact_check</span>
                {{ 'VOICE.END_AND_REVIEW' | translate }}
              </button>
            </div>
            <button type="button" class="link-btn danger" (click)="discardSession()">{{ 'VOICE.DISCARD' | translate }}</button>
          </div>
          <ng-container *ngTemplateOutlet="workspace" />
        }

        @case ('live') {
          @if (voice.microphoneSuspended()) {
            <button type="button" class="vs-alert action" (click)="voice.resumeMicrophone()">
              <span class="material-icons" aria-hidden="true">touch_app</span>
              {{ 'VOICE.MIC_SUSPENDED' | translate }}
            </button>
          }
          @if (voice.transcriptionIssue(); as issue) {
            <p class="vs-alert caution" role="status">
              <span class="material-icons" aria-hidden="true">cloud_off</span>{{ issue }}
            </p>
          }
          @if (voice.error(); as error) {
            <p class="vs-alert critical" role="alert">
              <span class="material-icons" aria-hidden="true">error</span>{{ error }}
            </p>
          }

          <!-- A question outranks everything else on screen. -->
          @if (voice.confirmation(); as pending) {
            <div class="card vs-prompt confirm" role="alertdialog" aria-live="assertive">
              <p class="vs-prompt-text">{{ pending.preview }}</p>
              <div class="vs-actions">
                <button type="button" class="btn-big positive" (click)="voice.confirmPending()">
                  <span class="material-icons" aria-hidden="true">check</span>{{ 'VOICE.CONFIRM' | translate }}
                </button>
                <button type="button" class="btn-big" (click)="voice.rejectPending()">
                  <span class="material-icons" aria-hidden="true">close</span>{{ 'VOICE.REJECT' | translate }}
                </button>
              </div>
              <p class="vs-hint">{{ 'VOICE.STATUS_CONFIRM' | translate }}</p>
            </div>
          }
          @if (voice.clarification(); as question) {
            <div class="card vs-prompt question" role="alertdialog" aria-live="assertive">
              <p class="vs-prompt-text">{{ question.question }}</p>
              @if (question.options.length) {
                <div class="vs-options">
                  @for (option of question.options; track option.value) {
                    <button type="button" class="vs-option" (click)="voice.answerClarificationOption(option.value)">
                      {{ option.label }}
                    </button>
                  }
                </div>
              }
              <button type="button" class="link-btn" (click)="voice.dismissClarification()">{{ 'VOICE.NEVER_MIND' | translate }}</button>
            </div>
          }

          <div class="card vs-live" aria-live="polite">
            <div class="vs-live-top">
              <div class="vs-meter" aria-hidden="true">
                <span [style.transform]="'scaleX(' + (voice.paused() ? 0 : voice.inputLevel()) + ')'"></span>
              </div>
              <p class="vs-status">{{ statusKey() | translate }}</p>
            </div>
            @if (voice.transcript()) {
              <p class="vs-line"><span class="vs-label">{{ 'VOICE.HEARD' | translate }}</span>{{ voice.transcript() }}</p>
            }
            @if (recentOutcome(); as outcome) {
              <p class="vs-line outcome" [class.bad]="!outcome.ok">
                <span class="vs-label">{{ 'VOICE.UNDERSTOOD' | translate }}</span>{{ outcome.message }}
              </p>
            }
            @if (voice.ignoredUtterance(); as ignored) {
              <p class="vs-line ignored">{{ 'VOICE.IGNORED' | translate: { text: ignored } }}</p>
            }
            @if (voice.undoAvailable()) {
              <button type="button" class="vs-undo" (click)="voice.undoLast()">
                <span class="material-icons" aria-hidden="true">undo</span>{{ 'VOICE.UNDO' | translate }}
              </button>
            }
          </div>

          <ng-container *ngTemplateOutlet="workspace" />

          <!-- The identical pipeline, for a moment when speaking is not an option. -->
          <form class="vs-typed" (submit)="submitTyped($event)">
            <input type="text" [(ngModel)]="typed" name="typed" autocomplete="off" enterkeyhint="send"
                   [placeholder]="'VOICE.TYPE_PLACEHOLDER' | translate"
                   [attr.aria-label]="'VOICE.TYPE_PLACEHOLDER' | translate" />
            <button type="submit" class="icon-btn solid" [attr.aria-label]="'VOICE.SEND' | translate">
              <span class="material-icons" aria-hidden="true">send</span>
            </button>
          </form>
        }

        @case ('review') {
          <div class="vs-grid">
            <ng-container *ngTemplateOutlet="chartCard" />
            <div class="card">
              <app-session-review [sessionId]="session.session()?.id ?? null" [patientId]="patientId()"
                                  [embedded]="true" (finished)="onReviewFinished($event)" />
            </div>
          </div>
        }
      }

      <ng-template #chartCard>
        <div class="card vs-chart">
          <div class="vs-card-head">
            <h3>{{ 'DENTAL_CHART.TITLE' | translate }}</h3>
            @if (stagedTeeth().length || focusFdi()) {
              <div class="vs-legend">
                <span><i class="swatch staged"></i>{{ 'VOICE.LEGEND_STAGED' | translate }}</span>
                <span><i class="swatch focus"></i>{{ 'VOICE.LEGEND_FOCUS' | translate }}</span>
              </div>
            }
          </div>
          @if (chart(); as state) {
            <app-dental-chart
              [chartType]="state.chartType"
              [patientId]="state.patientId"
              [teeth]="state.teeth"
              [interactive]="true"
              [statusMenu]="false"
              [patientTreatments]="treatments()"
              [findings]="findings()"
              [stagedTeeth]="phase() === 'saved' ? [] : stagedTeeth()"
              [focusFdi]="phase() === 'saved' ? null : focusFdi()"
              (toothSelected)="onToothSelected($event)"
            />
          }
          @if (phase() === 'live' || phase() === 'interrupted') {
            <p class="vs-hint">{{ 'VOICE.TAP_TOOTH_HINT' | translate }}</p>
          }
        </div>
      </ng-template>

      <ng-template #workspace>
        <div class="vs-grid">
          <ng-container *ngTemplateOutlet="chartCard" />

          <div class="card vs-staged">
            <div class="vs-card-head">
              <h3>{{ 'VOICE.STAGED_TITLE' | translate }}</h3>
              <span class="vs-count">{{ 'VOICE.ENTRIES' | translate: { count: voice.buffered().length } }}</span>
            </div>
            <p class="vs-hint">{{ 'VOICE.STAGED_HINT' | translate }}</p>

            @if (voice.buffered().length === 0) {
              <p class="vs-empty">{{ 'VOICE.STAGED_EMPTY' | translate }}</p>
            }

            <ul class="vs-teeth">
              @for (group of groups().teeth; track group.fdi) {
                <li class="vs-tooth" [class.focus]="group.fdi === focusFdi()">
                  <button type="button" class="vs-fdi" (click)="selectTooth(group.fdi)"
                          [attr.aria-label]="'VOICE.TOOTH' | translate: { fdi: group.fdi }"
                          [title]="group.description">
                    {{ group.fdi }}
                  </button>
                  <ul class="vs-entries">
                    @for (entry of group.entries; track entry.auditId) {
                      <li class="vs-entry">
                        <div class="vs-entry-body">
                          <div class="vs-chips">
                            @for (chip of chipsFor(entry); track $index) {
                              <span class="vs-chip" [attr.data-kind]="chip.kind">{{ chip.label }}</span>
                            }
                          </div>
                          @if (entry.transcript) {
                            <p class="vs-heard">“{{ entry.transcript }}”</p>
                          }
                        </div>
                        <button type="button" class="icon-btn" (click)="remove(entry)"
                                [attr.aria-label]="('VOICE.REMOVE' | translate) + ' — ' + entry.preview">
                          <span class="material-icons" aria-hidden="true">close</span>
                        </button>
                      </li>
                    }
                  </ul>
                </li>
              }
            </ul>

            @if (groups().other.length) {
              <p class="vs-subtitle">{{ 'VOICE.STAGED_OTHER' | translate }}</p>
              <ul class="vs-entries">
                @for (entry of groups().other; track entry.auditId) {
                  <li class="vs-entry">
                    <div class="vs-entry-body">
                      <p class="vs-entry-text">{{ entry.preview }}</p>
                      @if (entry.transcript) {
                        <p class="vs-heard">“{{ entry.transcript }}”</p>
                      }
                    </div>
                    <button type="button" class="icon-btn" (click)="remove(entry)"
                            [attr.aria-label]="('VOICE.REMOVE' | translate) + ' — ' + entry.preview">
                      <span class="material-icons" aria-hidden="true">close</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      </ng-template>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .vs { display: flex; flex-direction: column; gap: .75rem; }

    .card {
      background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 14px;
      padding: .875rem 1rem; min-width: 0;
    }

    .vs-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
    .vs-title { display: flex; align-items: center; gap: .5rem; min-width: 0; }
    .vs-title h2 { margin: 0; font-size: 1.125rem; font-weight: 700; color: rgb(var(--ink-900)); }
    .vs-elapsed {
      font-variant-numeric: tabular-nums; font-size: .8125rem; font-weight: 600;
      color: rgb(var(--ink-600)); background: rgb(var(--ink-100)); border-radius: 999px; padding: .125rem .5rem;
    }
    .vs-dot { width: .625rem; height: .625rem; border-radius: 50%; background: rgb(var(--ink-300)); flex-shrink: 0; }
    .vs-dot.live { background: rgb(var(--critical-600)); animation: vs-pulse 1.6s ease-in-out infinite; }
    .vs-head-actions { display: flex; gap: .25rem; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 2.75rem; height: 2.75rem; border-radius: 10px; border: none; background: transparent;
      color: rgb(var(--ink-600)); cursor: pointer; flex-shrink: 0;
    }
    .icon-btn:hover, .icon-btn.active { background: rgb(var(--ink-100)); color: rgb(var(--ink-900)); }
    .icon-btn.solid { background: rgb(var(--petrol-600)); color: #fff; }
    .icon-btn.solid:hover { background: rgb(var(--petrol-700)); }
    .icon-btn:focus-visible, .btn-big:focus-visible, .vs-option:focus-visible, .vs-fdi:focus-visible {
      outline: 2px solid var(--focus-ring); outline-offset: 2px;
    }

    .link-btn {
      background: none; border: none; padding: .5rem 0; cursor: pointer;
      color: rgb(var(--ink-600)); font-size: .8125rem; text-decoration: underline; align-self: flex-start;
    }
    .link-btn.danger { color: rgb(var(--critical-700)); }

    .btn-big {
      display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
      min-height: 3rem; padding: .625rem 1.125rem; border-radius: 12px; font-size: .9375rem; font-weight: 600;
      border: 1px solid rgb(var(--ink-300)); background: #fff; color: rgb(var(--ink-800)); cursor: pointer;
    }
    .btn-big:disabled { opacity: .6; cursor: default; }
    .btn-big.primary { background: rgb(var(--petrol-600)); border-color: transparent; color: #fff; }
    .btn-big.primary:hover:not(:disabled) { background: rgb(var(--petrol-700)); }
    .btn-big.positive { background: rgb(var(--positive-600)); border-color: transparent; color: #fff; }
    .btn-big .material-icons { font-size: 1.25rem; }

    .vs-intro { display: flex; flex-direction: column; align-items: flex-start; gap: .625rem; }
    .vs-intro h3 { margin: 0; font-size: 1rem; }
    .vs-intro p { margin: 0; color: rgb(var(--ink-700)); line-height: 1.5; font-size: .9rem; }
    .vs-intro-icon {
      font-size: 1.75rem; color: rgb(var(--petrol-600)); background: rgb(var(--petrol-50));
      border-radius: 12px; padding: .5rem;
    }
    .vs-intro.warn .vs-intro-icon { color: rgb(var(--caution-700)); background: rgb(var(--caution-50)); }
    .vs-intro.done .vs-intro-icon { color: rgb(var(--positive-700)); background: rgb(var(--positive-50)); }
    .vs-how { margin: 0; padding-inline-start: 1.125rem; color: rgb(var(--ink-600)); font-size: .85rem; line-height: 1.55; }
    .vs-actions { display: flex; flex-wrap: wrap; gap: .5rem; width: 100%; }
    .vs-actions .btn-big { flex: 1 1 12rem; }

    .vs-alert {
      display: flex; align-items: flex-start; gap: .5rem; margin: 0; padding: .75rem .875rem;
      border-radius: 12px; font-size: .875rem; line-height: 1.45; text-align: start; width: 100%;
    }
    .vs-alert .material-icons { font-size: 1.125rem; flex-shrink: 0; }
    .vs-alert.caution { background: rgb(var(--caution-50)); border: 1px solid rgb(var(--caution-200)); color: rgb(var(--caution-800)); }
    .vs-alert.critical { background: rgb(var(--critical-50)); border: 1px solid rgb(var(--critical-200)); color: rgb(var(--critical-700)); }
    .vs-alert.action {
      background: rgb(var(--petrol-600)); color: #fff; border: none; cursor: pointer;
      font-weight: 600; min-height: 3rem; align-items: center;
    }

    .vs-prompt { display: flex; flex-direction: column; gap: .625rem; }
    .vs-prompt.confirm { border-color: rgb(var(--caution-300)); background: rgb(var(--caution-50)); }
    .vs-prompt.question { border-color: rgb(var(--petrol-300)); background: rgb(var(--petrol-50)); }
    .vs-prompt-text { margin: 0; font-size: 1.0625rem; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
    .vs-options { display: flex; flex-wrap: wrap; gap: .5rem; }
    .vs-option {
      min-height: 2.75rem; padding: .5rem .875rem; border-radius: 999px; cursor: pointer;
      border: 1px solid rgb(var(--petrol-300)); background: #fff; color: rgb(var(--petrol-800)); font-weight: 600;
    }

    .vs-live { display: flex; flex-direction: column; gap: .375rem; }
    .vs-live-top { display: flex; align-items: center; gap: .75rem; }
    .vs-meter {
      width: 4.5rem; height: .5rem; border-radius: 999px; background: rgb(var(--ink-100));
      overflow: hidden; flex-shrink: 0;
    }
    .vs-meter span {
      display: block; height: 100%; background: rgb(var(--positive-500));
      transform-origin: left center; transition: transform 80ms linear;
    }
    :host-context([dir='rtl']) .vs-meter span { transform-origin: right center; }
    .vs-status { margin: 0; font-weight: 600; color: rgb(var(--ink-800)); font-size: .9375rem; }
    .vs-line { margin: 0; font-size: .875rem; line-height: 1.45; color: rgb(var(--ink-800)); overflow-wrap: anywhere; }
    .vs-line.outcome { color: rgb(var(--positive-700)); font-weight: 600; }
    .vs-line.outcome.bad { color: rgb(var(--caution-800)); }
    .vs-line.ignored { color: rgb(var(--ink-500)); font-size: .8125rem; font-style: italic; }
    .vs-label {
      display: inline-block; margin-inline-end: .375rem; font-size: .6875rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: .05em; color: rgb(var(--ink-500));
    }
    .vs-undo {
      display: inline-flex; align-items: center; gap: .375rem; align-self: flex-start; min-height: 2.5rem;
      padding: .375rem .75rem; border-radius: 10px; border: 1px dashed rgb(var(--ink-300));
      background: rgb(var(--ink-50)); color: rgb(var(--ink-700)); font-weight: 600; cursor: pointer;
    }
    .vs-undo .material-icons { font-size: 1.125rem; }

    .vs-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: .75rem; }
    @media (min-width: 1024px) {
      .vs-grid { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); align-items: start; }
    }

    .vs-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-wrap: wrap; margin-bottom: .25rem; }
    .vs-card-head h3 { margin: 0; font-size: .9375rem; font-weight: 700; }
    .vs-count { font-size: .75rem; font-weight: 700; color: rgb(var(--ink-600)); background: rgb(var(--ink-100)); border-radius: 999px; padding: .125rem .5rem; }
    .vs-legend { display: flex; flex-wrap: wrap; gap: .375rem .75rem; font-size: .75rem; color: rgb(var(--ink-600)); }
    .vs-legend span { display: inline-flex; align-items: center; gap: .25rem; }
    .swatch { display: inline-block; width: .75rem; height: .75rem; border-radius: 3px; border: 2px solid; }
    .swatch.staged { border-color: #d97706; }
    .swatch.focus { border-color: #0e7490; box-shadow: 0 0 3px rgba(14, 116, 144, .9); }
    .vs-hint { margin: .25rem 0 0; font-size: .8125rem; color: rgb(var(--ink-500)); line-height: 1.4; }
    .vs-empty { margin: .5rem 0 0; font-size: .875rem; color: rgb(var(--ink-600)); }
    .vs-subtitle { margin: .75rem 0 .25rem; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: rgb(var(--ink-500)); }

    .vs-teeth, .vs-entries { list-style: none; margin: 0; padding: 0; }
    .vs-tooth {
      display: flex; gap: .625rem; align-items: flex-start; padding: .625rem 0;
      border-bottom: 1px solid rgb(var(--ink-100));
    }
    .vs-tooth:last-child { border-bottom: none; }
    .vs-fdi {
      min-width: 2.75rem; height: 2.75rem; border-radius: 10px; border: 2px solid #d97706;
      background: #fffbeb; color: rgb(var(--ink-900)); font-weight: 800; font-size: 1rem; cursor: pointer;
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .vs-tooth.focus .vs-fdi { border-color: #0e7490; background: rgb(var(--petrol-50)); box-shadow: 0 0 0 3px rgba(14, 116, 144, .18); }
    .vs-entries { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .25rem; }
    .vs-entry { display: flex; align-items: flex-start; gap: .25rem; }
    .vs-entry-body { flex: 1; min-width: 0; padding-top: .25rem; }
    .vs-entry-text { margin: 0; font-size: .875rem; font-weight: 600; overflow-wrap: anywhere; }
    .vs-chips { display: flex; flex-wrap: wrap; gap: .25rem; }
    .vs-chip {
      font-size: .8125rem; font-weight: 600; padding: .1875rem .5rem; border-radius: 6px;
      background: rgb(var(--ink-100)); color: rgb(var(--ink-800));
    }
    .vs-chip[data-kind='CONDITION'] { background: rgb(var(--critical-50)); color: rgb(var(--critical-700)); }
    .vs-chip[data-kind='TREATMENT_REQUIRED'] { background: rgb(var(--caution-50)); color: rgb(var(--caution-800)); }
    .vs-chip[data-kind='EXISTING'] { background: rgb(var(--petrol-50)); color: rgb(var(--petrol-800)); }
    .vs-heard { margin: .125rem 0 0; font-size: .75rem; color: rgb(var(--ink-500)); font-style: italic; overflow-wrap: anywhere; }

    .vs-help { display: flex; flex-direction: column; gap: .375rem; }
    .vs-help-title { margin: 0; font-weight: 700; font-size: .8125rem; color: rgb(var(--ink-700)); }
    .vs-examples { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: .375rem; }
    .vs-examples li {
      font-size: .8125rem; background: rgb(var(--ink-50)); border: 1px solid rgb(var(--ink-200));
      border-radius: 8px; padding: .25rem .5rem; color: rgb(var(--ink-800));
    }
    .vs-note { display: flex; gap: .375rem; margin: 0; font-size: .8125rem; color: rgb(var(--ink-600)); line-height: 1.45; }
    .vs-note .material-icons { font-size: 1rem; color: rgb(var(--petrol-600)); flex-shrink: 0; }

    .vs-typed { display: flex; gap: .5rem; }
    .vs-typed input {
      flex: 1; min-width: 0; min-height: 2.75rem; border: 1px solid rgb(var(--ink-300)); border-radius: 12px;
      padding: .5rem .75rem; font: inherit; font-size: 1rem; color: rgb(var(--ink-900)); background: #fff;
    }
    .vs-typed input:focus { outline: 2px solid rgb(var(--petrol-300)); outline-offset: -1px; border-color: rgb(var(--petrol-400)); }

    @keyframes vs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) {
      .vs-dot.live { animation: none; }
      .vs-meter span { transition: none; }
    }
  `],
})
export class VoiceSessionPanelComponent {
  voice = inject(VoiceOrchestratorService);
  session = inject(VoiceSessionService);
  feedback = inject(SpeechFeedbackService);
  private context = inject(VoiceContextService);
  private confirmDialog = inject(ConfirmDialogService);

  chart = input<DentalChartState | null>(null);
  findings = input<ToothFinding[]>([]);
  treatments = input<PatientTreatment[]>([]);
  patientId = input('');
  /** The dossier is opening the microphone and creating the session. */
  starting = input(false);

  /**
   * Start or resume dictation. Emitted synchronously from the tap, so the
   * dossier can open the microphone inside the user gesture iOS requires.
   */
  begin = output<void>();
  /** The reviewed consultation reached the record. */
  saved = output<void>();

  showHelp = signal(false);
  typed = '';

  private now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private language = computed(() => spokenLanguage(this.context.locale()));

  phase = computed<Phase>(() => {
    if (this.session.reviewing()) return 'review';
    if (this.session.isActive()) return this.voice.examinationMode() ? 'live' : 'interrupted';
    if (this.session.session()?.status === 'COMPLETED') return 'saved';
    return this.voice.needsConsent() ? 'consent' : 'idle';
  });

  elapsed = computed(() => {
    const started = this.session.startedAt();
    if (!started || !this.session.isActive()) return null;
    const seconds = Math.max(0, Math.floor((this.now() - started) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  private awake = computed(() => (this.voice.awakeUntil() ?? 0) > this.now());
  statusKey = computed(() => sessionStatusKey(this.voice, this.awake()));

  /** An outcome stays on screen long enough to read after glancing up. */
  recentOutcome = computed(() => {
    const outcome = this.voice.outcome();
    return outcome && this.now() - outcome.at < 12_000 ? outcome : null;
  });

  focusFdi = computed(() => this.voice.highlightedFdi() ?? this.context.selectedFdi());

  stagedTeeth = computed(() => [...new Set(this.voice.buffered()
    .map(entry => entityString(entry.entities, 'fdi'))
    .filter((fdi): fdi is string => !!fdi))]);

  /** Newest tooth first — the one just dictated is the one to check. */
  groups = computed(() => {
    const teeth = new Map<string, ToothGroup>();
    const other: BufferedEntry[] = [];
    for (const entry of [...this.voice.buffered()].reverse()) {
      const fdi = entityString(entry.entities, 'fdi');
      if (!fdi || entry.intent !== 'clinical.addFindings') {
        other.push(entry);
        continue;
      }
      const group = teeth.get(fdi) ?? { fdi, description: describeFdi(fdi), entries: [] };
      group.entries.push(entry);
      teeth.set(fdi, group);
    }
    return { teeth: [...teeth.values()], other };
  });

  examples = computed(() => COMMAND_EXAMPLES.map(example => this.language() === 'fr' ? example.fr : example.en));

  chipsFor(entry: BufferedEntry): Array<{ label: string; kind: string }> {
    const codes = stagedFindingCodes(entry.entities);
    if (codes.length === 0) return [{ label: entry.preview, kind: '' }];
    return codes.map(code => {
      const label = spokenFindingLabel(code, this.language());
      return { label: label.charAt(0).toUpperCase() + label.slice(1), kind: findingKind(code) ?? '' };
    });
  }

  consent(): void {
    this.voice.grantMicrophoneConsent();
    this.begin.emit();
  }

  async endSession(): Promise<void> {
    await this.session.end();
  }

  async discardSession(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm(
      'Discard this session? Nothing dictated will be saved.',
      { danger: true, confirmLabel: 'Discard' },
    );
    if (confirmed) await this.session.abandon();
  }

  remove(entry: BufferedEntry): void {
    void this.voice.discardBuffered(entry.auditId);
  }

  /** A tap tells the assistant what "that tooth" means. */
  onToothSelected(tooth: ToothState): void {
    this.selectTooth(tooth.id);
  }

  selectTooth(fdi: string): void {
    this.voice.clearHighlight();
    this.context.selectTooth(fdi);
  }

  submitTyped(event: Event): void {
    event.preventDefault();
    const text = this.typed.trim();
    if (!text) return;
    this.typed = '';
    // Typed input is deliberate: no wake word.
    void this.voice.handleTranscript(text, 1, null, false);
  }

  onReviewFinished(result: 'saved' | 'discarded'): void {
    if (result === 'saved') this.saved.emit();
  }
}
