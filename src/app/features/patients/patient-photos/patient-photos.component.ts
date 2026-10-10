import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ClinicalPhotoApi, PHOTO_STAGES, PhotoSeries, PhotoStage, PhotoView,
} from '../../../core/services/clinical-photo-api.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';

interface ViewSlot {
  view: PhotoView;
  /** The guide drawing in public/photo-guides, shown until a picture is added. */
  guide: string;
  /** Radiographs are wide; the rest are framed in a circle like the usual photo collage. */
  wide?: boolean;
  /** Grid column for the occlusal row, which leaves the middle empty as a printed collage does. */
  column?: number;
}

interface ViewGroup {
  key: string;
  slots: ViewSlot[];
}

/** The standard orthodontic record, in the order a clinical collage lays it out. */
export const VIEW_GROUPS: readonly ViewGroup[] = [
  {
    key: 'EXTRA_ORAL',
    slots: [
      { view: 'SMILE', guide: 'smile' },
      { view: 'FACE_AT_REST', guide: 'face-at-rest' },
      { view: 'PROFILE', guide: 'profile' },
    ],
  },
  {
    key: 'INTRA_ORAL',
    slots: [
      { view: 'UPPER_OCCLUSAL', guide: 'upper-occlusal', column: 1 },
      { view: 'LOWER_OCCLUSAL', guide: 'lower-occlusal', column: 3 },
      { view: 'LEFT_LATERAL', guide: 'left-lateral' },
      { view: 'FRONTAL_OCCLUSION', guide: 'frontal-occlusion' },
      { view: 'RIGHT_LATERAL', guide: 'right-lateral' },
    ],
  },
  {
    key: 'RADIOGRAPHS',
    slots: [
      { view: 'PANORAMIC_XRAY', guide: 'panoramic-xray', wide: true },
      { view: 'LATERAL_CEPHALOGRAM', guide: 'lateral-cephalogram', wide: true },
    ],
  },
];

const ALL_SLOTS = VIEW_GROUPS.flatMap(g => g.slots);
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The patient's photo record in the dossier: a series per sitting (initial records, progress,
 * end of treatment), each with the eight standard photos and the two radiographs, and a
 * side-by-side view to set one sitting against another.
 */
