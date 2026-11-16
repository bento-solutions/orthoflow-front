import { IconComponent } from '../../ui/icon.component';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ConsultationApiService } from '../../../core/consultation/consultation-api.service';
import { ConsultationDto } from '../../../core/consultation/consultation.model';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConsultationAudioPlayerComponent } from './consultation-audio-player.component';
import { ConsultationLogComponent } from './consultation-log.component';
import { AppDatePipe } from '../../pipes/app-date.pipe';

/** How long a consultation lasted, in whole minutes, from its recording or else from its start and end. */
export function consultationMinutes(c: Pick<ConsultationDto, 'audio' | 'startedAt' | 'endedAt'>): number | null {
  if (c.audio?.durationMs) return Math.max(1, Math.round(c.audio.durationMs / 60_000));
  if (!c.endedAt) return null;
  const ms = Date.parse(c.endedAt) - Date.parse(c.startedAt);
  return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : null;
}

/**
 * The patient's recorded consultations in the Documents tab: for each, its timestamped
 * transcript (the consultation log) and its audio, so the doctor can check, long after
 * validating, what was said and what became of it. Shown to whoever may open consultations
 * (the server answers DOCTOR and ADMIN only).
 */
@Component({
  selector: 'app-consultation-records',
  standalone: true,
  imports: [IconComponent, AppDatePipe, TranslateModule, ConsultationAudioPlayerComponent, ConsultationLogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (c.available()) {
      <section class="card p-4" aria-labelledby="consultations-title" data-consultation-records>
        <header class="mb-3">
          <h2 id="consultations-title" class="section-title !mb-0">{{ 'CONSULTATION.DOCS_TITLE' | translate }}</h2>
          <p class="text-sm text-ink-600">{{ 'CONSULTATION.DOCS_HINT' | translate }}</p>
        </header>
        @if (consultations().length === 0) {
          <p class="text-sm text-ink-500">{{ 'CONSULTATION.DOCS_EMPTY' | translate }}</p>
        } @else {
          <ul class="divide-y divide-ink-100">
            @for (item of consultations(); track item.id) {
              <li class="flex flex-col gap-2 py-3" [attr.data-consultation]="item.id">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p class="font-semibold text-ink-900">{{ item.startedAt | appDate:'datetime' }}</p>
                  <span class="pill {{ item.status === 'COMPLETED' ? 'pill-ok' : 'pill-attention' }}">{{ statusKey(item) | translate }}</span>
                  @if (item.mode) {
                    <span class="pill pill-idle">{{ (item.mode === 'DEFERRED' ? 'CONSULTATION.MODE_LABEL_DEFERRED' : 'CONSULTATION.MODE_LABEL_LIVE') | translate }}</span>
                  }
                  @if (minutes(item); as m) { <span class="text-sm text-ink-600">{{ m }} min</span> }
                  <span class="ms-auto flex flex-wrap gap-1">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="openLog.set(item.id)" data-open-log>
                      <app-icon class="mi text-base" name="subject" size="1em" />{{ 'CONSULTATION.DOCS_LOG' | translate }}
                    </button>
                    @if (item.audio) {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="download(item)">
                        <app-icon class="mi text-base" name="download" size="1em" />{{ 'CONSULTATION.DOCS_DOWNLOAD' | translate }}
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="deleteAudio(item)">
                        {{ 'CONSULTATION.DOCS_DELETE_AUDIO' | translate }}
                      </button>
                    }
                  </span>
                </div>
                @if (item.audio) {
                  <app-consultation-audio-player [consultationId]="item.id" [audio]="item.audio" />
                } @else {
                  <p class="text-xs text-ink-500">{{ 'CONSULTATION.DOCS_NO_AUDIO' | translate }}</p>
                }
              </li>
            }
          </ul>
        }
      </section>
      <app-consultation-log [consultationId]="openLog()" (closed)="openLog.set(null)" />
    }
  `,
})
export class ConsultationRecordsComponent {
  protected readonly c = inject(ConsultationService);
  private api = inject(ConsultationApiService);
  private confirm = inject(ConfirmDialogService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);

  readonly patientId = input.required<string>();

  protected readonly all = signal<ConsultationDto[]>([]);
  /** Saved ones and those waiting to be validated; one still recording is the dossier's, not a document yet. */
  protected readonly consultations = computed(() => this.all().filter(item => item.status === 'COMPLETED' || item.status === 'REVIEW'));
  protected readonly openLog = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.patientId();
      // A consultation saved in this dossier shows up here without a reload.
      this.c.savedVersion();
      untracked(() => void this.load(id));
    });
  }

  async load(patientId = this.patientId()): Promise<void> {
    await this.c.loadConfig();
    if (!this.c.available()) return;
    try {
      const list = await firstValueFrom(this.api.list(patientId));
      if (this.patientId() === patientId) this.all.set(list ?? []);
    } catch {
      this.all.set([]);
    }
  }

  protected minutes(item: ConsultationDto): number | null {
    return consultationMinutes(item);
  }

  protected statusKey(item: ConsultationDto): string {
    return item.status === 'COMPLETED' ? 'CONSULTATION.DOCS_STATUS_COMPLETED'
      : item.status === 'REVIEW' ? 'CONSULTATION.DOCS_STATUS_REVIEW' : 'CONSULTATION.DOCS_STATUS_RECORDING';
  }

  protected async download(item: ConsultationDto): Promise<void> {
    try {
      const blob = await firstValueFrom(this.api.audio(item.id));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : blob.type.includes('wav') ? 'wav' : 'webm';
      link.href = url;
      link.download = `consultation-${item.startedAt.slice(0, 16).replace(/[:T]/g, '-')}.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      this.toast.error(this.translate.instant('CONSULTATION.DOCS_LOAD_FAILED'));
    }
  }

  protected async deleteAudio(item: ConsultationDto): Promise<void> {
    const confirmed = await this.confirm.confirm(this.translate.instant('CONSULTATION.DOCS_DELETE_AUDIO_CONFIRM'), {
      title: this.translate.instant('CONSULTATION.DOCS_DELETE_AUDIO'),
      confirmLabel: this.translate.instant('CONSULTATION.DOCS_DELETE_AUDIO'),
      cancelLabel: this.translate.instant('COMMON.CANCEL'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.deleteAudio(item.id));
      this.all.update(list => list.map(c => c.id === item.id ? { ...c, audio: null } : c));
    } catch {
      this.toast.error(this.translate.instant('CONSULTATION.DOCS_LOAD_FAILED'));
    }
  }
}
