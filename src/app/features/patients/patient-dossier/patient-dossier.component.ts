import { Component, effect, inject, OnInit, OnDestroy, signal, computed, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, switchMap, filter, map, takeUntil } from 'rxjs';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { CommandRegistryService } from '../../../core/services/command-registry.service';
import { PatientService } from '../../../core/services/patient.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { Patient, DentalChartState, DentalChartType, ToothState, Appointment } from '../../../core/models/patient.model';
import { DentalChartComponent } from '../../dental-chart/dental-chart.component';
import { Dental3DCanvasComponent } from '../../dental-3d-canvas/dental-3d-canvas.component';
import { InvoiceService } from '../../billing/services/invoice.service';
import { Invoice } from '../../billing/models/billing.model';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { PatientTreatmentService, PatientTreatmentRequestPayload } from '../../../core/services/patient-treatment.service';
import { StockService } from '../../../core/services/stock.service';
import { PatientTreatment, PatientTreatmentConsumable, PatientTreatmentStatus } from '../../../core/models/patient-treatment.model';
import { Treatment, StockItem } from '../../../core/models/stock.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { VoiceContextService } from '../../../core/voice/voice-context.service';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { VoiceSessionPanelComponent } from '../../../shared/components/voice/voice-session-panel.component';
import { VoiceSessionDockComponent } from '../../../shared/components/voice/voice-session-dock.component';
import { MedicalHistoryCategory, NoteCategory } from '../../../core/models/clinical-record.model';

