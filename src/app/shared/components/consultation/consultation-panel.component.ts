import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import {
  addManualItem,
  ageOn,
  approximateBirthDate,
  AllergyData,
  changesRecord,
  enterPatientField,
  ActiveTreatmentData,
  HistoryData,
  ListName,
  PATIENT_FIELDS,
  PlanData,
  planTotal,
  ReviewField,
  ReviewItem,
  setComplaint,
  setItem,
  setPatientField,
} from '../../../core/consultation/consultation-draft';
import { PatientFieldName } from '../../../core/consultation/consultation.model';
import { chartLine } from '../../../core/consultation/consultation-chart';
import { spokenLanguage } from '../../../core/voice/voice-vocabulary';
import { VoiceContextService } from '../../../core/voice/voice-context.service';
import { BufferedEntry } from '../../../core/voice/voice-orchestrator.service';
import { TranslateService } from '@ngx-translate/core';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { PatientService } from '../../../core/services/patient.service';
import { StockService } from '../../../core/services/stock.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { Treatment } from '../../../core/models/stock.model';

type Mode = 'intro' | 'recording' | 'review' | 'saved';

interface FieldDef {
  name: PatientFieldName;
  labelKey: string;
  kind: 'text' | 'number' | 'date' | 'gender' | 'insurer';
}

/** Everything an inline editor can hold; each list uses the part it needs. */
interface EditModel {
  text: string;
  detail: string;
  reaction: string;
  severity: string;
  category: string;
  type: string;
  teeth: string;
  price: number | null;
  quantity: number;
  treatmentId: string;
}

const EMPTY_EDIT: EditModel = {
  text: '', detail: '', reaction: '', severity: '', category: 'CONDITION', type: 'MEDICATION',
  teeth: '', price: null, quantity: 1, treatmentId: '',
};

const FIELDS: FieldDef[] = [
  { name: 'firstName', labelKey: 'PATIENTS.DOSSIER.FIRST_NAME', kind: 'text' },
  { name: 'lastName', labelKey: 'PATIENTS.DOSSIER.LAST_NAME', kind: 'text' },
  { name: 'age', labelKey: 'PATIENTS.DOSSIER.AGE', kind: 'number' },
  { name: 'dateOfBirth', labelKey: 'PATIENTS.DOSSIER.DOB', kind: 'date' },
  { name: 'gender', labelKey: 'PATIENTS.DOSSIER.GENDER', kind: 'gender' },
  { name: 'phone', labelKey: 'PATIENTS.DOSSIER.PHONE', kind: 'text' },
  { name: 'cin', labelKey: 'PATIENTS.DOSSIER.CIN', kind: 'text' },
  { name: 'insuranceProvider', labelKey: 'PATIENTS.DOSSIER.INSURANCE', kind: 'insurer' },
  { name: 'insuranceNumber', labelKey: 'PATIENTS.DOSSIER.POLICY_NUMBER', kind: 'text' },
];

const INSURERS = ['CNOPS', 'CNSS', 'CNAM', 'RAMED', 'PRIVATE'];
const SEVERITIES = ['MILD', 'MODERATE', 'SEVERE'];
const HISTORY_CATEGORIES = ['CONDITION', 'MEDICATION', 'SURGERY', 'DENTAL_HISTORY', 'FAMILY', 'LIFESTYLE', 'OTHER'];
const TREATMENT_TYPES = ['MEDICATION', 'DENTAL', 'OTHER'];

/**
 * The consultation, beside the dossier.
 *
 * While the doctor and the patient talk, this fills in with what the system
 * catches — who the patient is, what they are allergic to, what they take. When
 * the consultation ends it becomes the review: every item is validated,
 * corrected or removed by the doctor, and nothing is saved until none is left
 * undecided.
 *
 * The recording view is deliberately read-only. The doctor's hands are busy and
 * they are not looking at the screen (see the hands-free constraint on every
 * in-consultation feature); everything they need mid-consultation — begin,
 * end — is also a spoken phrase, and the screen only shows what was heard.
 * Deciding is screen-and-mouse work, and it happens after, in the review.
 */
