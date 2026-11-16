import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, filter, map, switchMap, takeUntil } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { CommandRegistryService } from '../../../core/services/command-registry.service';
import { PatientService } from '../../../core/services/patient.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { Dental3dViewService } from '../../../core/services/dental-3d-view.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { Appointment } from '../../../core/models/patient.model';
import { InvoiceService } from '../../billing/services/invoice.service';
import { Invoice } from '../../billing/models/billing.model';
import { PageLabelService } from '../../../core/services/page-label.service';
import { PatientTreatmentService } from '../../../core/services/patient-treatment.service';
import { PatientTreatment } from '../../../core/models/patient-treatment.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { VoiceContextService } from '../../../core/voice/voice-context.service';
import { stagedToothFindings } from '../../../core/voice/voice-chart-marks';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { VoiceSessionPanelComponent } from '../../../shared/components/voice/voice-session-panel.component';
import { VoiceSessionDockComponent } from '../../../shared/components/voice/voice-session-dock.component';
import { ConsultationPanelComponent } from '../../../shared/components/consultation/consultation-panel.component';
import { ConsultationCockpitComponent } from '../../../shared/components/consultation/cockpit/consultation-cockpit.component';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { ConsultationApiService } from '../../../core/consultation/consultation-api.service';
import { ConsultationLogComponent } from '../../../shared/components/consultation/consultation-log.component';
import { PermissionService } from '../../../core/services/permission.service';
import { IconComponent, IconName } from '../../../shared/ui/icon.component';
import { PatientAccountComponent } from '../account/patient-account.component';
import { PatientDocumentsComponent } from '../documents/patient-documents.component';
import { PatientFilesComponent } from '../documents/patient-files.component';
import { PatientPhotosComponent } from '../patient-photos/patient-photos.component';
import { TreatmentLogComponent } from '../treatment-log/treatment-log.component';
import { ChartPlanTabComponent } from './chart-plan-tab.component';
import { MedicalHistoryPanelComponent } from './medical-history-panel.component';
import { PatientBannerComponent, PatientState } from './patient-banner.component';
import { SummaryTabComponent } from './summary-tab.component';
import { VisitsTabComponent } from './visits-tab.component';

export type DossierTab = 'voice' | 'summary' | 'chart' | 'visits' | 'imaging' | 'billing' | 'documents';

interface TabDef {
  id: DossierTab;
  key: string;
  icon: IconName;
}

/** The file's six sections, in the order a visit goes (P1-1). Voice comes first while a session runs. */
export const DOSSIER_TABS: readonly TabDef[] = [
  { id: 'summary', key: 'PATIENTS.DOSSIER.TAB.SUMMARY', icon: 'grid' },
  { id: 'chart', key: 'PATIENTS.DOSSIER.TAB.CHART', icon: 'tooth' },
  { id: 'visits', key: 'PATIENTS.DOSSIER.TAB.VISITS', icon: 'history' },
  { id: 'imaging', key: 'PATIENTS.DOSSIER.TAB.IMAGING', icon: 'image' },
  { id: 'billing', key: 'PATIENTS.DOSSIER.TAB.BILLING', icon: 'wallet' },
  { id: 'documents', key: 'PATIENTS.DOSSIER.TAB.DOCUMENTS', icon: 'file-text' },
];

/** Addresses of the former tabs still open the right section: bookmarks and links keep working. */
const LEGACY_TABS: Record<string, DossierTab> = { overview: 'summary', clinical: 'chart', financial: 'billing' };

/** The tab an address names, or Summary for none, an unknown one, or one this person may not open. */
export function tabFromQuery(value: string | null, allowed: readonly string[]): DossierTab {
  const id = (value && (LEGACY_TABS[value] ?? value)) || 'summary';
  return (id === 'voice' || allowed.includes(id) ? id : 'summary') as DossierTab;
}