@Component({
  selector: 'app-patient-photos',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'lightbox.set(null)' },
  template: `
    <section class="photos">
      <header class="photos-head">
        <div>
          <h2>{{ 'PATIENTS.PHOTOS.TITLE' | translate }}</h2>
          <p class="photos-sub">{{ 'PATIENTS.PHOTOS.SUBTITLE' | translate }}</p>
        </div>
        @if (series().length) {
          <div class="head-actions">
            @if (series().length > 1) {
              <button type="button" class="btn btn-secondary btn-sm" [class.is-on]="comparing()"
                      [attr.aria-pressed]="comparing()" (click)="toggleCompare()">
                <span class="material-icons" aria-hidden="true">compare</span>
                {{ 'PATIENTS.PHOTOS.COMPARE' | translate }}
              </button>
            }
            @if (canWrite()) {
              <button type="button" class="btn btn-primary btn-sm" (click)="openForm(null)">
                <span class="material-icons" aria-hidden="true">add_a_photo</span>
                {{ 'PATIENTS.PHOTOS.NEW_SERIES' | translate }}
              </button>
            }
          </div>
        }
      </header>

      @if (formOpen()) {
        <form class="series-form card card-pad" (ngSubmit)="saveSeries()">
          <div class="field">
            <label class="label" for="photo-stage">{{ 'PATIENTS.PHOTOS.STAGE' | translate }}</label>
            <select id="photo-stage" class="select" name="stage" [(ngModel)]="form.stage">
              @for (stage of stages; track stage) {
                <option [value]="stage">{{ 'PATIENTS.PHOTOS.STAGES.' + stage | translate }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label class="label" for="photo-date">{{ 'PATIENTS.PHOTOS.TAKEN_ON' | translate }}</label>
            <input id="photo-date" class="input" type="date" name="takenOn" required [(ngModel)]="form.takenOn" />
          </div>
          <div class="field field-note">
            <label class="label" for="photo-note">{{ 'PATIENTS.PHOTOS.NOTE' | translate }}</label>
            <input id="photo-note" class="input" type="text" name="note" maxlength="2000" [(ngModel)]="form.note"
                   [placeholder]="'PATIENTS.PHOTOS.NOTE_PLACEHOLDER' | translate" />
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost btn-sm" (click)="formOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
            <button type="submit" class="btn btn-primary btn-sm" [disabled]="!form.takenOn || saving()">{{ 'COMMON.SAVE' | translate }}</button>
          </div>
        </form>
      }

      @if (loading()) {
        <p class="photos-sub">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (!series().length) {
        <div class="empty">
          <span class="material-icons empty-icon" aria-hidden="true">photo_camera</span>
          <p class="empty-title">{{ 'PATIENTS.PHOTOS.EMPTY_TITLE' | translate }}</p>
          <p class="empty-text">{{ 'PATIENTS.PHOTOS.EMPTY_TEXT' | translate }}</p>
          @if (canWrite()) {
            <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="startInitial()">
              <span class="material-icons" aria-hidden="true">add_a_photo</span>
              {{ 'PATIENTS.PHOTOS.START_INITIAL' | translate }}
            </button>
          }
        </div>
      } @else {
        <!-- One chip per sitting, the most recent first. -->
        <div class="series-strip" role="tablist" [attr.aria-label]="'PATIENTS.PHOTOS.SERIES' | translate">
          @for (s of series(); track s.id) {
            <button type="button" role="tab" class="series-chip" [class.active]="s.id === selectedId()"
                    [attr.aria-selected]="s.id === selectedId()" (click)="select(s.id)">
              <span class="chip-stage">{{ 'PATIENTS.PHOTOS.STAGES.' + s.stage | translate }}</span>
              <span class="chip-date">{{ s.takenOn | date:'mediumDate' }}</span>
              <span class="chip-count">{{ s.photos.length }}/{{ totalViews }}</span>
            </button>
          }
        </div>

        @if (selected(); as current) {
          @if (comparing()) {
            <div class="compare-bar">
              <span>{{ 'PATIENTS.PHOTOS.COMPARE_WITH' | translate }}</span>
              <select class="select" [ngModel]="compareId()" (ngModelChange)="setCompare($event)" name="compareWith"
                      [attr.aria-label]="'PATIENTS.PHOTOS.COMPARE_WITH' | translate">
                @for (s of otherSeries(); track s.id) {
                  <option [value]="s.id">{{ 'PATIENTS.PHOTOS.STAGES.' + s.stage | translate }} · {{ s.takenOn | date:'mediumDate' }}</option>
                }
              </select>
            </div>
            @if (compared(); as other) {
              <div class="compare-grid">
                <div class="compare-head">{{ 'PATIENTS.PHOTOS.STAGES.' + other.stage | translate }} · {{ other.takenOn | date:'mediumDate' }}</div>
                <div class="compare-head">{{ 'PATIENTS.PHOTOS.STAGES.' + current.stage | translate }} · {{ current.takenOn | date:'mediumDate' }}</div>
                @for (slot of comparedSlots(); track slot.view) {
                  <div class="compare-label">{{ 'PATIENTS.PHOTOS.VIEWS.' + slot.view | translate }}</div>
                  @for (s of [other, current]; track s.id) {
                    <div class="compare-cell" [class.wide]="slot.wide">
                      @if (urlFor(s, slot.view); as url) {
                        <button type="button" class="compare-img" (click)="openLightbox(url, slot.view, s)">
                          <img [src]="url" [alt]="'PATIENTS.PHOTOS.VIEWS.' + slot.view | translate" />
                        </button>
                      } @else {
                        <span class="compare-missing">{{ 'PATIENTS.PHOTOS.NO_PICTURE' | translate }}</span>
                      }
                    </div>
                  }
                }
              </div>
            }
          } @else {
            <div class="series-meta">
              <span class="meta-progress" [class.complete]="current.photos.length === totalViews">
                <span class="material-icons" aria-hidden="true">{{ current.photos.length === totalViews ? 'task_alt' : 'photo_library' }}</span>
                {{ 'PATIENTS.PHOTOS.PROGRESS' | translate: { done: current.photos.length, total: totalViews } }}
              </span>
              @if (current.note) { <span class="meta-note">{{ current.note }}</span> }
              @if (canWrite()) {
                <span class="meta-actions">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="openForm(current)">
                    <span class="material-icons" aria-hidden="true">edit</span>{{ 'PATIENTS.PHOTOS.EDIT_SERIES' | translate }}
                  </button>
                  <button type="button" class="btn btn-danger-ghost btn-sm" (click)="deleteSeries(current)">
                    <span class="material-icons" aria-hidden="true">delete</span>{{ 'PATIENTS.PHOTOS.DELETE_SERIES' | translate }}
                  </button>
                </span>
              }
            </div>

            @for (group of groups; track group.key) {
              <h3 class="group-title">{{ 'PATIENTS.PHOTOS.GROUPS.' + group.key | translate }}</h3>
              <div class="slot-grid" [class.wide-grid]="group.key === 'RADIOGRAPHS'">
                @for (slot of group.slots; track slot.view) {
                  <div class="slot" [style.grid-column]="slot.column ?? null"
                       [class.dragging]="dragOver() === slot.view"
                       (dragover)="onDragOver($event, slot.view)" (dragleave)="dragOver.set(null)"
                       (drop)="onDrop($event, slot.view)">
                    <span class="slot-label">{{ 'PATIENTS.PHOTOS.VIEWS.' + slot.view | translate }}</span>
                    <div class="frame" [class.wide]="slot.wide" [class.filled]="!!urlFor(current, slot.view)">
                      @if (urlFor(current, slot.view); as url) {
                        <button type="button" class="frame-btn" (click)="openLightbox(url, slot.view, current)"
                                [attr.aria-label]="('PATIENTS.PHOTOS.ENLARGE' | translate) + ' ' + ('PATIENTS.PHOTOS.VIEWS.' + slot.view | translate)">
                          <img [src]="url" [alt]="'PATIENTS.PHOTOS.VIEWS.' + slot.view | translate" />
                        </button>
                      } @else if (hasPhoto(current, slot.view)) {
                        <span class="frame-loading" aria-hidden="true"></span>
                      } @else {
                        <img class="guide" [src]="'photo-guides/' + slot.guide + '.svg'" alt="" />
                      }
                      @if (busy().has(slot.view)) {
                        <span class="frame-busy" role="status">
                          <span class="spinner" aria-hidden="true"></span>
                          <span class="sr-only">{{ 'PATIENTS.PHOTOS.UPLOADING' | translate }}</span>
                        </span>
                      }
                    </div>
                    @if (canWrite()) {
                      <div class="slot-actions">
                        <label class="btn btn-secondary btn-sm file-btn" [class.disabled]="busy().has(slot.view)">
                          <span class="material-icons" aria-hidden="true">{{ hasPhoto(current, slot.view) ? 'sync' : 'upload' }}</span>
                          {{ (hasPhoto(current, slot.view) ? 'PATIENTS.PHOTOS.REPLACE' : 'PATIENTS.PHOTOS.CHOOSE_FILE') | translate }}
                          <input type="file" class="sr-only" [accept]="accept" [disabled]="busy().has(slot.view)"
                                 (change)="onPick($event, slot.view)" />
                        </label>
                        @if (hasPhoto(current, slot.view)) {
                          <button type="button" class="btn btn-ghost btn-sm btn-icon" (click)="removePhoto(current, slot.view)"
                                  [attr.aria-label]="('PATIENTS.PHOTOS.REMOVE' | translate) + ' ' + ('PATIENTS.PHOTOS.VIEWS.' + slot.view | translate)"
                                  [title]="'PATIENTS.PHOTOS.REMOVE' | translate">
                            <span class="material-icons" aria-hidden="true">delete</span>
                          </button>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
            @if (canWrite()) {
              <p class="drop-hint">{{ 'PATIENTS.PHOTOS.DROP_HINT' | translate }}</p>
            }
          }
        }
      }
    </section>

    @if (lightbox(); as box) {
      <div class="lightbox" role="dialog" aria-modal="true" [attr.aria-label]="box.label" (click)="lightbox.set(null)">
        <figure (click)="$event.stopPropagation()">
          <img [src]="box.url" [alt]="box.label" />
          <figcaption>{{ box.label }} · {{ box.caption }}</figcaption>
        </figure>
        <button type="button" class="lightbox-close btn btn-secondary btn-icon" (click)="lightbox.set(null)"
                [attr.aria-label]="'COMMON.CLOSE' | translate">
          <span class="material-icons" aria-hidden="true">close</span>
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .photos { display: flex; flex-direction: column; gap: 1rem; }
    .photos-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    .photos-head h2 { margin: 0; font-size: var(--text-lg, 1.125rem); font-weight: 700; color: var(--text); }
    .photos-sub { margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.875rem; max-width: 60ch; }
    .head-actions { display: flex; gap: 0.5rem; }
    .head-actions .is-on { background: var(--action-tint); border-color: var(--action-border); color: var(--action-text); }
    .btn .material-icons { font-size: 1.1rem; }

    .series-form { display: grid; grid-template-columns: 1fr 1fr 2fr auto; gap: 0.75rem; align-items: end; }
    .form-actions { display: flex; gap: 0.5rem; }
    @media (max-width: 760px) { .series-form { grid-template-columns: 1fr 1fr; } .field-note, .form-actions { grid-column: 1 / -1; } }

    .series-strip { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.25rem; }
    .series-chip {
      display: flex; align-items: baseline; gap: 0.5rem; white-space: nowrap;
      padding: 0.5rem 0.875rem; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 0.875rem;
    }
    .series-chip:hover { background: var(--surface-hover); }
    .series-chip.active { border-color: var(--action); background: var(--action-tint); color: var(--action-text); }
    .series-chip:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .chip-stage { font-weight: 700; }
    .chip-date { color: var(--text-muted); }
    .series-chip.active .chip-date { color: inherit; }
    .chip-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; color: var(--text-muted); }

    .series-meta { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .meta-progress { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; font-weight: 600; color: var(--text-muted); }
    .meta-progress .material-icons { font-size: 1.1rem; }
    .meta-progress.complete { color: var(--status-done-text); }
    .meta-note { color: var(--text-muted); font-size: 0.875rem; font-style: italic; }
    .meta-actions { margin-inline-start: auto; display: flex; gap: 0.25rem; }

    .group-title {
      margin: 0.75rem 0 0; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.375rem;
    }
    .slot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem 1rem; }
    .slot-grid.wide-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .slot {
      display: flex; flex-direction: column; align-items: center; gap: 0.625rem;
      padding: 0.75rem; border-radius: 12px; border: 1px dashed transparent; transition: background-color 120ms, border-color 120ms;
    }
    .slot.dragging { border-color: var(--action); background: var(--action-tint); }
    .slot-label { font-weight: 600; font-size: 0.875rem; color: var(--text); text-align: center; }

    .frame {
      position: relative; width: 132px; aspect-ratio: 1; border-radius: 50%; overflow: hidden;
      background: var(--surface-sunken); box-shadow: 0 0 0 1px var(--border);
    }
    .frame.wide { width: 100%; max-width: 360px; aspect-ratio: 2 / 1; border-radius: 12px; }
    .frame img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .frame .guide { opacity: 0.9; }
    .frame.wide.filled img { object-fit: contain; background: #111; }
    .frame-btn { all: unset; display: block; width: 100%; height: 100%; cursor: zoom-in; }
    .frame-btn:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: -3px; }
    .frame-loading, .frame-busy { position: absolute; inset: 0; display: grid; place-items: center; }
    .frame-loading { background: linear-gradient(90deg, var(--surface-sunken), var(--surface-hover), var(--surface-sunken)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
    .frame-busy { background: rgb(0 0 0 / 0.45); }
    .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid rgb(255 255 255 / 0.4); border-top-color: #fff; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .spinner, .frame-loading { animation: none; } }

    .slot-actions { display: flex; align-items: center; gap: 0.25rem; }
    .file-btn { cursor: pointer; }
    .file-btn.disabled { opacity: 0.5; pointer-events: none; }
    .file-btn:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .drop-hint { margin: 0; text-align: center; font-size: 0.8125rem; color: var(--text-muted); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

    @media (max-width: 640px) {
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .slot-grid .slot { grid-column: auto !important; }
      .slot-grid.wide-grid { grid-template-columns: 1fr; }
      .frame { width: 112px; }
    }

    .compare-bar { display: flex; align-items: center; gap: 0.75rem; font-size: 0.875rem; color: var(--text-muted); }
    .compare-bar .select { max-width: 280px; }
    .compare-grid { display: grid; grid-template-columns: minmax(7rem, 10rem) minmax(0, 300px) minmax(0, 300px); gap: 0.5rem 1rem; align-items: center; }
    .compare-head { font-weight: 700; font-size: 0.875rem; text-align: center; color: var(--text); }
    .compare-head:first-child { grid-column: 2; }
    .compare-label { font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); }
    .compare-cell { aspect-ratio: 4 / 3; border-radius: 10px; overflow: hidden; background: var(--surface-sunken); display: grid; place-items: center; }
    .compare-cell.wide { aspect-ratio: 2 / 1; }
    .compare-img { all: unset; width: 100%; height: 100%; cursor: zoom-in; }
    .compare-img img { width: 100%; height: 100%; object-fit: contain; display: block; background: #111; }
    .compare-missing { font-size: 0.75rem; color: var(--text-muted); }

    .lightbox { position: fixed; inset: 0; z-index: 1000; background: rgb(0 0 0 / 0.85); display: grid; place-items: center; padding: 2rem; }
    .lightbox figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; max-width: 100%; max-height: 100%; }
    .lightbox img { max-width: min(92vw, 1400px); max-height: 82vh; object-fit: contain; border-radius: 8px; }
    .lightbox figcaption { color: #fff; font-size: 0.875rem; }
    .lightbox-close { position: absolute; top: 1rem; inset-inline-end: 1rem; }
  `],
})
export class PatientPhotosComponent implements OnDestroy {
  readonly patientId = input.required<string>();

