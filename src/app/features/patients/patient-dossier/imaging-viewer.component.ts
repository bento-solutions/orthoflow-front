import {
  AfterViewInit, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { DocumentCategory, PatientFile, PatientFilesApi } from '../../../core/services/patient-files-api.service';
import { keepTabInside } from '../../../shared/ui/dialog.directive';
import { ModelType, isModel } from './scan-model';
import { ScanViewerComponent } from './scan-viewer.component';

export type ImagingKind = Extract<DocumentCategory, 'XRAY' | 'INTRAORAL_3D'>;

/** How far in a picture can be looked at: eight times its fitted size. */
export const MAX_ZOOM = 8;

interface Point { readonly x: number; readonly y: number; }

/**
 * Zooming by {@link factor} with the pointer at {@link at} (from the stage's centre) keeps what is
 * under the pointer where it is. Returns the new zoom and the new offset; at the fitted size the
 * picture goes back to the centre.
 */
export function zoomAround(zoom: number, pan: Point, factor: number, at: Point): { zoom: number; pan: Point } {
  const next = Math.min(MAX_ZOOM, Math.max(1, zoom * factor));
  if (next === 1) return { zoom: 1, pan: { x: 0, y: 0 } };
  const k = next / zoom;
  return { zoom: next, pan: { x: at.x - (at.x - pan.x) * k, y: at.y - (at.y - pan.y) * k } };
}

/** The pictures a kind shows: images of either kind, and for the intraoral scan the 3D model too. */
export function imagingFiles(files: readonly PatientFile[], kind: ImagingKind): PatientFile[] {
  return files.filter((f) => f.category === kind && (f.contentType.startsWith('image/') || (kind === 'INTRAORAL_3D' && isModel(f.contentType))));
}

let nextId = 1;

/**
 * An X-ray or an intraoral scan on the whole screen, to read it properly: zoom and move,
 * brightness, contrast, negative, a quarter turn, side by side with an earlier one, and a strip
 * of every one the patient has. A 3D scan opens in the model viewer instead, which turns and
 * zooms on its own. Escape, or the browser leaving full screen, closes it.
 */
@Component({
  selector: 'app-imaging-viewer',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule, ScanViewerComponent],
  host: {
    class: 'imaging-viewer',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-labelledby]': 'titleId',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <header class="iv-bar">
      <div class="iv-title">
        <h2 [id]="titleId">
          @if (current(); as f) { {{ ('PFILES.CAT.' + f.category) | translate }} · {{ f.createdAt | date:'mediumDate' }} }
        </h2>
        <p>
          @if (patientName()) { {{ patientName() }} · }
          @if (current(); as f) { <span dir="auto">{{ f.name }}</span> }
        </p>
      </div>

      <div class="iv-tools" role="toolbar" [attr.aria-label]="'IMAGING.TOOLS' | translate">
        @if (!model()) {
          <button type="button" class="iv-btn" (click)="zoomBy(1 / 1.25)" [disabled]="zoom() <= 1"
            [title]="'IMAGING.ZOOM_OUT' | translate" [attr.aria-label]="'IMAGING.ZOOM_OUT' | translate">
            <span class="material-icons" aria-hidden="true">zoom_out</span>
          </button>
          <span class="iv-zoom" aria-live="polite">{{ zoom() === 1 ? ('IMAGING.FIT' | translate) : (zoom() * 100 | number:'1.0-0') + '%' }}</span>
          <button type="button" class="iv-btn" (click)="zoomBy(1.25)" [disabled]="zoom() >= maxZoom"
            [title]="'IMAGING.ZOOM_IN' | translate" [attr.aria-label]="'IMAGING.ZOOM_IN' | translate">
            <span class="material-icons" aria-hidden="true">zoom_in</span>
          </button>
          <span class="iv-sep" aria-hidden="true"></span>
          <label class="iv-slider" [title]="'IMAGING.BRIGHTNESS' | translate">
            <span class="material-icons" aria-hidden="true">light_mode</span>
            <span class="sr-only">{{ 'IMAGING.BRIGHTNESS' | translate }}</span>
            <input type="range" min="40" max="200" step="5" [value]="brightness()" (input)="brightness.set(+$any($event.target).value)" />
          </label>
          <label class="iv-slider" [title]="'IMAGING.CONTRAST' | translate">
            <span class="material-icons" aria-hidden="true">contrast</span>
            <span class="sr-only">{{ 'IMAGING.CONTRAST' | translate }}</span>
            <input type="range" min="40" max="250" step="5" [value]="contrast()" (input)="contrast.set(+$any($event.target).value)" />
          </label>
          <button type="button" class="iv-btn" [class.on]="invert()" [attr.aria-pressed]="invert()" (click)="invert.set(!invert())"
            [title]="'IMAGING.INVERT' | translate" [attr.aria-label]="'IMAGING.INVERT' | translate">
            <span class="material-icons" aria-hidden="true">invert_colors</span>
          </button>
          <button type="button" class="iv-btn" (click)="rotate()" [title]="'IMAGING.ROTATE' | translate" [attr.aria-label]="'IMAGING.ROTATE' | translate">
            <span class="material-icons" aria-hidden="true">rotate_right</span>
          </button>
          <button type="button" class="iv-btn" (click)="resetImage()" [disabled]="pristine()"
            [title]="'IMAGING.RESET' | translate" [attr.aria-label]="'IMAGING.RESET' | translate">
            <span class="material-icons" aria-hidden="true">restart_alt</span>
          </button>
          <span class="iv-sep" aria-hidden="true"></span>
          <button type="button" class="iv-btn iv-wide" [class.on]="comparing()" [attr.aria-pressed]="comparing()" [disabled]="pictures().length < 2"
            (click)="toggleCompare()" [title]="'IMAGING.COMPARE_HINT' | translate">
            <span class="material-icons" aria-hidden="true">vertical_split</span>{{ 'IMAGING.COMPARE' | translate }}
          </button>
        }
        @if (chartLink()) {
          <button type="button" class="iv-btn iv-wide" (click)="openChart.emit()" [title]="'DENTAL_3D.FULL_SCREEN_HINT' | translate">
            <span class="material-icons" aria-hidden="true">view_in_ar</span>{{ 'IMAGING.CHART' | translate }}
          </button>
        }
        <button type="button" class="iv-btn" (click)="download()" [disabled]="!current()"
          [title]="'IMAGING.DOWNLOAD' | translate" [attr.aria-label]="'IMAGING.DOWNLOAD' | translate">
          <span class="material-icons" aria-hidden="true">download</span>
        </button>
        <button type="button" class="iv-btn iv-wide iv-close" (click)="close()" [attr.aria-label]="'IMAGING.CLOSE' | translate">
          <span class="material-icons" aria-hidden="true">close</span>{{ 'COMMON.CLOSE' | translate }} <kbd>Esc</kbd>
        </button>
      </div>
    </header>

    <div class="iv-body">
      <div #stage class="iv-stage" [class.iv-split]="comparing() && compareWith()" tabindex="0"
        [attr.aria-label]="'IMAGING.STAGE' | translate"
        (wheel)="onWheel($event)" (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)" (pointercancel)="onPointerUp($event)" (dblclick)="onDoubleClick($event)">
        @if (current(); as f) {
          @if (model(); as type) {
            @if (blobs().get(f.id); as blob) {
              <app-scan-viewer class="iv-model" [blob]="blob" [type]="type" [expandable]="false" />
            } @else {
              <p class="iv-wait" role="status">{{ 'COMMON.LOADING' | translate }}</p>
            }
          } @else {
            <figure class="iv-pane">
              @if (urls().get(f.id); as url) {
                <img [src]="url" [alt]="('PFILES.CAT.' + f.category | translate) + ' — ' + f.name" [style.transform]="transform()" [style.filter]="filter()" draggable="false" />
              } @else {
                <p class="iv-wait" role="status">{{ 'COMMON.LOADING' | translate }}</p>
              }
              @if (comparing() && compareWith()) { <figcaption>{{ f.createdAt | date:'mediumDate' }}</figcaption> }
            </figure>
            @if (comparing() && compareWith(); as other) {
              <figure class="iv-pane">
                @if (urls().get(other.id); as url) {
                  <img [src]="url" [alt]="('PFILES.CAT.' + other.category | translate) + ' — ' + other.name" [style.transform]="transform()" [style.filter]="filter()" draggable="false" />
                } @else {
                  <p class="iv-wait" role="status">{{ 'COMMON.LOADING' | translate }}</p>
                }
                <figcaption>{{ other.createdAt | date:'mediumDate' }}</figcaption>
              </figure>
            }
          }
        } @else {
          <p class="iv-wait">{{ (kind() === 'XRAY' ? 'PFILES.NO_XRAY' : 'PFILES.NO_INTRAORAL') | translate }}</p>
        }
        @if (!model()) {
          <div class="iv-sides" aria-hidden="true"><span>{{ 'DENTAL_3D.PATIENT_RIGHT' | translate }}</span><span>{{ 'DENTAL_3D.PATIENT_LEFT' | translate }}</span></div>
          <p class="iv-hint" aria-hidden="true">{{ 'IMAGING.HINT' | translate }}</p>
        }
      </div>
      @if (list().length > 1) {
        <button type="button" class="iv-step iv-step--older" (click)="step(1)" [disabled]="index() >= list().length - 1"
          [attr.aria-label]="'PFILES.OLDER' | translate" [title]="'PFILES.OLDER' | translate">
          <span class="material-icons rtl:rotate-180" aria-hidden="true">chevron_left</span>
        </button>
        <button type="button" class="iv-step iv-step--newer" (click)="step(-1)" [disabled]="index() <= 0"
          [attr.aria-label]="'PFILES.NEWER' | translate" [title]="'PFILES.NEWER' | translate">
          <span class="material-icons rtl:rotate-180" aria-hidden="true">chevron_right</span>
        </button>
      }
    </div>

    <footer class="iv-strip">
      <div class="iv-kinds" role="group" [attr.aria-label]="'PFILES.PANE_LABEL' | translate">
        @for (k of kinds; track k) {
          <button type="button" [attr.aria-pressed]="kind() === k" (click)="pick(k)">
            {{ ('PFILES.CAT.' + k) | translate }} · {{ countOf(k) }}
          </button>
        }
      </div>
      <ul class="iv-thumbs" [attr.aria-label]="'IMAGING.ALL' | translate">
        @for (f of list(); track f.id; let i = $index) {
          <li>
            <button type="button" class="iv-thumb" [class.on]="f.id === currentId()" [class.other]="comparing() && f.id === compareWith()?.id"
              [attr.aria-current]="f.id === currentId() ? 'true' : null" (click)="choose(f)"
              [attr.aria-label]="(f.createdAt | date:'mediumDate') + ', ' + f.name">
              @if (isModel(f.contentType)) {
                <span class="material-icons iv-thumb-icon" aria-hidden="true">view_in_ar</span>
              } @else if (urls().get(f.id); as url) {
                <img [src]="url" alt="" draggable="false" />
              }
              <span class="iv-thumb-date">{{ f.createdAt | date:'mediumDate' }}</span>
              @if (comparing() && f.id === compareWith()?.id) { <span class="iv-thumb-tag">B</span> }
              @if (comparing() && f.id === currentId()) { <span class="iv-thumb-tag">A</span> }
            </button>
          </li>
        }
      </ul>
      <p class="iv-count">
        @if (list().length) { {{ 'IMAGING.POSITION' | translate: { at: index() + 1, of: list().length } }} }
      </p>
    </footer>
  `,
  styles: [`
    :host {
      position: fixed; inset: 0; z-index: calc(var(--z-modal, 60) + 5); display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
      background: #000; color: #e8f1f3; font-size: .875rem; outline: none;
    }
    .iv-bar { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; padding: .625rem 1rem; background: #0a1114; border-bottom: 1px solid #1d2a2f; }
    .iv-title { min-width: 0; margin-inline-end: auto; }
    .iv-title h2 { margin: 0; font-size: 1rem; font-weight: 700; color: #fff; }
    .iv-title p { margin: .125rem 0 0; font-size: .75rem; color: #a9bcc2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iv-tools { display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; }
    .iv-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: .375rem; width: 2.25rem; height: 2.25rem; padding: 0;
      border: 1px solid #2a3a41; border-radius: .5rem; background: #11191d; color: #e2ecef; font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer;
    }
    .iv-btn:hover:not(:disabled) { background: #1b272c; }
    .iv-btn:disabled { opacity: .4; cursor: default; }
    .iv-btn.on, .iv-btn.on:hover:not(:disabled) { background: #237489; border-color: #4fb3c9; color: #fff; }
    .iv-btn .material-icons { font-size: 1.125rem; }
    .iv-wide { width: auto; padding: 0 .75rem; }
    .iv-close { border-color: #2f6c7d; background: transparent; }
    .iv-close kbd { padding: .0625rem .3125rem; border: 1px solid #33454c; border-bottom-width: 2px; border-radius: .3125rem; font: inherit; font-size: .6875rem; color: #c9d6da; }
    .iv-btn:focus-visible, .iv-thumb:focus-visible, .iv-kinds button:focus-visible, .iv-step:focus-visible, .iv-slider input:focus-visible { outline: 2px solid #6cc8db; outline-offset: 2px; }
    .iv-zoom { min-width: 3.25rem; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; color: #e2ecef; }
    .iv-sep { width: 1px; height: 1.625rem; margin: 0 .25rem; background: #2a3a41; }
    .iv-slider { display: inline-flex; align-items: center; gap: .375rem; color: #c9d6da; }
    .iv-slider .material-icons { font-size: 1.125rem; }
    .iv-slider input { width: 6.5rem; accent-color: #4fb3c9; }

    .iv-body { position: relative; min-height: 0; }
    .iv-stage { position: absolute; inset: 0; display: grid; overflow: hidden; touch-action: none; cursor: grab; outline: none; }
    .iv-stage:active { cursor: grabbing; }
    .iv-stage:focus-visible { box-shadow: inset 0 0 0 2px #6cc8db; }
    .iv-split { grid-template-columns: 1fr 1fr; gap: 2px; background: #1d2a2f; }
    .iv-pane { position: relative; margin: 0; min-width: 0; overflow: hidden; background: #000; display: grid; place-items: center; }
    .iv-pane img {
      position: absolute; inset: 1.5rem 4.5rem; width: calc(100% - 9rem); height: calc(100% - 3rem); object-fit: contain;
      transform-origin: center; user-select: none; -webkit-user-drag: none;
    }
    .iv-split .iv-pane img { inset: 2.5rem .75rem 1rem; width: calc(100% - 1.5rem); height: calc(100% - 3.5rem); }
    .iv-pane figcaption { position: absolute; top: .5rem; inset-inline-start: .75rem; padding: .125rem .5rem; border-radius: .375rem; background: rgb(0 0 0 / .6); color: #e2ecef; font-size: .75rem; font-weight: 600; }
    .iv-model { position: absolute; inset: 0; border-radius: 0; }
    .iv-wait { margin: auto; color: #a9bcc2; }
    .iv-sides { position: absolute; inset: .625rem 5rem auto; display: flex; justify-content: space-between; pointer-events: none; font-size: .75rem; color: #d5e0e3; }
    .iv-sides span, .iv-hint { padding: .125rem .5rem; border-radius: .375rem; background: rgb(0 0 0 / .6); }
    .iv-split ~ .iv-sides, .iv-split .iv-sides { display: none; }
    .iv-hint { position: absolute; bottom: .625rem; inset-inline-start: 5rem; margin: 0; pointer-events: none; font-size: .75rem; color: #c3d1d5; }
    .iv-split .iv-hint { display: none; }
    .iv-step {
      position: absolute; top: 50%; margin-top: -1.5rem; width: 2.75rem; height: 3rem; display: grid; place-items: center;
      border: 1px solid #2a3a41; border-radius: .625rem; background: rgb(17 25 29 / .85); color: #e2ecef; cursor: pointer;
    }
    .iv-step:disabled { opacity: .35; cursor: default; }
    .iv-step--older { inset-inline-start: 1rem; }
    .iv-step--newer { inset-inline-end: 1rem; }

    .iv-strip { display: flex; align-items: center; gap: 1rem; padding: .625rem 1rem; background: #0a1114; border-top: 1px solid #1d2a2f; min-width: 0; }
    .iv-kinds { display: inline-flex; flex: none; border: 1px solid #2a3a41; border-radius: .5rem; overflow: hidden; }
    .iv-kinds button { padding: 0 .75rem; height: 2rem; border: 0; background: #11191d; color: #c9d6da; font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; }
    .iv-kinds button[aria-pressed='true'] { background: #237489; color: #fff; }
    .iv-thumbs { display: flex; gap: .625rem; margin: 0; padding: .125rem; list-style: none; overflow-x: auto; min-width: 0; }
    .iv-thumb {
      position: relative; display: block; width: 8.5rem; height: 4.75rem; padding: 0; overflow: hidden; flex: none;
      border: 2px solid transparent; border-radius: .5rem; background: #11191d; cursor: pointer;
    }
    .iv-thumb.on { border-color: #4fb3c9; }
    .iv-thumb.other { border-color: #e59a3f; }
    .iv-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .iv-thumb-icon { position: absolute; inset: 0; display: grid; place-items: center; font-size: 1.75rem; color: #8fd3e2; }
    .iv-thumb-date { position: absolute; inset: auto 0 0; padding: .1875rem .375rem; text-align: start; font-size: .6875rem; font-weight: 600; color: #fff; background: linear-gradient(transparent, rgb(0 0 0 / .85)); }
    .iv-thumb-tag { position: absolute; top: .25rem; inset-inline-end: .25rem; padding: 0 .3125rem; border-radius: .25rem; font-size: .6875rem; font-weight: 800; background: #0a1114; color: #fff; }
    .iv-count { margin: 0 0 0 auto; flex: none; font-size: .75rem; color: #a9bcc2; }

    @media (max-width: 720px) {
      .iv-slider input { width: 4.5rem; }
      .iv-pane img { inset: 1rem; width: calc(100% - 2rem); height: calc(100% - 2rem); }
      .iv-step { display: none; }
      .iv-sides, .iv-hint { display: none; }
    }
  `],
})
export class ImagingViewerComponent implements AfterViewInit {
  /** Every file of the patient; the viewer shows the X-rays and the intraoral scans among them. */
  readonly files = input.required<readonly PatientFile[]>();
  /** The one to open on. */
  readonly startId = input.required<string>();
  readonly startKind = input<ImagingKind>('XRAY');
  readonly patientName = input('');
  /** A way to the 3D chart's own window; left out inside that window. */
  readonly chartLink = input(true);

  readonly closed = output<void>();
  readonly openChart = output<void>();

  private readonly api = inject(PatientFilesApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  protected readonly titleId = `imaging-viewer-title-${nextId++}`;
  protected readonly kinds: readonly ImagingKind[] = ['XRAY', 'INTRAORAL_3D'];
  protected readonly maxZoom = MAX_ZOOM;
  protected readonly isModel = isModel;

  readonly kind = signal<ImagingKind>('XRAY');
  readonly currentId = signal<string | null>(null);
  readonly comparing = signal(false);
  private readonly compareId = signal<string | null>(null);

  readonly zoom = signal(1);
  readonly pan = signal<Point>({ x: 0, y: 0 });
  readonly turns = signal(0);
  readonly brightness = signal(100);
  readonly contrast = signal(100);
  readonly invert = signal(false);

  readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  readonly blobs = signal<ReadonlyMap<string, Blob>>(new Map());
  private readonly asked = new Set<string>();

  readonly list = computed(() => imagingFiles(this.files(), this.kind()));
  /** What compare can put side by side: the pictures, not the 3D models. */
  readonly pictures = computed(() => this.list().filter((f) => f.contentType.startsWith('image/')));
  readonly index = computed(() => Math.max(0, this.list().findIndex((f) => f.id === this.currentId())));
  readonly current = computed(() => this.list().find((f) => f.id === this.currentId()) ?? this.list()[0] ?? null);
  readonly model = computed<ModelType | null>(() => {
    const f = this.current();
    return f && isModel(f.contentType) ? f.contentType : null;
  });
  /** The other side of the comparison: the one picked, else the one taken just before. */
  readonly compareWith = computed(() => {
    const pictures = this.pictures();
    const current = this.current();
    if (!current) return null;
    const picked = pictures.find((f) => f.id === this.compareId() && f.id !== current.id);
    if (picked) return picked;
    const at = pictures.findIndex((f) => f.id === current.id);
    return pictures[at + 1] ?? pictures[at - 1] ?? null;
  });

  readonly pristine = computed(() =>
    this.zoom() === 1 && this.turns() === 0 && this.brightness() === 100 && this.contrast() === 100 && !this.invert());

  /** A quarter turn stands the picture on its side, so it is shrunk to stay inside the stage. */
  readonly transform = computed(() => {
    const { x, y } = this.pan();
    const quarter = this.turns() % 2 === 1;
    const fit = quarter ? this.sideways : 1;
    return `translate(${x}px, ${y}px) scale(${this.zoom() * fit}) rotate(${this.turns() * 90}deg)`;
  });
  readonly filter = computed(() => `brightness(${this.brightness()}%) contrast(${this.contrast()}%)${this.invert() ? ' invert(1)' : ''}`);

  private sideways = 1;
  private drag: { id: number; x: number; y: number } | null = null;
  private sawFullscreen = false;
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const start = this.startId();
      const kind = this.startKind();
      untracked(() => {
        this.kind.set(kind);
        this.currentId.set(start);
      });
    });
    // The picture on screen, the one beside it, and the strip's thumbnails.
    effect(() => {
      const wanted = [this.current(), this.comparing() ? this.compareWith() : null, ...this.list()].filter((f): f is PatientFile => !!f);
      untracked(() => wanted.forEach((f) => void this.fetch(f)));
    });
    // Another picture is looked at afresh: its own size, upright, as it was taken.
    effect(() => {
      this.currentId();
      untracked(() => this.resetView());
    });

    const onFullscreen = () => {
      if (document.fullscreenElement) this.sawFullscreen = true;
      else if (this.sawFullscreen) this.close();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      for (const url of this.urls().values()) URL.revokeObjectURL(url);
      if (this.opener?.isConnected) this.opener.focus();
    });
  }

  ngAfterViewInit(): void {
    this.opener = document.activeElement as HTMLElement | null;
    if (document.fullscreenElement) this.sawFullscreen = true;
    this.stage()?.nativeElement.focus({ preventScroll: true });
    this.measure();
  }

  protected countOf(kind: ImagingKind): number {
    return imagingFiles(this.files(), kind).length;
  }

  pick(kind: ImagingKind): void {
    if (kind === this.kind()) return;
    this.kind.set(kind);
    this.comparing.set(false);
    this.currentId.set(this.list()[0]?.id ?? null);
  }

  /** A thumbnail: while comparing, it goes on the other side; otherwise it is the one looked at. */
  choose(file: PatientFile): void {
    if (this.comparing() && !isModel(file.contentType) && file.id !== this.current()?.id) {
      this.compareId.set(file.id);
      return;
    }
    this.currentId.set(file.id);
  }

  /** +1 goes to the older one, -1 to the newer: the list runs newest first. */
  step(delta: number): void {
    const list = this.list();
    const next = list[this.index() + delta];
    if (next) this.currentId.set(next.id);
  }

  toggleCompare(): void {
    if (this.model()) return;
    this.comparing.set(!this.comparing());
    this.compareId.set(null);
  }

  zoomBy(factor: number, at: Point = { x: 0, y: 0 }): void {
    if (this.model()) return;
    const next = zoomAround(this.zoom(), this.pan(), factor, at);
    this.zoom.set(next.zoom);
    this.pan.set(next.pan);
  }

  rotate(): void {
    this.turns.set((this.turns() + 1) % 4);
    this.measure();
  }

  resetImage(): void {
    this.resetView();
    this.brightness.set(100);
    this.contrast.set(100);
    this.invert.set(false);
  }

  close(): void {
    this.closed.emit();
  }

  download(): void {
    const f = this.current();
    if (!f) return;
    void this.api.blob(f.id).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }).catch(() => undefined);
  }

  /* ── Pointer ──────────────────────────────────────────────────────────── */

  protected onWheel(event: WheelEvent): void {
    if (this.model()) return;
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, this.fromCentre(event));
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.model() || event.button !== 0 || this.zoom() === 1) return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const { x, y } = this.pan();
    this.pan.set({ x: x + event.clientX - this.drag.x, y: y + event.clientY - this.drag.y });
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.drag?.id === event.pointerId) this.drag = null;
  }

  /** In closer where the doctor points, or back to the whole picture. */
  protected onDoubleClick(event: MouseEvent): void {
    if (this.model()) return;
    if (this.zoom() > 1) this.resetView();
    else this.zoomBy(2.5, this.fromCentre(event));
  }

  /* ── Keyboard ─────────────────────────────────────────────────────────── */

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      keepTabInside(event, this.host);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.close();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
    const rtl = getComputedStyle(this.host).direction === 'rtl';
    const handled = (() => {
      switch (event.key) {
        case 'ArrowLeft': this.step(rtl ? -1 : 1); return true;
        case 'ArrowRight': this.step(rtl ? 1 : -1); return true;
        case '+': case '=': this.zoomBy(1.25); return true;
        case '-': this.zoomBy(1 / 1.25); return true;
        case '0': this.resetView(); return true;
        case 'r': case 'R': this.rotate(); return true;
        case 'i': case 'I': this.invert.set(!this.invert()); return true;
        default: return false;
      }
    })();
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /* ── Inside ───────────────────────────────────────────────────────────── */

  private resetView(): void {
    this.zoom.set(1);
    this.pan.set({ x: 0, y: 0 });
    this.turns.set(0);
  }

  private fromCentre(event: MouseEvent): Point {
    const box = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect?.() ?? this.stage()?.nativeElement.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 };
  }

  /** How much a picture on its side must shrink to stay inside the stage. */
  private measure(): void {
    const box = this.stage()?.nativeElement.getBoundingClientRect();
    this.sideways = box && box.width && box.height ? Math.min(box.width / box.height, box.height / box.width) : 1;
  }

  private async fetch(file: PatientFile): Promise<void> {
    if (this.asked.has(file.id)) return;
    this.asked.add(file.id);
    try {
      const blob = await this.api.blob(file.id);
      if (isModel(file.contentType)) {
        this.blobs.update((m) => new Map(m).set(file.id, blob));
      } else {
        const url = URL.createObjectURL(blob);
        this.urls.update((m) => new Map(m).set(file.id, url));
      }
    } catch {
      // Asked again next time it is wanted.
      this.asked.delete(file.id);
    }
  }
}