/**
 * What the badge says (P1-3): the patient's own status when the practice set one (on hold,
 * completed), and otherwise read from the same treatments the summary and the plan show, so the
 * badge can no longer say "Active Treatment" over "No active treatments".
 */
export function patientState(status: string | null | undefined, treatments: readonly PatientTreatment[]): PatientState {
  if (status === 'ON_HOLD') return { key: 'PATIENTS.DOSSIER.STATUS_ON_HOLD', pill: 'pill-attention' };
  if (status === 'COMPLETED') return { key: 'PATIENTS.DOSSIER.STATUS_COMPLETED', pill: 'pill-done' };
  if (treatments.some(t => t.status === 'ACTIVE')) return { key: 'PATIENTS.DOSSIER.STATE.IN_TREATMENT', pill: 'pill-active' };
  if (treatments.some(t => t.status === 'PLANNED')) return { key: 'PATIENTS.DOSSIER.STATE.PLANNED', pill: 'pill-attention' };
  return { key: 'PATIENTS.DOSSIER.STATE.NONE', pill: 'pill-idle' };
}

/**
 * The patient file.
 *
 * The banner stays in view on every tab, with the medical alerts (P0-2, P0-3); under it six tabs,
 * each with its own address (`?tab=chart`), so Reload, Back and a shared link land where they were
 * (P1-2). A change of query keeps the component, and with it the voice session and the
 * consultation, alive.
 */