  private readonly api = inject(ClinicalPhotoApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  readonly groups = VIEW_GROUPS;
  readonly totalViews = ALL_SLOTS.length;
  readonly stages = PHOTO_STAGES;
  readonly accept = ACCEPTED.join(',');

  readonly series = signal<PhotoSeries[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly busy = signal<ReadonlySet<PhotoView>>(new Set());
  readonly dragOver = signal<PhotoView | null>(null);
  readonly comparing = signal(false);
  readonly compareId = signal<string | null>(null);
  readonly lightbox = signal<{ url: string; label: string; caption: string } | null>(null);
  readonly formOpen = signal(false);
  /** The series being edited, or null when the form creates one. */
  private editing: PhotoSeries | null = null;
  form: { stage: PhotoStage; takenOn: string; note: string } = { stage: 'INITIAL', takenOn: today(), note: '' };

  /** Object URLs of the pictures fetched so far, by file id. */
  private readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  private readonly fetching = new Set<string>();

  readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));
  readonly selected = computed(() => this.series().find(s => s.id === this.selectedId()) ?? null);
  readonly otherSeries = computed(() => this.series().filter(s => s.id !== this.selectedId()));
  readonly compared = computed(() => this.otherSeries().find(s => s.id === this.compareId()) ?? null);
  /** The views at least one of the two sittings has a picture of; the rest would be two empty boxes. */
  readonly comparedSlots = computed(() => {
    const pair = [this.selected(), this.compared()];
    return ALL_SLOTS.filter(slot => pair.some(s => s?.photos.some(p => p.view === slot.view)));
  });

