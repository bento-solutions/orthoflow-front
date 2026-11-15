import { Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  DOCUMENT_CATEGORIES, DocumentCategory, PATIENT_FILE_TYPES, PatientFile, PatientFilesApi,
} from '../../../core/services/patient-files-api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { IconComponent } from '../../../shared/ui/icon.component';

/**
 * The patient's uploaded pictures, each with a type: X-ray, 3D intraoral scan or other
 * image. The latest X-ray and intraoral scan are what the overview shows beside the 3D chart.
 */
@Component({
  selector: 'app-patient-files',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent],
  template: `
    <section class="card p-4" aria-labelledby="pf-title">
      <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="pf-title" class="section-title !mb-0">{{ 'PFILES.TITLE' | translate }}</h2>
        @if (canWrite()) {
          <div class="flex flex-wrap items-center gap-2">
            <label class="sr-only" for="pf-category">{{ 'PFILES.TYPE' | translate }}</label>
            <select id="pf-category" class="select !w-auto" [ngModel]="category()" (ngModelChange)="category.set($event)">
              @for (c of categories; track c) { <option [value]="c">{{ 'PFILES.CAT.' + c | translate }}</option> }
            </select>
            <label class="btn btn-primary btn-sm cursor-pointer" [class.opacity-60]="uploading()">
              <app-icon name="upload" [size]="14" />
              {{ (uploading() ? 'PFILES.UPLOADING' : 'PFILES.UPLOAD') | translate }}
              <input type="file" class="sr-only" multiple [accept]="accept" [disabled]="uploading()" (change)="onPick($event)" />
            </label>
          </div>
        }
      </header>

      <div class="mb-3 flex flex-wrap gap-1.5" role="group" [attr.aria-label]="'PFILES.FILTER' | translate">
        <button type="button" class="pill pill-nodot pill-round" [class.pill-active]="filter() === null" [class.pill-idle]="filter() !== null"
          [attr.aria-pressed]="filter() === null" (click)="filter.set(null)">{{ 'PFILES.ALL' | translate }} · {{ files().length }}</button>
        @for (c of categories; track c) {
          <button type="button" class="pill pill-nodot pill-round" [class.pill-active]="filter() === c" [class.pill-idle]="filter() !== c"
            [attr.aria-pressed]="filter() === c" (click)="filter.set(c)">{{ 'PFILES.CAT.' + c | translate }} · {{ count(c) }}</button>
        }
      </div>

      @if (loading()) {
        <p class="text-sm text-ink-500">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (!shown().length) {
        <p class="text-sm text-ink-500">{{ 'PFILES.EMPTY' | translate }}</p>
      } @else {
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          @for (f of shown(); track f.id) {
            <li class="group relative overflow-hidden rounded-lg border border-ink-200 bg-surface">
              <a class="block aspect-[4/3] bg-ink-50" [href]="urls().get(f.id) ?? null" target="_blank" rel="noopener"
                 [attr.aria-label]="f.name">
                @if (urls().get(f.id); as url) {
                  <img [src]="url" [alt]="f.name" class="h-full w-full object-cover" loading="lazy" />
                }
              </a>
              <div class="flex items-start justify-between gap-1 p-2">
                <div class="min-w-0">
                  <span class="pill pill-nodot" [class.pill-active]="f.category === 'XRAY'" [class.pill-done]="f.category === 'INTRAORAL_3D'" [class.pill-idle]="f.category !== 'XRAY' && f.category !== 'INTRAORAL_3D'">
                    {{ 'PFILES.CAT.' + (f.category ?? 'IMAGE') | translate }}
                  </span>
                  <p class="mt-1 truncate text-xs text-ink-600" [title]="f.name">{{ f.name }}</p>
                  <p class="text-2xs text-ink-500">{{ f.createdAt | date:'mediumDate' }}</p>
                </div>
                @if (canWrite()) {
                  <button type="button" class="btn btn-ghost btn-icon btn-sm shrink-0 text-critical-700" (click)="remove(f)"
                    [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + f.name" [title]="'COMMON.DELETE' | translate">
                    <app-icon name="trash" [size]="14" />
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class PatientFilesComponent implements OnDestroy {
  readonly patientId = input.required<string>();

  private readonly api = inject(PatientFilesApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  readonly categories = DOCUMENT_CATEGORIES;
  readonly accept = PATIENT_FILE_TYPES.join(',');
  readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));

  readonly files = signal<PatientFile[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly category = signal<DocumentCategory>('XRAY');
  readonly filter = signal<DocumentCategory | null>(null);
  readonly urls = signal<ReadonlyMap<string, string>>(new Map());

  readonly shown = computed(() => {
    const f = this.filter();
    return f ? this.files().filter((x) => (x.category ?? 'IMAGE') === f) : this.files();
  });

  constructor() {
    effect(() => {
      const id = this.patientId();
      this.api.version();
      untracked(() => void this.load(id));
    });
  }

  count(c: DocumentCategory): number {
    return this.files().filter((x) => (x.category ?? 'IMAGE') === c).length;
  }

  private async load(patientId: string): Promise<void> {
    try {
      const list = (await this.api.list(patientId)).filter((f) => f.contentType.startsWith('image/'));
      this.files.set(list);
      for (const f of list) void this.fetch(f.id);
    } catch {
      this.toast.error(this.translate.instant('PFILES.LOAD_FAILED'));
    } finally {
      this.loading.set(false);
    }
  }

  private async fetch(id: string): Promise<void> {
    if (this.urls().has(id)) return;
    try {
      const url = URL.createObjectURL(await this.api.blob(id));
      this.urls.update((m) => new Map(m).set(id, url));
    } catch { /* the tile stays blank */ }
  }

  async onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (!picked.length) return;
    const bad = picked.filter((f) => !(PATIENT_FILE_TYPES as readonly string[]).includes(f.type));
    if (bad.length) {
      this.toast.error(this.translate.instant('PFILES.WRONG_TYPE'));
      return;
    }
    this.uploading.set(true);
    try {
      for (const file of picked) await this.api.upload(this.patientId(), this.category(), file);
      this.toast.success(this.translate.instant('PFILES.UPLOADED', { count: picked.length }));
    } catch {
      this.toast.error(this.translate.instant('PFILES.UPLOAD_FAILED'));
    } finally {
      this.uploading.set(false);
    }
  }

  async remove(f: PatientFile): Promise<void> {
    const ok = await this.confirm.confirm(this.translate.instant('PFILES.DELETE_CONFIRM', { name: f.name }), { danger: true });
    if (!ok) return;
    try {
      await this.api.delete(f.id);
    } catch {
      this.toast.error(this.translate.instant('PFILES.DELETE_FAILED'));
    }
  }

  ngOnDestroy(): void {
    for (const url of this.urls().values()) URL.revokeObjectURL(url);
  }
}