@Component({
  selector: 'app-patient-dossier',
  standalone: true,
  imports: [CommonModule, RouterModule, DentalChartComponent, Dental3DCanvasComponent, TranslateModule, FormsModule, VoiceSessionPanelComponent, VoiceSessionDockComponent],
  template: `
    <div class="dossier-container" [class.has-voice-dock]="voiceSession.isActive()">
      @if (patientService.currentPatient(); as patient) {
      <!-- Dossier Header -->
      <header class="dossier-header">
        <div class="header-top">
          <button type="button" class="back-btn" routerLink="/patients" [attr.aria-label]="'COMMON.BACK' | translate">
            <span class="material-icons" aria-hidden="true">arrow_back</span>
          </button>
          <div class="patient-title">
            <h1>{{ patient.firstName }} {{ patient.lastName }}</h1>
            <span class="status-badge active">{{ 'PATIENTS.DOSSIER.STATUS_' + patient.status | translate }}</span>
          </div>
          <div class="header-actions no-print">
            <!-- Dictation starts here and nowhere else: a session only means
                 something in the context of one patient's dossier. -->
            @if (voiceSession.isActive()) {
              <button type="button" class="btn btn-recording" (click)="endSession()"
                      [disabled]="voiceSession.busy()">
                <span class="material-icons" aria-hidden="true">stop_circle</span>
                {{ (voiceSession.busy() ? 'VOICE.ENDING' : 'VOICE.END_AND_REVIEW') | translate }}
              </button>
            } @else if (voiceSession.reviewing()) {
              <button type="button" class="btn btn-record" (click)="activeTab.set('voice')">
                <span class="material-icons" aria-hidden="true">fact_check</span>
                {{ 'VOICE.REVIEWING' | translate }}
              </button>
            } @else {
              <button type="button" class="btn btn-record" (click)="startSession()"
                      [disabled]="voiceStarting()">
                <span class="material-icons" aria-hidden="true">mic</span>
                {{ (voiceStarting() ? 'VOICE.STARTING' : 'VOICE.START') | translate }}
              </button>
            }
            <button type="button" class="btn btn-secondary btn-compact" (click)="onPrint()"
                    [attr.aria-label]="'COMMON.PRINT' | translate" [title]="'COMMON.PRINT' | translate">
              <span class="material-icons" aria-hidden="true">print</span>
              <span class="btn-label">{{ 'COMMON.PRINT' | translate }}</span>
            </button>
            <button type="button" class="btn btn-primary btn-compact" [routerLink]="['edit']"
                    [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + ('PATIENTS.NAME' | translate)"
                    [title]="('COMMON.EDIT' | translate) + ' ' + ('PATIENTS.NAME' | translate)">
              <span class="material-icons" aria-hidden="true">edit</span>
              <span class="btn-label">{{ 'COMMON.EDIT' | translate }} {{ 'PATIENTS.NAME' | translate }}</span>
            </button>
            <button type="button" class="btn btn-danger btn-compact" (click)="onDelete()"
                    [attr.aria-label]="'COMMON.DELETE' | translate" [title]="'COMMON.DELETE' | translate">
              <span class="material-icons" aria-hidden="true">delete</span>
              <span class="btn-label">{{ 'COMMON.DELETE' | translate }}</span>
            </button>
          </div>
        </div>

        <div class="patient-quick-info">
          <div class="info-item">
            <span class="label">{{ 'PATIENTS.DOSSIER.AGE' | translate }}</span>
            <span class="value">{{ calculateAge(patient.dateOfBirth) }} {{ 'PATIENTS.DOSSIER.YEARS' | translate }}</span>
          </div>
          <div class="info-divider"></div>
          <div class="info-item">
            <span class="label">{{ 'PATIENTS.DOSSIER.GENDER' | translate }}</span>
            <span class="value">{{ 'PATIENTS.DOSSIER.GENDER_' + patient.gender | translate }}</span>
          </div>
          <div class="info-divider"></div>
          <div class="info-item">
            <span class="label">{{ 'PATIENTS.DOSSIER.PHONE' | translate }}</span>
            <span class="value">{{ patient.phone }}</span>
          </div>
          <div class="info-divider"></div>
          <div class="info-item">
            <span class="label">{{ 'PATIENTS.DOSSIER.CIN' | translate }}</span>
            <span class="value">{{ patient.cin || 'N/A' }}</span>
          </div>
          <div class="info-divider"></div>
          <div class="info-item">
            <span class="label">{{ 'PATIENTS.DOSSIER.INSURANCE' | translate }}</span>
            <span class="value">{{ patient.insuranceProvider || ('PATIENTS.DOSSIER.PRIVATE' | translate) }}</span>
          </div>
        </div>

        <!-- Tabs Navigation -->
        <nav class="dossier-tabs no-print" role="tablist" [attr.aria-label]="'PATIENTS.DOSSIER.TITLE' | translate" (keydown)="onTabKeydown($event, navTabs(), activeTab(), setActiveTab.bind(this), 'dossier-tab-')">
          @for (tab of navTabs(); track tab.id) {
            <button type="button"
              [id]="'dossier-tab-' + tab.id"
              role="tab"
              [attr.aria-selected]="activeTab() === tab.id"
              [attr.aria-controls]="'dossier-panel-' + tab.id"
              [tabindex]="activeTab() === tab.id ? 0 : -1"
              [class.active]="activeTab() === tab.id"
              [class.voice-tab]="tab.id === 'voice'"
              (click)="activeTab.set(tab.id)"
            >
              <span class="material-icons" aria-hidden="true">{{ tab.icon }}</span>
              {{ tab.key | translate }}
              @if (tab.id === 'voice' && voiceSession.isActive()) {
                <span class="tab-live-dot" aria-hidden="true"></span>
              }
            </button>
          }
        </nav>
      </header>

      <!-- Main Content Area -->
      <main class="dossier-content">
        @switch (activeTab()) {
          @case ('voice') {
            <!-- Every voice result is shown here: the chart with what is staged
                 drawn on it, what was dictated, and the review. Nothing a
                 dentist says moves them to another tab or view. -->
            <div class="tab-pane" role="tabpanel" id="dossier-panel-voice" aria-labelledby="dossier-tab-voice" tabindex="0">
              <app-voice-session-panel
                [chart]="dentalChartState()"
                [findings]="clinicalRecordService.findings()"
                [treatments]="patientTreatments()"
                [patientId]="patient.id"
                [starting]="voiceStarting()"
                (begin)="beginSession()"
                (saved)="onVoiceSaved()"
              />
            </div>
          }
          @case ('overview') {
            <div class="tab-pane" role="tabpanel" id="dossier-panel-overview" aria-labelledby="dossier-tab-overview" tabindex="0">
              <div class="overview-grid">
                <!-- Summary Cards -->
                <div class="summary-card">
                  <h3>{{ 'PATIENTS.NEXT_APPOINTMENT' | translate }}</h3>
                  <div class="card-content">
                    @if (nextAppointment(); as appt) {
                      <span class="date">{{ appt.dateTime | date:'longDate' }} - {{ appt.dateTime | date:'shortTime' }}</span>
                      <span class="desc">{{ appt.type }}</span>
                    } @else {
                      <p class="empty-hint">{{ 'PATIENTS.DOSSIER.NO_UPCOMING_APPOINTMENT' | translate }}</p>
                    }
                  </div>
                </div>
                <div class="summary-card">
                  <h3>{{ 'PATIENTS.DOSSIER.ACTIVE_TREATMENTS' | translate }}</h3>
                  <div class="card-content">
                    @if (activeTreatmentsCount() > 0) {
                      <span class="date">{{ activeTreatmentsCount() }}</span>
                      <span class="desc">{{ 'PATIENTS.DOSSIER.ACTIVE_TREATMENTS' | translate }}</span>
                    } @else {
                      <p class="empty-hint">{{ 'PATIENTS.DOSSIER.NO_ACTIVE_TREATMENTS' | translate }}</p>
                    }
                  </div>
                </div>
                <div class="summary-card">
                  <h3>{{ 'BILLING.OUTSTANDING' | translate }}</h3>
                  <div class="card-content">
                    @if (balanceDueForPatient() > 0) {
                      <span class="date" [class.balance-due]="balanceDueForPatient() > 0">{{ balanceDueForPatient() | number:'1.2-2' }} MAD</span>
                      <button type="button" class="desc link-btn" (click)="activeTab.set('financial')">{{ 'BILLING.TITLE' | translate }}</button>
                    } @else {
                      <p class="empty-hint">{{ 'PATIENTS.DOSSIER.NO_INVOICES' | translate }}</p>
                    }
                  </div>
                </div>
                <div class="summary-card">
                  <h3>{{ 'PATIENTS.DOSSIER.LATEST_NOTE' | translate }}</h3>
                  <div class="card-content">
                    @if (latestNote(); as note) {
                      <span class="desc">{{ note.content }}</span>
                      <span class="clinical-item-meta">{{ note.createdAt | date:'mediumDate' }}</span>
                    } @else {
                      <p class="empty-hint">{{ 'PATIENTS.DOSSIER.NO_NOTES' | translate }}</p>
                    }
                  </div>
                </div>
                <div class="summary-card" [class.has-allergies]="clinicalRecordService.allergies().length > 0">
                  <h3>{{ 'PATIENTS.DOSSIER.ALLERGIES' | translate }}</h3>
                  <div class="card-content">
                    @if (clinicalRecordService.allergies().length) {
                      <div class="allergy-chips">
                        @for (allergy of clinicalRecordService.allergies(); track allergy.id) {
                          <span class="allergy-chip" [class]="(allergy.severity || 'mild').toLowerCase()">
                            <span class="material-icons">warning</span>
                            {{ allergy.substance }}
                          </span>
                        }
                      </div>
                    } @else {
                      <p class="empty-hint">{{ 'PATIENTS.DOSSIER.NO_ALLERGIES' | translate }}</p>
                    }
                  </div>
                </div>
                <div class="summary-card dental-chart-card">
                  <div class="chart-card-header">
                    <h3>{{ 'DENTAL_CHART.TITLE' | translate }}</h3>
                    <button type="button" class="btn btn-secondary btn-sm" (click)="showDentalChartFullscreen.set(!showDentalChartFullscreen())">
                      <span class="material-icons">{{ showDentalChartFullscreen() ? 'close_fullscreen' : 'open_in_full' }}</span>
                    </button>
                  </div>
                  @if (dentalChartState(); as chart) {
                    <app-dental-chart
                      [chartType]="chart.chartType"
                      [patientId]="chart.patientId"
                      [teeth]="chart.teeth"
                      [interactive]="true"
                      [patientTreatments]="patientTreatments()"
                      [findings]="clinicalRecordService.findings()"
                      (toothSelected)="onToothSelected($event)"
                    />
                  }
                </div>
              </div>
            </div>
          }
          @case ('clinical') {
            <div class="tab-pane" role="tabpanel" id="dossier-panel-clinical" aria-labelledby="dossier-tab-clinical" tabindex="0">
              <!-- Secondary in-page navigation — consolidated here from what
                   were six separate top-level tabs (audit VIII.5) -->
              <nav class="clinical-subtabs no-print" role="tablist" [attr.aria-label]="'PATIENTS.DOSSIER.CLINICAL' | translate" (keydown)="onTabKeydown($event, clinicalSubTabs, activeClinicalSubTab(), setActiveClinicalSubTab.bind(this), 'clinical-subtab-')">
                @for (sub of clinicalSubTabs; track sub.id) {
                  <button
                    type="button"
                    [id]="'clinical-subtab-' + sub.id"
                    role="tab"
                    [attr.aria-selected]="activeClinicalSubTab() === sub.id"
                    [attr.aria-controls]="'clinical-subpanel-' + sub.id"
                    [tabindex]="activeClinicalSubTab() === sub.id ? 0 : -1"
                    [class.active]="activeClinicalSubTab() === sub.id"
                    (click)="activeClinicalSubTab.set(sub.id)"
                  >
                    <span class="material-icons" aria-hidden="true">{{ sub.icon }}</span>
                    {{ sub.key | translate }}
                  </button>
                }
              </nav>

              @switch (activeClinicalSubTab()) {
                @case ('history') {
                  <section class="dossier-section">
                    <div class="notes-header">
                      <h2>{{ 'PATIENTS.DOSSIER.MEDICAL_HISTORY' | translate }}</h2>
                      <button type="button" class="btn btn-primary btn-sm" (click)="showHistoryForm.set(!showHistoryForm())">
                        {{ 'COMMON.ADD' | translate }}
                      </button>
                    </div>

                    @if (showHistoryForm()) {
                      <div class="inline-form">
                        <select [(ngModel)]="historyForm.category" class="select">
                          @for (cat of medicalHistoryCategories; track cat) {
                            <option [value]="cat">{{ cat }}</option>
                          }
                        </select>
                        <input type="text" [(ngModel)]="historyForm.label" placeholder="Label (e.g. Hypertension)" class="input" />
                        <textarea [(ngModel)]="historyForm.detail" placeholder="Detail (optional)" rows="2" class="textarea"></textarea>
                        <div class="inline-form-actions">
                          <button type="button" class="btn btn-ghost btn-sm" (click)="showHistoryForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
                          <button type="button" class="btn btn-primary btn-sm" [disabled]="!historyForm.label" (click)="submitMedicalHistory()">{{ 'COMMON.SAVE' | translate }}</button>
                        </div>
                      </div>
                    }

                    @if (clinicalRecordService.medicalHistory().length) {
                      <div class="clinical-list">
                        @for (entry of clinicalRecordService.medicalHistory(); track entry.id) {
                          <div class="clinical-item">
                            <div class="clinical-item-main">
                              <span class="clinical-item-badge">{{ entry.category }}</span>
                              <span class="clinical-item-label">{{ entry.label }}</span>
                              @if (entry.detail) { <p class="clinical-item-detail">{{ entry.detail }}</p> }
                            </div>
                            <button type="button" class="btn btn-ghost btn-icon" (click)="removeMedicalHistory(entry.id)" title="Delete">
                              <span class="material-icons text-sm">delete</span>
                            </button>
                          </div>
                        }
                      </div>
                    } @else if (!showHistoryForm()) {
                      <div class="empty">
                        <span class="material-icons">medical_services</span>
                        <p>{{ 'PATIENTS.DOSSIER.NO_MEDICAL_HISTORY' | translate }}</p>
                      </div>
                    }
                  </section>
                }
                @case ('diagnostics') {
                  <section class="dossier-section">
                    <div class="notes-header">
                      <h2>{{ 'PATIENTS.DOSSIER.DIAGNOSTICS' | translate }}</h2>
                      <button type="button" class="btn btn-primary btn-sm" (click)="openFindingForm('diagnostic')">
                        {{ 'COMMON.ADD' | translate }}
                      </button>
                    </div>

                    @if (showFindingForm() === 'diagnostic') {
                      <div class="inline-form">
                        <input type="text" [(ngModel)]="findingForm.fdi" placeholder="Tooth FDI (e.g. 26)" maxlength="2" class="input" />
                        <select [(ngModel)]="findingForm.findingCode" class="select">
                          <option value="" disabled>Select a finding...</option>
                          @for (def of diagnosticCatalogCodes(); track def.code) {
                            <option [value]="def.code">{{ def.code | titlecase }}</option>
                          }
                        </select>
                        <select [(ngModel)]="findingForm.severity" class="select">
                          <option value="">No severity</option>
                          <option value="MILD">Mild</option>
                          <option value="MODERATE">Moderate</option>
                          <option value="SEVERE">Severe</option>
                        </select>
                        <textarea [(ngModel)]="findingForm.note" placeholder="Note (optional)" rows="2" class="textarea"></textarea>
                        <div class="inline-form-actions">
                          <button type="button" class="btn btn-ghost btn-sm" (click)="showFindingForm.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
                          <button type="button" class="btn btn-primary btn-sm" [disabled]="!findingForm.fdi || !findingForm.findingCode" (click)="submitFinding()">{{ 'COMMON.SAVE' | translate }}</button>
                        </div>
                      </div>
                    }

                    @if (diagnosticFindings().length) {
                      <div class="clinical-list">
                        @for (finding of diagnosticFindings(); track finding.id) {
                          <div class="clinical-item">
                            <div class="clinical-item-main">
                              <span class="clinical-item-badge tooth">#{{ finding.fdi }}</span>
                              <span class="clinical-item-label">{{ finding.findingCode | titlecase }}</span>
                              @if (finding.severity) { <span class="clinical-item-severity" [class]="finding.severity.toLowerCase()">{{ finding.severity }}</span> }
                              @if (finding.note) { <p class="clinical-item-detail">{{ finding.note }}</p> }
                            </div>
                            <button type="button" class="btn btn-ghost btn-icon" (click)="resolveFinding(finding.id)" title="Mark resolved">
                              <span class="material-icons text-sm">check_circle</span>
                            </button>
                          </div>
                        }
                      </div>
                    } @else if (showFindingForm() !== 'diagnostic') {
                      <div class="empty">
                        <span class="material-icons">biotech</span>
                        <p>{{ 'PATIENTS.DOSSIER.NO_DIAGNOSTICS' | translate }}</p>
                      </div>
                    }
                  </section>
                }
                @case ('plan') {
                  <section class="dossier-section">
                    <div class="notes-header">
                      <h2>{{ 'PATIENTS.DOSSIER.TREATMENT_PLAN' | translate }}</h2>
                      <button type="button" class="btn btn-primary btn-sm" (click)="openFindingForm('plan')">
                        {{ 'COMMON.ADD' | translate }}
                      </button>
                    </div>

                    @if (showFindingForm() === 'plan') {
                      <div class="inline-form">
                        <input type="text" [(ngModel)]="findingForm.fdi" placeholder="Tooth FDI (e.g. 26)" maxlength="2" class="input" />
                        <select [(ngModel)]="findingForm.findingCode" class="select">
                          <option value="" disabled>Select required treatment...</option>
                          @for (def of treatmentRequiredCatalogCodes(); track def.code) {
                            <option [value]="def.code">{{ def.code | titlecase }}</option>
                          }
                        </select>
                        <textarea [(ngModel)]="findingForm.note" placeholder="Note (optional)" rows="2" class="textarea"></textarea>
                        <div class="inline-form-actions">
                          <button type="button" class="btn btn-ghost btn-sm" (click)="showFindingForm.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
                          <button type="button" class="btn btn-primary btn-sm" [disabled]="!findingForm.fdi || !findingForm.findingCode" (click)="submitFinding()">{{ 'COMMON.SAVE' | translate }}</button>
                        </div>
                      </div>
                    }

                    @if (treatmentRequiredFindings().length) {
                      <div class="clinical-list">
                        @for (finding of treatmentRequiredFindings(); track finding.id) {
                          <div class="clinical-item">
                            <div class="clinical-item-main">
                              <span class="clinical-item-badge tooth">#{{ finding.fdi }}</span>
                              <span class="clinical-item-label">{{ finding.findingCode | titlecase }}</span>
                              @if (finding.note) { <p class="clinical-item-detail">{{ finding.note }}</p> }
                            </div>
                            <button type="button" class="btn btn-ghost btn-icon" (click)="resolveFinding(finding.id)" title="Mark treated">
                              <span class="material-icons text-sm">check_circle</span>
                            </button>
                          </div>
                        }
                      </div>
                    } @else if (showFindingForm() !== 'plan') {
                      <div class="empty">
                        <span class="material-icons">assignment</span>
                        <p>{{ 'PATIENTS.DOSSIER.NO_TREATMENT_PLAN' | translate }}</p>
                      </div>
                    }
                  </section>
                }
                @case ('appointments') {
                  <section class="dossier-section">
                    <h2>{{ 'COMMON.SCHEDULE' | translate }}</h2>
                    @if (patientAppointments().length) {
                      <div class="table-wrap">
                        <div class="table-scroll">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>{{ 'COMMON.DATE' | translate }}</th>
                                <th>{{ 'COMMON.TYPE' | translate }}</th>
                                <th>{{ 'COMMON.STATUS' | translate }}</th>
                                <th>{{ 'COMMON.NOTES' | translate }}</th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (app of patientAppointments(); track app.id) {
                                <tr>
                                  <td>{{ app.dateTime | date:'mediumDate' }}</td>
                                  <td>{{ app.type }}</td>
                                  <td><span class="status-badge">{{ app.status }}</span></td>
                                  <td>{{ app.notes }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        </div>
                      </div>
                    } @else {
                      <div class="empty">
                        <span class="material-icons">event_busy</span>
                        <p>{{ 'PATIENTS.DOSSIER.NO_APPOINTMENTS' | translate }}</p>
                      </div>
                    }
                  </section>
                }
                @case ('notes') {
                  <section class="dossier-section">
                    <div class="notes-header">
                      <h2>{{ 'DENTAL_CHART.REPORT_TITLE' | translate }}</h2>
                      <button type="button" class="btn btn-primary btn-sm" (click)="showNoteForm.set(!showNoteForm())">
                        {{ 'COMMON.ADD' | translate }} {{ 'DENTAL_CHART.NOTE_LABEL' | translate }}
                      </button>
                    </div>

                    @if (showNoteForm()) {
                      <div class="inline-form">
                        <select [(ngModel)]="noteForm.category" class="select">
                          @for (cat of noteCategories; track cat) {
                            <option [value]="cat">{{ cat }}</option>
                          }
                        </select>
                        <textarea [(ngModel)]="noteForm.content" placeholder="Note content..." rows="3" class="textarea"></textarea>
                        <div class="inline-form-actions">
                          <button type="button" class="btn btn-ghost btn-sm" (click)="showNoteForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
                          <button type="button" class="btn btn-primary btn-sm" [disabled]="!noteForm.content" (click)="submitNote()">{{ 'COMMON.SAVE' | translate }}</button>
                        </div>
                      </div>
                    }

                    @if (clinicalRecordService.notes().length) {
                      <div class="clinical-list">
                        @for (note of clinicalRecordService.notes(); track note.id) {
                          <div class="clinical-item">
                            <div class="clinical-item-main">
                              <span class="clinical-item-badge">{{ note.category }}</span>
                              @if (note.fdi) { <span class="clinical-item-badge tooth">#{{ note.fdi }}</span> }
                              <p class="clinical-item-detail">{{ note.content }}</p>
                              <span class="clinical-item-meta">{{ note.createdAt | date:'medium' }}</span>
                            </div>
                            <button type="button" class="btn btn-ghost btn-icon" (click)="removeNote(note.id)" title="Delete">
                              <span class="material-icons text-sm">delete</span>
                            </button>
                          </div>
                        }
                      </div>
                    } @else if (!showNoteForm()) {
                      <div class="empty">
                        <span class="material-icons">history_edu</span>
                        <p>{{ 'PATIENTS.DOSSIER.NO_NOTES' | translate }}</p>
                      </div>
                    }
                  </section>
                }
                @case ('treatments') {
                  <div class="treatments-layout-3d">
                    <!-- Interactive 3D canvas. The treatment tracker is
                         projected into the canvas' own side panel, so that
                         panel shows the patient's treatments while no tooth
                         is selected instead of sitting empty. -->
                    <div class="chart-sidebar-3d">
                      @if (dentalChartState(); as chart) {
                        <app-dental-3d-canvas
                          [patientId]="patient.id"
                          [initialTeeth]="chart.teeth"
                          (toothSelected)="onToothSelected3D($event)"
                          (openAssignModal)="openAssignModalFrom3D($event)"
                        >
                    <div class="treatments-tracker" canvasIdlePanel>
                      <div class="tracker-header">
                        <h2>Patient Clinical Treatments</h2>
                        <button type="button" class="btn btn-primary" (click)="openAssignModal()">
                          <span class="material-icons">add</span>
                          Assign Treatment
                        </button>
                      </div>

                      <div class="treatments-list">
                        @for (pt of patientTreatments(); track pt.id) {
                          <div class="treatment-card">
                            <div class="card-left">
                              <div class="treatment-icon">
                                <span class="material-icons">healing</span>
                              </div>
                              <div class="treatment-meta">
                                <div class="flex items-center gap-2">
                                  <span class="treatment-name">{{ pt.treatment.name }}</span>
                                  <span class="teeth-list">Teeth: {{ pt.teeth }}</span>
                                </div>
                                <div class="flex items-center gap-4 text-xs text-slate-500 mt-1">
                                  <span><span class="font-semibold text-slate-700">Doctor:</span> {{ pt.doctorName }}</span>
                                  <span *ngIf="pt.startDate">
                                    <span class="font-semibold text-slate-700">Started:</span> {{ pt.startDate | date:'mediumDate' }}
                                  </span>
                                </div>
                                <p class="treatment-desc text-xs text-slate-600 mt-2" *ngIf="pt.notes">
                                  {{ pt.notes }}
                                </p>
                              </div>
                            </div>

                            <div class="card-right">
                              <div class="status-progress">
                                <span [class]="getStatusClass(pt.status)">{{ pt.status }}</span>
                                <div class="progress-bar-container">
                                  <div class="progress-fill" [style.width.%]="pt.progress"></div>
                                  <span class="progress-val">{{ pt.progress }}%</span>
                                </div>
                              </div>

                              <div class="card-actions">
                                <button type="button" class="btn btn-ghost btn-icon" (click)="openAssignModal(pt)" title="Edit">
                                  <span class="material-icons text-slate-500 hover:text-slate-800">edit</span>
                                </button>
                                <button type="button" class="btn btn-ghost btn-icon" (click)="deletePatientTreatment(pt)" title="Delete">
                                  <span class="material-icons text-red-600 hover:text-red-700">delete</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        } @empty {
                          <div class="no-treatments">
                            <span class="material-icons large">health_and_safety</span>
                            <p>No treatments assigned to this patient.</p>
                            <button type="button" class="btn btn-secondary btn-sm mt-3" (click)="openAssignModal()">Assign First Treatment</button>
                          </div>
                        }
                      </div>
                    </div>
                        </app-dental-3d-canvas>
                      }
                    </div>
                  </div>
                }
              }
            </div>

            <!-- Custom Modal Backdrop -->
            @if (showAssignModal()) {
              <div class="modal-backdrop" (click)="closeAssignModal()">
                <div class="modal-card" (click)="$event.stopPropagation()">
                  <header class="modal-header">
                    <h3>{{ isEditingTreatment() ? 'Edit Treatment Assignment' : 'Assign Treatment Procedure' }}</h3>
                    <button type="button" class="btn btn-ghost btn-icon" [attr.aria-label]="'COMMON.CLOSE' | translate" (click)="closeAssignModal()">
                      <span class="material-icons" aria-hidden="true">close</span>
                    </button>
                  </header>

                  <div class="modal-body">
                    <div class="form-grid">
                      <!-- Select Treatment -->
                      <div class="form-group col-span-2">
                        <label>Select Treatment Setup *</label>
                        <select [(ngModel)]="formTreatmentId" (ngModelChange)="onTreatmentSelected($event)" [disabled]="isEditingTreatment()" class="select">
                          <option value="" disabled>-- Choose a predefined treatment --</option>
                          @for (t of availableTreatments(); track t.id) {
                            <option [value]="t.id">{{ t.name }} ({{ t.code }})</option>
                          }
                        </select>
                      </div>

                      <!-- Teeth comma separated -->
                      <div class="form-group">
                        <label>Assigned Teeth (FDI numbers separated by comma) *</label>
                        <input type="text" [(ngModel)]="formTeeth" placeholder="e.g. 11, 12, 13" class="input">
                      </div>

                      <!-- Doctor Name -->
                      <div class="form-group">
                        <label>Assigned Doctor *</label>
                        <input type="text" [(ngModel)]="formDoctorName" class="input">
                      </div>

                      <!-- Status -->
                      <div class="form-group">
                        <label>Status</label>
                        <select [(ngModel)]="formStatus" class="select">
                          <option value="PLANNED">PLANNED</option>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="COMPLETED">COMPLETED</option>
                          <option value="CANCELLED">CANCELLED</option>
                        </select>
                      </div>

                      <!-- Progress Slider -->
                      <div class="form-group">
                        <label>Progress ({{ formProgress }}%)</label>
                        <div class="flex items-center gap-2">
                          <input type="range" min="0" max="100" step="5" [(ngModel)]="formProgress" class="flex-1">
                        </div>
                      </div>

                      <!-- Start Date -->
                      <div class="form-group">
                        <label>Start Date</label>
                        <input type="date" [(ngModel)]="formStartDate" class="input">
                      </div>

                      <!-- End Date -->
                      <div class="form-group">
                        <label>End Date</label>
                        <input type="date" [(ngModel)]="formEndDate" class="input">
                      </div>

                      <!-- Notes -->
                      <div class="form-group col-span-2">
                        <label>Clinical Notes</label>
                        <textarea [(ngModel)]="formNotes" placeholder="Describe clinical symptoms or execution details..." class="textarea"></textarea>
                      </div>

                      <!-- Predefined Materials / Consumables -->
                      <div class="form-group col-span-2">
                        <div class="flex justify-between items-center mb-2">
                          <span class="font-bold text-slate-700 text-sm">Material Consumption Settings</span>
                          <button type="button" class="btn btn-secondary btn-sm" (click)="addConsumableToForm()">
                            <span class="material-icons">add</span> Add Material
                          </button>
                        </div>
                        
                        <div class="consumables-editor bg-slate-50 p-3 rounded-xl border border-slate-200">
                          @if (formConsumables.length > 0) {
                            @for (c of formConsumables; track $index) {
                              <div class="consumable-editor-row">
                                <div class="item-select">
                                  <select [(ngModel)]="c.stockItem" class="select">
                                    @for (item of availableStockItems(); track item.id) {
                                      <option [ngValue]="item">{{ item.name }} (SKU: {{ item.sku }})</option>
                                    }
                                  </select>
                                </div>
                                <div class="item-qty">
                                  <input type="number" step="any" [(ngModel)]="c.quantityUsed" class="input" style="width: 80px;">
                                  <span class="text-xs text-slate-500 ms-1">{{ c.stockItem.unitLabel || 'Units' }}</span>
                                </div>
                                <div class="item-actions">
                                  <button type="button" class="btn btn-ghost btn-icon" (click)="removeConsumableFromForm($index)">
                                    <span class="material-icons text-sm text-red-600">delete</span>
                                  </button>
                                </div>
                              </div>
                            }
                          } @else {
                            <p class="text-slate-500 text-xs italic text-center p-2">No materials configured for consumption in this session.</p>
                          }
                        </div>
                      </div>
                    </div>
                  </div>

                  <footer class="modal-footer mt-4">
                    <button type="button" class="btn btn-secondary" (click)="closeAssignModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" (click)="savePatientTreatment()">Save Assignment</button>
                  </footer>
                </div>
              </div>
            }
          }
          @case ('financial') {
            <div class="tab-pane" role="tabpanel" id="dossier-panel-financial" aria-labelledby="dossier-tab-financial" tabindex="0">
              <div class="billing-header">
                <h2>{{ 'BILLING.TITLE' | translate }}</h2>
                <button type="button" class="btn btn-primary" [routerLink]="['/billing/invoices/create']" [queryParams]="{ patientId: patient.id }">
                  <span class="material-icons">add</span>
                  {{ 'BILLING.NEW_INVOICE' | translate }}
                </button>
              </div>

              <div class="billing-summary-mini">
                <div class="mini-stat">
                  <span class="label">{{ 'BILLING.TOTAL_INVOICED' | translate }}</span>
                  <span class="value">{{ totalInvoicedForPatient() | number:'1.2-2' }} MAD</span>
                </div>
                <div class="mini-stat">
                  <span class="label">{{ 'BILLING.OUTSTANDING' | translate }}</span>
                  <span class="value warning">{{ balanceDueForPatient() | number:'1.2-2' }} MAD</span>
                </div>
              </div>

              <div class="table-wrap">
                <div class="table-scroll">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>{{ 'BILLING.INVOICE_NUMBER' | translate }}</th>
                        <th>{{ 'COMMON.STATUS' | translate }}</th>
                        <th>{{ 'COMMON.DATE' | translate }}</th>
                        <th>{{ 'COMMON.AMOUNT' | translate }}</th>
                        <th>{{ 'COMMON.ACTIONS' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (invoice of patientInvoices(); track invoice.id) {
                        <tr>
                          <td><span class="invoice-link" [routerLink]="['/billing/invoices', invoice.id]">{{ invoice.invoiceNumber }}</span></td>
                          <td>
                            <span class="status-badge" [class]="invoice.status.toLowerCase().replace('_', '-')">
                              {{ 'BILLING.STATUS.' + invoice.status | translate }}
                            </span>
                          </td>
                          <td>{{ invoice.issueDate | date:'mediumDate' }}</td>
                          <td>{{ invoice.total | number:'1.2-2' }} {{ invoice.currency }}</td>
                          <td>
                            <button type="button" class="icon-btn" [title]="'PATIENTS.DOSSIER.DOWNLOAD_PDF' | translate" [attr.aria-label]="'PATIENTS.DOSSIER.DOWNLOAD_PDF' | translate"><span class="material-icons" aria-hidden="true">download</span></button>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="empty">{{ 'PATIENTS.DOSSIER.NO_INVOICES' | translate }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }
        }
      </main>
      } @else {
        <div class="loading">
          <p>{{ 'COMMON.LOADING' | translate }}</p>
        </div>
      }

      <!-- Scoped to the dossier rather than mounted at the app root. A voice
           command like "sixteen, recurrent caries" only has a referent when a
           patient's record is open; showing a live microphone on the billing
           screen invited exactly the ambiguity this rework removes. -->
      <app-voice-session-dock
        [onVoiceTab]="activeTab() === 'voice'"
        (openPanel)="activeTab.set('voice')"
        (resume)="beginSession()"
      />
    </div>
  `,
  styles: [`
    .dossier-container {
      background: rgb(var(--ink-50));
      min-height: 100vh;
    }

    .dossier-header {
      background: white;
      padding: 1.5rem 2rem 0 2rem;
      border-bottom: 1px solid rgb(var(--ink-200));
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .header-top {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .back-btn {
      background: rgb(var(--ink-100));
      border: none;
      padding: 0.5rem;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      transition: all 0.2s;
    }

    .back-btn:hover {
      background: rgb(var(--ink-200));
    }

    .patient-title {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .patient-title h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    .patient-quick-info {
      display: flex;
      align-items: center;
      gap: 2rem;
      padding-bottom: 1.5rem;
      color: rgb(var(--ink-500));
      font-size: 0.9rem;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-item .label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      font-weight: 600;
      color: rgb(var(--ink-500));
    }

    .info-item .value {
      color: rgb(var(--ink-700));
      font-weight: 600;
    }

    .info-divider {
      width: 1px;
      height: 24px;
      background: rgb(var(--ink-200));
    }

    .btn-record, .btn-recording {
      display: inline-flex; align-items: center; gap: .4rem;
    }
    .btn-compact { display: inline-flex; align-items: center; gap: .4rem; }
    .tab-live-dot {
      width: .5rem; height: .5rem; border-radius: 50%; background: #c62828;
      animation: recording-pulse 1.6s ease-in-out infinite;
    }
    /* Room for the recording dock, so it never covers the last row. */
    .dossier-container.has-voice-dock { padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px)); }
    .btn-record { background: var(--primary, #2563eb); color: #fff; }
    /* Unmissable while the microphone is live — the dentist is not looking at
       the screen, so the one person who can see this state is whoever else is
       in the room. */
    .btn-recording { background: #c62828; color: #fff; }
    .btn-recording .material-icons { animation: recording-pulse 1.6s ease-in-out infinite; }
    @keyframes recording-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) {
      .btn-recording .material-icons { animation: none; }
    }

    .dossier-tabs {
      display: flex;
      gap: 2rem;
    }

    .dossier-tabs button {
      background: transparent;
      border: none;
      padding: 1rem 0;
      color: rgb(var(--ink-500));
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      position: relative;
      transition: all 0.2s;
    }

    .dossier-tabs button:hover {
      color: rgb(var(--petrol-900));
    }

    .dossier-tabs button.active {
      color: rgb(var(--petrol-900));
    }

    .dossier-tabs button.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      inset-inline-start: 0;
      inset-inline-end: 0;
      height: 2px;
      background: var(--action);
    }

    .dossier-tabs button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .dossier-content {
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .tab-pane {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .overview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .summary-card {
      background: white;
      padding: 1.5rem;
      border-radius: 16px;
      border: 1px solid rgb(var(--ink-200));
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
    }

    .summary-card h3 {
      font-size: 1rem;
      margin: 0 0 1rem 0;
      color: rgb(var(--ink-500));
      font-weight: 600;
    }

    .card-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .card-content .date {
      color: rgb(var(--petrol-900));
      font-weight: 700;
      font-size: 1.1rem;
    }

    .card-content .desc {
      color: rgb(var(--ink-700));
    }

    .card-content .date.balance-due {
      color: rgb(var(--critical-600));
    }

    .link-btn {
      background: none;
      border: none;
      padding: 0;
      color: rgb(var(--petrol-900));
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
      text-align: start;
      font-size: inherit;
    }

    .clinical-subtabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid rgb(var(--ink-200));
    }

    .clinical-subtabs button {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.9rem;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: rgb(var(--ink-500));
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .clinical-subtabs button .material-icons {
      font-size: 18px;
    }

    .clinical-subtabs button:hover {
      background: rgb(var(--ink-100));
      color: rgb(var(--ink-700));
    }

    .clinical-subtabs button.active {
      background: rgb(var(--petrol-50));
      color: rgb(var(--petrol-900));
    }

    .clinical-subtabs button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .dental-chart-card {
      grid-column: 1 / -1;
    }

    .chart-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .chart-card-header h3 {
      margin: 0;
    }

    .chart-card-header .btn-sm {
      padding: 0.25rem;
      min-width: unset;
    }

    .chart-card-header .btn-sm .material-icons {
      font-size: 1.1rem;
    }

    /* Treatments Layout */
    .treatments-layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 2rem;
      align-items: start;
    }

    .chart-sidebar {
      background: white;
      border: 1px solid rgb(var(--ink-200));
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }

    .sidebar-header-custom h3 {
      font-size: 1.1rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0 0 0.25rem 0;
    }

    .dental-chart-small {
      margin: 1rem 0;
      border-bottom: 1px solid rgb(var(--ink-100));
      padding-bottom: 1rem;
    }

    .tooth-treatment-details {
      background: rgb(var(--ink-50));
      border-radius: 12px;
      padding: 1rem;
      border: 1px solid rgb(var(--ink-200));
    }

    .detail-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid rgb(var(--ink-200));
      padding-bottom: 0.5rem;
    }

    .detail-header h4 {
      font-size: 0.9rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .tooth-badge {
      background: rgb(var(--petrol-700));
      color: white;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
    }

    .small-timeline {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .timeline-detail-item {
      background: white;
      border: 1px solid rgb(var(--ink-200));
      border-radius: 8px;
      padding: 0.75rem;
    }

    .material-chip {
      background: rgb(var(--ink-100));
      color: rgb(var(--ink-600));
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.15rem 0.4rem;
      border-radius: 9999px;
      border: 1px solid rgb(var(--ink-300));
    }

    .treatments-tracker {
      background: white;
      border: 1px solid rgb(var(--ink-200));
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }

    .tracker-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .tracker-header h2 {
      font-size: 1.25rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .treatments-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .treatment-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgb(var(--ink-50));
      border: 1px solid rgb(var(--ink-200));
      border-radius: 12px;
      padding: 1.25rem;
      transition: all 0.2s;
    }

    .treatment-card:hover {
      border-color: rgb(var(--petrol-900));
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(3, 4, 94, 0.05);
    }

    .card-left {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      flex: 1;
    }

    .treatment-icon {
      background: rgb(var(--petrol-50));
      color: rgb(var(--petrol-900));
      padding: 0.5rem;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .treatment-meta {
      flex: 1;
    }

    .treatment-name {
      font-weight: 700;
      color: rgb(var(--ink-900));
      font-size: 1rem;
    }

    .teeth-list {
      font-size: 0.75rem;
      font-weight: 700;
      background: rgb(var(--ink-200));
      color: rgb(var(--ink-600));
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
    }

    .card-right {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .status-progress {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.5rem;
      min-width: 120px;
    }

    .progress-bar-container {
      width: 100px;
      height: 6px;
      background: rgb(var(--ink-200));
      border-radius: 9999px;
      position: relative;
    }

    .progress-fill {
      height: 100%;
      background: var(--action);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .progress-val {
      font-size: 0.7rem;
      font-weight: 700;
      color: rgb(var(--ink-500));
      margin-top: 0.2rem;
    }

    .card-actions {
      display: flex;
      gap: 0.5rem;
    }

    .no-treatments {
      text-align: center;
      padding: 4rem 2rem;
      background: rgb(var(--ink-50));
      border: 2px dashed rgb(var(--ink-300));
      border-radius: 12px;
      color: rgb(var(--ink-500));
    }

    .no-treatments .material-icons.large {
      font-size: 3rem;
      color: rgb(var(--ink-500));
      margin-bottom: 1rem;
    }

    /* Modal Styling */
    .modal-backdrop {
      position: fixed;
      top: 0;
      inset-inline-start: 0;
      inset-inline-end: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999;
      animation: fadeIn 0.2s ease-out;
    }

    .modal-card {
      background: white;
      border-radius: 20px;
      width: 650px;
      max-width: 90%;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      padding: 2rem;
      display: flex;
      flex-direction: column;
      animation: slideUp 0.2s ease-out;
    }

    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid rgb(var(--ink-100));
      padding-bottom: 0.75rem;
    }

    .modal-header h3 {
      font-size: 1.2rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }

    .col-span-2 {
      grid-column: span 2;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .form-group label {
      font-size: 0.75rem;
      font-weight: 700;
      color: rgb(var(--ink-600));
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .consumable-editor-row {
      display: grid;
      grid-template-columns: 1fr 160px 40px;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      border-top: 1px solid rgb(var(--ink-100));
      padding-top: 1rem;
    }

    .dossier-section {
      background: white;
      padding: 2rem;
      border-radius: 16px;
      border: 1px solid rgb(var(--ink-200));
    }

    .section-title { margin-top: 0; }

    .info-group { margin-bottom: 1.5rem; }
    .info-group label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: rgb(var(--ink-500));
      margin-bottom: 0.5rem;
    }

    .tag-list { display: flex; gap: 0.5rem; }
    .tag {
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgb(var(--ink-100));
      color: rgb(var(--ink-600));
    }
    .tag.alert { background: rgb(var(--critical-100)); color: rgb(var(--critical-700)); }

    .notes-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .note-item {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid rgb(var(--ink-200));
      margin-bottom: 1rem;
    }
    .note-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      font-size: 0.85rem;
    }
    .note-meta .author { font-weight: 700; color: rgb(var(--ink-900)); }
    .note-meta .date { color: rgb(var(--ink-500)); }
    .note-content { margin: 0; color: rgb(var(--ink-600)); line-height: 1.5; }

    .docs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }
    .doc-card {
      background: white;
      border: 1px solid rgb(var(--ink-200));
      border-radius: 12px;
      padding: 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .doc-card:hover { border-color: rgb(var(--petrol-900)); transform: translateY(-2px); }
    .doc-icon {
      color: rgb(var(--petrol-900));
      background: rgb(var(--petrol-50));
      padding: 0.5rem;
      border-radius: 8px;
    }
    .doc-info .name { display: block; font-weight: 600; font-size: 0.9rem; color: rgb(var(--ink-900)); }
    .doc-info .date { font-size: 0.75rem; color: rgb(var(--ink-500)); }
    
    .billing-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .billing-summary-mini {
      display: flex;
      gap: 2rem;
      margin-bottom: 2rem;
      background: rgb(var(--ink-50));
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid rgb(var(--ink-200));
    }

    .mini-stat {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .mini-stat .label {
      font-size: 0.75rem;
      font-weight: 600;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
    }

    .mini-stat .value {
      font-size: 1.25rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
    }

    .mini-stat .value.warning { color: rgb(var(--caution-600)); }

    .invoice-link {
      color: rgb(var(--petrol-900));
      font-weight: 600;
      cursor: pointer;
    }

    .invoice-link:hover { text-decoration: underline; }

    /* .empty (shared) supplies the flex/centering/padding shell; this only
       adapts the icon+paragraph markup used here to look the same as before. */
    .empty p {
      color: rgb(var(--ink-500));
      font-style: italic;
    }

    .empty .material-icons {
      font-size: 2rem;
      color: rgb(var(--ink-300));
    }

    .empty-hint {
      color: rgb(var(--ink-500));
      font-style: italic;
      font-size: 0.85rem;
    }

    .summary-card.has-allergies {
      border-color: rgb(var(--critical-300));
      background: rgb(var(--critical-50));
    }

    .allergy-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .allergy-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.8rem;
      font-weight: 600;
      border-radius: 999px;
      padding: 0.25rem 0.7rem;
      background: rgb(var(--critical-100));
      color: rgb(var(--critical-800));
    }
    .allergy-chip .material-icons { font-size: 14px; }
    .allergy-chip.moderate { background: rgb(var(--caution-200)); color: rgb(var(--caution-800)); }
    .allergy-chip.severe { background: rgb(var(--critical-200)); color: rgb(var(--critical-900)); font-weight: 700; }

    .inline-form {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      background: rgb(var(--ink-50));
      border: 1px solid rgb(var(--ink-200));
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }

    .inline-form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }

    .clinical-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .clinical-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 0.75rem;
      background: white;
      border: 1px solid rgb(var(--ink-200));
      border-radius: 10px;
      padding: 0.75rem 1rem;
    }

    .clinical-item-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
    }

    .clinical-item-badge {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      background: rgb(var(--ink-100));
      color: rgb(var(--ink-600));
      border-radius: 999px;
      padding: 0.15rem 0.6rem;
    }

    .clinical-item-badge.tooth {
      background: rgb(var(--petrol-700));
      color: white;
    }

    .clinical-item-label {
      font-weight: 600;
      color: rgb(var(--ink-900));
      font-size: 0.9rem;
    }

    .clinical-item-severity {
      font-size: 0.7rem;
      font-weight: 700;
      border-radius: 999px;
      padding: 0.15rem 0.6rem;
    }
    .clinical-item-severity.mild { background: rgb(var(--caution-100)); color: rgb(var(--caution-700)); }
    .clinical-item-severity.moderate { background: rgb(var(--caution-200)); color: rgb(var(--caution-800)); }
    .clinical-item-severity.severe { background: rgb(var(--critical-100)); color: rgb(var(--critical-800)); }

    .clinical-item-detail {
      flex-basis: 100%;
      margin: 0.25rem 0 0 0;
      font-size: 0.85rem;
      color: rgb(var(--ink-600));
    }

    .clinical-item-meta {
      flex-basis: 100%;
      font-size: 0.75rem;
      color: rgb(var(--ink-400));
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 4rem;
      color: rgb(var(--ink-500));
    }

    /* Responsive Styles */
    @media (max-width: 768px) {
      /* The header used to stack four full-width buttons and stay sticky,
         which on a phone pinned most of the screen above the content. It now
         scrolls away, keeps the voice button as the one full-width action,
         and reduces the others to icons. */
      .dossier-header {
        position: static;
        padding: .75rem 1rem 0 1rem;
      }

      .header-top {
        flex-wrap: wrap;
        gap: .5rem .75rem;
        margin-bottom: 1rem;
      }

      .patient-title {
        min-width: 0;
        flex-wrap: wrap;
        gap: .5rem;
      }

      .patient-title h1 {
        font-size: 1.25rem;
        overflow-wrap: anywhere;
      }

      .header-actions {
        width: 100%;
        gap: .5rem;
      }

      .header-actions .btn-record,
      .header-actions .btn-recording {
        flex: 1;
        justify-content: center;
        min-height: 2.75rem;
      }

      .header-actions .btn-compact {
        min-width: 2.75rem;
        min-height: 2.75rem;
        justify-content: center;
        padding-inline: .625rem;
      }

      .header-actions .btn-compact .btn-label {
        display: none;
      }

      .patient-quick-info {
        flex-wrap: wrap;
        gap: 1rem;
        padding-bottom: 1rem;
      }

      .info-divider {
        display: none;
      }

      .info-item {
        flex: 1 1 40%;
      }

      .dossier-tabs {
        overflow-x: auto;
        padding-bottom: 2px;
        gap: 1.5rem;
      }

      .dossier-tabs button {
        white-space: nowrap;
      }

      .dossier-content {
        padding: 1rem;
      }

      .overview-grid {
        grid-template-columns: 1fr;
      }

      .docs-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class PatientDossierComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  patientService = inject(PatientService);
  private chartService = inject(DentalChartService);
  private invoiceService = inject(InvoiceService);
  private translate = inject(TranslateService);
  private scheduleService = inject(ScheduleService);
  private toast = inject(ToastService);
  private confirmDialog = inject(ConfirmDialogService);
  voiceSession = inject(VoiceSessionService);
  private commandRegistry = inject(CommandRegistryService);
  clinicalRecordService = inject(ClinicalRecordService);
  private voiceContext = inject(VoiceContextService);
  private voice = inject(VoiceOrchestratorService);

  /**
   * A tooth named by voice becomes the dossier's selected tooth, so the
   * treatment panel follows it when the dentist later looks there.
   *
   * It no longer switches tabs. That used to throw the dossier onto Clinical
   * and its 3D viewer on every dictated tooth — the view moving under a
   * dentist who cannot touch the screen to get back. Voice results are shown
   * in the voice panel's own chart instead (audit XII.2's visual check,
   * without the navigation).
   *
   * Declared as a field rather than created in ngOnInit: `effect()` requires
   * an injection context, and a field initializer is one.
   */
  private readonly voiceToothSync = effect(() => {
    const fdi = this.voiceContext.selectedFdi();
    if (fdi && fdi !== this.selectedToothForTreatments()) this.selectedToothForTreatments.set(fdi);
  });

  /** The microphone is being opened and the session created. */
  voiceStarting = signal(false);

  activeTab = signal('overview');
  showDentalChartFullscreen = signal(false);
  private elementRef = inject(ElementRef);

  setActiveTab(id: string): void {
    this.activeTab.set(id);
  }

  setActiveClinicalSubTab(id: string): void {
    this.activeClinicalSubTab.set(id);
  }

  /**
   * WAI-ARIA tabs pattern: ArrowLeft/ArrowRight (and Home/End) move both
   * focus and selection between tabs in a tablist, with roving tabindex
   * (only the active tab is in the natural tab order).
   */
  onTabKeydown(event: KeyboardEvent, items: { id: string }[], currentId: string, setActive: (id: string) => void, idPrefix: string): void {
    const index = items.findIndex(t => t.id === currentId);
    if (index === -1) return;
    let nextIndex: number | null = null;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextId = items[nextIndex].id;
    setActive(nextId);
    setTimeout(() => {
      const el = this.elementRef.nativeElement.querySelector(`#${idPrefix}${nextId}`) as HTMLElement | null;
      el?.focus();
    }, 0);
  }

  /**
   * Reactive dental chart state — automatically reflects any changes made in the 3D viewer
   * because ThreeDentalSyncService now writes back to DentalChartService on every update.
   */
  dentalChartState = computed(() => this.chartService.currentChart());

  patientInvoices = signal<Invoice[]>([]);

  // Patient Treatment Signals
  private patientTreatmentService = inject(PatientTreatmentService);
  private stockService = inject(StockService);

  patientTreatments = signal<PatientTreatment[]>([]);
  availableTreatments = signal<Treatment[]>([]);
  availableStockItems = signal<StockItem[]>([]);

  // Modal State
  showAssignModal = signal(false);
  isEditingTreatment = signal(false);
  selectedTreatmentForEdit = signal<PatientTreatment | null>(null);

  // Form Fields
  formTreatmentId = '';
  formTeeth = '';
  formStatus: PatientTreatmentStatus = 'PLANNED';
  formProgress = 0;
  formNotes = '';
  formDoctorName = '';
  formStartDate = '';
  formEndDate = '';
  formConsumables: PatientTreatmentConsumable[] = [];

  // Tooth selection detail panel
  selectedToothForTreatments = signal<string | null>(null);
  selectedToothTreatments = computed(() => {
    const tooth = this.selectedToothForTreatments();
    if (!tooth) return [];
    return this.patientTreatments().filter(t => t.teeth.split(',').map(x => x.trim()).includes(tooth));
  });

  totalInvoicedForPatient = computed(() => {
    return this.patientInvoices().reduce((sum, inv) => sum + inv.total, 0);
  });

  balanceDueForPatient = computed(() => {
    // Sums each invoice's remaining balance (total minus what's already been
    // paid), not the full invoice total — a partially-paid invoice used to
    // contribute its entire value to "Outstanding" (audit III.7).
    return this.patientInvoices()
      .filter(inv => inv.status !== 'PAID' && inv.status !== 'CANCELLED')
      .reduce((sum, inv) => sum + (inv.balanceDue ?? inv.total), 0);
  });

  patientAppointments = computed<Appointment[]>(() => {
    const patient = this.patientService.currentPatient();
    if (!patient) return [];
    return this.scheduleService.appointments()
      .filter(a => a.patientId === patient.id)
      .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
  });

  nextAppointment = computed<Appointment | null>(() => {
    const now = Date.now();
    const upcoming = this.patientAppointments()
      .filter(a => new Date(a.dateTime).getTime() >= now && a.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    return upcoming[0] ?? null;
  });

  // Consolidated from nine tabs to three (audit VIII.5: "nine tabs where six
  // are hollow is worse than three that work"). The six former secondary
  // tabs (Treatments/History/Diagnostics/Plan/Appointments/Notes) still
  // exist and are still independently reachable — they're nested inside
  // Clinical as an in-page tab strip rather than deleted, since Treatments
  // in particular is "the strongest screen in the product" per the audit
  // and nothing about it needed to change, only where it lives.
  tabs = [
    { id: 'overview', key: 'COMMON.OVERVIEW', icon: 'dashboard' },
    { id: 'clinical', key: 'PATIENTS.DOSSIER.CLINICAL', icon: 'healing' },
    { id: 'financial', key: 'PATIENTS.DOSSIER.FINANCIAL', icon: 'payments' },
  ];

  /** The voice tab exists while a session does, or while one is being started. */
  navTabs = computed(() =>
    this.voiceSession.isActive() || this.voiceSession.reviewing() || this.activeTab() === 'voice'
      ? [{ id: 'voice', key: 'VOICE.TAB', icon: 'mic' }, ...this.tabs]
      : this.tabs);

  clinicalSubTabs = [
    { id: 'treatments', key: 'COMMON.TREATMENTS', icon: 'healing' },
    { id: 'history', key: 'PATIENTS.DOSSIER.MEDICAL_HISTORY', icon: 'medical_services' },
    { id: 'diagnostics', key: 'PATIENTS.DOSSIER.DIAGNOSTICS', icon: 'biotech' },
    { id: 'plan', key: 'PATIENTS.DOSSIER.TREATMENT_PLAN', icon: 'assignment' },
    { id: 'appointments', key: 'COMMON.SCHEDULE', icon: 'event' },
    { id: 'notes', key: 'DENTAL_CHART.REPORT_TITLE', icon: 'history_edu' },
  ];
  activeClinicalSubTab = signal('treatments');

  activeTreatmentsCount = computed(() =>
    this.patientTreatments().filter(t => t.status === 'ACTIVE').length
  );

  // ── Clinical record (findings / notes / allergies / medical history) ──
  latestNote = computed(() => {
    const notes = this.clinicalRecordService.notes();
    if (!notes.length) return null;
    return [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  });

  diagnosticFindings = computed(() =>
    this.clinicalRecordService.findings().filter(f =>
      f.status === 'ACTIVE' && (f.kind === 'EXISTING' || f.kind === 'CONDITION')
    )
  );
  treatmentRequiredFindings = computed(() =>
    this.clinicalRecordService.findings().filter(f => f.status === 'ACTIVE' && f.kind === 'TREATMENT_REQUIRED')
  );

  readonly medicalHistoryCategories: MedicalHistoryCategory[] =
    ['CONDITION', 'MEDICATION', 'SURGERY', 'DENTAL_HISTORY', 'FAMILY', 'LIFESTYLE', 'OTHER'];
  readonly noteCategories: NoteCategory[] =
    ['GENERAL', 'CHIEF_COMPLAINT', 'OBSERVATION', 'DENTAL_HISTORY', 'MEDICAL_HISTORY', 'DIAGNOSIS', 'FOLLOW_UP', 'TREATMENT_PLAN'];

  showHistoryForm = signal(false);
  historyForm: { category: MedicalHistoryCategory; label: string; detail: string } =
    { category: 'CONDITION', label: '', detail: '' };

  showNoteForm = signal(false);
  noteForm: { category: NoteCategory; content: string } = { category: 'GENERAL', content: '' };

  showFindingForm = signal<'diagnostic' | 'plan' | null>(null);
  findingForm: { fdi: string; findingCode: string; severity: string; note: string } =
    { fdi: '', findingCode: '', severity: '', note: '' };

  diagnosticCatalogCodes = computed(() =>
    (this.clinicalRecordService.catalog()?.definitions ?? []).filter(d => d.kind === 'EXISTING' || d.kind === 'CONDITION')
  );
  treatmentRequiredCatalogCodes = computed(() =>
    (this.clinicalRecordService.catalog()?.definitions ?? []).filter(d => d.kind === 'TREATMENT_REQUIRED')
  );

  openFindingForm(target: 'diagnostic' | 'plan'): void {
    this.findingForm = { fdi: '', findingCode: '', severity: '', note: '' };
    this.showFindingForm.set(target);
  }

  submitFinding(): void {
    const patient = this.patientService.currentPatient();
    if (!patient || !this.findingForm.fdi || !this.findingForm.findingCode) return;
    this.clinicalRecordService.addFinding(patient.id, this.findingForm.fdi, {
      findingCode: this.findingForm.findingCode,
      severity: (this.findingForm.severity || undefined) as any,
      note: this.findingForm.note || undefined,
      source: 'manual',
    }).subscribe({
      next: () => {
        this.toast.success('Finding recorded.');
        this.showFindingForm.set(null);
      },
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || 'Could not save the finding.')
    });
  }

  submitMedicalHistory(): void {
    const patient = this.patientService.currentPatient();
    if (!patient || !this.historyForm.label) return;
    this.clinicalRecordService.addMedicalHistory(patient.id, {
      category: this.historyForm.category,
      label: this.historyForm.label,
      detail: this.historyForm.detail || undefined,
      source: 'manual',
    }).subscribe({
      next: () => {
        this.toast.success('Medical history entry added.');
        this.historyForm = { category: 'CONDITION', label: '', detail: '' };
        this.showHistoryForm.set(false);
      },
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || 'Could not save the entry.')
    });
  }

  removeMedicalHistory(entryId: string): void {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    this.clinicalRecordService.deleteMedicalHistory(patient.id, entryId).subscribe({
      next: () => this.toast.success('Entry removed.'),
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || 'Could not remove the entry.')
    });
  }

  submitNote(): void {
    const patient = this.patientService.currentPatient();
    if (!patient || !this.noteForm.content) return;
    this.clinicalRecordService.addNote(patient.id, {
      category: this.noteForm.category,
      content: this.noteForm.content,
      source: 'manual',
    }).subscribe({
      next: () => {
        this.toast.success('Note added.');
        this.noteForm = { category: 'GENERAL', content: '' };
        this.showNoteForm.set(false);
      },
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || 'Could not save the note.')
    });
  }

  removeNote(noteId: string): void {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    this.clinicalRecordService.deleteNote(patient.id, noteId).subscribe({
      next: () => this.toast.success('Note deleted.'),
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || 'Could not delete the note.')
    });
  }

  resolveFinding(findingId: string): void {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    this.clinicalRecordService.changeFindingStatus(patient.id, findingId, 'RESOLVED').subscribe({
      next: () => this.toast.success('Finding marked resolved.'),
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || 'Could not update the finding.')
    });
  }

  ngOnInit() {
    // switchMap cancels the previous patient's in-flight resolution when the
    // route param changes again before it settles — without it, navigating
    // quickly from patient A to patient B could resolve A's response after
    // B's and load A's clinical data under B's name (see III.1 in the audit).
    this.route.params
      .pipe(
        map(params => params['id'] as string | undefined),
        filter((id): id is string => !!id),
        switchMap(id => this.patientService.setCurrentPatient(id)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (patient) => {
          this.chartService.loadChart(patient.id, patient.dateOfBirth);
          this.loadPatientBilling(patient.id);
          this.loadPatientTreatments(patient.id);
          this.clinicalRecordService.refresh(patient.id);
          void this.restoreVoiceSession(patient.id);
        },
        error: (err) => console.error('Failed to load patient', err)
      });

    this.clinicalRecordService.loadCatalogOnce();

    // Load available treatments and stock items for selectors
    this.stockService.getTreatments().subscribe(list => this.availableTreatments.set(list));
    this.stockService.getStockItems().subscribe(list => this.availableStockItems.set(list));

    // Context-scoped commands (audit XII.4 §7): only reachable from the
    // command palette while a patient dossier is open, unregistered on
    // leaving so they never linger and match against an unrelated screen.
    this.commandRegistry.registerMany(
      this.tabs.map(tab => ({
        id: `dossier.tab.${tab.id}`,
        label: `Open ${tab.key.split('.').pop()?.replace(/_/g, ' ')} Tab`,
        category: 'navigation' as const,
        icon: tab.icon,
        routeScope: '/patients/',
        execute: () => this.activeTab.set(tab.id),
      }))
    );
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.tabs.forEach(tab => this.commandRegistry.unregister(`dossier.tab.${tab.id}`));
    // Leaving the dossier closes the microphone: there is nowhere else a
    // session's results are shown, and a live microphone behind another
    // screen is one nobody is watching. The session itself is kept and
    // offered back when this patient's dossier opens again.
    this.voiceSession.detach();
    // A tooth selected by voice on this patient must not follow the doctor to
    // the next one — "that tooth" would silently resolve to the wrong record.
    this.voiceContext.selectTooth(null);
  }

  loadPatientBilling(patientId: string) {
    this.invoiceService.getPatientInvoices(patientId).subscribe(invoices => {
      this.patientInvoices.set(invoices);
    });
  }

  onToothSelected(tooth: ToothState) {
    // dentalChartState is now a computed signal, no manual refresh needed.
    this.selectedToothForTreatments.set(tooth.id);
    // Selecting by hand is also how the doctor tells the assistant what
    // "that tooth" refers to, so the next dictated finding needs no tooth name.
    this.voiceContext.selectTooth(tooth.id);
  }

  onToothSelected3D(toothId: string) {
    this.selectedToothForTreatments.set(toothId);
    this.voiceContext.selectTooth(toothId);
  }

  openAssignModalFrom3D(toothId: string) {
    this.selectedToothForTreatments.set(toothId);
    this.openAssignModal();
  }

  loadPatientTreatments(patientId: string) {
    this.patientTreatmentService.getPatientTreatments(patientId).subscribe(list => {
      this.patientTreatments.set(list);
    });
  }

  openAssignModal(treatment?: PatientTreatment) {
    if (treatment) {
      this.isEditingTreatment.set(true);
      this.selectedTreatmentForEdit.set(treatment);
      this.formTreatmentId = treatment.treatment.id || '';
      this.formTeeth = treatment.teeth;
      this.formStatus = treatment.status;
      this.formProgress = treatment.progress;
      this.formNotes = treatment.notes || '';
      this.formDoctorName = treatment.doctorName || '';
      this.formStartDate = treatment.startDate || '';
      this.formEndDate = treatment.endDate || '';
      this.formConsumables = treatment.consumables ? [...treatment.consumables.map(c => ({...c}))] : [];
    } else {
      this.isEditingTreatment.set(false);
      this.selectedTreatmentForEdit.set(null);
      this.formTreatmentId = '';
      this.formTeeth = this.selectedToothForTreatments() || '';
      this.formStatus = 'PLANNED';
      this.formProgress = 0;
      this.formNotes = '';
      this.formDoctorName = '';
      this.formStartDate = new Date().toISOString().split('T')[0];
      this.formEndDate = '';
      this.formConsumables = [];
    }
    this.showAssignModal.set(true);
  }

  closeAssignModal() {
    this.showAssignModal.set(false);
    this.isEditingTreatment.set(false);
    this.selectedTreatmentForEdit.set(null);
  }

  onTreatmentSelected(treatmentId: string) {
    const matched = this.availableTreatments().find(t => t.id === treatmentId);
    if (matched && matched.consumables) {
      this.formConsumables = matched.consumables.map(c => ({
        stockItem: c.stockItem,
        quantityUsed: c.quantityUsed,
        pricePerUnit: c.stockItem.pricePerUse,
        notes: ''
      }));
    } else {
      this.formConsumables = [];
    }
  }

  addConsumableToForm() {
    this.formConsumables.push({
      stockItem: this.availableStockItems()[0],
      quantityUsed: 1,
      pricePerUnit: this.availableStockItems()[0]?.pricePerUse || 0,
      notes: ''
    });
  }

  removeConsumableFromForm(index: number) {
    this.formConsumables.splice(index, 1);
  }

  savePatientTreatment() {
    const patient = this.patientService.currentPatient();
    if (!patient) return;

    const matchedTreatment = this.availableTreatments().find(t => t.id === this.formTreatmentId);
    if (!matchedTreatment) {
      this.toast.error('Please select a valid treatment procedure.');
      return;
    }

    const payload: PatientTreatmentRequestPayload = {
      treatmentId: matchedTreatment.id!,
      teeth: this.formTeeth,
      status: this.formStatus,
      progress: this.formProgress,
      notes: this.formNotes,
      doctorName: this.formDoctorName,
      startDate: this.formStartDate || undefined,
      endDate: this.formEndDate || undefined,
      consumables: this.formConsumables.map(c => ({
        stockItemId: c.stockItem.id,
        quantityUsed: c.quantityUsed,
        notes: c.notes
      }))
    };

    if (this.isEditingTreatment() && this.selectedTreatmentForEdit()) {
      const treatmentId = this.selectedTreatmentForEdit()!.id!;
      this.patientTreatmentService.updatePatientTreatment(patient.id, treatmentId, payload).subscribe({
        next: () => {
          this.loadPatientTreatments(patient.id);
          this.closeAssignModal();
        },
        error: (err: any) => {
          this.toast.error(err.error?.detail || err.error?.message || err.message || 'Error updating treatment. Check stock quantities.');
        }
      });
    } else {
      this.patientTreatmentService.createPatientTreatment(patient.id, payload).subscribe({
        next: () => {
          this.loadPatientTreatments(patient.id);
          this.closeAssignModal();
        },
        error: (err: any) => {
          this.toast.error(err.error?.detail || err.error?.message || err.message || 'Error assigning treatment. Check stock quantities.');
        }
      });
    }
  }

  async deletePatientTreatment(treatment: PatientTreatment) {
    const patient = this.patientService.currentPatient();
    if (!patient || !treatment.id) return;

    const confirmed = await this.confirmDialog.confirm(
      'Are you sure you want to delete this treatment assignment? This will reverse any stock deductions.',
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!confirmed) return;

    this.patientTreatmentService.deletePatientTreatment(patient.id, treatment.id).subscribe({
      next: () => {
        this.toast.success('Treatment assignment deleted.');
        this.loadPatientTreatments(patient.id);
      },
      error: (err: any) => {
        console.error('Error deleting patient treatment', err);
        this.toast.error('Could not delete the treatment assignment. Please try again.');
      }
    });
  }

  getStatusClass(status: PatientTreatmentStatus): string {
    switch (status) {
      case 'PLANNED': return 'status-badge sent';
      case 'ACTIVE': return 'status-badge partially-paid';
      case 'COMPLETED': return 'status-badge paid';
      case 'CANCELLED': return 'status-badge cancelled';
      default: return 'status-badge';
    }
  }

  calculateAge(dob: string): number {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  onPrint(): void {
    window.print();
  }

  async onDelete() {
    const patient = this.patientService.currentPatient();
    if (!patient) return;

    const confirmMsg = this.translate.instant('PATIENTS.DOSSIER.ARCHIVE_CONFIRM', { name: `${patient.firstName} ${patient.lastName}` });
    const confirmed = await this.confirmDialog.confirm(confirmMsg, { danger: true, confirmLabel: 'Archive' });
    if (!confirmed) return;

    this.patientService.deletePatient(patient.id).subscribe({
      next: () => {
        this.toast.success('Patient record deleted.');
        this.router.navigate(['/patients']);
      },
      error: (err) => {
        console.error('Error deleting patient', err);
        this.toast.error('Could not delete the patient record. Please try again.');
      }
    });
  }

  /**
   * The header's voice button. Opens the voice tab; the session starts at
   * once unless consent is still needed, in which case the panel asks for it
   * and its button starts the session from inside that tap.
   */
  startSession(): void {
    this.activeTab.set('voice');
    if (this.voice.needsConsent()) return;
    void this.beginSession();
  }

  /**
   * Opens the microphone and starts — or resumes — dictation for this patient.
   *
   * **Must be reached synchronously from a tap.** The microphone is requested
   * before anything is awaited, because iOS only lets audio start inside the
   * user's gesture and the round trip that creates the session would outlive
   * it; this ordering is what makes the microphone work on an iPhone.
   *
   * An interrupted examination for this patient has already been restored by
   * the time the dossier shows its voice tab, so resuming is the same tap as
   * starting. It is scoped to this patient on purpose: offering Ahmed's
   * half-finished examination while Fatima's chart is on screen is how
   * findings end up on the wrong record.
   */
  async beginSession(): Promise<void> {
    const patient = this.patientService.currentPatient();
    if (!patient || this.voiceStarting() || this.voiceSession.busy()) return;

    const microphone = this.voice.openMicrophone();
    this.activeTab.set('voice');
    this.voiceStarting.set(true);
    try {
      if (!this.voiceSession.isActive()) {
        const restored = await this.voiceSession.resumeIfAvailable(patient.id);
        if (restored === 'review') {
          this.voice.stopListening();
          return;
        }
        if (restored === null) {
          // No server session for a microphone that will not open.
          if (!(await microphone) && this.voice.captureSupported()) {
            await this.voice.startExaminationMode();
            return;
          }
          await this.voiceSession.start();
        }
      }
      await this.voice.startExaminationMode();
    } catch {
      this.voice.stopListening();
      this.toast.error('The voice session could not start — check the connection and try again.');
    } finally {
      this.voiceStarting.set(false);
    }
  }

  /** Ends dictation and switches the voice panel to review. Nothing is written here. */
  async endSession(): Promise<void> {
    this.activeTab.set('voice');
    await this.voiceSession.end();
  }

  /** The reviewed consultation is on the record; show it on the chart. */
  onVoiceSaved(): void {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    this.chartService.loadChart(patient.id, patient.dateOfBirth);
    this.clinicalRecordService.refresh(patient.id);
  }

  /**
   * Picks up an examination left unfinished for this patient — still
   * dictating, or waiting in review — and shows it in the voice tab. A
   * session belonging to a different patient is let go first.
   */
  private async restoreVoiceSession(patientId: string): Promise<void> {
    const current = this.voiceSession.session();
    if (current && current.patientId !== patientId) this.voiceSession.detach();
    const restored = await this.voiceSession.resumeIfAvailable(patientId);
    if (restored && this.patientService.currentPatient()?.id === patientId) {
      this.activeTab.set('voice');
    }
  }
}