  constructor() {
    effect(() => {
      const id = this.patientId();
      void this.load(id);
    });
    // Fetch the pictures of whatever is on screen: the selected series, and the one it is compared with.
    effect(() => {
      const shown = [this.selected(), this.comparing() ? this.compared() : null];
      for (const s of shown) {
        s?.photos.forEach(p => void this.fetchImage(p.fileId));
      }
    });
  }

  ngOnDestroy(): void {
    this.urls().forEach(url => URL.revokeObjectURL(url));
  }

  hasPhoto(series: PhotoSeries, view: PhotoView): boolean {
    return series.photos.some(p => p.view === view);
  }

  urlFor(series: PhotoSeries, view: PhotoView): string | null {
    const photo = series.photos.find(p => p.view === view);
    return photo ? this.urls().get(photo.fileId) ?? null : null;
  }

  select(id: string): void {
    this.selectedId.set(id);
    if (this.compareId() === id) {
      this.compareId.set(this.otherSeries()[0]?.id ?? null);
    }
  }

  toggleCompare(): void {
    const on = !this.comparing();
    this.comparing.set(on);
    if (on && !this.compared()) {
      // The natural comparison is with the oldest sitting: the before of this after.
      const others = this.otherSeries();
      this.compareId.set(others[others.length - 1]?.id ?? null);
    }
  }

