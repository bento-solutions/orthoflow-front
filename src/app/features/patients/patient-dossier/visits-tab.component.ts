import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { findingLabel } from '../../../core/clinical/finding-options';
import { ClinicalNote, NoteCategory } from '../../../core/models/clinical-record.model';
import { Appointment } from '../../../core/models/patient.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { TreatmentPassportService } from '../../../core/services/treatment-passport.service';
import { ConsultationRecordsComponent } from '../../../shared/components/consultation/consultation-records.component';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { EmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { IconComponent, IconName } from '../../../shared/ui/icon.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';
import { reportVisits } from './consultation-report.component';

export type VisitKind = 'appointment' | 'consultation' | 'note' | 'work';

/** One dated line of the patient's story. */
export interface VisitItem {
  key: string;
  kind: VisitKind;
  /** ISO date-time, or '' when the date is not known. */
  date: string;
  title: string;
  body: string | null;
  /** A second block under the body (a consultation's plan). */
  extra: string | null;
  status: string | null;
  sessionId: string | null;
  /** A note written by hand, which may be deleted. */
  noteId: string | null;
}

/** Notes a consultation save files: they are shown with their consultation, not on their own. */
const FILED_BY_SAVE = new Set(['CONSULTATION_REPORT', 'CONSULTATION_TRANSCRIPT', 'CHIEF_COMPLAINT', 'TREATMENT_PLAN']);

/** Upcoming appointments soonest first, then everything else newest first; undated last. */
export function visitTimeline(items: readonly VisitItem[], now = Date.now()): { upcoming: VisitItem[]; past: VisitItem[] } {
  const time = (i: VisitItem) => (i.date ? new Date(i.date).getTime() : Number.NaN);
  const upcoming = items.filter(i => i.kind === 'appointment' && time(i) >= now && i.status !== 'CANCELLED')
    .sort((a, b) => time(a) - time(b));
  const past = items.filter(i => !upcoming.includes(i))
    .sort((a, b) => (Number.isNaN(time(a)) ? 1 : 0) - (Number.isNaN(time(b)) ? 1 : 0) || time(b) - time(a));
  return { upcoming, past };
}

/**
 * Visits: one dated timeline of what happened to the patient and what is planned (P1-1) —
 * appointments past and future, each consultation with its report, transcript and audio, the
 * notes written by hand, and the work done. It replaces Clinical › Schedule, Treatment log and
 * Observations Report, Documents › Recorded consultations and Overview › Medical report.
 */
@Component({
  selector: 'app-visits-tab',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, TranslateModule, AppDatePipe, EmptyStateComponent, IconComponent, StatusPillComponent, ConsultationRecordsComponent],
  template: `
    <h2 class="sr-only">{{ 'PATIENTS.DOSSIER.TAB.VISITS' | translate }}</h2>
    <div class="vt-head">
      <div class="seg" role="group" [attr.aria-label]="'PATIENTS.DOSSIER.VISITS.FILTER' | translate">
        @for (f of filters; track f) {
          <button type="button" class="seg-item" [attr.aria-pressed]="filter() === f" (click)="filter.set(f)">{{ ('PATIENTS.DOSSIER.VISITS.KIND.' + f) | translate }}</button>
        }
      </div>
      <div class="flex flex-wrap gap-2">
        @if (canWrite() && !noteForm()) {
          <button type="button" class="btn btn-secondary btn-sm" (click)="noteForm.set(true)"><app-icon name="edit" [size]="14" /> {{ 'PATIENTS.DOSSIER.VISITS.ADD_NOTE' | translate }}</button>
        }
        @if (canBook()) {
          <button type="button" class="btn btn-primary btn-sm" (click)="book.emit()"><app-icon name="calendar-plus" [size]="14" /> {{ 'PATIENTS.DOSSIER.BOOK' | translate }}</button>
        }
      </div>
    </div>

    @if (noteForm()) {
      <form class="card mb-4 space-y-2 p-4" (ngSubmit)="addNote()">
        <label class="field">
          <span class="label">{{ 'PATIENTS.DOSSIER.UI.CATEGORY' | translate }}</span>
          <select class="select" name="category" [(ngModel)]="note.category">
            @for (cat of noteCategories; track cat) { <option [value]="cat">{{ 'PATIENTS.DOSSIER.UI.NOTE_CAT.' + cat | translate }}</option> }
          </select>
        </label>
        <label class="field">
          <span class="label label-required">{{ 'PATIENTS.DOSSIER.UI.NOTE_CONTENT' | translate }}</span>
          <textarea class="textarea" name="content" rows="3" required [(ngModel)]="note.content"></textarea>
        </label>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost btn-sm" (click)="noteForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="!note.content.trim()">{{ 'COMMON.SAVE' | translate }}</button>
        </div>
      </form>
    }

    @if (timeline().upcoming.length) {
      <h3 class="vt-group">{{ 'PATIENTS.DOSSIER.VISITS.UPCOMING' | translate }}</h3>
      <ol class="vt-list">
        @for (item of timeline().upcoming; track item.key) { <ng-container *ngTemplateOutlet="row; context: { $implicit: item }" /> }
      </ol>
    }

    <h3 class="vt-group">{{ 'PATIENTS.DOSSIER.VISITS.HISTORY' | translate }}</h3>
    @if (timeline().past.length) {
      <ol class="vt-list">
        @for (item of timeline().past; track item.key) { <ng-container *ngTemplateOutlet="row; context: { $implicit: item }" /> }
      </ol>
    } @else {
      <app-empty-state icon="history" [title]="'PATIENTS.DOSSIER.VISITS.EMPTY' | translate" [text]="'PATIENTS.DOSSIER.VISITS.EMPTY_TEXT' | translate"
        [actionLabel]="canBook() ? ('PATIENTS.DOSSIER.BOOK' | translate) : null" actionIcon="calendar-plus" (action)="book.emit()" />
    }

    @if (canReadClinical()) {
      <h3 class="vt-group">{{ 'PATIENTS.DOSSIER.VISITS.RECORDINGS' | translate }}</h3>
      <app-consultation-records [patientId]="patientId()" />
    }

    <ng-template #row let-item>
      <li class="vt-item" [attr.data-kind]="item.kind">
        <span class="vt-icon" aria-hidden="true"><app-icon [name]="icon(item.kind)" [size]="16" /></span>
        <div class="vt-main">
          <p class="vt-line">
            <span class="vt-date">@if (item.date) { {{ item.date | appDate:(item.kind === 'work' ? 'date' : 'datetime') }} } @else { {{ 'TOOTH_DETAIL.DATE_UNKNOWN' | translate }} }</span>
            <span class="vt-kind">{{ ('PATIENTS.DOSSIER.VISITS.KIND.' + item.kind) | translate }}</span>
            @if (item.status) { <app-status-pill [status]="item.status" /> }
          </p>
          <p class="vt-title">{{ item.title }}</p>
          @if (item.body) { <p class="vt-body">{{ item.body }}</p> }
          @if (item.extra) {
            <div class="vt-extra"><span class="vt-extra-label">{{ 'PATIENTS.DOSSIER.REPORT.PLAN' | translate }}</span>{{ item.extra }}</div>
          }
          @if (item.sessionId || item.noteId) {
            <div class="vt-actions">
              @if (item.sessionId) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="openLog.emit(item.sessionId)"><app-icon name="history" [size]="14" /> {{ 'CONSULTATION.OPEN_LOG' | translate }}</button>
              }
              @if (item.noteId && canWrite()) {
                <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="removeNote(item)"><app-icon name="trash" [size]="14" /> {{ 'COMMON.DELETE' | translate }}</button>
              }
            </div>
          }
        </div>
      </li>
    </ng-template>
  `,
  styles: [`
    :host { display: block; max-width: 60rem; }
    .vt-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; }
    .vt-group { margin: 1.5rem 0 .5rem; font-size: var(--text-xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }
    .vt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .vt-item { display: flex; gap: .75rem; padding: .75rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
    .vt-icon { flex: none; display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius-full); background: var(--surface-sunken); color: var(--text-muted-on-tint); }
    .vt-item[data-kind='consultation'] .vt-icon { background: var(--action-tint); color: var(--action-text); }
    .vt-item[data-kind='work'] .vt-icon { background: var(--status-done-tint); color: var(--status-done-text); }
    .vt-main { min-width: 0; flex: 1; }
    .vt-line { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem .625rem; font-size: var(--text-sm); color: var(--text-muted); }
    .vt-date { font-weight: 700; color: var(--text); }
    .vt-kind { font-weight: 600; }
    .vt-title { margin-top: .125rem; font-weight: 650; color: var(--text); }
    .vt-body { margin-top: .25rem; white-space: pre-line; font-size: var(--text-base); color: rgb(var(--ink-700)); }
    .vt-extra { margin-top: .5rem; padding: .5rem .75rem; border-radius: var(--radius-md); background: var(--surface-sunken); white-space: pre-line; font-size: var(--text-sm); }
    .vt-extra-label { display: block; font-size: var(--text-xs); font-weight: 700; color: var(--text-muted-on-tint); }
    .vt-actions { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .375rem; }
  `],
})
export class VisitsTabComponent {
  readonly patientId = input.required<string>();
  readonly appointments = input<readonly Appointment[]>([]);
  readonly notes = input<readonly ClinicalNote[]>([]);
  readonly book = output<void>();
  readonly openLog = output<string>();

