import { IconComponent } from '../../../shared/ui/icon.component';
import { Component, computed, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ClinicalNote } from '../../../core/models/clinical-record.model';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';

/** One saved consultation or dictated examination, as the patient file keeps it. */
export interface ReportVisit {
  sessionId: string;
  date: string;
  report: ClinicalNote;
  complaint: ClinicalNote | null;
  plan: ClinicalNote | null;
  transcript: ClinicalNote | null;
}

/**
 * Groups the notes a consultation save files (the report, the chief complaint, the
 * treatment plan, the transcript) by the session they came from, newest first. Only a
 * session with a report counts: that is the note a doctor reviewed before saving.
 */
export function reportVisits(notes: readonly ClinicalNote[]): ReportVisit[] {
  const bySession = new Map<string, ClinicalNote[]>();
  for (const note of notes) {
    if (!note.sessionId) continue;
    const list = bySession.get(note.sessionId) ?? [];
    list.push(note);
    bySession.set(note.sessionId, list);
  }
  const visits: ReportVisit[] = [];
  for (const [sessionId, list] of bySession) {
    const of = (category: ClinicalNote['category']) => list.find((n) => n.category === category) ?? null;
    const report = of('CONSULTATION_REPORT');
    if (!report?.content?.trim()) continue;
    visits.push({
      sessionId,
      date: report.createdAt ?? '',
      report,
      complaint: of('CHIEF_COMPLAINT'),
      plan: of('TREATMENT_PLAN'),
      transcript: of('CONSULTATION_TRANSCRIPT'),
    });
  }
  return visits.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The medical report of the patient's last consultation, in full, on the overview. Earlier
 * ones are a pick away. It is read-only: a report is written by saving a consultation.
 */
@Component({
  selector: 'app-consultation-report',
  standalone: true,
  imports: [IconComponent, AppDatePipe, TranslateModule],
  template: `
    <section class="cr" aria-labelledby="cr-title">
      <header class="cr-head">
        <div class="cr-title">
          <app-icon class="mi" name="description" size="1em" />
          <h2 id="cr-title">{{ 'PATIENTS.DOSSIER.REPORT.TITLE' | translate }}</h2>
          @if (visit(); as v) { <span class="cr-date">{{ v.date | appDate:'long' }} · {{ v.date | appDate:'time' }}</span> }
        </div>
        @if (visits().length > 1) {
          <label class="cr-pick">
            <span>{{ 'PATIENTS.DOSSIER.REPORT.PICK' | translate }}</span>
            <select class="select !w-auto" [value]="visit()?.sessionId ?? ''" (change)="picked.set($any($event.target).value)">
              @for (v of visits(); track v.sessionId; let first = $first) {
                <option [value]="v.sessionId">{{ v.date | appDate }}@if (first) { · {{ 'PATIENTS.DOSSIER.REPORT.LATEST' | translate }} }</option>
              }
            </select>
          </label>
        }
      </header>

      @if (visit(); as v) {
        <div class="cr-body">
          @if (v.complaint?.content; as complaint) {
            <div class="cr-block">
              <h3>{{ 'PATIENTS.DOSSIER.REPORT.COMPLAINT' | translate }}</h3>
              <p>{{ complaint }}</p>
            </div>
          }
          <div class="cr-block cr-main">
            <h3>{{ 'PATIENTS.DOSSIER.REPORT.REPORT' | translate }}</h3>
            <p>{{ v.report.content }}</p>
          </div>
          @if (v.plan?.content; as plan) {
            <div class="cr-block">
              <h3>{{ 'PATIENTS.DOSSIER.REPORT.PLAN' | translate }}</h3>
              <p>{{ plan }}</p>
            </div>
          }
        </div>
        @if (v.transcript) {
          <footer class="cr-foot">
            <button type="button" class="btn btn-ghost btn-sm" (click)="openLog.emit(v.sessionId)">
              <app-icon class="mi text-sm" name="history" size="1em" /> {{ 'CONSULTATION.OPEN_LOG' | translate }}
            </button>
          </footer>
        }
      } @else {
        <p class="cr-empty">{{ 'PATIENTS.DOSSIER.REPORT.EMPTY' | translate }}</p>
      }
    </section>
  `,
  styles: [`
    .cr { margin-top: 1rem; padding: 1rem 1.25rem; border-radius: var(--radius-lg); border: 1px solid rgb(var(--ink-200)); background: var(--surface); }
    .cr-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem; margin-bottom: .75rem; }
    .cr-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: .25rem .625rem; min-width: 0; }
    .cr-title app-icon.mi { align-self: center; font-size: var(--text-lg); color: rgb(var(--petrol-700)); }
    .cr-title h2 { margin: 0; font-size: var(--text-md); font-weight: 700; color: rgb(var(--ink-900)); }
    .cr-date { font-size: var(--text-sm); color: rgb(var(--ink-500)); }
    .cr-pick { display: inline-flex; align-items: center; gap: .5rem; font-size: var(--text-sm); color: rgb(var(--ink-600)); }
    .cr-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
    @media (min-width: 1100px) {
      .cr-body { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
      .cr-main { grid-row: 1 / span 2; grid-column: 1; }
      .cr-block:not(.cr-main) { grid-column: 2; }
    }
    .cr-block h3 { margin: 0 0 .375rem; font-size: var(--text-xs); font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: rgb(var(--ink-500)); }
    /* A report has line breaks and lists; run together it is unreadable. */
    .cr-block p { margin: 0; white-space: pre-line; font-size: var(--text-base); line-height: 1.6; color: rgb(var(--ink-800)); }
    .cr-block:not(.cr-main) { padding: .75rem .875rem; border-radius: var(--radius-md); background: rgb(var(--ink-50)); }
    .cr-block:not(.cr-main) p { font-size: var(--text-base); }
    .cr-foot { margin-top: .75rem; padding-top: .5rem; border-top: 1px solid rgb(var(--ink-100)); }
    .cr-empty { margin: 0; font-size: var(--text-base); color: rgb(var(--ink-500)); }
  `],
})
export class ConsultationReportComponent {
  readonly notes = input.required<readonly ClinicalNote[]>();
  /** Opens the consultation's log: what was said, beside what was understood and validated. */
  readonly openLog = output<string>();

  protected readonly picked = signal<string | null>(null);
  protected readonly visits = computed(() => reportVisits(this.notes()));
  protected readonly visit = computed(() => {
    const all = this.visits();
    return all.find((v) => v.sessionId === this.picked()) ?? all[0] ?? null;
  });
}
