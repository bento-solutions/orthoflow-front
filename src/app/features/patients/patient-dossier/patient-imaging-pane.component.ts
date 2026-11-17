import { Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { DocumentCategory, PatientFile, PatientFilesApi } from '../../../core/services/patient-files-api.service';
import { ModelType, isModel } from './scan-model';
import { ScanViewerComponent } from './scan-viewer.component';
import { ImagingViewerComponent } from './imaging-viewer.component';

type PaneKind = Extract<DocumentCategory, 'XRAY' | 'INTRAORAL_3D'>;

/**
 * The picture the doctor cross-references with the 3D chart: the latest panoramic X-ray,
 * or with one tap the latest 3D intraoral scan. Both are uploaded from the Documents tab
 * with that type; the scan may be a picture of it or the model itself (STL, PLY, OBJ, 3MF,
 * glTF), which is shown in a viewer that turns and zooms. Older ones are a click away.
 */
@Component({
  selector: 'app-patient-imaging-pane',
  standalone: true,
  imports: [DatePipe, TranslateModule, ScanViewerComponent, ImagingViewerComponent],
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
  template: `
    <div class="flex flex-wrap items-center justify-between gap-2 pb-2">
      <div class="inline-flex overflow-hidden rounded-lg border border-ink-200 bg-surface text-[0.8125rem] font-semibold" role="group"
           [attr.aria-label]="'PFILES.PANE_LABEL' | translate">
        @for (k of kinds; track k) {
          <button type="button" class="min-h-9 px-3 transition-colors" [attr.aria-pressed]="kind() === k"
            [class.bg-petrol-600]="kind() === k" [class.text-white]="kind() === k" [class.hover:bg-ink-50]="kind() !== k"
            (click)="pick(k)">{{ 'PFILES.CAT.' + k | translate }}</button>
        }
      </div>
      <div class="ms-auto flex items-center gap-2">
      @if (list().length > 1) {
        <div class="flex items-center gap-1 text-xs text-ink-500">
          <button type="button" class="btn btn-ghost btn-icon btn-sm" [disabled]="index() >= list().length - 1"
            (click)="index.set(index() + 1)" [attr.aria-label]="'PFILES.OLDER' | translate" [title]="'PFILES.OLDER' | translate">
            <span class="material-icons text-[18px] rtl:rotate-180" aria-hidden="true">chevron_left</span>
          </button>
          <span>{{ index() + 1 }} / {{ list().length }}</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" [disabled]="index() === 0"
            (click)="index.set(index() - 1)" [attr.aria-label]="'PFILES.NEWER' | translate" [title]="'PFILES.NEWER' | translate">
            <span class="material-icons text-[18px] rtl:rotate-180" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      }
      @if (current()) {
        <button type="button" class="btn btn-secondary btn-sm" (click)="openViewer()" [title]="'IMAGING.OPEN_HINT' | translate">
          <span class="material-icons text-[18px]" aria-hidden="true">open_in_full</span>{{ 'IMAGING.OPEN' | translate }}
        </button>
      }
      </div>
    </div>

    <div class="relative min-h-0 flex-1">
      @if (current(); as f) {
        @if (modelOf(f); as type) {
          @if (blobs().get(f.id); as blob) {
            <app-scan-viewer class="h-full" [blob]="blob" [type]="type" />
          } @else {
            <div class="grid h-full place-items-center text-sm text-ink-500">{{ 'COMMON.LOADING' | translate }}</div>
          }
        } @else if (urls().get(f.id); as url) {
          <button type="button" class="block h-full w-full cursor-zoom-in" [title]="'IMAGING.OPEN_HINT' | translate" (click)="openViewer()">
            <img [src]="url" [alt]="('PFILES.CAT.' + kind() | translate) + ' — ' + f.name" class="h-full w-full object-contain" />
          </button>
        } @else {
          <div class="grid h-full place-items-center text-sm text-ink-500">{{ 'COMMON.LOADING' | translate }}</div>
        }
        @if (!modelOf(f)) {
          <p class="pointer-events-none absolute bottom-1 start-1 rounded bg-surface/80 px-1.5 py-0.5 text-2xs text-ink-600">
            {{ f.createdAt | date:'mediumDate' }} · {{ f.name }}
          </p>
        }
      } @else if (!loading()) {
        <div class="grid h-full place-items-center p-4 text-center">
          <div>
            <p class="text-sm text-ink-500">{{ (kind() === 'XRAY' ? 'PFILES.NO_XRAY' : 'PFILES.NO_INTRAORAL') | translate }}</p>
            @if (uploadLink()) {
              <button type="button" class="btn btn-secondary btn-sm mt-2" (click)="openDocuments.emit()">{{ 'PFILES.GO_UPLOAD' | translate }}</button>
            }
          </div>
        </div>
      }
    </div>

    @if (viewing(); as start) {
      <app-imaging-viewer [files]="files()" [startId]="start" [startKind]="kind()" [patientName]="patientName()" [chartLink]="chartLink()"
        (closed)="viewing.set(null)" (openChart)="openChart.emit()" />
    }
  `,
})
export class PatientImagingPaneComponent implements OnDestroy {
  readonly patientId = input.required<string>();
  /** Named on the full-screen viewer's title bar. */
  readonly patientName = input('');
  /** The empty pane's way to the Documents tab, where pictures are uploaded; not there in the chart's own window. */
  readonly uploadLink = input(true);
  /** The full-screen viewer's way to the 3D chart's own window; not there inside that window. */
  readonly chartLink = input(true);
  readonly openDocuments = output<void>();
  readonly openChart = output<void>();

  private readonly api = inject(PatientFilesApi);

  readonly kinds: readonly PaneKind[] = ['XRAY', 'INTRAORAL_3D'];
  readonly kind = signal<PaneKind>('XRAY');
  readonly index = signal(0);
  readonly loading = signal(true);
  protected readonly files = signal<PatientFile[]>([]);
  /** The file the full-screen viewer opened on, while it is open. */
  readonly viewing = signal<string | null>(null);
  readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  /** Scans that are 3D models, kept as bytes for the viewer. */
  readonly blobs = signal<ReadonlyMap<string, Blob>>(new Map());

  /** Pictures for either kind; for the intraoral scan, the 3D model too. */
  readonly list = computed(() =>
    this.files().filter((f) => f.category === this.kind() && (f.contentType.startsWith('image/') || (this.kind() === 'INTRAORAL_3D' && isModel(f.contentType)))),
  );
  readonly current = computed(() => this.list()[this.index()] ?? null);

  constructor() {
    effect(() => {
      const id = this.patientId();
      this.api.version();
      untracked(() => void this.load(id));
    });
    effect(() => {
      const f = this.current();
      if (f) untracked(() => void this.fetch(f.id));
    });
  }

  pick(k: PaneKind): void {
    this.kind.set(k);
    this.index.set(0);
  }

  private async load(patientId: string): Promise<void> {
    try {
      this.files.set(await this.api.list(patientId));
      this.index.set(0);
    } catch {
      this.files.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The picture on the whole screen. The browser's full screen is asked for here, in the click,
   * which is the only moment it is granted; where it is refused the viewer still covers the page.
   */
  openViewer(): void {
    const f = this.current();
    if (!f) return;
    this.viewing.set(f.id);
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.()?.catch(() => undefined);
  }

  modelOf(f: PatientFile): ModelType | null {
    return isModel(f.contentType) ? f.contentType : null;
  }

  private async fetch(id: string): Promise<void> {
    if (this.urls().has(id) || this.blobs().has(id)) return;
    try {
      const blob = await this.api.blob(id);
      if (this.files().some((f) => f.id === id && isModel(f.contentType))) {
        this.blobs.update((m) => new Map(m).set(id, blob));
        return;
      }
      const url = URL.createObjectURL(blob);
      this.urls.update((m) => new Map(m).set(id, url));
    } catch { /* the pane says it is loading; the Documents tab shows the failure */ }
  }

  ngOnDestroy(): void {
    for (const url of this.urls().values()) URL.revokeObjectURL(url);
  }
}
