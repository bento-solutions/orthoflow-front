import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { VoiceOrchestratorService, BufferedEntry } from '../../../core/voice/voice-orchestrator.service';
import { SessionBufferService } from '../../../core/voice/session-buffer.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PatientService } from '../../../core/services/patient.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { PatientTreatmentService } from '../../../core/services/patient-treatment.service';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { InvoiceService } from '../../billing/services/invoice.service';
import { entityString, stagedFindingCodes } from '../../../core/voice/voice-intent.model';
import { findingLabel } from '../../../core/voice/clinical-lexicon';
import { describeFdi } from '../../../core/voice/tooth-lexicon';

/**
 * Where a dictated examination becomes part of the record — or doesn't.
 *
 * ── Two ways in ─────────────────────────────────────────────────────────
 *
 * Normally **embedded** in the patient dossier's voice panel: ending a
 * session switches that panel into review, beside the chart the findings
 * were dictated onto, without leaving the dossier. The route
 * `/patients/:id/session/:sessionId/review` still renders it standalone, for
 * a link or a reload, with the patient context the dossier would otherwise
 * provide.
 *
 * ── What the dentist is looking at ──────────────────────────────────────
 *
 * The **staged findings** are the record: each one is a command that was
 * dictated, is included by default, and is written when they save. The
 * **narrative** is generated prose to help read the consultation back; it is
 * editable, saved as a note, and not what the clinical tables are built
 * from. Confusing the two would let a model's sentence become a finding.
 */
