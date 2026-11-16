import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PATIENT_FILE_TYPES, PatientFile, PatientFilesApi } from '../../../core/services/patient-files-api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { MODEL_EXTENSIONS, ModelType, hasModelExtension, isModel, modelLabel } from './scan-model';
import { ScanViewerComponent } from './scan-viewer.component';

/** What is open full screen: a picture, or a 3D file in the viewer. */
type Viewing = { name: string; url: string; type: null } | { name: string; blob: Blob; type: ModelType };

/**
 * Under the X-ray and the scan: whatever else the doctor wants on the patient's file,
 * pictures or 3D files (a wax-up, an appliance, a photo). Each is a patient document of
 * the type Image, so it is also listed in Documents.
 */
@Component({
  selector: 'app-patient-gallery',
  standalone: true,
  imports: [DatePipe, TranslateModule, ScanViewerComponent],
  template: `
    <section class="pg" aria-labelledby="pg-title">
      <header class="pg-head">
        <h2 id="pg-title">{{ 'PFILES.GALLERY_TITLE' | translate }}</h2>
        @if (files().length) { <span class="pg-count">{{ files().length }}</span> }
      </header>
      <ul class="pg-grid">
        @for (f of files(); track f.id) {
          <li class="pg-tile">
            @if (modelOf(f); as type) {
              <button type="button" class="pg-open pg-model" (click)="openModel(f, type)"
                      [attr.aria-label]="('PFILES.OPEN_MODEL' | translate) + ' ' + f.name">
                <span class="material-icons" aria-hidden="true">view_in_ar</span>
                <span class="pg-format">{{ label(type) }}</span>
              </button>
            } @else {
              <button type="button" class="pg-open" (click)="openPicture(f)" [attr.aria-label]="'PFILES.OPEN_IMAGE' | translate: { name: f.name }">
                @if (urls().get(f.id); as url) { <img [src]="url" alt="" loading="lazy" /> }
              </button>
            }
            <div class="pg-meta">
              <span class="pg-name" [title]="f.name">{{ f.name }}</span>
              <span class="pg-date">{{ f.createdAt | date:'mediumDate' }}</span>
            </div>
            @if (canWrite()) {
              <button type="button" class="pg-delete" (click)="remove(f)"
                      [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + f.name" [title]="'COMMON.DELETE' | translate">
                <span class="material-icons" aria-hidden="true">delete</span>
              </button>
            }
          </li>
        }
        @if (canWrite()) {
          <li class="pg-tile pg-add-tile">
            <label class="pg-add" [class.busy]="uploading()">
              <span class="material-icons" aria-hidden="true">{{ uploading() ? 'hourglass_top' : 'add' }}</span>
              <strong>{{ (uploading() ? 'PFILES.UPLOADING' : 'PFILES.ADD_ELEMENT') | translate }}</strong>
              <small>{{ 'PFILES.ADD_HINT' | translate }}</small>
              <input type="file" class="sr-only" multiple [accept]="accept" [disabled]="uploading()" (change)="onPick($event)" />
            </label>
          </li>
        }
      </ul>
      @if (!files().length && !loading()) {
        <p class="pg-empty">{{ (canWrite() ? 'PFILES.GALLERY_EMPTY' : 'PFILES.GALLERY_EMPTY_READ') | translate }}</p>
      }
    </section>

    @if (viewing(); as v) {
      <div class="pg-overlay" role="dialog" aria-modal="true" [attr.aria-label]="v.name" (keydown.escape)="close()">
        @if (v.type) {
          <app-scan-viewer class="pg-viewer" [blob]="v.blob" [type]="v.type" />
        } @else {
          <img class="pg-full" [src]="v.url" [alt]="v.name" />
        }
        <button #closeBtn type="button" class="btn btn-secondary btn-sm pg-close" (click)="close()">{{ 'COMMON.CLOSE' | translate }}</button>
        <p class="pg-caption">{{ v.name }}</p>
      </div>
    }
  `,
  styles: [`
    .pg { margin-top: 1rem; }
    .pg-head { display: flex; align-items: baseline; gap: .5rem; margin-bottom: .5rem; }
    .pg-head h2 { margin: 0; font-size: .9375rem; font-weight: 700; color: rgb(var(--ink-900)); }
    .pg-count { font-size: .75rem; font-weight: 600; color: rgb(var(--ink-500)); }
    .pg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: .75rem; margin: 0; padding: 0; list-style: none; }
    .pg-tile { position: relative; display: flex; flex-direction: column; overflow: hidden; border-radius: .75rem;
      border: 1px solid rgb(var(--ink-200)); background: var(--surface); }
    .pg-open { display: grid; place-items: center; aspect-ratio: 4 / 3; width: 100%; padding: 0; border: 0; cursor: zoom-in;
      background: rgb(var(--ink-50)); overflow: hidden; }
    .pg-open img { width: 100%; height: 100%; object-fit: cover; }
    .pg-open:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
    .pg-model { cursor: pointer; background: radial-gradient(ellipse at center, #26343a 0%, #10181b 100%); color: #d6dfe1; gap: .125rem; align-content: center; }
    .pg-model .material-icons { font-size: 2.25rem; }
    .pg-format { font-size: .75rem; font-weight: 700; letter-spacing: .04em; }
    .pg-meta { display: flex; flex-direction: column; gap: .0625rem; padding: .375rem .5rem .5rem; min-width: 0; }
    .pg-name { font-size: .75rem; color: rgb(var(--ink-700)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pg-date { font-size: .6875rem; color: rgb(var(--ink-500)); }
    .pg-delete { position: absolute; top: .375rem; inset-inline-end: .375rem; display: grid; place-items: center; width: 1.875rem; height: 1.875rem;
      border: 0; border-radius: .5rem; background: rgb(255 255 255 / .92); color: rgb(var(--critical-700)); cursor: pointer;
      opacity: 0; transition: opacity .15s; box-shadow: 0 1px 3px rgb(0 0 0 / .2); }
    .pg-delete .material-icons { font-size: 1.0625rem; }
    .pg-tile:hover .pg-delete, .pg-delete:focus-visible { opacity: 1; }
    @media (hover: none) { .pg-delete { opacity: 1; } }
    .pg-add-tile { border-style: dashed; border-width: 2px; border-color: rgb(var(--ink-300)); background: transparent; }
    .pg-add { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: .125rem; min-height: 9.5rem;
      padding: .75rem; text-align: center; color: rgb(var(--petrol-700)); cursor: pointer; }
    .pg-add:hover { background: rgb(var(--petrol-50)); }
    .pg-add:focus-within { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
    .pg-add .material-icons { font-size: 2rem; }
    .pg-add strong { font-size: .875rem; }
    .pg-add small { font-size: .75rem; color: rgb(var(--ink-500)); }
    .pg-add.busy { cursor: progress; opacity: .7; }
    .pg-empty { margin: .5rem 0 0; font-size: .8125rem; color: rgb(var(--ink-500)); }
    .pg-overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 3.5rem 1rem 2.5rem; background: rgb(0 0 0 / .9); }
    .pg-full { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: .25rem; }
    .pg-viewer { position: absolute; inset: 1rem; width: auto; height: auto; }
    .pg-close { position: absolute; top: 1.25rem; inset-inline-start: 1.25rem; z-index: 1; }
    .pg-caption { position: absolute; bottom: .75rem; inset-inline: 1rem; margin: 0; text-align: center; color: #d6dfe1; font-size: .8125rem; }
  `],
})
export class PatientGalleryComponent implements OnDestroy {
  readonly patientId = input.required<string>();