  setCompare(id: string): void {
    this.compareId.set(id);
  }

  openForm(series: PhotoSeries | null): void {
    this.editing = series;
    this.form = series
      ? { stage: series.stage, takenOn: series.takenOn, note: series.note ?? '' }
      : { stage: this.series().length ? 'PROGRESS' : 'INITIAL', takenOn: today(), note: '' };
    this.formOpen.set(true);
  }

  async startInitial(): Promise<void> {
    this.editing = null;
    this.form = { stage: 'INITIAL', takenOn: today(), note: '' };
    await this.saveSeries();
  }

  async saveSeries(): Promise<void> {
    if (!this.form.takenOn || this.saving()) return;
    this.saving.set(true);
    const body = { stage: this.form.stage, takenOn: this.form.takenOn, note: this.form.note.trim() || undefined };
    try {
      const saved = this.editing
        ? await this.api.update(this.editing.id, body)
        : await this.api.create(this.patientId(), body);
      this.replace(saved);
      this.selectedId.set(saved.id);
      this.formOpen.set(false);
    } catch {
      this.toast.error(this.translate.instant('PATIENTS.PHOTOS.SAVE_FAILED'));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteSeries(series: PhotoSeries): Promise<void> {
    const ok = await this.confirm.confirm(this.translate.instant('PATIENTS.PHOTOS.DELETE_SERIES_CONFIRM', { count: series.photos.length }),
      { title: this.translate.instant('PATIENTS.PHOTOS.DELETE_SERIES'), danger: true });
    if (!ok) return;
    try {
      await this.api.delete(series.id);
      const rest = this.series().filter(s => s.id !== series.id);
      this.series.set(rest);
      this.selectedId.set(rest[0]?.id ?? null);
      if (rest.length < 2) this.comparing.set(false);
    } catch {
      this.toast.error(this.translate.instant('PATIENTS.PHOTOS.SAVE_FAILED'));
    }
  }

  onPick(event: Event, view: PhotoView): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (file) void this.upload(view, file);
  }

  onDragOver(event: DragEvent, view: PhotoView): void {
    if (!this.canWrite()) return;
    event.preventDefault();
    this.dragOver.set(view);
  }

  onDrop(event: DragEvent, view: PhotoView): void {
    if (!this.canWrite()) return;
    event.preventDefault();
    this.dragOver.set(null);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.upload(view, file);
  }

  async upload(view: PhotoView, file: File): Promise<void> {
    const series = this.selected();
    if (!series) return;
    if (!ACCEPTED.includes(file.type)) {
      this.toast.error(this.translate.instant('PATIENTS.PHOTOS.ONLY_IMAGES'));
      return;
    }
    this.setBusy(view, true);
    try {
      const updated = await this.api.upload(series.id, view, file);
      // Show the picture just chosen straight away rather than downloading it back.
      const photo = updated.photos.find(p => p.view === view);
      if (photo) this.remember(photo.fileId, URL.createObjectURL(file));
      this.replace(updated);
    } catch {
      this.toast.error(this.translate.instant('PATIENTS.PHOTOS.UPLOAD_FAILED'));
    } finally {
      this.setBusy(view, false);
    }
  }

  async removePhoto(series: PhotoSeries, view: PhotoView): Promise<void> {
    const label = this.translate.instant('PATIENTS.PHOTOS.VIEWS.' + view);
    const ok = await this.confirm.confirm(this.translate.instant('PATIENTS.PHOTOS.REMOVE_CONFIRM', { view: label }),
      { title: this.translate.instant('PATIENTS.PHOTOS.REMOVE'), danger: true });
    if (!ok) return;
    this.setBusy(view, true);
    try {
      this.replace(await this.api.removePhoto(series.id, view));
    } catch {
      this.toast.error(this.translate.instant('PATIENTS.PHOTOS.SAVE_FAILED'));
    } finally {
      this.setBusy(view, false);
    }
  }

  openLightbox(url: string, view: PhotoView, series: PhotoSeries): void {
    const stage = this.translate.instant('PATIENTS.PHOTOS.STAGES.' + series.stage);
    this.lightbox.set({ url, label: this.translate.instant('PATIENTS.PHOTOS.VIEWS.' + view), caption: `${stage} · ${series.takenOn}` });
  }

  private async load(patientId: string): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.api.list(patientId);
      this.series.set(list);
      this.selectedId.set(list[0]?.id ?? null);
      this.comparing.set(false);
    } catch {
      this.series.set([]);
      this.toast.error(this.translate.instant('PATIENTS.PHOTOS.LOAD_FAILED'));
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchImage(fileId: string): Promise<void> {
    if (this.urls().has(fileId) || this.fetching.has(fileId)) return;
    this.fetching.add(fileId);
    try {
      this.remember(fileId, URL.createObjectURL(await this.api.image(fileId)));
    } catch {
      /* the slot keeps its placeholder; the next render may try again */
    } finally {
      this.fetching.delete(fileId);
    }
  }

  private remember(fileId: string, url: string): void {
    const next = new Map(this.urls());
    const previous = next.get(fileId);
    if (previous) URL.revokeObjectURL(previous);
    next.set(fileId, url);
    this.urls.set(next);
  }

  private replace(saved: PhotoSeries): void {
    const exists = this.series().some(s => s.id === saved.id);
    const list = exists ? this.series().map(s => (s.id === saved.id ? saved : s)) : [saved, ...this.series()];
    this.series.set([...list].sort((a, b) => b.takenOn.localeCompare(a.takenOn) || b.createdAt.localeCompare(a.createdAt)));
  }

  private setBusy(view: PhotoView, on: boolean): void {
    const next = new Set(this.busy());
    if (on) next.add(view); else next.delete(view);
    this.busy.set(next);
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