@Component({
  selector: 'app-session-review',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="review" [class.embedded]="embedded()">
      <header class="review-header">
        <div>
          @if (!embedded()) {
            <h1>{{ 'VOICE.REVIEW_TITLE' | translate }}</h1>
          }
          <p class="sub">
            @if (!embedded()) {
              {{ patient()?.firstName }} {{ patient()?.lastName }}
              <span class="dot">·</span>
            }
            {{ 'VOICE.REVIEW_COUNT' | translate: { included: included().length, total: entries().length } }}
          </p>
        </div>
        <div class="header-actions">
          <button type="button" class="btn btn-ghost" (click)="discardAll()" [disabled]="saving()">
            {{ 'VOICE.REVIEW_DISCARD' | translate }}
          </button>
          <button type="button" class="btn btn-primary" (click)="save()"
                  [disabled]="saving() || entries().length === 0">
            {{ (saving() ? 'VOICE.REVIEW_SAVING' : 'VOICE.REVIEW_SAVE') | translate }}
          </button>
        </div>
      </header>

      @if (failures().length) {
        <div class="banner banner-error" role="alert">
          <strong>{{ 'VOICE.REVIEW_FAILED' | translate: { count: failures().length } }}</strong>
          <ul>
            @for (failure of failures(); track failure.auditId) {
              <li>{{ failure.errorMessage }}</li>
            }
          </ul>
        </div>
      }

      <div class="review-grid">
        <!-- ── Staged findings: the record ─────────────────────────── -->
        <section class="panel span-2">
          <h2>{{ 'VOICE.REVIEW_DICTATED' | translate }}</h2>
          <p class="panel-hint">{{ 'VOICE.REVIEW_DICTATED_HINT' | translate }}</p>

          @if (entries().length === 0) {
            <p class="empty">{{ 'VOICE.REVIEW_EMPTY' | translate }}</p>
          } @else {
            <ul class="entry-list">
              @for (entry of entries(); track entry.auditId) {
                <li class="entry" [class.excluded]="!isIncluded(entry.auditId)">
                  <label class="entry-check">
                    <input type="checkbox" [checked]="isIncluded(entry.auditId)"
                           (change)="toggle(entry.auditId)"
                           [attr.aria-label]="entry.preview" />
                  </label>
                  <div class="entry-body">
                    <p class="entry-preview">{{ entry.preview }}</p>
                    @if (entry.transcript) {
                      <p class="entry-heard">“{{ entry.transcript }}”</p>
                    }
                    <!-- A repaired word is shown, not hidden. If the system
                         acted on a different word than was said, that is
                         exactly what needs checking here. -->
                    @if (entry.corrections.length) {
                      <p class="entry-correction">
                        @for (correction of entry.corrections; track correction.from) {
                          <span class="chip">{{ correction.from }} → {{ correction.to }}</span>
                        }
                      </p>
                    }
                  </div>
                  <time class="entry-time">{{ entry.at | date:'HH:mm' }}</time>
                </li>
              }
            </ul>
          }
        </section>

        @if (!embedded()) {
          <!-- ── Teeth ──────────────────────────────────────────────── -->
          <section class="panel">
            <h2>{{ 'VOICE.REVIEW_TEETH' | translate }}</h2>
            @if (stagedTeeth().length === 0) {
              <p class="empty">{{ 'VOICE.REVIEW_NO_TEETH' | translate }}</p>
            } @else {
              <ul class="tooth-list">
                @for (tooth of stagedTeeth(); track tooth.fdi) {
                  <li>
                    <span class="fdi">{{ tooth.fdi }}</span>
                    <div>
                      <p class="tooth-name">{{ tooth.description }}</p>
                      <p class="tooth-findings">
                        @for (label of tooth.labels; track label) {
                          <span class="finding">{{ label }}</span>
                        }
                      </p>
                    </div>
                  </li>
                }
              </ul>
            }
          </section>

          <!-- ── Context ────────────────────────────────────────────── -->
          <section class="panel">
            <h2>{{ 'VOICE.REVIEW_CONTEXT' | translate }}</h2>
            <dl class="context">
              <dt>{{ 'PATIENTS.DOSSIER.ALLERGIES' | translate }}</dt>
              <dd [class.alert]="allergies().length > 0">
                {{ allergies().length ? allergies().join(', ') : '—' }}
              </dd>
              <dt>{{ 'PATIENTS.DOSSIER.ACTIVE_TREATMENTS' | translate }}</dt>
              <dd>{{ activeTreatments().length ? activeTreatments().join(', ') : '—' }}</dd>
              <dt>{{ 'PATIENTS.NEXT_APPOINTMENT' | translate }}</dt>
              <dd>{{ nextAppointment() ?? '—' }}</dd>
              <dt>{{ 'BILLING.OUTSTANDING' | translate }}</dt>
              <dd [class.alert]="outstanding() > 0">
                {{ outstanding() > 0 ? (outstanding() | number:'1.2-2') + ' MAD' : '—' }}
              </dd>
            </dl>
          </section>
        }

        <!-- ── Narrative ───────────────────────────────────────────── -->
        <section class="panel span-2">
          <div class="panel-head">
            <h2>{{ 'VOICE.REVIEW_REPORT' | translate }}</h2>
            <button type="button" class="btn btn-ghost btn-sm"
                    (click)="regenerate()" [disabled]="regenerating()">
              {{ (regenerating() ? 'VOICE.REVIEW_GENERATING' : 'VOICE.REVIEW_REGENERATE') | translate }}
            </button>
          </div>
          <p class="panel-hint">{{ 'VOICE.REVIEW_REPORT_HINT' | translate }}</p>

          @if (narrativeError()) {
            <p class="narrative-unavailable">
              {{ 'VOICE.REVIEW_REPORT_UNAVAILABLE' | translate: { reason: narrativeError() } }}
            </p>
          }
          <textarea class="narrative" rows="6" [(ngModel)]="narrativeText"
                    [attr.aria-label]="'VOICE.REVIEW_REPORT' | translate"></textarea>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .review { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
    .review.embedded { padding: 0; max-width: none; }
    .review-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: .75rem 1rem; flex-wrap: wrap; margin-bottom: 1rem;
    }
    .review-header h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
    .sub { margin: 0; color: rgb(var(--ink-500)); font-size: .9rem; }
    .dot { margin: 0 .4rem; opacity: .5; }
    .header-actions { display: flex; gap: .5rem; flex-wrap: wrap; }

    .banner { padding: .875rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: .9rem; }
    .banner-error { background: rgb(var(--critical-50)); border: 1px solid rgb(var(--critical-200)); color: rgb(var(--critical-700)); }
    .banner ul { margin: .5rem 0 0; padding-left: 1.25rem; }

    .review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    .embedded .review-grid { grid-template-columns: 1fr; }
    .span-2 { grid-column: 1 / -1; }

    .panel { background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 10px; padding: 1rem; }
    .panel h2 { margin: 0 0 .25rem; font-size: 1rem; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
    .panel-hint { margin: 0 0 .75rem; font-size: .82rem; color: rgb(var(--ink-500)); }
    .empty { color: rgb(var(--ink-500)); font-size: .9rem; margin: 0; }

    .entry-list { list-style: none; margin: 0; padding: 0; }
    .entry {
      display: flex; gap: .75rem; align-items: flex-start;
      padding: .75rem 0; border-bottom: 1px solid rgb(var(--ink-100));
    }
    .entry:last-child { border-bottom: none; }
    .entry.excluded { opacity: .45; }
    .entry.excluded .entry-preview { text-decoration: line-through; }
    .entry-check input { width: 1.25rem; height: 1.25rem; margin-top: .1rem; }
    .entry-body { flex: 1; min-width: 0; }
    .entry-preview { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .entry-heard { margin: .2rem 0 0; font-size: .8rem; color: rgb(var(--ink-500)); font-style: italic; overflow-wrap: anywhere; }
    .entry-correction { margin: .35rem 0 0; display: flex; gap: .35rem; flex-wrap: wrap; }
    .chip {
      font-size: .72rem; padding: .12rem .45rem; border-radius: 999px;
      background: rgb(var(--caution-50)); color: rgb(var(--caution-700)); border: 1px solid rgb(var(--caution-200));
    }
    .entry-time { font-size: .78rem; color: rgb(var(--ink-500)); white-space: nowrap; }

    .tooth-list { list-style: none; margin: 0; padding: 0; }
    .tooth-list li { display: flex; gap: .75rem; padding: .5rem 0; align-items: flex-start; }
    .fdi {
      font-weight: 700; min-width: 2.2rem; text-align: center; padding: .15rem .35rem;
      background: rgb(var(--ink-100)); border-radius: 6px; font-size: .85rem;
    }
    .tooth-name { margin: 0; font-size: .85rem; }
    .tooth-findings { margin: .2rem 0 0; display: flex; gap: .3rem; flex-wrap: wrap; }
    .finding { font-size: .75rem; padding: .1rem .4rem; border-radius: 4px; background: rgb(var(--ink-100)); }

    .context { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: .5rem .875rem; }
    .context dt { font-size: .82rem; color: rgb(var(--ink-500)); }
    .context dd { margin: 0; font-size: .88rem; }
    .context dd.alert { color: rgb(var(--critical-700)); font-weight: 600; }

    .narrative {
      width: 100%; box-sizing: border-box; font: inherit; line-height: 1.6;
      padding: .75rem; border: 1px solid rgb(var(--ink-300)); border-radius: 8px; resize: vertical;
    }
    .narrative-unavailable {
      font-size: .85rem; color: rgb(var(--caution-700)); background: rgb(var(--caution-50));
      border: 1px solid rgb(var(--caution-200)); border-radius: 6px; padding: .6rem .75rem; margin: 0 0 .75rem;
    }
    .btn-sm { font-size: .82rem; padding: .3rem .7rem; }

    @media (max-width: 900px) { .review-grid { grid-template-columns: 1fr; } }
    @media (max-width: 640px) {
      .review { padding: 1rem; }
      .review.embedded { padding: 0; }
      .header-actions { width: 100%; }
      .header-actions .btn { flex: 1; justify-content: center; min-height: 2.75rem; }
    }
  `],
})
export class SessionReviewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sessions = inject(VoiceSessionService);
  private orchestrator = inject(VoiceOrchestratorService);
  private buffer = inject(SessionBufferService);
  private toast = inject(ToastService);
  private confirmDialog = inject(ConfirmDialogService);
  private patients = inject(PatientService);
  private schedule = inject(ScheduleService);
  private treatments = inject(PatientTreatmentService);
  private clinical = inject(ClinicalRecordService);
  private invoices = inject(InvoiceService);

  /** Set when embedded; the route supplies both when standalone. */
  sessionIdInput = input<string | null>(null, { alias: 'sessionId' });
  patientIdInput = input<string | null>(null, { alias: 'patientId' });
  /** Rendered inside the dossier, which already shows the chart and context. */
  embedded = input(false);
  /** Emitted once the consultation is saved or thrown away. */
  finished = output<'saved' | 'discarded'>();

  private get sessionId(): string {
    return this.sessionIdInput() ?? this.route.snapshot.paramMap.get('sessionId') ?? '';
  }

  private get patientId(): string {
    return this.patientIdInput() ?? this.route.snapshot.paramMap.get('id') ?? '';
  }

  private entriesSignal = signal<BufferedEntry[]>([]);
  private excludedSignal = signal<Set<string>>(new Set());
  private savingSignal = signal(false);
  private regeneratingSignal = signal(false);
  private failuresSignal = signal<{ auditId: string; errorMessage: string }[]>([]);
  private treatmentsSignal = signal<string[]>([]);
  private nextAppointmentSignal = signal<string | null>(null);
  private outstandingSignal = signal(0);

  entries = this.entriesSignal.asReadonly();
  saving = this.savingSignal.asReadonly();
  regenerating = this.regeneratingSignal.asReadonly();
  failures = this.failuresSignal.asReadonly();
  allergies = computed(() => this.clinical.allergies().map(allergy => allergy.substance));
  activeTreatments = this.treatmentsSignal.asReadonly();
  nextAppointment = this.nextAppointmentSignal.asReadonly();
  outstanding = this.outstandingSignal.asReadonly();
  narrativeError = this.sessions.narrativeError;
  patient = this.patients.currentPatient;

  narrativeText = '';

  included = computed(() =>
    this.entriesSignal().filter(entry => !this.excludedSignal().has(entry.auditId)));

  /** Included entries' auditIds, so the dossier chart can mark only what will be saved. */
  includedTeeth = computed(() => [...new Set(this.included()
    .map(entry => entityString(entry.entities, 'fdi'))
    .filter((fdi): fdi is string => !!fdi))]);

  /** The teeth this examination touched, for the at-a-glance panel. */
  stagedTeeth = computed(() => {
    const byTooth = new Map<string, { fdi: string; description: string; labels: string[] }>();
    for (const entry of this.included()) {
      const fdi = entityString(entry.entities, 'fdi');
      if (!fdi) continue;
      const row = byTooth.get(fdi) ?? { fdi, description: describeFdi(fdi), labels: [] };
      for (const code of stagedFindingCodes(entry.entities)) {
        const label = findingLabel(code);
        if (!row.labels.includes(label)) row.labels.push(label);
      }
      byTooth.set(fdi, row);
    }
    return [...byTooth.values()].sort((a, b) => a.fdi.localeCompare(b.fdi));
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    // The in-memory buffer is authoritative when review was reached by ending
    // a session. IndexedDB is the fallback for a reload or a resumed review.
    const live = this.orchestrator.buffered();
    if (live.length > 0) {
      this.entriesSignal.set(live);
    } else {
      const stored = await this.buffer.get(this.sessionId);
      this.entriesSignal.set(stored?.commands ?? []);
    }

    this.narrativeText = this.sessions.narrative() ?? '';
    if (!this.narrativeText && !this.sessions.narrativeError()) {
      await this.regenerate();
    }

    if (!this.embedded()) void this.loadContext();
  }

  /**
   * The context that makes a finding judgeable, for the standalone page. Each
   * source is independent, so one failing must not blank the others.
   */
  private async loadContext(): Promise<void> {
    if (!this.patientId) return;

    if (!this.patients.currentPatient()) {
      this.patients.setCurrentPatient(this.patientId).subscribe({ error: () => undefined });
    }
    this.clinical.refresh(this.patientId);

    try {
      const treatments = await firstValueFrom(this.treatments.getPatientTreatments(this.patientId));
      this.treatmentsSignal.set(treatments
        .filter(treatment => treatment.status === 'ACTIVE' || treatment.status === 'PLANNED')
        .map(treatment => treatment.treatment?.name ?? 'Treatment'));
    } catch { /* leave empty */ }

    try {
      const invoices = await firstValueFrom(this.invoices.getPatientInvoices(this.patientId));
      this.outstandingSignal.set(invoices
        .filter(invoice => invoice.status !== 'PAID' && invoice.status !== 'CANCELLED')
        .reduce((sum, invoice) => sum + (invoice.balanceDue ?? invoice.total), 0));
    } catch { /* leave at zero */ }

    const now = Date.now();
    const next = this.schedule.appointments()
      .filter(appointment => appointment.patientId === this.patientId
        && new Date(appointment.dateTime).getTime() > now)
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())[0];
    this.nextAppointmentSignal.set(next ? new Date(next.dateTime).toLocaleString() : null);
  }

  isIncluded(auditId: string): boolean {
    return !this.excludedSignal().has(auditId);
  }

  toggle(auditId: string): void {
    this.excludedSignal.update(excluded => {
      const next = new Set(excluded);
      if (next.has(auditId)) next.delete(auditId);
      else next.add(auditId);
      return next;
    });
  }

  async regenerate(): Promise<void> {
    this.regeneratingSignal.set(true);
    try {
      await this.sessions.generateNarrative(this.sessionId);
      const narrative = this.sessions.narrative();
      if (narrative) this.narrativeText = narrative;
    } finally {
      this.regeneratingSignal.set(false);
    }
  }

  async save(): Promise<void> {
    this.savingSignal.set(true);
    this.failuresSignal.set([]);
    try {
      const approved = this.included().map(entry => entry.auditId);
      const rejected = this.entriesSignal()
        .filter(entry => this.excludedSignal().has(entry.auditId))
        .map(entry => entry.auditId);

      const result = await this.sessions.commit(this.sessionId, approved, rejected, this.narrativeText);

      if (result.ok) {
        this.toast.success(`Saved ${result.executed} finding(s) to the dossier.`);
        if (this.patientId) {
          this.clinical.refresh(this.patientId);
        }
        if (this.embedded()) {
          this.finished.emit('saved');
        } else {
          await this.router.navigate(['/patients', this.patientId]);
        }
        return;
      }

      // Partial success. Stay open showing what is left, rather than moving
      // on and leaving the dentist to discover the gap.
      this.failuresSignal.set(result.failed);
      this.toast.error(`${result.failed.length} finding(s) could not be saved.`);
    } catch {
      this.toast.error('Nothing was saved — check the connection and try again.');
    } finally {
      this.savingSignal.set(false);
    }
  }

  async discardAll(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm(
      'Discard this examination? Nothing dictated will be saved to the dossier.',
      { danger: true, confirmLabel: 'Discard' },
    );
    if (!confirmed) return;

    if (this.sessions.session()?.id === this.sessionId) {
      await this.sessions.abandon();
    } else {
      await this.buffer.clear(this.sessionId);
      this.orchestrator.resetBuffer();
    }

    if (this.embedded()) {
      this.finished.emit('discarded');
    } else {
      await this.router.navigate(['/patients', this.patientId]);
    }
  }
}
