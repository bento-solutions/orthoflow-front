import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { StagedFinding } from '../../../core/clinical/tooth-paint';
import { ClinicalNote, ToothFinding } from '../../../core/models/clinical-record.model';
import { Appointment, DentalChartState, Patient } from '../../../core/models/patient.model';
import { PatientTreatment } from '../../../core/models/patient-treatment.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { PermissionService } from '../../../core/services/permission.service';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { EmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';
import { Dental3dChartComponent } from '../../dental-3d/dental-3d-chart.component';
import { ConsultationReportComponent, reportVisits } from './consultation-report.component';
import { PatientImagingPaneComponent } from './patient-imaging-pane.component';

/**
 * Summary: what the doctor needs before saying hello. The mouth (to look at; a tooth opens it on
 * Chart & plan) beside the latest X-ray, then the alerts, the treatment under way, the next
 * appointment, what is owed, and the last visit's report. Nothing here is edited in place.
 */
@Component({
  selector: 'app-summary-tab',
  standalone: true,
  imports: [TranslateModule, AppDatePipe, MoneyPipe, EmptyStateComponent, IconComponent, StatusPillComponent, Dental3dChartComponent, ConsultationReportComponent, PatientImagingPaneComponent],
  template: `
    <h2 class="sr-only">{{ 'PATIENTS.DOSSIER.TAB.SUMMARY' | translate }}</h2>
    <div class="sm-row" [class.no-image]="imagingEmpty()">
      <div class="sm-chart">
        @if (chart(); as c) {
          @defer (on viewport; prefetch on idle) {
            <app-dental-3d-chart
              [chart]="c"
              [findings]="findings()"
              [treatments]="treatments()"
              [staged]="staged()"
              [focusFdi]="focusFdi()"
              [selected]="null"
              [sidePanel]="false"
              (selectedChange)="$event && openTooth.emit($event)"
            />
          } @placeholder {
            <div class="sm-placeholder" aria-hidden="true"></div>
          }
        }
      </div>
      <app-patient-imaging-pane class="sm-image" [patientId]="patient().id" (openDocuments)="openTab.emit('imaging')" (emptyChange)="imagingEmpty.set($event)" />
    </div>

    <div class="sm-cards">
      <!-- Alerts -->
      <section class="card sm-card" [class.sm-alert]="records.alertsState() === 'alerts'" aria-labelledby="sm-alerts">
        <header class="sm-card-head">
          <h3 id="sm-alerts">{{ 'ALERTS.TITLE' | translate }}</h3>
          <button type="button" class="btn btn-ghost btn-sm" (click)="openHistory.emit()">{{ 'ALERTS.OPEN' | translate }}</button>
        </header>
        @switch (records.alertsState()) {
          @case ('alerts') {
            <ul class="space-y-1">
              @for (a of records.medicalAlerts(); track a.id) {
                <li class="flex items-start gap-2" [class.text-critical-800]="a.tone === 'critical'" [class.text-caution-800]="a.tone === 'attention'">
                  <app-icon [name]="a.tone === 'critical' ? 'alert-triangle' : 'alert-circle'" [size]="16" class="mt-0.5" />
                  <span><b>{{ a.label }}</b>
                    <span class="text-sm"> · {{ ('ALERTS.KIND.' + a.kind) | translate }}@if (a.detail) { — {{ a.detail }} }</span></span>
                </li>
              }
            </ul>
          }
          @case ('none') { <p class="text-ink-600">{{ 'ALERTS.NONE' | translate }}</p> }
          @case ('not-asked') {
            <app-empty-state icon="help-circle" [compact]="true" [title]="'ALERTS.NOT_ASKED' | translate" [text]="'ALERTS.NOT_ASKED_TEXT' | translate"
              [actionLabel]="'ALERTS.ASK_NOW' | translate" actionIcon="edit" (action)="openHistory.emit()" />
          }
          @default { <p class="text-ink-500">{{ 'COMMON.LOADING' | translate }}</p> }
        }
      </section>

      <!-- The treatment under way: the same list the badge and the plan read. -->
      <section class="card sm-card" aria-labelledby="sm-treatment">
        <header class="sm-card-head">
          <h3 id="sm-treatment">{{ 'PATIENTS.DOSSIER.CURRENT_TREATMENT' | translate }}</h3>
          <button type="button" class="btn btn-ghost btn-sm" (click)="openTab.emit('chart')">{{ 'PATIENTS.DOSSIER.OPEN_PLAN' | translate }}</button>
        </header>
        @if (current().length) {
          <ul class="space-y-3">
            @for (t of current(); track t.id) {
              <li>
                <p class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold">{{ t.treatment.name }} <span class="text-sm text-ink-500">· {{ t.teeth }}</span></span>
                  <app-status-pill [status]="t.status" />
                </p>
                <div class="mt-1 flex items-center gap-2">
                  <div class="h-1.5 flex-1 rounded-full bg-ink-200" role="progressbar" [attr.aria-valuenow]="t.progress" aria-valuemin="0" aria-valuemax="100"
                       [attr.aria-label]="t.treatment.name">
                    <div class="h-full rounded-full bg-petrol-600" [style.width.%]="t.progress"></div>
                  </div>
                  <span class="text-xs font-bold text-ink-500">{{ t.progress }}%</span>
                </div>
              </li>
            }
          </ul>
        } @else if (proposed(); as plan) {
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">{{ 'PATIENTS.DOSSIER.PROPOSED_PLAN' | translate }}
            <span class="pill pill-idle ms-1">{{ 'PATIENTS.DOSSIER.NOT_ACCEPTED' | translate }}</span></p>
          <p class="line-clamp-4 whitespace-pre-line text-sm">{{ plan }}</p>
        } @else {
          <p class="text-ink-600">{{ 'PATIENTS.DOSSIER.NO_ACTIVE_TREATMENTS' | translate }}</p>
        }
      </section>

      <!-- Next appointment -->
      <section class="card sm-card" aria-labelledby="sm-next">
        <header class="sm-card-head"><h3 id="sm-next">{{ 'PATIENTS.NEXT_APPOINTMENT' | translate }}</h3></header>
        @if (nextAppointment(); as appt) {
          <p class="text-lg font-bold text-ink-900">{{ appt.dateTime | appDate:'datetime' }}</p>
          @if (appt.type) { <p class="text-ink-600">{{ appt.type }}</p> }
        } @else {
          <app-empty-state icon="calendar" [compact]="true" [title]="'PATIENTS.DOSSIER.NO_UPCOMING_APPOINTMENT' | translate"
            [actionLabel]="canBook() ? ('PATIENTS.DOSSIER.BOOK' | translate) : null" actionIcon="calendar-plus" (action)="book.emit()" />
        }
      </section>

      @if (balance() !== null) {
        <section class="card sm-card" aria-labelledby="sm-balance">
          <header class="sm-card-head">
            <h3 id="sm-balance">{{ 'BILLING.OUTSTANDING' | translate }}</h3>
            <button type="button" class="btn btn-ghost btn-sm" (click)="openTab.emit('billing')">{{ 'PATIENTS.DOSSIER.OPEN_BILLING' | translate }}</button>
          </header>
          <p class="text-lg font-bold tnum" [class.text-critical-700]="balance()! > 0">{{ balance() | money }}</p>
        </section>
      }
    </div>

    <!-- The last visit, in full. Earlier ones are on Visits. -->
    <app-consultation-report [notes]="notes()" (openLog)="openLog.emit($event)" />
  `,
  styles: [`
    :host { display: block; }
    .sm-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .75rem; height: max(22rem, calc(100vh - 22rem)); }
    .sm-row.no-image { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    .sm-chart { min-width: 0; min-height: 0; height: 100%; }
    .sm-placeholder { height: 100%; border-radius: var(--radius-lg); background: var(--surface-hover); }
    .sm-image { min-height: 0; }
    @media (max-width: 1099.98px) {
      .sm-row, .sm-row.no-image { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; height: auto; }
      .sm-chart { height: 58vh; }
      .sm-row:not(.no-image) .sm-image { height: 46vh; }
    }
    .sm-cards { display: grid; gap: .75rem; margin-top: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
    .sm-card { padding: 1rem 1.125rem; }
    .sm-card.sm-alert { border-color: rgb(var(--critical-300)); background: var(--status-critical-tint); }
    .sm-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
    .sm-card-head h3 { font-size: var(--text-base); font-weight: 700; color: var(--text-muted); }
  `],
})
export class SummaryTabComponent {
  readonly patient = input.required<Patient>();
  readonly chart = input<DentalChartState | null>(null);
  readonly findings = input<ToothFinding[]>([]);
  readonly notes = input<readonly ClinicalNote[]>([]);
  readonly treatments = input<PatientTreatment[]>([]);
  readonly staged = input<readonly StagedFinding[]>([]);
  readonly focusFdi = input<string | null>(null);
  readonly nextAppointment = input<Appointment | null>(null);
  readonly balance = input<number | null>(null);

  readonly openTooth = output<string>();
  readonly openTab = output<string>();
  readonly openHistory = output<void>();
  readonly openLog = output<string>();
  readonly book = output<void>();

  protected readonly records = inject(ClinicalRecordService);
  private readonly permissions = inject(PermissionService);
  protected readonly canBook = computed(() => this.permissions.can('AGENDA_MANAGE'));
  protected readonly imagingEmpty = signal(false);

  protected readonly current = computed(() => this.treatments().filter(t => t.status === 'ACTIVE' || t.status === 'PLANNED'));
  protected readonly proposed = computed(() => reportVisits(this.notes())[0]?.plan?.content ?? null);
}
