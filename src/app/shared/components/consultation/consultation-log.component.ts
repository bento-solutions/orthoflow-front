import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ConsultationApiService } from '../../../core/consultation/consultation-api.service';
import { buildTimeline, TimelineRow } from '../../../core/consultation/consultation-log';
import { ConsultationLogDto } from '../../../core/consultation/consultation.model';
import { spokenLanguage } from '../../../core/voice/voice-vocabulary';
import { ModalComponent } from '../../ui/modal.component';

/**
 * The consultation log: what was said and when, the commands the examination
 * understood and what became of them, and what the doctor validated — for
 * checking, afterwards, what the proposals were read from. Read-only.
 *
 * Times are the browser's own clock at the moment each sentence was transcribed
 * (the server holds them to the consultation's span), so a line is a few
 * seconds after it was spoken, not at its first word.
 */
@Component({
  selector: 'app-consultation-log',
  standalone: true,
  imports: [DatePipe, TranslateModule, ModalComponent],
  template: `
    <app-modal [open]="!!consultationId()" [title]="'CONSULTATION.LOG.TITLE' | translate" size="lg" (closed)="closed.emit()">
      @if (loading()) {
        <p class="text-sm text-ink-500">{{ 'CONSULTATION.LOG.LOADING' | translate }}</p>
      } @else if (error()) {
        <p class="text-sm text-red-600" role="alert">{{ 'CONSULTATION.LOG.ERROR' | translate }}</p>
      } @else if (log(); as l) {
        <p class="mb-3 text-sm text-ink-500">
          {{ l.startedAt | date: 'dd/MM/yyyy HH:mm' }}
          · {{ 'CONSULTATION.LOG.INFORMED_AT' | translate }} {{ l.patientInformedAt | date: 'HH:mm:ss' }}
        </p>

        @if (!l.transcriptKept) {
          <p class="mb-3 rounded-md border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700">{{ 'CONSULTATION.LOG.NOT_KEPT' | translate }}</p>
        }

        <ol class="space-y-1" aria-label="{{ 'CONSULTATION.LOG.TITLE' | translate }}">
          @for (row of timeline(); track $index) {
            @switch (row.kind) {
              @case ('milestone') {
                <li class="flex items-center gap-3 border-t border-ink-100 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <time class="w-16 shrink-0 tabular-nums">{{ row.at | date: 'HH:mm:ss' }}</time>
                  <span>{{ 'CONSULTATION.LOG.MILESTONE.' + row.key | translate }}</span>
                </li>
              }
              @case ('line') {
                <li class="flex gap-3 text-sm">
                  <time class="w-16 shrink-0 tabular-nums text-ink-500">{{ row.at ? (row.at | date: 'HH:mm:ss') : '—' }}</time>
                  <span class="text-ink-900">
                    {{ row.line.text }}
                    @if (row.line.typed) {
                      <span class="ms-1 rounded bg-ink-100 px-1.5 text-xs text-ink-600">{{ 'CONSULTATION.LOG.TYPED' | translate }}</span>
                    }
                  </span>
                </li>
              }
              @case ('command') {
                <li class="ms-16 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm" [attr.data-outcome]="row.command.outcome">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-ink-900">{{ row.text }}</span>
                    <span class="rounded px-1.5 text-xs font-semibold" [class]="outcomeClass(row.command.outcome)">
                      {{ 'CONSULTATION.LOG.OUTCOME.' + row.command.outcome | translate }}
                    </span>
                    @if (row.decision !== 'undecided') {
                      <span class="rounded bg-ink-100 px-1.5 text-xs text-ink-700">{{ 'CONSULTATION.LOG.DECISION.' + row.decision | translate }}</span>
                    }
                  </div>
                  @if (row.command.transcript) {
                    <p class="mt-1 text-xs text-ink-500">« {{ row.command.transcript }} »</p>
                  }
                  @if (row.command.errorMessage) {
                    <p class="mt-1 text-xs text-red-600">{{ row.command.errorMessage }}</p>
                  }
                </li>
              }
            }
          }
        </ol>

        @if (l.reviewed) {
          <section class="mt-5 border-t border-ink-100 pt-4">
            <h3 class="mb-2 text-sm font-bold text-ink-900">{{ 'CONSULTATION.LOG.VALIDATED' | translate }}</h3>
            <dl class="space-y-1 text-sm">
              @if (l.reviewed.chiefComplaint) {
                <div><dt class="inline font-medium">{{ 'CONSULTATION.LOG.V_COMPLAINT' | translate }} : </dt><dd class="inline">{{ l.reviewed.chiefComplaint }}</dd></div>
              }
              @if (l.reviewed.allergies.length) {
                <div><dt class="inline font-medium">{{ 'CONSULTATION.LOG.V_ALLERGIES' | translate }} : </dt><dd class="inline">{{ names(l.reviewed.allergies, 'substance') }}</dd></div>
              }
              @if (l.reviewed.medicalHistory.length) {
                <div><dt class="inline font-medium">{{ 'CONSULTATION.LOG.V_HISTORY' | translate }} : </dt><dd class="inline">{{ names(l.reviewed.medicalHistory, 'label') }}</dd></div>
              }
              @if (l.reviewed.treatmentPlan.length) {
                <div><dt class="inline font-medium">{{ 'CONSULTATION.LOG.V_PLAN' | translate }} : </dt><dd class="inline">{{ names(l.reviewed.treatmentPlan, 'label') }}</dd></div>
              }
              @if (l.reviewed.nextAppointment) {
                <div><dt class="inline font-medium">{{ 'CONSULTATION.LOG.V_APPOINTMENT' | translate }} : </dt><dd class="inline">{{ l.reviewed.nextAppointment.dateTime | date: 'dd/MM/yyyy HH:mm' }}</dd></div>
              }
              @if (l.report) {
                <div><dt class="font-medium">{{ 'CONSULTATION.LOG.V_REPORT' | translate }}</dt><dd class="mt-1 whitespace-pre-line text-ink-700">{{ l.report }}</dd></div>
              }
            </dl>
          </section>
        }
      }
    </app-modal>
  `,
})
export class ConsultationLogComponent {
  private api = inject(ConsultationApiService);
  private translate = inject(TranslateService);

  /** The consultation to show; null keeps the dialog closed. */
  readonly consultationId = input<string | null>(null);
  readonly closed = output<void>();

  readonly log = signal<ConsultationLogDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);

  readonly timeline = computed<TimelineRow[]>(() => {
    const l = this.log();
    if (!l) return [];
    return buildTimeline(l, spokenLanguage(l.locale ?? this.translate.currentLang ?? 'fr'),
      this.translate.instant('CONSULTATION.DOC.TOOTH'));
  });

  constructor() {
    effect(() => {
      const id = this.consultationId();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string | null): Promise<void> {
    this.log.set(null);
    this.error.set(false);
    if (!id) return;
    this.loading.set(true);
    try {
      const loaded = await firstValueFrom(this.api.log(id));
      // A slower answer for a consultation closed meanwhile must not show over the next one.
      if (this.consultationId() === id) this.log.set(loaded);
    } catch {
      if (this.consultationId() === id) this.error.set(true);
    } finally {
      if (this.consultationId() === id) this.loading.set(false);
    }
  }

  names<T extends object>(items: T[], key: keyof T): string {
    return items.map(item => String(item[key])).join(', ');
  }

  outcomeClass(outcome: string): string {
    switch (outcome) {
      case 'EXECUTED': return 'bg-green-100 text-green-800';
      case 'FAILED': return 'bg-red-100 text-red-800';
      default: return 'bg-ink-100 text-ink-700';
    }
  }
}