  private readonly api = inject(PatientFilesApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  readonly accept = [...PATIENT_FILE_TYPES, ...MODEL_EXTENSIONS].join(',');
  readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));
  readonly files = signal<PatientFile[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  readonly viewing = signal<Viewing | null>(null);
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const id = this.patientId();
      this.api.version();
      untracked(() => void this.load(id));
    });
    // The overlay takes focus when it opens, so Escape and Tab start from inside it.
    effect(() => this.closeBtn()?.nativeElement.focus());
  }

  private async load(patientId: string): Promise<void> {
    try {
      const list = (await this.api.list(patientId)).filter(
        (f) => (f.category ?? 'IMAGE') === 'IMAGE' && (f.contentType.startsWith('image/') || isModel(f.contentType)),
      );
      this.files.set(list);
      for (const f of list) if (!isModel(f.contentType)) void this.fetch(f.id);
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
    // A 3D file's type is often blank in the browser: its extension says what it is, and the server checks the bytes.
    const bad = picked.filter((f) => !(PATIENT_FILE_TYPES as readonly string[]).includes(f.type) && !hasModelExtension(f.name));
    if (bad.length) {
      this.toast.error(this.translate.instant('PFILES.WRONG_TYPE_3D'));
      return;
    }
    this.uploading.set(true);
    try {
      for (const file of picked) await this.api.upload(this.patientId(), 'IMAGE', file);
      this.toast.success(this.translate.instant('PFILES.UPLOADED', { count: picked.length }));
    } catch {
      this.toast.error(this.translate.instant('PFILES.UPLOAD_FAILED'));
    } finally {
      this.uploading.set(false);
    }
  }

  modelOf(f: PatientFile): ModelType | null {
    return isModel(f.contentType) ? f.contentType : null;
  }

  label(type: ModelType): string {
    return modelLabel(type);
  }

  openPicture(f: PatientFile): void {
    const url = this.urls().get(f.id);
    if (!url) return;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.viewing.set({ name: f.name, url, type: null });
  }

  async openModel(f: PatientFile, type: ModelType): Promise<void> {
    this.returnFocus = document.activeElement as HTMLElement | null;
    try {
      this.viewing.set({ name: f.name, blob: await this.api.blob(f.id), type });
    } catch {
      this.toast.error(this.translate.instant('PFILES.MODEL_FAILED'));
    }
  }

  close(): void {
    this.viewing.set(null);
    this.returnFocus?.focus();
    this.returnFocus = null;
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