  private readonly records = inject(ClinicalRecordService);
  private readonly passport = inject(TreatmentPassportService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  protected readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));
  protected readonly canReadClinical = computed(() => this.permissions.can('CLINICAL_READ'));
  protected readonly canBook = computed(() => this.permissions.can('AGENDA_MANAGE'));
  protected readonly filters = ['all', 'appointment', 'consultation', 'note', 'work'] as const;
  protected readonly filter = signal<(typeof this.filters)[number]>('all');
  protected readonly noteForm = signal(false);
  protected readonly noteCategories: NoteCategory[] = ['GENERAL', 'CHIEF_COMPLAINT', 'OBSERVATION', 'DENTAL_HISTORY', 'MEDICAL_HISTORY', 'DIAGNOSIS', 'FOLLOW_UP', 'TREATMENT_PLAN'];
  protected note: { category: NoteCategory; content: string } = { category: 'GENERAL', content: '' };

  constructor() {
    effect(() => {
      const id = this.patientId();
      if (id && this.canReadClinical()) untracked(() => this.passport.load(id));
    });
  }

  private readonly items = computed<VisitItem[]>(() => {
    const t = (key: string, params?: object) => this.translate.instant(key, params);
    const appointments: VisitItem[] = this.appointments().map(a => ({
      key: 'a' + a.id, kind: 'appointment', date: a.dateTime ?? '', title: a.type || t('PATIENTS.DOSSIER.VISITS.KIND.appointment'),
      body: a.notes || null, extra: null, status: a.status ?? null, sessionId: null, noteId: null,
    }));
    const consultations: VisitItem[] = reportVisits(this.notes()).map(v => ({
      key: 'c' + v.sessionId, kind: 'consultation', date: v.date, title: v.complaint?.content || t('PATIENTS.DOSSIER.REPORT.TITLE'),
      body: v.report.content, extra: v.plan?.content || null, status: null, sessionId: v.transcript ? v.sessionId : null, noteId: null,
    }));
    const notes: VisitItem[] = this.notes()
      .filter(n => !(n.sessionId && FILED_BY_SAVE.has(n.category)))
      .map(n => ({
        key: 'n' + n.id, kind: 'note', date: n.createdAt ?? '', title: t('PATIENTS.DOSSIER.UI.NOTE_CAT.' + n.category),
        body: n.content, extra: null, status: null, sessionId: null, noteId: n.sessionId ? null : n.id,
      }));
    const work: VisitItem[] = (this.passport.passport()?.log ?? []).map((w, i) => ({
      key: 'w' + i, kind: 'work', date: w.date ?? '',
      title: (w.name ?? findingLabel(this.translate, w.code ?? '')) + (w.teeth?.length ? ` · ${t('TREATMENT_LOG.TOOTH')} ${w.teeth.join(', ')}` : ''),
      body: w.note ?? null, extra: null, status: null, sessionId: null, noteId: null,
    }));
    return [...appointments, ...consultations, ...notes, ...work];
  });

  protected readonly timeline = computed(() => {
    const f = this.filter();
    return visitTimeline(f === 'all' ? this.items() : this.items().filter(i => i.kind === f));
  });

  protected icon(kind: VisitKind): IconName {
    return ({ appointment: 'calendar', consultation: 'message', note: 'file-text', work: 'check-circle' } as const)[kind];
  }

  protected addNote(): void {
    if (!this.note.content.trim()) return;
    this.records.addNote(this.patientId(), { category: this.note.category, content: this.note.content.trim(), source: 'manual' }).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.NOTE_ADDED'));
        this.note = { category: 'GENERAL', content: '' };
        this.noteForm.set(false);
      },
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || this.translate.instant('COMMON.SAVE_FAILED')),
    });
  }

  protected async removeNote(item: VisitItem): Promise<void> {
    if (!item.noteId) return;
    const excerpt = (item.body ?? '').replace(/\s+/g, ' ').trim();
    const ok = await this.confirmDialog.confirm(
      this.translate.instant('PATIENTS.DOSSIER.UI.NOTE_DELETE_CONFIRM', { excerpt: excerpt.length > 80 ? excerpt.slice(0, 80) + '…' : excerpt }),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') });
    if (!ok) return;
    this.records.deleteNote(this.patientId(), item.noteId).subscribe({
      next: () => this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.NOTE_DELETED')),
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || this.translate.instant('COMMON.SAVE_FAILED')),
    });
  }
}