@Component({
  selector: 'app-consultation-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    @if (c.visible()) {
      <aside class="cp" [attr.data-mode]="mode()" [attr.aria-label]="'CONSULTATION.TITLE' | translate">
        <header class="cp-head">
          <div class="cp-title">
            <span class="cp-dot" [class.live]="c.listening()" aria-hidden="true"></span>
            <h2>{{ 'CONSULTATION.TITLE' | translate }}</h2>
            @if (mode() === 'recording') {
              <span class="cp-badge">{{ (c.phase() === 'intake' ? 'CONSULTATION.PHASE_INTAKE' : 'CONSULTATION.PHASE_EXAMINATION') | translate }}</span>
            } @else if (mode() === 'review') {
              <span class="cp-badge review">{{ 'CONSULTATION.PHASE_REVIEW' | translate }}</span>
            }
          </div>
          @if (mode() === 'recording' && elapsed(); as time) {
            <span class="cp-elapsed">{{ time }}</span>
          }
        </header>

        @switch (mode()) {
          <!-- ── Before we start ─────────────────────────────────────── -->
          @case ('intro') {
            <div class="cp-body">
              <div class="cp-card">
                <span class="material-icons cp-hero" aria-hidden="true">graphic_eq</span>
                <p>{{ 'CONSULTATION.INTRO_BODY' | translate }}</p>
                <ul class="cp-steps">
                  <li>{{ 'CONSULTATION.STEP_1' | translate }}</li>
                  <li>{{ 'CONSULTATION.STEP_2' | translate }}</li>
                  <li>{{ 'CONSULTATION.STEP_3' | translate }}</li>
                </ul>
                <p class="cp-notice"><span class="material-icons" aria-hidden="true">info</span>{{ (c.retainTranscript() ? 'CONSULTATION.INTRO_NOTICE' : 'CONSULTATION.INTRO_NOTICE_NOT_KEPT') | translate }}</p>
                <label class="cp-ack">
                  <input type="checkbox" [ngModel]="informed()" (ngModelChange)="informed.set($event)" />
                  <span>{{ (c.retainTranscript() ? 'CONSULTATION.INTRO_ACK' : 'CONSULTATION.INTRO_ACK_NOT_KEPT') | translate }}</span>
                </label>
                @if (voice.error(); as error) {
                  <p class="cp-alert critical" role="alert">{{ error }}</p>
                }
                <div class="cp-actions">
                  <button type="button" class="cp-btn primary big" (click)="startRecording()"
                          [disabled]="!informed() || c.starting()">
                    <span class="material-icons" aria-hidden="true">mic</span>
                    {{ (c.starting() ? 'CONSULTATION.STARTING' : voice.needsConsent() ? 'CONSULTATION.START_AND_ALLOW_MIC' : 'CONSULTATION.START') | translate }}
                  </button>
                  <button type="button" class="cp-btn" (click)="c.closeIntro()" [disabled]="c.starting()">
                    {{ 'COMMON.CANCEL' | translate }}
                  </button>
                </div>
              </div>
            </div>
          }

          <!-- ── Recording ───────────────────────────────────────────── -->
          @case ('recording') {
            <div class="cp-body">
              @if (!c.listening()) {
                <div class="cp-alert caution" role="status">
                  <span class="material-icons" aria-hidden="true">mic_off</span>
                  <span>{{ 'CONSULTATION.MIC_OFF' | translate }}</span>
                  <button type="button" class="cp-btn small" (click)="c.resumeRecording()">{{ 'CONSULTATION.MIC_RESUME' | translate }}</button>
                </div>
              } @else if (voice.microphoneSuspended()) {
                <button type="button" class="cp-alert caution action" (click)="voice.resumeMicrophone()">
                  <span class="material-icons" aria-hidden="true">touch_app</span>{{ 'VOICE.MIC_SUSPENDED' | translate }}
                </button>
              }
              @if (voice.transcriptionIssue(); as issue) {
                <p class="cp-alert caution" role="status"><span class="material-icons" aria-hidden="true">cloud_off</span>{{ issue }}</p>
              }

              <div class="cp-live" aria-live="polite">
                <div class="cp-meter" aria-hidden="true"><span [style.transform]="'scaleX(' + (voice.paused() ? 0 : voice.inputLevel()) + ')'"></span></div>
                <span class="cp-live-label">{{ (voice.userSpeaking() ? 'VOICE.STATUS_HEARING' : voice.pendingTranscriptions() > 0 ? 'VOICE.STATUS_TRANSCRIBING' : 'CONSULTATION.LISTENING') | translate }}</span>
              </div>

              <div class="cp-controls">
                @if (c.phase() === 'intake') {
                  <button type="button" class="cp-btn primary" (click)="c.beginExamination()" [disabled]="c.busy()">
                    <span class="material-icons" aria-hidden="true">medical_services</span>{{ 'CONSULTATION.BEGIN_EXAM' | translate }}
                  </button>
                }
                <button type="button" class="cp-btn danger" (click)="c.end()" [disabled]="c.busy()">
                  <span class="material-icons" aria-hidden="true">stop_circle</span>
                  {{ (c.busy() ? 'VOICE.ENDING' : 'CONSULTATION.END') | translate }}
                </button>
              </div>
              <p class="cp-hint">
                @if (c.phase() === 'intake') { {{ 'CONSULTATION.HINT_INTAKE' | translate }} }
                @else { {{ 'CONSULTATION.HINT_EXAM' | translate }} }
              </p>

              <section class="cp-sec">
                <button type="button" class="cp-sec-head" (click)="showHeard.set(!showHeard())" [attr.aria-expanded]="showHeard()">
                  <h3>{{ 'CONSULTATION.HEARD_TITLE' | translate }}</h3>
                  <span class="cp-count">{{ c.lines().length }}</span>
                  <span class="material-icons" aria-hidden="true">{{ showHeard() ? 'expand_less' : 'expand_more' }}</span>
                </button>
                @if (showHeard()) {
                  @if (c.lines().length === 0) {
                    <p class="cp-empty">{{ 'CONSULTATION.HEARD_EMPTY' | translate }}</p>
                  }
                  <ol class="cp-lines">
                    @for (line of recentLines(); track line.id) {
                      <li [class.typed]="line.typed">{{ line.text }}</li>
                    }
                  </ol>
                  <form class="cp-typed" (submit)="submitTyped($event)">
                    <input type="text" [(ngModel)]="typed" name="typed" autocomplete="off" enterkeyhint="send"
                           [placeholder]="'CONSULTATION.TYPE_PLACEHOLDER' | translate"
                           [attr.aria-label]="'CONSULTATION.TYPE_PLACEHOLDER' | translate" />
                    <button type="submit" class="cp-icon solid" [attr.aria-label]="'VOICE.SEND' | translate">
                      <span class="material-icons" aria-hidden="true">send</span>
                    </button>
                  </form>
                }
              </section>

              <div class="cp-caught-head">
                <h3>{{ 'CONSULTATION.CAUGHT_TITLE' | translate }}</h3>
                @if (c.extracting()) { <span class="cp-reading">{{ 'CONSULTATION.READING' | translate }}</span> }
              </div>
              @if (noteKey(); as key) {
                <p class="cp-hint note"><span class="material-icons" aria-hidden="true">info</span>{{ key | translate }}</p>
              }
              <ng-container *ngTemplateOutlet="items; context: { editable: false }" />
            </div>
          }

          <!-- ── Review ──────────────────────────────────────────────── -->
          @case ('review') {
            <div class="cp-body">
              <div class="cp-banner" [class.done]="c.pending() === 0">
                @if (c.pending() > 0) {
                  <strong>{{ 'CONSULTATION.REVIEW_PENDING' | translate: { count: c.pending() } }}</strong>
                  <button type="button" class="cp-btn small" (click)="c.validateEverything()">{{ 'CONSULTATION.VALIDATE_ALL' | translate }}</button>
                } @else {
                  <strong><span class="material-icons" aria-hidden="true">check_circle</span>{{ 'CONSULTATION.REVIEW_DONE' | translate }}</strong>
                }
              </div>
              @if (c.extracting()) { <p class="cp-reading">{{ 'CONSULTATION.READING' | translate }}</p> }
              @if (noteKey(); as key) {
                <p class="cp-hint note"><span class="material-icons" aria-hidden="true">info</span>{{ key | translate }}</p>
              }
              <ng-container *ngTemplateOutlet="items; context: { editable: true }" />

              <!-- Chart findings dictated during the examination. -->
              <section class="cp-sec">
                <div class="cp-sec-title"><h3>{{ 'CONSULTATION.SEC_CHART' | translate }}</h3><span class="cp-count">{{ c.chartEntries().length }}</span></div>
                @if (c.chartEntries().length === 0) {
                  <p class="cp-empty">{{ 'CONSULTATION.CHART_EMPTY' | translate }}</p>
                }
                <ul class="cp-list">
                  @for (row of c.chartEntries(); track row.entry.auditId) {
                    <li class="cp-item" [class.removed]="!row.included">
                      <label class="cp-check">
                        <input type="checkbox" [checked]="row.included" (change)="c.toggleChartEntry(row.entry.auditId)" />
                        <span>{{ chartText(row.entry) }}</span>
                      </label>
                    </li>
                  }
                </ul>
                @for (failure of c.failures(); track failure.auditId) {
                  <p class="cp-alert critical" role="alert"><span class="material-icons" aria-hidden="true">error</span>{{ failure.errorMessage }}</p>
                }
              </section>

              <!-- Next appointment. -->
              <section class="cp-sec">
                <div class="cp-sec-title"><h3>{{ 'CONSULTATION.SEC_APPOINTMENT' | translate }}</h3></div>
                @if (c.review().appointmentSuggestion; as s) {
                  <div class="cp-suggest">
                    <span>{{ 'CONSULTATION.APPT_SUGGEST' | translate }}
                      <strong>{{ suggestionText(s.date, s.time, s.inDays) }}</strong>
                      @if (s.reason) { — {{ s.reason }} }
                    </span>
                    <span class="cp-quote">« {{ s.quote }} »</span>
                    @if (!c.review().appointment) {
                      <button type="button" class="cp-btn small" (click)="useSuggestion()">{{ 'CONSULTATION.APPT_USE' | translate }}</button>
                    }
                  </div>
                }
                @if (c.review().appointment; as a) {
                  <div class="cp-appt">
                    <label>{{ 'CONSULTATION.APPT_DATE' | translate }}
                      <input type="date" [ngModel]="a.date" (ngModelChange)="changeAppointment({ date: $event })" [min]="today" />
                    </label>
                    <label>{{ 'CONSULTATION.APPT_TIME' | translate }}
                      <input type="time" [ngModel]="a.time" (ngModelChange)="changeAppointment({ time: $event })" />
                    </label>
                    <label>{{ 'CONSULTATION.APPT_DURATION' | translate }}
                      <select [ngModel]="a.durationMinutes" (ngModelChange)="changeAppointment({ durationMinutes: +$event })">
                        @for (minutes of durations; track minutes) { <option [ngValue]="minutes">{{ minutes }} min</option> }
                      </select>
                    </label>
                    <label class="wide">{{ 'CONSULTATION.APPT_TYPE' | translate }}
                      <input type="text" [ngModel]="a.type" (ngModelChange)="changeAppointment({ type: $event })" maxlength="100" />
                    </label>
                    <button type="button" class="cp-btn small" (click)="c.setAppointment(null)">{{ 'CONSULTATION.APPT_CLEAR' | translate }}</button>
                  </div>
                } @else {
                  <button type="button" class="cp-btn" (click)="newAppointment()">
                    <span class="material-icons" aria-hidden="true">event</span>{{ 'CONSULTATION.APPT_ADD' | translate }}
                  </button>
                  <p class="cp-hint">{{ 'CONSULTATION.APPT_NONE' | translate }}</p>
                }
              </section>

              <!-- The report. -->
              <section class="cp-sec">
                <div class="cp-sec-title">
                  <h3>{{ 'CONSULTATION.SEC_REPORT' | translate }}</h3>
                  <button type="button" class="cp-btn small" (click)="regenerate()">{{ 'CONSULTATION.REPORT_REGENERATE' | translate }}</button>
                </div>
                <textarea class="cp-report" rows="7" [ngModel]="c.report()" (ngModelChange)="c.setReport($event)"
                          [placeholder]="'CONSULTATION.REPORT_PLACEHOLDER' | translate"
                          [attr.aria-label]="'CONSULTATION.SEC_REPORT' | translate"></textarea>
                <p class="cp-hint">{{ 'CONSULTATION.REPORT_HINT' | translate }}</p>
              </section>

              <div class="cp-footer">
                <button type="button" class="cp-btn primary big" (click)="c.commit()" [disabled]="!c.canSave()">
                  <span class="material-icons" aria-hidden="true">task_alt</span>
                  {{ (c.saving() ? 'CONSULTATION.SAVING' : 'CONSULTATION.SAVE') | translate }}
                </button>
                @if (c.pending() > 0) {
                  <p class="cp-hint">{{ 'CONSULTATION.SAVE_BLOCKED' | translate: { count: c.pending() } }}</p>
                }
                <button type="button" class="cp-link danger" (click)="discard()" [disabled]="c.saving()">{{ 'CONSULTATION.DISCARD' | translate }}</button>
              </div>
            </div>
          }

          <!-- ── Saved ───────────────────────────────────────────────── -->
          @case ('saved') {
            <div class="cp-body">
              <div class="cp-card center">
                <span class="material-icons cp-hero ok" aria-hidden="true">check_circle</span>
                <h3>{{ 'CONSULTATION.SAVED' | translate }}</h3>
                <p>{{ 'CONSULTATION.SAVED_BODY' | translate }}</p>
                <div class="cp-actions col">
                  <button type="button" class="cp-btn primary big" (click)="c.printReport()">
                    <span class="material-icons" aria-hidden="true">description</span>{{ 'CONSULTATION.PRINT_REPORT' | translate }}
                  </button>
                  <button type="button" class="cp-btn big" (click)="c.printAssistantSheet()">
                    <span class="material-icons" aria-hidden="true">assignment</span>{{ 'CONSULTATION.PRINT_SHEET' | translate }}
                  </button>
                  <button type="button" class="cp-link" (click)="c.dismiss()">{{ 'CONSULTATION.CLOSE' | translate }}</button>
                </div>
              </div>
            </div>
          }
        }
      </aside>
    }

    <!-- ── What the system caught, as the doctor sees it ───────────────── -->
    <ng-template #items let-editable="editable">
      <!-- The patient -->
      <section class="cp-sec">
        <div class="cp-sec-title"><h3>{{ 'CONSULTATION.SEC_PATIENT' | translate }}</h3></div>
        <dl class="cp-fields">
          @for (def of fields; track def.name) {
            @if (showField(def.name, editable)) {
              <div class="cp-field" [class.removed]="fieldOf(def.name)?.status === 'removed'">
                <dt>{{ def.labelKey | translate }}</dt>
                <dd>
                  @if (editKey() === 'patient:' + def.name) {
                    <ng-container *ngTemplateOutlet="fieldEditor; context: { def: def }" />
                  } @else {
                    @if (fieldOf(def.name); as f) {
                      <span class="cp-value" [class.proposed]="f.status === 'proposed'">{{ display(def, f.value) }}</span>
                      <span class="cp-status" [attr.data-status]="f.status">{{ statusKey(f) | translate }}</span>
                      @if (onFile(def.name); as current) {
                        @if (isSame(def.name, f)) {
                          <span class="cp-onfile">{{ 'CONSULTATION.SAME_AS_FILE' | translate }}</span>
                        } @else {
                          <span class="cp-onfile diff">{{ 'CONSULTATION.ON_FILE' | translate }} : {{ current }}</span>
                        }
                      }
                      @if (def.name === 'age' && f.status !== 'removed' && !hasBirthDate()) {
                        <span class="cp-onfile">{{ 'CONSULTATION.APPROX_DOB' | translate: { year: approxYear(f.value) } }}</span>
                      }
                      @if (f.quote) { <span class="cp-quote" [title]="f.quote">« {{ f.quote }} »</span> }
                      @if (editable) {
                        <span class="cp-row-actions">
                          @if (f.status === 'removed') {
                            <button type="button" class="cp-icon" (click)="restoreField(def.name)" [attr.aria-label]="'CONSULTATION.RESTORE' | translate" [title]="'CONSULTATION.RESTORE' | translate"><span class="material-icons">undo</span></button>
                          } @else {
                            @if (f.status === 'proposed') {
                              <button type="button" class="cp-icon ok" (click)="validateField(def.name)" [attr.aria-label]="'CONSULTATION.VALIDATE' | translate" [title]="'CONSULTATION.VALIDATE' | translate"><span class="material-icons">check</span></button>
                            }
                            <button type="button" class="cp-icon" (click)="editField(def)" [attr.aria-label]="'CONSULTATION.EDIT' | translate" [title]="'CONSULTATION.EDIT' | translate"><span class="material-icons">edit</span></button>
                            <button type="button" class="cp-icon bad" (click)="removeField(def.name)" [attr.aria-label]="'CONSULTATION.REMOVE' | translate" [title]="'CONSULTATION.REMOVE' | translate"><span class="material-icons">close</span></button>
                          }
                        </span>
                      }
                    } @else {
                      @if (onFile(def.name); as current) {
                        <span class="cp-value onfile">{{ current }}</span>
                      } @else {
                        <span class="cp-value empty">—</span>
                      }
                      @if (editable) {
                        <button type="button" class="cp-icon" (click)="editField(def)" [attr.aria-label]="'CONSULTATION.ADD' | translate" [title]="'CONSULTATION.ADD' | translate"><span class="material-icons">add</span></button>
                      }
                    }
                  }
                </dd>
              </div>
            }
          }
        </dl>
      </section>

      <!-- Chief complaint -->
      @if (c.review().chiefComplaint; as complaint) {
        <section class="cp-sec">
          <div class="cp-sec-title"><h3>{{ 'CONSULTATION.SEC_COMPLAINT' | translate }}</h3></div>
          <div class="cp-item" [class.removed]="complaint.status === 'removed'">
            <div class="cp-item-main">
              @if (editKey() === 'complaint') {
                <input type="text" class="cp-input" [(ngModel)]="edit.text" maxlength="400" (keydown.enter)="saveComplaint()" />
                <span class="cp-row-actions">
                  <button type="button" class="cp-icon ok" (click)="saveComplaint()" [attr.aria-label]="'CONSULTATION.SAVE_EDIT' | translate"><span class="material-icons">check</span></button>
                  <button type="button" class="cp-icon" (click)="editKey.set(null)" [attr.aria-label]="'COMMON.CANCEL' | translate"><span class="material-icons">close</span></button>
                </span>
              } @else {
                <span class="cp-value" [class.proposed]="complaint.status === 'proposed'">{{ complaint.value }}</span>
                <span class="cp-status" [attr.data-status]="complaint.status">{{ statusKey(complaint) | translate }}</span>
                @if (complaint.quote) { <span class="cp-quote">« {{ complaint.quote }} »</span> }
                @if (editable) {
                  <span class="cp-row-actions">
                    @if (complaint.status === 'removed') {
                      <button type="button" class="cp-icon" (click)="c.changeReview(restoreComplaint)" [attr.aria-label]="'CONSULTATION.RESTORE' | translate"><span class="material-icons">undo</span></button>
                    } @else {
                      @if (complaint.status === 'proposed') {
                        <button type="button" class="cp-icon ok" (click)="c.changeReview(validateComplaint)" [attr.aria-label]="'CONSULTATION.VALIDATE' | translate"><span class="material-icons">check</span></button>
                      }
                      <button type="button" class="cp-icon" (click)="editComplaint(complaint.value)" [attr.aria-label]="'CONSULTATION.EDIT' | translate"><span class="material-icons">edit</span></button>
                      <button type="button" class="cp-icon bad" (click)="c.changeReview(removeComplaint)" [attr.aria-label]="'CONSULTATION.REMOVE' | translate"><span class="material-icons">close</span></button>
                    }
                  </span>
                }
              }
            </div>
          </div>
        </section>
      }

      <!-- Allergies, treatments, history, plan -->
      @for (list of lists; track list.name) {
        <section class="cp-sec" [attr.data-list]="list.name">
          <div class="cp-sec-title">
            <h3>{{ list.titleKey | translate }}</h3>
            <span class="cp-count">{{ visibleCount(list.name) }}</span>
          </div>
          @if (itemsOf(list.name).length === 0 && editKey() !== list.name + ':new') {
            <p class="cp-empty">{{ list.emptyKey | translate }}</p>
          }
          <ul class="cp-list">
            @for (item of itemsOf(list.name); track item.key) {
              <li class="cp-item" [class.removed]="item.status === 'removed'" [class.manual]="item.manual">
                @if (editKey() === list.name + ':' + item.key) {
                  <ng-container *ngTemplateOutlet="itemEditor; context: { list: list.name, key: item.key }" />
                } @else {
                  <div class="cp-item-main">
                    <span class="cp-value" [class.proposed]="item.status === 'proposed'">{{ itemText(list.name, item) }}</span>
                    <span class="cp-status" [attr.data-status]="item.status">{{ statusKey(item) | translate }}</span>
                    @if (list.name === 'plan' && priceBadge(item); as badge) { <span class="cp-onfile">{{ badge | translate }}</span> }
                    @if (item.quote) { <span class="cp-quote" [title]="item.quote">« {{ item.quote }} »</span> }
                    @if (editable) {
                      <span class="cp-row-actions">
                        @if (item.status === 'removed') {
                          <button type="button" class="cp-icon" (click)="restoreItem(list.name, item.key)" [attr.aria-label]="'CONSULTATION.RESTORE' | translate"><span class="material-icons">undo</span></button>
                        } @else {
                          @if (item.status === 'proposed') {
                            <button type="button" class="cp-icon ok" (click)="validateItem(list.name, item.key)" [attr.aria-label]="'CONSULTATION.VALIDATE' | translate"><span class="material-icons">check</span></button>
                          }
                          <button type="button" class="cp-icon" (click)="editItem(list.name, item)" [attr.aria-label]="'CONSULTATION.EDIT' | translate"><span class="material-icons">edit</span></button>
                          <button type="button" class="cp-icon bad" (click)="removeItem(list.name, item.key)" [attr.aria-label]="'CONSULTATION.REMOVE' | translate"><span class="material-icons">close</span></button>
                        }
                      </span>
                    }
                  </div>
                }
              </li>
            }
            @if (editKey() === list.name + ':new') {
              <li class="cp-item"><ng-container *ngTemplateOutlet="itemEditor; context: { list: list.name, key: 'new' }" /></li>
            }
          </ul>
          @if (list.name === 'plan' && planItems().length) {
            <div class="cp-total">
              <span>{{ (planSummary().complete ? 'CONSULTATION.PLAN_TOTAL' : 'CONSULTATION.PLAN_TOTAL_PARTIAL') | translate }}</span>
              <strong>{{ planSummary().total | number:'1.0-2' }} MAD</strong>
            </div>
          }
          @if (editable && editKey() !== list.name + ':new') {
            <button type="button" class="cp-btn small" (click)="newItem(list.name)">
              <span class="material-icons" aria-hidden="true">add</span>{{ list.addKey | translate }}
            </button>
          }
        </section>
      }
    </ng-template>

    <!-- Editing one patient field. -->
    <ng-template #fieldEditor let-def="def">
      <span class="cp-editor row">
        @switch (def.kind) {
          @case ('gender') {
            <select class="cp-input" [(ngModel)]="edit.text">
              <option value="M">{{ 'PATIENTS.DOSSIER.GENDER_M' | translate }}</option>
              <option value="F">{{ 'PATIENTS.DOSSIER.GENDER_F' | translate }}</option>
            </select>
          }
          @case ('insurer') {
            <select class="cp-input" [(ngModel)]="edit.text">
              @for (insurer of insurers; track insurer) { <option [value]="insurer">{{ insurer }}</option> }
            </select>
          }
          @case ('number') { <input type="number" class="cp-input" [(ngModel)]="edit.text" min="0" max="120" (keydown.enter)="saveField(def)" /> }
          @case ('date') { <input type="date" class="cp-input" [(ngModel)]="edit.text" [max]="today" (keydown.enter)="saveField(def)" /> }
          @default { <input type="text" class="cp-input" [(ngModel)]="edit.text" maxlength="100" (keydown.enter)="saveField(def)" /> }
        }
        <button type="button" class="cp-icon ok" (click)="saveField(def)" [attr.aria-label]="'CONSULTATION.SAVE_EDIT' | translate"><span class="material-icons">check</span></button>
        <button type="button" class="cp-icon" (click)="editKey.set(null)" [attr.aria-label]="'COMMON.CANCEL' | translate"><span class="material-icons">close</span></button>
      </span>
    </ng-template>

    <!-- Editing one list item (or adding a new one). -->
    <ng-template #itemEditor let-list="list" let-key="key">
      <div class="cp-editor col">
        @switch (list) {
          @case ('allergies') {
            <input type="text" class="cp-input" [(ngModel)]="edit.text" [placeholder]="'CONSULTATION.F_SUBSTANCE' | translate" maxlength="160" />
            <input type="text" class="cp-input" [(ngModel)]="edit.reaction" [placeholder]="'CONSULTATION.F_REACTION' | translate" maxlength="500" />
            <select class="cp-input" [(ngModel)]="edit.severity">
              <option value="">{{ 'CONSULTATION.F_SEVERITY' | translate }}</option>
              @for (s of severities; track s) { <option [value]="s">{{ 'CONSULTATION.DOC.SEVERITY_' + s | translate }}</option> }
            </select>
          }
          @case ('activeTreatments') {
            <input type="text" class="cp-input" [(ngModel)]="edit.text" [placeholder]="'CONSULTATION.F_LABEL' | translate" maxlength="160" />
            <input type="text" class="cp-input" [(ngModel)]="edit.detail" [placeholder]="'CONSULTATION.F_DETAIL' | translate" maxlength="500" />
            <select class="cp-input" [(ngModel)]="edit.type">
              @for (t of treatmentTypes; track t) { <option [value]="t">{{ 'CONSULTATION.TYPE_' + t | translate }}</option> }
            </select>
          }
          @case ('medicalHistory') {
            <select class="cp-input" [(ngModel)]="edit.category">
              @for (cat of historyCategories; track cat) { <option [value]="cat">{{ 'CONSULTATION.CAT_' + cat | translate }}</option> }
            </select>
            <input type="text" class="cp-input" [(ngModel)]="edit.text" [placeholder]="'CONSULTATION.F_LABEL' | translate" maxlength="160" />
            <input type="text" class="cp-input" [(ngModel)]="edit.detail" [placeholder]="'CONSULTATION.F_DETAIL' | translate" maxlength="500" />
          }
          @case ('plan') {
            <select class="cp-input" [ngModel]="edit.treatmentId" (ngModelChange)="pickCatalog($event)">
              <option value="">{{ 'CONSULTATION.PLAN_NO_CATALOG' | translate }}</option>
              @for (t of catalog(); track t.id) { <option [value]="t.id">{{ t.name }} — {{ t.basePrice | number:'1.0-2' }} MAD</option> }
            </select>
            <input type="text" class="cp-input" [(ngModel)]="edit.text" [placeholder]="'CONSULTATION.F_LABEL' | translate" maxlength="200" />
            <span class="cp-editor row">
              <input type="text" class="cp-input" [(ngModel)]="edit.teeth" [placeholder]="'CONSULTATION.PLAN_TEETH' | translate" maxlength="100" />
              <input type="number" class="cp-input narrow" [(ngModel)]="edit.price" min="0" [placeholder]="'CONSULTATION.PLAN_PRICE' | translate" />
              <input type="number" class="cp-input narrow" [(ngModel)]="edit.quantity" min="1" [attr.aria-label]="'CONSULTATION.PLAN_QTY' | translate" />
            </span>
            <input type="text" class="cp-input" [(ngModel)]="edit.detail" [placeholder]="'CONSULTATION.F_NOTES' | translate" maxlength="500" />
          }
        }
        <span class="cp-editor row">
          <button type="button" class="cp-btn small primary" (click)="saveItem(list, key)" [disabled]="!edit.text.trim()">{{ 'CONSULTATION.SAVE_EDIT' | translate }}</button>
          <button type="button" class="cp-btn small" (click)="editKey.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        </span>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .cp {
      display: flex; flex-direction: column; min-height: 0; height: 100%;
      background: rgb(var(--ink-50)); border-inline-start: 1px solid rgb(var(--ink-200));
    }
    .cp-head {
      display: flex; align-items: center; justify-content: space-between; gap: .5rem;
      padding: 1rem 1rem .75rem; background: #fff; border-bottom: 1px solid rgb(var(--ink-200));
    }
    .cp-title { display: flex; align-items: center; gap: .5rem; min-width: 0; flex-wrap: wrap; }
    .cp-title h2 { margin: 0; font-size: 1.0625rem; font-weight: 700; color: rgb(var(--ink-900)); }
    .cp-dot { width: .625rem; height: .625rem; border-radius: 50%; background: rgb(var(--ink-300)); flex-shrink: 0; }
    .cp-dot.live { background: rgb(var(--critical-600)); animation: cp-pulse 1.6s ease-in-out infinite; }
    @keyframes cp-pulse { 50% { box-shadow: 0 0 0 .4rem rgb(var(--critical-600) / .15); } }
    @media (prefers-reduced-motion: reduce) { .cp-dot.live { animation: none; } }
    .cp-badge {
      font-size: .75rem; font-weight: 600; padding: .125rem .5rem; border-radius: 999px;
      background: rgb(var(--petrol-50)); color: rgb(var(--petrol-700));
    }
    .cp-badge.review { background: rgb(var(--caution-50)); color: rgb(var(--caution-700)); }
    .cp-elapsed { font-variant-numeric: tabular-nums; font-size: .8125rem; font-weight: 600; color: rgb(var(--ink-600)); }

    .cp-body { flex: 1; min-height: 0; overflow-y: auto; padding: .875rem 1rem 1.5rem; display: flex; flex-direction: column; gap: .875rem; }

    .cp-card { background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 14px; padding: 1rem; display: flex; flex-direction: column; gap: .75rem; }
    .cp-card.center { align-items: center; text-align: center; }
    .cp-card h3, .cp-card p { margin: 0; }
    .cp-hero { font-size: 2rem; color: rgb(var(--petrol-600)); }
    .cp-hero.ok { color: rgb(var(--positive-600)); font-size: 2.5rem; }
    .cp-steps { margin: 0; padding-inline-start: 1.1rem; color: rgb(var(--ink-700)); font-size: .875rem; display: grid; gap: .25rem; }
    .cp-notice { display: flex; gap: .5rem; font-size: .8125rem; color: rgb(var(--ink-700)); background: rgb(var(--caution-50)); border-radius: 10px; padding: .625rem .75rem; }
    .cp-notice .material-icons { font-size: 1.125rem; color: rgb(var(--caution-700)); flex-shrink: 0; }
    .cp-ack { display: flex; gap: .625rem; align-items: flex-start; font-size: .875rem; font-weight: 600; color: rgb(var(--ink-900)); cursor: pointer; }
    .cp-ack input { margin-top: .2rem; width: 1.125rem; height: 1.125rem; flex-shrink: 0; }

    .cp-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
    .cp-actions.col { flex-direction: column; align-items: stretch; width: 100%; }
    .cp-controls { display: flex; gap: .5rem; flex-wrap: wrap; }

    .cp-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: .375rem;
      min-height: 2.5rem; padding: .5rem .875rem; border-radius: 10px; cursor: pointer;
      border: 1px solid rgb(var(--ink-300)); background: #fff; color: rgb(var(--ink-800)); font-size: .875rem; font-weight: 600;
    }
    .cp-btn:hover:not(:disabled) { background: rgb(var(--ink-100)); }
    .cp-btn:disabled { opacity: .5; cursor: not-allowed; }
    .cp-btn.primary { background: rgb(var(--petrol-600)); border-color: rgb(var(--petrol-600)); color: #fff; }
    .cp-btn.primary:hover:not(:disabled) { background: rgb(var(--petrol-700)); }
    .cp-btn.danger { color: rgb(var(--critical-700)); border-color: rgb(var(--critical-300)); }
    .cp-btn.big { min-height: 3rem; font-size: .9375rem; width: 100%; }
    .cp-btn.small { min-height: 2rem; padding: .25rem .625rem; font-size: .8125rem; }
    .cp-btn .material-icons { font-size: 1.125rem; }
    .cp-btn:focus-visible, .cp-icon:focus-visible, .cp-link:focus-visible, .cp-input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .cp-link { background: none; border: none; padding: .5rem 0; cursor: pointer; font-size: .8125rem; text-decoration: underline; color: rgb(var(--ink-600)); align-self: center; }
    .cp-link.danger { color: rgb(var(--critical-700)); }

    .cp-icon {
      display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 8px;
      border: none; background: transparent; color: rgb(var(--ink-600)); cursor: pointer; flex-shrink: 0;
    }
    .cp-icon .material-icons { font-size: 1.125rem; }
    .cp-icon:hover { background: rgb(var(--ink-100)); }
    .cp-icon.ok { color: rgb(var(--positive-600)); }
    .cp-icon.bad { color: rgb(var(--critical-600)); }
    .cp-icon.solid { background: rgb(var(--petrol-600)); color: #fff; width: 2.5rem; height: 2.5rem; border-radius: 10px; }

    .cp-alert { display: flex; gap: .5rem; align-items: center; padding: .625rem .75rem; border-radius: 10px; font-size: .8125rem; margin: 0; }
    .cp-alert.caution { background: rgb(var(--caution-50)); color: rgb(var(--caution-800)); }
    .cp-alert.critical { background: rgb(var(--critical-50)); color: rgb(var(--critical-800)); }
    .cp-alert.action { border: none; width: 100%; text-align: start; cursor: pointer; }
    .cp-alert .material-icons { font-size: 1.125rem; flex-shrink: 0; }

    .cp-live { display: flex; align-items: center; gap: .625rem; background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 12px; padding: .625rem .75rem; }
    .cp-meter { flex: 1; height: .375rem; background: rgb(var(--ink-100)); border-radius: 999px; overflow: hidden; }
    .cp-meter span { display: block; height: 100%; background: rgb(var(--petrol-500)); transform-origin: left center; transition: transform 70ms linear; }
    .cp-live-label { font-size: .8125rem; font-weight: 600; color: rgb(var(--ink-700)); white-space: nowrap; }

    .cp-hint { margin: 0; font-size: .75rem; color: rgb(var(--ink-600)); }
    .cp-hint.note { display: flex; gap: .375rem; align-items: center; background: rgb(var(--ink-100)); border-radius: 8px; padding: .375rem .625rem; }
    .cp-hint .material-icons { font-size: 1rem; }
    .cp-reading { margin: 0; font-size: .75rem; font-weight: 600; color: rgb(var(--petrol-700)); }

    .cp-banner { display: flex; align-items: center; justify-content: space-between; gap: .5rem; background: rgb(var(--caution-50)); color: rgb(var(--caution-800)); border-radius: 12px; padding: .625rem .875rem; }
    .cp-banner.done { background: rgb(var(--positive-50)); color: rgb(var(--positive-700)); }
    .cp-banner strong { display: inline-flex; align-items: center; gap: .375rem; font-size: .875rem; }

    .cp-sec { background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 14px; padding: .75rem .875rem; display: flex; flex-direction: column; gap: .5rem; }
    .cp-sec-head { display: flex; align-items: center; gap: .5rem; background: none; border: none; padding: 0; cursor: pointer; text-align: start; width: 100%; }
    .cp-sec-head h3, .cp-sec-title h3, .cp-caught-head h3 { margin: 0; font-size: .8125rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: rgb(var(--ink-700)); flex: 1; }
    .cp-sec-title { display: flex; align-items: center; gap: .5rem; justify-content: space-between; }
    .cp-caught-head { display: flex; align-items: center; justify-content: space-between; }
    .cp-count { font-size: .75rem; font-weight: 700; color: rgb(var(--ink-600)); background: rgb(var(--ink-100)); border-radius: 999px; padding: 0 .5rem; }
    .cp-empty { margin: 0; font-size: .8125rem; color: rgb(var(--ink-500)); }

    .cp-lines { margin: 0; padding: 0; list-style: none; max-height: 10rem; overflow-y: auto; display: flex; flex-direction: column; gap: .25rem; font-size: .8125rem; }
    .cp-lines li { padding: .25rem .5rem; background: rgb(var(--ink-50)); border-radius: 8px; color: rgb(var(--ink-800)); }
    .cp-lines li.typed { border-inline-start: 3px solid rgb(var(--petrol-400)); }
    .cp-typed { display: flex; gap: .5rem; }
    .cp-typed input { flex: 1; min-width: 0; min-height: 2.5rem; padding: .5rem .75rem; border: 1px solid rgb(var(--ink-300)); border-radius: 10px; font-size: .875rem; }

    .cp-fields { margin: 0; display: grid; gap: .125rem; }
    .cp-field { display: grid; grid-template-columns: 6.5rem 1fr; gap: .5rem; align-items: start; padding: .375rem 0; border-bottom: 1px dashed rgb(var(--ink-200)); }
    .cp-field:last-child { border-bottom: none; }
    .cp-field dt { font-size: .75rem; color: rgb(var(--ink-600)); padding-top: .125rem; }
    .cp-field dd { margin: 0; display: flex; flex-wrap: wrap; gap: .25rem .5rem; align-items: center; min-width: 0; }
    .cp-field.removed .cp-value { text-decoration: line-through; opacity: .55; }

    .cp-list { margin: 0; padding: 0; list-style: none; display: grid; gap: .375rem; }
    .cp-item { padding: .375rem .5rem; background: rgb(var(--ink-50)); border-radius: 10px; }
    .cp-item.removed .cp-value { text-decoration: line-through; opacity: .55; }
    .cp-item-main { display: flex; flex-wrap: wrap; gap: .25rem .5rem; align-items: center; }
    .cp-check { display: flex; gap: .5rem; align-items: center; font-size: .875rem; cursor: pointer; }
    .cp-check input { width: 1.125rem; height: 1.125rem; }

    .cp-value { font-size: .875rem; font-weight: 600; color: rgb(var(--ink-900)); word-break: break-word; }
    .cp-value.proposed { color: rgb(var(--petrol-800)); }
    .cp-value.onfile { font-weight: 500; color: rgb(var(--ink-700)); }
    .cp-value.empty { color: rgb(var(--ink-400)); font-weight: 400; }
    .cp-status { font-size: .6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: .0625rem .375rem; border-radius: 999px; }
    .cp-status[data-status='proposed'] { background: rgb(var(--caution-100)); color: rgb(var(--caution-800)); }
    .cp-status[data-status='validated'] { background: rgb(var(--positive-100)); color: rgb(var(--positive-700)); }
    .cp-status[data-status='removed'] { background: rgb(var(--ink-200)); color: rgb(var(--ink-700)); }
    .cp-onfile { font-size: .75rem; color: rgb(var(--ink-600)); }
    .cp-onfile.diff { color: rgb(var(--caution-800)); }
    .cp-quote { font-size: .75rem; font-style: italic; color: rgb(var(--ink-500)); flex-basis: 100%; overflow-wrap: anywhere; }
    .cp-row-actions { margin-inline-start: auto; display: inline-flex; }

    .cp-editor { display: flex; gap: .375rem; align-items: center; }
    .cp-editor.col { flex-direction: column; align-items: stretch; width: 100%; }
    .cp-editor.row { flex-direction: row; flex-wrap: wrap; }
    .cp-input { min-height: 2.25rem; padding: .375rem .625rem; border: 1px solid rgb(var(--ink-300)); border-radius: 8px; font-size: .875rem; background: #fff; min-width: 0; flex: 1; }
    .cp-input.narrow { flex: 0 0 5.5rem; }

    .cp-total { display: flex; justify-content: space-between; align-items: center; padding: .5rem .625rem; border-top: 2px solid rgb(var(--ink-300)); font-size: .9375rem; }
    .cp-suggest { display: flex; flex-direction: column; gap: .25rem; background: rgb(var(--petrol-50)); border-radius: 10px; padding: .5rem .75rem; font-size: .8125rem; align-items: flex-start; }
    .cp-appt { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
    .cp-appt label { display: flex; flex-direction: column; gap: .125rem; font-size: .75rem; color: rgb(var(--ink-600)); }
    .cp-appt label.wide { grid-column: 1 / -1; }
    .cp-appt input, .cp-appt select { min-height: 2.25rem; padding: .375rem .5rem; border: 1px solid rgb(var(--ink-300)); border-radius: 8px; font-size: .875rem; color: rgb(var(--ink-900)); }
    .cp-appt .cp-btn { grid-column: 1 / -1; justify-self: start; }

    .cp-report { width: 100%; min-height: 8rem; padding: .625rem .75rem; border: 1px solid rgb(var(--ink-300)); border-radius: 10px; font: inherit; font-size: .875rem; line-height: 1.5; resize: vertical; }

    .cp-footer { position: sticky; bottom: -1.5rem; display: flex; flex-direction: column; gap: .5rem; padding: .75rem 0 .25rem; background: linear-gradient(transparent, rgb(var(--ink-50)) 25%); }
  `],
})
export class ConsultationPanelComponent {
  c = inject(ConsultationService);
  voice = inject(VoiceOrchestratorService);
  private patients = inject(PatientService);
  private stock = inject(StockService);
  private confirmDialog = inject(ConfirmDialogService);
  private voiceContext = inject(VoiceContextService);
  private translate = inject(TranslateService);

  /** A consultation was saved or discarded; the dossier may want to reload. */
  closed = output<void>();

  readonly fields = FIELDS;
  readonly insurers = INSURERS;
  readonly severities = SEVERITIES;
  readonly historyCategories = HISTORY_CATEGORIES;
  readonly treatmentTypes = TREATMENT_TYPES;
  readonly durations = [15, 30, 45, 60, 90];
  readonly today = new Date().toISOString().slice(0, 10);

  readonly lists: Array<{ name: ListName; titleKey: string; emptyKey: string; addKey: string }> = [
    { name: 'allergies', titleKey: 'CONSULTATION.SEC_ALLERGIES', emptyKey: 'CONSULTATION.EMPTY_ALLERGIES', addKey: 'CONSULTATION.ADD_ALLERGY' },
    { name: 'activeTreatments', titleKey: 'CONSULTATION.SEC_ACTIVE', emptyKey: 'CONSULTATION.EMPTY_ACTIVE', addKey: 'CONSULTATION.ADD_ACTIVE' },
    { name: 'medicalHistory', titleKey: 'CONSULTATION.SEC_HISTORY', emptyKey: 'CONSULTATION.EMPTY_HISTORY', addKey: 'CONSULTATION.ADD_HISTORY' },
    { name: 'plan', titleKey: 'CONSULTATION.SEC_PLAN', emptyKey: 'CONSULTATION.EMPTY_PLAN', addKey: 'CONSULTATION.ADD_PLAN' },
  ];

  informed = signal(false);
  showHeard = signal(true);
  editKey = signal<string | null>(null);
  edit: EditModel = { ...EMPTY_EDIT };
  typed = '';
  catalog = signal<Treatment[]>([]);

  private now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    this.stock.getTreatments().subscribe({ next: list => this.catalog.set(list), error: () => undefined });
  }

  mode = computed<Mode>(() => {
    switch (this.c.phase()) {
      case 'intake':
      case 'examination': return 'recording';
      case 'review': return 'review';
      case 'saved': return 'saved';
      default: return 'intro';
    }
  });

  elapsed = computed(() => {
    const started = this.c.consultation()?.startedAt;
    if (!started) return null;
    const seconds = Math.max(0, Math.floor((this.now() - new Date(started).getTime()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  recentLines = computed(() => this.c.lines().slice(-30));

  noteKey = computed(() => {
    switch (this.c.note()) {
      case 'extraction-disabled': return 'CONSULTATION.NOTE_DISABLED';
      case 'extraction-failed': return 'CONSULTATION.NOTE_FAILED';
      case 'truncated': return 'CONSULTATION.NOTE_TRUNCATED';
      case 'offline': return 'CONSULTATION.NOTE_OFFLINE';
      default: return null;
    }
  });

  planItems = computed(() => this.c.review().plan.filter(item => item.status !== 'removed'));
  planSummary = computed(() => planTotal(this.planItems().map(item => item.data)));

  // ── Starting ────────────────────────────────────────────────────────

  /** Reached synchronously from the tap: the service opens the microphone before it awaits anything. */
  startRecording(): void {
    if (this.voice.needsConsent()) this.voice.grantMicrophoneConsent();
    void this.c.start();
  }

  submitTyped(event: Event): void {
    event.preventDefault();
    const text = this.typed.trim();
    if (!text) return;
    this.typed = '';
    this.c.addTyped(text);
  }

  async discard(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm(this.translate.instant('CONSULTATION.DISCARD_CONFIRM'), {
      title: this.translate.instant('CONSULTATION.DISCARD_TITLE'),
      confirmLabel: this.translate.instant('CONSULTATION.DISCARD_LABEL'),
      cancelLabel: this.translate.instant('CONSULTATION.KEEP_LABEL'),
      danger: true,
    });
    if (confirmed) {
      await this.c.abandon();
      this.closed.emit();
    }
  }

  /** A chart finding as the doctor reads it — the words that were read back to them, not the audit text. */
  chartText(entry: BufferedEntry): string {
    return chartLine(entry, spokenLanguage(this.voiceContext.locale()), this.translate.instant('CONSULTATION.DOC.TOOTH'));
  }

  // ── Patient fields ──────────────────────────────────────────────────

  fieldOf(name: PatientFieldName): ReviewField | undefined {
    return this.c.review().patient[name];
  }

  /** Which fields to list: all in review, and in the recording only those with something to show. */
  showField(name: PatientFieldName, editable: boolean): boolean {
    return editable || !!this.fieldOf(name) || !!this.onFile(name);
  }

  onFile(name: PatientFieldName): string | null {
    const p = this.patients.currentPatient();
    if (!p) return null;
    switch (name) {
      case 'age': return p.dateOfBirth ? String(ageOn(p.dateOfBirth, new Date()) ?? '') || null : null;
      case 'dateOfBirth': return p.dateOfBirth ?? null;
      case 'gender': return p.gender ? p.gender : null;
      default: return (p[name as keyof typeof p] as string | null | undefined) || null;
    }
  }

  hasBirthDate(): boolean {
    return !!this.patients.currentPatient()?.dateOfBirth || this.fieldOf('dateOfBirth')?.status === 'validated';
  }

  approxYear(age: string | number): string {
    return approximateBirthDate(Number(age), new Date()).slice(0, 4);
  }

  isSame(name: PatientFieldName, field: ReviewField): boolean {
    const p = this.patients.currentPatient();
    return !!p && !changesRecord(name, field, {
      firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, gender: p.gender,
      phone: p.phone, cin: p.cin, insuranceProvider: p.insuranceProvider, insuranceNumber: p.insuranceNumber,
    }, new Date());
  }

  display(def: FieldDef, value: string | number): string {
    if (def.kind === 'number') return `${value}`;
    return String(value);
  }

  statusKey(entry: { status: string }): string {
    return `CONSULTATION.STATUS_${entry.status.toUpperCase()}`;
  }

  validateField(name: PatientFieldName): void {
    this.c.changeReview(state => setPatientField(state, name, { status: 'validated' }));
  }

  removeField(name: PatientFieldName): void {
    this.c.changeReview(state => setPatientField(state, name, { status: 'removed' }));
  }

  restoreField(name: PatientFieldName): void {
    this.c.changeReview(state => setPatientField(state, name, { status: 'proposed' }));
  }

  editField(def: FieldDef): void {
    const current = this.fieldOf(def.name);
    this.edit = { ...EMPTY_EDIT, text: current ? String(current.value) : def.kind === 'gender' ? 'M' : def.kind === 'insurer' ? 'CNOPS' : '' };
    this.editKey.set(`patient:${def.name}`);
  }

  saveField(def: FieldDef): void {
    const raw = this.edit.text.toString().trim();
    if (!raw) return;
    const value: string | number = def.kind === 'number' ? Number(raw) : raw;
    if (def.kind === 'number' && (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 120)) return;
    this.c.changeReview(state => {
      const existing = state.patient[def.name];
      return existing
        ? setPatientField(state, def.name, { value, edited: true, status: 'validated' })
        : enterPatientField(state, def.name, value);
    });
    this.editKey.set(null);
  }

  // ── Chief complaint ─────────────────────────────────────────────────

  readonly validateComplaint = (state: ReturnType<ConsultationService['review']>) => setComplaint(state, { status: 'validated' });
  readonly removeComplaint = (state: ReturnType<ConsultationService['review']>) => setComplaint(state, { status: 'removed' });
  readonly restoreComplaint = (state: ReturnType<ConsultationService['review']>) => setComplaint(state, { status: 'proposed' });

  editComplaint(value: string): void {
    this.edit = { ...EMPTY_EDIT, text: value };
    this.editKey.set('complaint');
  }

  saveComplaint(): void {
    const text = this.edit.text.trim();
    if (!text) return;
    this.c.changeReview(state => setComplaint(state, { value: text, edited: true, status: 'validated' }));
    this.editKey.set(null);
  }

  // ── Lists ───────────────────────────────────────────────────────────

  itemsOf(list: ListName): ReviewItem<unknown>[] {
    return this.c.review()[list] as ReviewItem<unknown>[];
  }

  visibleCount(list: ListName): number {
    return this.itemsOf(list).filter(item => item.status !== 'removed').length;
  }

  itemText(list: ListName, item: ReviewItem<unknown>): string {
    switch (list) {
      case 'allergies': {
        const a = item.data as AllergyData;
        return [a.substance, a.reaction ? `(${a.reaction})` : null, a.severity ? `· ${a.severity.toLowerCase()}` : null].filter(Boolean).join(' ');
      }
      case 'activeTreatments': {
        const t = item.data as ActiveTreatmentData;
        return [t.label, t.detail ? `— ${t.detail}` : null].filter(Boolean).join(' ');
      }
      case 'medicalHistory': {
        const h = item.data as HistoryData;
        return [h.label, h.detail ? `— ${h.detail}` : null].filter(Boolean).join(' ');
      }
      case 'plan': {
        const p = item.data as PlanData;
        const where = p.teeth ? ` (${p.teeth})` : '';
        const qty = p.quantity > 1 ? ` ×${p.quantity}` : '';
        const price = p.price === null ? '' : ` — ${p.price} MAD`;
        return `${p.label}${where}${qty}${price}`;
      }
    }
  }

  priceBadge(item: ReviewItem<unknown>): string | null {
    const source = (item.data as PlanData).priceSource;
    if (source === 'CATALOG') return 'CONSULTATION.PRICE_CATALOG';
    if (source === 'SPOKEN') return 'CONSULTATION.PRICE_SPOKEN';
    return null;
  }

  validateItem(list: ListName, key: string): void {
    this.c.changeReview(state => setItem(state, list, key, { status: 'validated' }));
  }

  removeItem(list: ListName, key: string): void {
    this.c.changeReview(state => setItem(state, list, key, { status: 'removed' }));
  }

  restoreItem(list: ListName, key: string): void {
    this.c.changeReview(state => setItem(state, list, key, { status: 'proposed' }));
  }

  newItem(list: ListName): void {
    this.edit = { ...EMPTY_EDIT };
    this.editKey.set(`${list}:new`);
  }

  editItem(list: ListName, item: ReviewItem<unknown>): void {
    const e: EditModel = { ...EMPTY_EDIT };
    switch (list) {
      case 'allergies': {
        const a = item.data as AllergyData;
        Object.assign(e, { text: a.substance, reaction: a.reaction ?? '', severity: a.severity ?? '' });
        break;
      }
      case 'activeTreatments': {
        const t = item.data as ActiveTreatmentData;
        Object.assign(e, { text: t.label, detail: t.detail ?? '', type: t.type });
        break;
      }
      case 'medicalHistory': {
        const h = item.data as HistoryData;
        Object.assign(e, { text: h.label, detail: h.detail ?? '', category: h.category });
        break;
      }
      case 'plan': {
        const p = item.data as PlanData;
        Object.assign(e, {
          text: p.label, teeth: p.teeth ?? '', price: p.price, quantity: p.quantity,
          detail: p.notes ?? '', treatmentId: p.treatmentId ?? '',
        });
        break;
      }
    }
    this.edit = e;
    this.editKey.set(`${list}:${item.key}`);
  }

  /** Choosing a catalogue treatment fills in what it knows: the name, if none was given, and the price. */
  pickCatalog(id: string): void {
    this.edit.treatmentId = id;
    const treatment = this.catalog().find(t => t.id === id);
    if (!treatment) return;
    if (!this.edit.text.trim()) this.edit.text = treatment.name;
    this.edit.price = treatment.basePrice;
  }

  saveItem(list: ListName, key: string): void {
    const e = this.edit;
    const text = e.text.trim();
    if (!text) return;

    const data = ((): ReviewState_ItemData => {
      switch (list) {
        case 'allergies':
          return { substance: text, reaction: e.reaction.trim() || null, severity: (e.severity || null) as AllergyData['severity'] };
        case 'activeTreatments':
          return { label: text, detail: e.detail.trim() || null, type: e.type as ActiveTreatmentData['type'] };
        case 'medicalHistory':
          return { category: e.category as HistoryData['category'], label: text, detail: e.detail.trim() || null };
        case 'plan': {
          const catalogPrice = this.catalog().find(t => t.id === e.treatmentId)?.basePrice ?? null;
          const price = e.price === null || e.price === undefined || (e.price as unknown) === '' ? null : Number(e.price);
          return {
            label: text, treatmentId: e.treatmentId || null, teeth: e.teeth.trim() || null, price,
            quantity: Math.max(1, Math.floor(Number(e.quantity) || 1)), notes: e.detail.trim() || null,
            priceSource: price !== null && catalogPrice !== null && price === Number(catalogPrice) ? 'CATALOG' : price !== null ? 'SPOKEN' : null,
          };
        }
      }
    })();

    if (key === 'new') {
      this.c.changeReview(state => addManualItem(state, list, data as never));
    } else {
      this.c.changeReview(state => setItem(state, list, key, { data: data as never, edited: true, status: 'validated' }));
    }
    this.editKey.set(null);
  }

  // ── Appointment ─────────────────────────────────────────────────────

  suggestionText(date: string | null, time: string | null, inDays: number | null): string {
    const parts: string[] = [];
    if (date) parts.push(new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'full' }));
    if (time) parts.push(time);
    if (!parts.length && inDays !== null) parts.push(`+${inDays} d`);
    return parts.join(' · ');
  }

  useSuggestion(): void {
    const s = this.c.review().appointmentSuggestion;
    this.c.setAppointment({
      date: s?.date ?? this.addDays(7),
      time: s?.time ?? '09:00',
      durationMinutes: 30,
      type: s?.reason ?? '',
      notes: '',
    });
  }

  newAppointment(): void {
    this.c.setAppointment({ date: this.addDays(7), time: '09:00', durationMinutes: 30, type: '', notes: '' });
  }

  changeAppointment(patch: Partial<{ date: string; time: string; durationMinutes: number; type: string }>): void {
    const current = this.c.review().appointment;
    if (current) this.c.setAppointment({ ...current, ...patch });
  }

  private addDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  regenerate(): void {
    void this.c.regenerateReport();
  }

  /** Not used directly — keeps the field list in one place for tests. */
  readonly fieldNames = PATIENT_FIELDS;
}

type ReviewState_ItemData = AllergyData | ActiveTreatmentData | HistoryData | PlanData;