@Component({
  selector: 'app-patient-dossier',
  standalone: true,
  imports: [
    TranslateModule, IconComponent, VoiceSessionPanelComponent, VoiceSessionDockComponent, ConsultationPanelComponent,
    ConsultationCockpitComponent, ConsultationLogComponent, PatientAccountComponent, PatientDocumentsComponent,
    PatientFilesComponent, PatientPhotosComponent, TreatmentLogComponent, ChartPlanTabComponent, MedicalHistoryPanelComponent,
    PatientBannerComponent, SummaryTabComponent, VisitsTabComponent,
  ],
  template: `
    <div class="dossier-container" [class.has-voice-dock]="voiceSession.isActive() && !cockpit()"
         [class.has-consultation]="consultation.visible() && !cockpit()" [class.is-cockpit]="cockpit()">
      @if (patientService.currentPatient(); as patient) {
      @if (cockpit()) {
        <!-- While a consultation records, one screen: the cockpit replaces the tabs, the dictation
             panel, the side panel and the dock. Nothing that deletes, edits or prints is on it. -->
        <app-consultation-cockpit
          [chart]="dentalChartState()"
          [findings]="clinicalRecordService.findings()"
          [treatments]="patientTreatments()"
          (leave)="leaveForList()"
        />
      } @else {
      <!-- The banner and the tabs stay in view; once scrolled, the banner is one row (P0-3). -->
      <div class="dossier-top" [class.is-compact]="compact()">
        <app-patient-banner
          [patient]="patient"
          [state]="state()"
          [nextAppointment]="nextAppointment()"
          [balance]="canBilling() ? balanceDueForPatient() : null"
          [starting]="voiceStarting() || consultation.starting()"
          [compact]="compact()"
          (startVoice)="startSession()"
          (startConsultation)="startConsultation()"
          (endSession)="endSession()"
          (openVoice)="goTo('voice')"
          (openHistory)="historyOpen.set(true)"
          (openBilling)="goTo('billing')"
          (book)="bookAppointment()"
          (print)="onPrint()"
          (archive)="onArchive()"
        />

        <nav class="dossier-tabs no-print" role="tablist" [attr.aria-label]="'PATIENTS.DOSSIER.TITLE' | translate"
             (keydown)="onTabKeydown($event)">
          @for (tab of navTabs(); track tab.id) {
            <button type="button"
              [id]="'dossier-tab-' + tab.id"
              role="tab"
              [attr.aria-selected]="activeTab() === tab.id"
              [attr.aria-controls]="'dossier-panel-' + tab.id"
              [tabindex]="activeTab() === tab.id ? 0 : -1"
              [class.active]="activeTab() === tab.id"
              (click)="goTo(tab.id, false)"
            >
              <app-icon [name]="tab.icon" [size]="16" />
              {{ tab.key | translate }}
              @if (tab.id === 'voice' && voiceSession.isActive()) {
                <span class="tab-live-dot" aria-hidden="true"></span>
              }
            </button>
          }
        </nav>
      </div>

      <div class="dossier-content" [class.is-wide]="activeTab() === 'summary' || activeTab() === 'chart'">
        <div class="tab-pane" role="tabpanel" [id]="'dossier-panel-' + activeTab()" [attr.aria-labelledby]="'dossier-tab-' + activeTab()" tabindex="0">
        @switch (activeTab()) {
          @case ('voice') {
            <!-- Every voice result is shown here: the chart with what is staged drawn on it, what
                 was dictated, and the review. Nothing a dentist says moves them to another tab. -->
            <app-voice-session-panel
              [chart]="dentalChartState()"
              [findings]="clinicalRecordService.findings()"
              [treatments]="patientTreatments()"
              [patientId]="patient.id"
              [starting]="voiceStarting()"
              [consultation]="consultation.isOpen()"
              (begin)="beginSession()"
              (saved)="onVoiceSaved()"
            />
          }
          @case ('summary') {
            <app-summary-tab
              [patient]="patient"
              [chart]="dentalChartState()"
              [findings]="clinicalRecordService.findings()"
              [notes]="clinicalRecordService.notes()"
              [treatments]="patientTreatments()"
              [staged]="stagedFindings()"
              [focusFdi]="voiceFocusFdi()"
              [nextAppointment]="nextAppointment()"
              [balance]="canBilling() ? balanceDueForPatient() : null"
              (openTooth)="openTooth($event)"
              (openTab)="goTo($any($event), false)"
              (openHistory)="historyOpen.set(true)"
              (openLog)="openConsultationLog($event)"
              (book)="bookAppointment()"
            />
          }
          @case ('chart') {
            <app-chart-plan-tab
              [patient]="patient"
              [chart]="dentalChartState()"
              [findings]="clinicalRecordService.findings()"
              [notes]="clinicalRecordService.notes()"
              [treatments]="patientTreatments()"
              [staged]="stagedFindings()"
              [focusFdi]="voiceFocusFdi()"
              [selected]="selectedToothForTreatments()"
              (selectedChange)="onToothSelected3D($event)"
              (treatmentsChanged)="loadPatientTreatments(patient.id)"
            />
          }
          @case ('visits') {
            <app-visits-tab
              [patientId]="patient.id"
              [appointments]="patientAppointments()"
              [notes]="clinicalRecordService.notes()"
              (book)="bookAppointment()"
              (openLog)="openConsultationLog($event)"
            />
          }
          @case ('imaging') {
            <h2 class="sr-only">{{ 'PATIENTS.DOSSIER.TAB.IMAGING' | translate }}</h2>
            <div class="space-y-6">
              @if (canClinical()) { <app-patient-photos [patientId]="patient.id" /> }
              <app-patient-files [patientId]="patient.id" />
            </div>
          }
          @case ('billing') {
            <h2 class="sr-only">{{ 'PATIENTS.DOSSIER.TAB.BILLING' | translate }}</h2>
            <div class="space-y-6">
              <app-patient-account [patientId]="patient.id" />
              <app-patient-documents [patientId]="patient.id" [patientName]="patient.firstName + ' ' + patient.lastName" [sections]="['forms']" />
            </div>
          }
          @case ('documents') {
            <h2 class="sr-only">{{ 'PATIENTS.DOSSIER.TAB.DOCUMENTS' | translate }}</h2>
            <div class="space-y-6">
              <app-patient-documents [patientId]="patient.id" [patientName]="patient.firstName + ' ' + patient.lastName" [sections]="['prescriptions']" />
              <section class="card p-5"><app-treatment-log [patientId]="patient.id" mode="share" /></section>
            </div>
          }
        }
        </div>
      </div>

      <app-medical-history-panel [open]="historyOpen()" [patientId]="patient.id" (closed)="historyOpen.set(false)" />
      }
      } @else {
        <div class="loading"><p>{{ 'COMMON.LOADING' | translate }}</p></div>
      }

      <!-- The consultation: what is heard and what the system catches, beside the file while it
           runs, and the review once it ends. In the cockpit the recording view is the cockpit. -->
      @if (!cockpit()) {
        <app-consultation-panel class="dossier-consultation" />
      }
      <app-consultation-log [consultationId]="logConsultationId()" (closed)="logConsultationId.set(null)" />

      <!-- Scoped to the file: a voice command like "sixteen, recurrent caries" only has a referent
           while a patient's record is open. -->
      @if (!cockpit()) {
        <app-voice-session-dock
          [onVoiceTab]="activeTab() === 'voice'"
          (openPanel)="goTo('voice')"
          (resume)="beginSession()"
        />
      }
    </div>
  `,
  styles: [`
    .dossier-container { min-height: 100vh; }
    .dossier-container.is-cockpit { min-height: 0; }

    /* The banner and the tabs stick under the app bar (h-16 from md up; it scrolls on a phone). */
    .dossier-top {
      position: sticky; top: 0; z-index: var(--z-sticky);
      background: var(--surface); border-bottom: 1px solid var(--border);
      margin-inline: -1rem; margin-top: -1rem;
    }
    @media (min-width: 768px) { .dossier-top { top: 4rem; margin-inline: -1.5rem; margin-top: -1.5rem; } }
    @media (min-width: 1024px) { .dossier-top { margin-inline: -2rem; margin-top: -2rem; } }
    .dossier-top.is-compact { box-shadow: var(--shadow-sm); }

    .dossier-tabs { display: flex; gap: 1.5rem; padding: 0 1.25rem; overflow-x: auto; scrollbar-width: none; }
    .dossier-tabs::-webkit-scrollbar { display: none; }
    .dossier-tabs button {
      position: relative; display: flex; align-items: center; gap: .5rem; padding: .75rem 0; min-height: 2.75rem;
      background: transparent; border: none; white-space: nowrap; cursor: pointer;
      color: var(--text-muted); font: inherit; font-weight: 600; font-size: var(--text-base);
    }
    .dossier-tabs button:hover, .dossier-tabs button.active { color: var(--action-text); }
    .dossier-tabs button.active::after {
      content: ''; position: absolute; bottom: 0; inset-inline: 0; height: 2px; background: var(--action);
    }
    .tab-live-dot { width: .5rem; height: .5rem; border-radius: 50%; background: rgb(var(--critical-600)); animation: dossier-pulse 1.6s ease-in-out infinite; }
    @keyframes dossier-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) { .tab-live-dot { animation: none; } }

    .dossier-content { padding: 1.5rem 0 2rem; max-width: 75rem; margin: 0 auto; }
    .dossier-content.is-wide { max-width: none; padding-top: .75rem; }
    .tab-pane:focus-visible { outline: none !important; }

    /* Room for the recording dock, so it never covers the last row. */
    .dossier-container.has-voice-dock { padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px)); }

    /* A consultation puts its panel beside the file: the doctor keeps the chart in view while the
       conversation is read. Below the breakpoint the panel stacks above the content. */
    .dossier-container.has-consultation { display: grid; grid-template-columns: minmax(0, 1fr); }
    .dossier-container.has-consultation > .dossier-consultation { grid-column: 1; grid-row: 2; }
    .dossier-container.has-consultation > .dossier-content { grid-row: 3; }
    @media (min-width: 1100px) {
      .dossier-container.has-consultation { grid-template-columns: minmax(0, 1fr) 27rem; grid-template-rows: auto 1fr; column-gap: 1rem; }
      .dossier-container.has-consultation > .dossier-top { grid-column: 1; grid-row: 1; }
      .dossier-container.has-consultation > .dossier-content { grid-column: 1; grid-row: 2; }
      .dossier-container.has-consultation > .dossier-consultation {
        grid-column: 2; grid-row: 1 / span 2; position: sticky; top: 4rem; height: calc(100vh - 6rem); align-self: start;
      }
    }
    .loading { display: flex; justify-content: center; padding: 4rem; color: var(--text-muted); }
    @media (max-width: 767.98px) { .dossier-tabs { gap: 1.25rem; padding-inline: 1rem; } }
  `],
})
export class PatientDossierComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  patientService = inject(PatientService);
  private chartService = inject(DentalChartService);
  private chartView = inject(Dental3dViewService);
  private invoiceService = inject(InvoiceService);
  private translate = inject(TranslateService);
  private scheduleService = inject(ScheduleService);
  private toast = inject(ToastService);
  private confirmDialog = inject(ConfirmDialogService);
  voiceSession = inject(VoiceSessionService);
  consultation = inject(ConsultationService);
  private consultationApi = inject(ConsultationApiService);
  /** The consultation whose log is open, or null. */
  logConsultationId = signal<string | null>(null);
  private commandRegistry = inject(CommandRegistryService);
  clinicalRecordService = inject(ClinicalRecordService);
  private voiceContext = inject(VoiceContextService);
  private voice = inject(VoiceOrchestratorService);
  private readonly permissions = inject(PermissionService);
  private readonly patientTreatmentService = inject(PatientTreatmentService);
  private readonly elementRef = inject(ElementRef);

  readonly canBilling = computed(() => this.permissions.can('BILLING_READ'));
  readonly canClinical = computed(() => this.permissions.can('CLINICAL_READ'));

  /** The medical history side panel, opened from the alert strip and the summary. */
  readonly historyOpen = signal(false);

  /** The banner's one-row form, once the page has scrolled (with some slack, so it does not flicker). */
  readonly compact = signal(false);
  @HostListener('window:scroll')
  protected onScroll(): void {
    const y = window.scrollY;
    if (!this.compact() && y > 160) this.compact.set(true);
    else if (this.compact() && y < 40) this.compact.set(false);
  }

  /**
   * The breadcrumb ends on the patient's name, set once per loaded patient and cleared when the
   * file closes. It does not read the label back: it used to, and re-set the name while a
   * navigation away was under way, so the next screen was titled with this patient (P0-5).
   */
  private readonly pageLabel = inject(PageLabelService);
  private readonly routeId = toSignal(this.route.paramMap.pipe(map(p => p.get('id'))), { initialValue: null });
  private readonly breadcrumbName = effect(() => {
    const patient = this.patientService.currentPatient();
    if (patient && String(patient.id) === this.routeId()) {
      this.pageLabel.set(`${patient.firstName} ${patient.lastName}`, this);
    }
  });

  /** A tooth named by voice becomes the file's selected tooth. It no longer switches tabs. */
  private readonly voiceToothSync = effect(() => {
    const fdi = this.voiceContext.selectedFdi();
    if (fdi && fdi !== untracked(this.selectedToothForTreatments)) this.selectedToothForTreatments.set(fdi);
  });

  /** A consultation saved: what it wrote is what the rest of the file should now show. Version 0 is not a save. */
  private readonly consultationSaved = effect(() => {
    if (this.consultation.savedVersion() > 0) untracked(() => this.onVoiceSaved());
  });

  /** The consultation cockpit, while recording: one screen, no tabs. */
  readonly cockpit = computed(() => this.consultation.isRecording() && this.consultation.cockpitEnabled());

  /** The intro and the review are shown beside the dictation tab. */
  private readonly consultationFocus = effect(() => {
    if (this.consultation.intro() || (this.consultation.isOpen() && !this.cockpit())) untracked(() => this.goTo('voice'));
  });

  /** The cockpit's back arrow: leave the file, as its own back button does; the consultation stays open. */
  leaveForList(): void {
    void this.router.navigate(['/patients']);
  }

  /** The microphone is being opened and the session created. */
  voiceStarting = signal(false);

  // ── Tabs ───────────────────────────────────────────────────────────────

  private readonly visibleTabs = computed(() => DOSSIER_TABS.filter(t =>
    t.id === 'billing' ? this.permissions.can('BILLING_READ')
      : t.id === 'documents' ? this.permissions.can('CLINICAL_READ')
        : true));

  readonly navTabs = computed<TabDef[]>(() =>
    this.voiceSession.isActive() || this.voiceSession.reviewing() || this.activeTab() === 'voice'
      ? [{ id: 'voice', key: 'VOICE.TAB', icon: 'mic' }, ...this.visibleTabs()]
      : [...this.visibleTabs()]);

  private readonly queryTab = toSignal(this.route.queryParamMap.pipe(map(q => q.get('tab'))),
    { initialValue: this.route.snapshot.queryParamMap.get('tab') });

  readonly activeTab = signal<DossierTab>('summary');

  /** The address says which tab: Reload, Back and a shared link land on it. */
  private readonly tabFromAddress = effect(() => {
    const wanted = tabFromQuery(this.queryTab(), this.visibleTabs().map(t => t.id));
    if (wanted !== untracked(this.activeTab)) this.activeTab.set(wanted);
  });

  /**
   * Opens a tab and writes it in the address. A tab the doctor picks is a step Back can undo;
   * one the file opens by itself (voice, a consultation) replaces the address instead.
   */
  goTo(id: DossierTab, replace = true): void {
    this.activeTab.set(id);
    const current = this.route.snapshot.queryParamMap.get('tab');
    const next = id === 'summary' ? null : id;
    if (current === next) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: next },
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  /** WAI-ARIA tabs: arrows, Home and End move focus and selection, with a roving tabindex. */
  onTabKeydown(event: KeyboardEvent): void {
    const items = this.navTabs();
    const index = items.findIndex(t => t.id === this.activeTab());
    if (index === -1) return;
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % items.length, ArrowDown: (index + 1) % items.length,
      ArrowLeft: (index - 1 + items.length) % items.length, ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0, End: items.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const nextId = items[keys[event.key]].id;
    this.goTo(nextId, false);
    setTimeout(() => (this.elementRef.nativeElement.querySelector(`#dossier-tab-${nextId}`) as HTMLElement | null)?.focus(), 0);
  }

  // ── What the file shows ────────────────────────────────────────────────

  /** The chart as the server last gave it. Findings change it; DentalChartService re-reads it. */
  dentalChartState = computed(() => this.chartService.currentChart());

  patientInvoices = signal<Invoice[]>([]);
  patientTreatments = signal<PatientTreatment[]>([]);
  selectedToothForTreatments = signal<string | null>(null);

  readonly state = computed(() => patientState(this.patientService.currentPatient()?.status, this.patientTreatments()));

  /** Each invoice's remaining balance, not its full total. */
  balanceDueForPatient = computed(() => this.patientInvoices()
    .filter(inv => inv.status !== 'PAID' && inv.status !== 'CANCELLED')
    .reduce((sum, inv) => sum + (inv.balanceDue ?? inv.total), 0));

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

  /** While a session runs, what it has heard is drawn on the chart wherever the doctor is looking. */
  stagedFindings = computed(() => stagedToothFindings(this.voice.buffered()));
  voiceFocusFdi = computed(() => (this.voiceSession.isActive() ? this.voice.highlightedFdi() : null));

  ngOnInit() {
    // switchMap cancels the previous patient's in-flight resolution when the route param changes
    // again before it settles, so A's response can never load under B's name.
    this.route.params
      .pipe(
        map(params => params['id'] as string | undefined),
        filter((id): id is string => !!id),
        switchMap(id => this.patientService.setCurrentPatient(id)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (patient) => {
          // How the last patient's mouth was being looked at says nothing about this one's.
          this.chartView.reset();
          this.selectedToothForTreatments.set(null);
          this.historyOpen.set(false);
          this.chartService.loadChart(patient.id, patient.dateOfBirth);
          this.loadPatientBilling(patient.id);
          this.loadPatientTreatments(patient.id);
          this.clinicalRecordService.refresh(patient.id);
          void this.restoreConsultationAndVoice(patient.id);
        },
        error: (err) => console.error('Failed to load patient', err)
      });

    this.clinicalRecordService.loadCatalogOnce();
    void this.consultation.loadConfig();

    // Context-scoped commands: only in the palette while a patient file is open.
    this.commandRegistry.registerMany(
      DOSSIER_TABS.map(tab => ({
        id: `dossier.tab.${tab.id}`,
        label: `Open ${tab.id} tab`,
        category: 'navigation' as const,
        icon: tab.icon,
        routeScope: '/patients/',
        execute: () => this.goTo(tab.id, false),
      }))
    );
  }

  ngOnDestroy() {
    this.pageLabel.clear(this);
    this.destroy$.next();
    this.destroy$.complete();
    DOSSIER_TABS.forEach(tab => this.commandRegistry.unregister(`dossier.tab.${tab.id}`));
    // Leaving the file closes the microphone: a live microphone behind another screen is one
    // nobody is watching. The session is kept and offered back when this file opens again; a
    // consultation is let go of the same way, before the session whose routing it holds.
    this.consultation.detach();
    this.voiceSession.detach();
    // A tooth selected on this patient must not follow the doctor to the next one.
    this.voiceContext.selectTooth(null);
  }

  loadPatientBilling(patientId: string) {
    if (!this.canBilling()) return;
    this.invoiceService.getPatientInvoices(patientId).subscribe(invoices => this.patientInvoices.set(invoices));
  }

  loadPatientTreatments(patientId: string) {
    this.patientTreatmentService.getPatientTreatments(patientId).subscribe(list => this.patientTreatments.set(list));
  }

  onToothSelected3D(toothId: string | null) {
    this.selectedToothForTreatments.set(toothId);
    // Selecting by hand is also how the doctor tells the assistant what "that tooth" refers to.
    this.voiceContext.selectTooth(toothId);
  }

  /** A tooth picked on the summary's chart opens it where it is edited. */
  openTooth(fdi: string): void {
    this.onToothSelected3D(fdi);
    this.goTo('chart', false);
  }

  /** The schedule's own form, with this patient filled in. Only the id travels in the address. */
  bookAppointment(): void {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    void this.router.navigate(['/schedule'], { queryParams: { book: patient.id } });
  }

  /** Opens the log of the consultation a filed transcript came from. */
  openConsultationLog(sessionId?: string): void {
    const patient = this.patientService.currentPatient();
    if (!patient || !sessionId) return;
    this.consultationApi.list(patient.id).subscribe({
      next: list => {
        const owner = list.find(c => c.voiceSessionId === sessionId);
        if (owner) this.logConsultationId.set(owner.id);
        else this.toast.error(this.translate.instant('CONSULTATION.LOG.ERROR'));
      },
      error: () => this.toast.error(this.translate.instant('CONSULTATION.LOG.ERROR')),
    });
  }

  onPrint(): void {
    window.print();
  }

  /** Archive, from the More menu: asks first and names the patient (P0-7). */
  async onArchive() {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    const confirmMsg = this.translate.instant('PATIENTS.DOSSIER.ARCHIVE_CONFIRM', { name: `${patient.firstName} ${patient.lastName}` });
    const confirmed = await this.confirmDialog.confirm(confirmMsg, { danger: true, confirmLabel: this.translate.instant('PATIENTS.DOSSIER.UI.ARCHIVE') });
    if (!confirmed) return;
    this.patientService.deletePatient(patient.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.PATIENT_DELETED'));
        void this.router.navigate(['/patients']);
      },
      error: (err) => {
        console.error('Error archiving patient', err);
        this.toast.error(this.translate.instant('PATIENTS.DOSSIER.UI.PATIENT_DELETE_FAILED'));
      }
    });
  }

  // ── Voice and consultation ─────────────────────────────────────────────

  /**
   * The menu's New consultation: shows the attestation card, then the tap there starts recording.
   * A doctor who asked not to see the card again starts at once, from this tap.
   */
  startConsultation(): void {
    this.goTo('voice');
    if (this.consultation.introHidden()) {
      if (this.voice.needsConsent()) this.voice.grantMicrophoneConsent();
      void this.consultation.startWithoutIntro();
      return;
    }
    this.consultation.openIntro();
  }

  /** The menu's dictation: opens the voice tab; starts at once unless consent is still needed. */
  startSession(): void {
    this.goTo('voice');
    if (this.voice.needsConsent()) return;
    void this.beginSession();
  }

  /**
   * Opens the microphone and starts — or resumes — dictation for this patient.
   *
   * **Must be reached synchronously from a tap.** The microphone is requested before anything is
   * awaited, because iOS only lets audio start inside the user's gesture.
   */
  async beginSession(): Promise<void> {
    const patient = this.patientService.currentPatient();
    if (!patient || this.voiceStarting() || this.voiceSession.busy()) return;
    // A consultation that lost its microphone comes back the same way, but reopens *its* recording.
    if (this.consultation.isRecording()) {
      void this.consultation.resumeRecording();
      return;
    }

    const microphone = this.voice.openMicrophone();
    this.goTo('voice');
    this.voiceStarting.set(true);
    try {
      if (!this.voiceSession.isActive()) {
        const restored = await this.voiceSession.resumeIfAvailable(patient.id);
        if (restored === 'review') {
          this.voice.stopListening();
          return;
        }
        if (restored === null) {
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
      this.toast.error(this.translate.instant('PATIENTS.DOSSIER.UI.VOICE_START_FAILED'));
    } finally {
      this.voiceStarting.set(false);
    }
  }

  /** Ends dictation and switches the voice panel to review. Nothing is written here. */
  async endSession(): Promise<void> {
    this.goTo('voice');
    await this.voiceSession.end();
  }

  /** The reviewed consultation is on the record; show it on the chart. */
  onVoiceSaved(): void {
    const patient = this.patientService.currentPatient();
    if (!patient) return;
    this.chartService.loadChart(patient.id, patient.dateOfBirth);
    this.clinicalRecordService.refresh(patient.id);
    this.loadPatientTreatments(patient.id);
  }

  /**
   * An unfinished consultation for this patient comes back first: it owns the dictated session,
   * and restoring that session alone would show the wrong review.
   */
  private async restoreConsultationAndVoice(patientId: string): Promise<void> {
    const current = this.consultation.consultation();
    if (current && current.patientId !== patientId) {
      this.consultation.detach();
      this.voiceSession.detach();
    }
    await this.consultation.resumeOpen(patientId);
    await this.restoreVoiceSession(patientId);
    // Arriving from "add patient and start the consultation".
    if (this.route.snapshot.queryParamMap.has('consultation') && !this.consultation.isOpen()) {
      this.startConsultation();
    }
  }

  private async restoreVoiceSession(patientId: string): Promise<void> {
    const current = this.voiceSession.session();
    if (current && current.patientId !== patientId) this.voiceSession.detach();
    const restored = await this.voiceSession.resumeIfAvailable(patientId);
    if (restored && this.patientService.currentPatient()?.id === patientId) this.goTo('voice');
  }
}
