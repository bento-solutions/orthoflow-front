import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import {
  emptyPerioData, fromApi, summarize, toApi, valueAt, withToothCleared, withToothStatus, withValue,
} from '../../../core/clinical/perio/perio-data';
import { ToothNumbering } from '../../../core/clinical/perio/perio-layout';
import {
  PerioChartDto, PerioChartListItem, PerioData, PerioMode, SavePerioChartRequest, ToothStatusMap,
} from '../../../core/clinical/perio/perio.model';
import { AuthService } from '../../../core/services/auth.service';
import { CabinetService } from '../../../core/services/cabinet.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PerioChartService } from '../../../core/services/perio-chart.service';
import { ToastService } from '../../../core/services/toast.service';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PerioGridComponent, PerioValueChange } from './perio-grid.component';
import { PerioHelpComponent } from './perio-help.component';
import { PerioIconComponent } from './perio-icon.component';
import { PerioProgressionComponent } from './perio-progression.component';
import { PerioStatusChange } from './perio-numbers.component';
import { openPerioPrint } from './perio-print';
import { PerioSummaryComponent } from './perio-summary.component';
import { PerioTourComponent } from './perio-tour.component';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

/** The chart open on screen: which one, and the version the screen is built on. */
interface OpenChart {
  readonly id: string;
  readonly patientId: string;
  readonly version: number;
}

const AUTOSAVE_MS = 900;
const NUMBERING_KEY = 'orthoflow.perio.numbering';
const TOUR_KEY = 'orthoflow.perio.tour.v1';

const remembered = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const remember = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* private mode: the preference just does not stick */ }
};

/**
 * The periodontal chart of a patient: one chart per examination, the open one filled in on the sheet and
 * saved by itself a moment after the last keystroke. A save is built on the version the screen was loaded
 * at, so a chart open on two screens cannot silently overwrite itself.
 */
@Component({
  selector: 'app-perio-chart',
  standalone: true,
  imports: [
    DatePipe, FormsModule, TranslateModule, ModalComponent, PerioGridComponent, PerioSummaryComponent, PerioHelpComponent,
    PerioTourComponent, PerioIconComponent, PerioProgressionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="perio" #root [attr.aria-busy]="loading()">
      <header class="head">
        <div class="titlebar">
          <h2>{{ 'PERIO.TITLE' | translate }}</h2>
          @if (open()) {
            <span class="save" role="status" [attr.data-state]="saveState()">
              @switch (saveState()) {
                @case ('saving') { {{ 'PERIO.SAVE.SAVING' | translate }} }
                @case ('saved') { <app-perio-icon name="check" [size]="14"/> {{ 'PERIO.SAVE.SAVED' | translate }} }
                @case ('dirty') { {{ 'PERIO.SAVE.UNSAVED' | translate }} }
                @case ('error') {
                  {{ 'PERIO.SAVE.FAILED' | translate }}
                  <button type="button" class="link" (click)="retry()">{{ 'PERIO.SAVE.RETRY' | translate }}</button>
                }
              }
            </span>
          }
          @if (open()) {
            <nav class="views" [attr.aria-label]="'PERIO.TITLE' | translate">
              <button type="button" [class.on]="view() === 'chart'" [attr.aria-current]="view() === 'chart' ? 'page' : null" (click)="view.set('chart')">{{ 'PERIO.VIEW.CHART' | translate }}</button>
              <button type="button" [class.on]="view() === 'progression'" [attr.aria-current]="view() === 'progression' ? 'page' : null" (click)="showProgression()">{{ 'PERIO.VIEW.PROGRESSION' | translate }}</button>
            </nav>
          }
        </div>

        @if (open() && view() === 'chart') {
          <div class="controls">
            <label class="sr-only" for="perio-chart-select">{{ 'PERIO.TOOLBAR.CHART' | translate }}</label>
            <select id="perio-chart-select" class="pc-select" [ngModel]="open()!.id" (ngModelChange)="select($event)">
              @for (c of charts(); track c.id) {
                <option [value]="c.id">{{ 'PERIO.TOOLBAR.CHART_OF' | translate: { date: (c.chartDate | date: 'mediumDate') } }}</option>
              }
            </select>
            <button type="button" class="btn btn-secondary btn-sm" (click)="create()">
              <app-perio-icon name="plus" [size]="16"/> {{ 'PERIO.TOOLBAR.NEW' | translate }}
            </button>
            <span class="spacer"></span>
            <div class="toggle" role="group" [attr.aria-label]="'PERIO.NUMBERING.LABEL' | translate" [title]="'PERIO.NUMBERING.LABEL' | translate">
              <button type="button" [attr.aria-pressed]="numbering() === 'FDI'" [class.on]="numbering() === 'FDI'" (click)="setNumbering('FDI')">{{ 'PERIO.NUMBERING.FDI' | translate }}</button>
              <button type="button" [attr.aria-pressed]="numbering() === 'universal'" [class.on]="numbering() === 'universal'" (click)="setNumbering('universal')">{{ 'PERIO.NUMBERING.UNIVERSAL' | translate }}</button>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" [title]="'PERIO.TOOLBAR.PRINT_HINT' | translate" (click)="print()">
              <app-perio-icon name="download" [size]="16"/> {{ 'PERIO.TOOLBAR.PRINT' | translate }}
            </button>
            <button type="button" class="pc-icon-btn" [attr.aria-label]="'PERIO.TOOLBAR.HELP' | translate" [title]="'PERIO.TOOLBAR.HELP' | translate" (click)="helpOpen.set(true)">
              <app-perio-icon name="help" [size]="16"/>
            </button>
            <div class="menu-wrap">
              <button type="button" class="pc-icon-btn" [attr.aria-label]="'PERIO.TOOLBAR.MORE' | translate" [title]="'PERIO.TOOLBAR.MORE' | translate"
                      aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" (click)="toggleMenu($event)">
                <app-perio-icon name="more" [size]="16"/>
              </button>
              @if (menuOpen()) {
                <div class="menu" role="menu">
                  <button type="button" role="menuitem" (click)="clear()">{{ 'PERIO.TOOLBAR.CLEAR' | translate }}</button>
                  <button type="button" role="menuitem" class="danger" (click)="remove()">{{ 'PERIO.TOOLBAR.DELETE' | translate }}</button>
                  @if (deletedCount() > 0) {
                    <hr/>
                    <button type="button" role="menuitem" (click)="openDeleted()">{{ 'PERIO.TOOLBAR.RECENTLY_DELETED' | translate: { count: deletedCount() } }}</button>
                  }
                </div>
              }
            </div>
          </div>
        }
      </header>

      @if (saveState() === 'conflict') {
        <div class="conflict" role="alert">
          <span>{{ 'PERIO.SAVE.CONFLICT_HELP' | translate }}</span>
          <button type="button" class="btn btn-secondary btn-sm" (click)="reload()">{{ 'PERIO.SAVE.RELOAD' | translate }}</button>
        </div>
      }

      @if (loadFailed()) {
        <div class="pc-empty" role="alert">
          <p>{{ 'PERIO.LOAD_FAILED' | translate }}</p>
          <button type="button" class="btn btn-secondary btn-sm" (click)="load()">{{ 'PERIO.SAVE.RETRY' | translate }}</button>
        </div>
      } @else if (!loading() && !open()) {
        <div class="pc-empty">
          <app-perio-icon name="info" [size]="24"/>
          <h3>{{ 'PERIO.EMPTY.TITLE' | translate }}</h3>
          <p>{{ 'PERIO.EMPTY.TEXT' | translate }}</p>
          <button type="button" class="btn btn-primary" (click)="create()">{{ 'PERIO.EMPTY.CREATE' | translate }}</button>
          @if (deletedCount() > 0) {
            <button type="button" class="link" (click)="openDeleted()">{{ 'PERIO.TOOLBAR.RECENTLY_DELETED' | translate: { count: deletedCount() } }}</button>
          }
        </div>
      }

      @if (open() && view() === 'progression') {
        <app-perio-progression [charts]="charts()"/>
      }

      @if (open() && view() === 'chart') {
        <div class="paper" dir="ltr">
          <app-perio-grid [data]="data()" [toothStatus]="toothStatus()" [numbering]="numbering()"
                          (valueChange)="onValue($event)" (statusChange)="onStatus($event)" (modeChange)="mode.set($event)"/>
        </div>
        <app-perio-summary [summary]="summary()"/>

        <details class="visit">
          <summary>{{ 'PERIO.TOOLBAR.VISIT' | translate }}</summary>
          <div class="visit-grid">
            <label class="pf-field">
              <span>{{ 'PERIO.VISIT.DATE' | translate }}</span>
              <input class="control" type="date" [max]="today" [ngModel]="chartDate()" (ngModelChange)="setDate($event)"/>
            </label>
            <label class="pf-field wide">
              <span>{{ 'PERIO.VISIT.REASON' | translate }}</span>
              <input class="control" type="text" maxlength="200" [ngModel]="visitReason()" (ngModelChange)="setReason($event)"
                     [placeholder]="'PERIO.VISIT.REASON_PLACEHOLDER' | translate"/>
            </label>
            <label class="pf-field wide">
              <span>{{ 'PERIO.VISIT.NOTES' | translate }}</span>
              <textarea class="control" rows="3" maxlength="4000" [ngModel]="clinicalNotes()" (ngModelChange)="setNotes($event)"
                        [placeholder]="'PERIO.VISIT.NOTES_PLACEHOLDER' | translate"></textarea>
            </label>
          </div>
        </details>
      }
    </section>

    <app-perio-help [open]="helpOpen()" [mode]="mode()" (closed)="helpOpen.set(false)"/>
    <app-perio-tour [open]="tourOpen()" (done)="endTour()"/>

    <app-modal [open]="deletedOpen()" [title]="'PERIO.TOOLBAR.RECENTLY_DELETED' | translate: { count: deleted().length }" size="sm" (closed)="deletedOpen.set(false)">
      <ul class="deleted">
        @for (c of deleted(); track c.id) {
          <li>
            <span>{{ 'PERIO.TOOLBAR.CHART_OF' | translate: { date: (c.chartDate | date: 'mediumDate') } }}</span>
            <button type="button" class="btn btn-secondary btn-sm" (click)="restore(c)">{{ 'PERIO.TOOLBAR.RESTORE' | translate }}</button>
          </li>
        }
      </ul>
    </app-modal>
  `,
  styles: [`
    :host { display: block; --perio-fg: #09090b; --perio-muted: #f4f4f5; --perio-muted-fg: #71717a; --perio-border: #e4e4e7; --perio-accent: #f4f4f5; --perio-ring: #52525c; }
    .perio { display: flex; flex-direction: column; gap: .75rem; max-width: 1000px; }
    h2, h3, p { margin: 0; }
    .head { display: flex; flex-direction: column; gap: .5rem; }
    .titlebar { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
    .views { display: inline-flex; height: 2rem; align-items: center; gap: 2px; margin-inline-start: auto; padding: 2px; border-radius: 9999px; background: var(--surface-sunken); }
    .views button { display: inline-flex; height: 1.75rem; align-items: center; padding: 0 .75rem; border: 0; border-radius: 9999px; background: transparent; color: var(--text-muted); font: inherit; font-size: var(--text-sm); font-weight: 500; white-space: nowrap; cursor: pointer; }
    .views button:hover:not(.on) { color: var(--text); }
    .views button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
    h2 { font-size: 1.125rem; line-height: 1.25; font-weight: 600; }
    .save { display: inline-flex; align-items: center; gap: .375rem; min-height: 2rem; font-size: var(--text-xs); color: var(--text-muted); }
    .save[data-state='error'] { color: var(--status-critical-text); }
    .save[data-state='saved'] { color: var(--status-done-text); }
    .link { border: 0; background: none; padding: 0; font: inherit; color: var(--action); text-decoration: underline; cursor: pointer; }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; }
    .spacer { flex: 1; }
    .pc-select { height: 2rem; width: auto; min-width: 12rem; flex: 0 0 auto; padding: 0 1.75rem 0 .625rem; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface); color: var(--text); font: inherit; font-size: var(--text-sm); }
    .toggle { display: inline-flex; height: 2rem; align-items: center; padding: 2px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); }
    .toggle button { height: 100%; padding: 0 .625rem; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); font: inherit; font-size: var(--text-sm); cursor: pointer; }
    .toggle button.on { background: var(--surface-sunken); color: var(--text); font-weight: 600; }
    .toggle button:hover:not(.on) { color: var(--text); }
    .pc-icon-btn { display: inline-flex; width: 2rem; height: 2rem; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-muted); cursor: pointer; }
    .pc-icon-btn:hover { background: var(--surface-hover); color: var(--text); }
    .menu-wrap { position: relative; }
    .menu { position: absolute; z-index: 40; inset-inline-end: 0; top: calc(100% + 4px); min-width: 14rem; padding: .25rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-lg); }
    .menu button { display: block; width: 100%; padding: .375rem .625rem; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); font: inherit; font-size: var(--text-sm); text-align: start; cursor: pointer; }
    .menu button:hover { background: var(--surface-hover); }
    .menu .danger { color: var(--status-critical-text); }
    .menu hr { margin: .25rem 0; border: 0; border-top: 1px solid var(--border); }
    .conflict { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; padding: .75rem 1rem; border: 1px solid var(--status-attention); border-radius: var(--radius-md); background: var(--status-attention-tint); color: var(--status-attention-text); font-size: var(--text-sm); }
    .pc-empty { display: flex; flex-direction: column; align-items: center; gap: .5rem; padding: 2.5rem 1rem; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); text-align: center; color: var(--text-muted); }
    .pc-empty h3 { font-size: var(--text-md); color: var(--text); }
    .pc-empty p { max-width: 32rem; font-size: var(--text-sm); }
    .paper { border-radius: 8px; background: #fff; font-family: 'Inter', var(--font-sans); font-size: 16px; line-height: 1.5; color: #09090b; box-shadow: 0 0 0 1px var(--border); }
    .visit { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
    .visit summary { padding: .625rem .875rem; font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
    .visit-grid { display: grid; grid-template-columns: 12rem 1fr; gap: .75rem; padding: 0 .875rem .875rem; }
    .pf-field { display: flex; flex-direction: column; gap: .25rem; font-size: var(--text-xs); font-weight: 600; }
    .pf-field.wide { grid-column: 1 / -1; }
    .control { padding: .4375rem .5rem; font: inherit; font-size: var(--text-sm); font-weight: 400; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
    @media (max-width: 560px) { .visit-grid { grid-template-columns: 1fr; } }
    .deleted { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .deleted li { display: flex; align-items: center; justify-content: space-between; gap: .75rem; font-size: var(--text-sm); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  `],
})
export class PerioChartComponent implements OnDestroy {
  readonly patientId = input.required<string>();
  /** For the header of the printout; the chart itself does not need them. */
  readonly patientName = input<string | null>(null);
  readonly patientBirthDate = input<string | null>(null);

  private readonly api = inject(PerioChartService);
  private readonly toast = inject(ToastService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly grid = viewChild(PerioGridComponent);
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private readonly auth = inject(AuthService);
  private readonly cabinet = inject(CabinetService);

  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly charts = signal<readonly PerioChartListItem[]>([]);
  protected readonly deleted = signal<readonly PerioChartListItem[]>([]);
  protected readonly deletedCount = computed(() => this.deleted().length);
  protected readonly open = signal<OpenChart | null>(null);

  protected readonly data = signal<PerioData>(emptyPerioData());
  protected readonly toothStatus = signal<ToothStatusMap>({});
  protected readonly chartDate = signal(this.today);
  protected readonly visitReason = signal('');
  protected readonly clinicalNotes = signal('');
  protected readonly summary = computed(() => summarize(this.data()));

  protected readonly saveState = signal<SaveState>('idle');
  protected readonly view = signal<'chart' | 'progression'>('chart');
  protected readonly mode = signal<PerioMode>('pocketDepth');
  protected readonly numbering = signal<ToothNumbering>(remembered(NUMBERING_KEY) === 'universal' ? 'universal' : 'FDI');
  protected readonly helpOpen = signal(false);
  protected readonly tourOpen = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly deletedOpen = signal(false);

  /** Counts every edit; a save that finishes at an older revision leaves the chart dirty. */
  private revision = 0;
  private savedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor() {
    effect(() => {
      this.patientId();
      untracked(() => void this.load());
    });
  }

  ngOnDestroy(): void {
    // Leaving the page with an edit still waiting: send it now rather than lose it.
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.run();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.revision !== this.savedRevision && this.saveState() !== 'conflict') event.preventDefault();
  }

  @HostListener('document:click')
  protected onDocumentClick(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
  }

  // ── loading ──────────────────────────────────────────────────────────

  protected async load(): Promise<void> {
    await this.flush();
    const patientId = this.patientId();
    this.loading.set(true);
    this.loadFailed.set(false);
    this.open.set(null);
    this.view.set('chart');
    try {
      const [charts, deleted] = await Promise.all([
        firstValueFrom(this.api.list(patientId)),
        firstValueFrom(this.api.listDeleted(patientId)),
      ]);
      this.charts.set(charts);
      this.deleted.set(deleted);
      if (charts.length) {
        this.apply(await firstValueFrom(this.api.get(patientId, charts[0].id)));
        this.maybeTour();
      }
    } catch (error) {
      console.error('Failed to load periodontal charts', error);
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  private apply(dto: PerioChartDto): void {
    this.data.set(fromApi(dto.teeth));
    this.toothStatus.set(dto.toothStatus);
    this.chartDate.set(dto.chartDate);
    this.visitReason.set(dto.visitReason ?? '');
    this.clinicalNotes.set(dto.clinicalNotes ?? '');
    this.open.set({ id: dto.id, patientId: dto.patientId, version: dto.version });
    this.revision = this.savedRevision = 0;
    this.saveState.set('idle');
  }

  private maybeTour(): void {
    if (remembered(TOUR_KEY) === null) this.tourOpen.set(true);
  }

  protected endTour(): void {
    this.tourOpen.set(false);
    remember(TOUR_KEY, 'done');
    this.grid()?.focus();
  }

  // ── choosing, creating, deleting ──────────────────────────────────────

  protected async select(chartId: string): Promise<void> {
    const current = this.open();
    if (!current || chartId === current.id) return;
    await this.flush();
    try {
      this.apply(await firstValueFrom(this.api.get(current.patientId, chartId)));
    } catch (error) {
      console.error('Failed to open the periodontal chart', error);
      this.toast.error(this.translate.instant('PERIO.LOAD_FAILED'));
    }
  }

  protected async create(): Promise<void> {
    await this.flush();
    const patientId = this.patientId();
    try {
      const dto = await firstValueFrom(this.api.create(patientId, {}));
      this.apply(dto);
      this.charts.set(await firstValueFrom(this.api.list(patientId)));
      if (this.tourOpen() === false && remembered(TOUR_KEY) === null) this.tourOpen.set(true);
      else queueMicrotask(() => this.grid()?.focus());
    } catch (error) {
      console.error('Failed to create the periodontal chart', error);
      this.toast.error(this.translate.instant('PERIO.CREATE_FAILED'));
    }
  }

  protected async remove(): Promise<void> {
    const current = this.open();
    if (!current) return;
    const date = this.shownDate(this.chartDate());
    const confirmed = await this.confirmDialog.confirm(this.translate.instant('PERIO.DELETE.TEXT', { date }), {
      title: this.translate.instant('PERIO.DELETE.TITLE'),
      confirmLabel: this.translate.instant('PERIO.DELETE.CONFIRM'),
      cancelLabel: this.translate.instant('PERIO.DELETE.CANCEL'),
      danger: true,
    });
    if (!confirmed) return;
    // Whatever is waiting to be saved belongs to the chart that is about to go.
    this.cancelPending();
    try {
      await firstValueFrom(this.api.delete(current.patientId, current.id));
      this.toast.success(this.translate.instant('PERIO.DELETE.DONE'));
      await this.load();
    } catch (error) {
      console.error('Failed to delete the periodontal chart', error);
      this.toast.error(this.translate.instant('PERIO.SAVE.FAILED'));
    }
  }

  /** A date in the language of the screen, without needing Angular's locale data for it. */
  private shownDate(isoDate: string): string {
    try {
      return new Intl.DateTimeFormat(this.translate.currentLang || undefined, { dateStyle: 'medium' }).format(new Date(`${isoDate}T12:00:00`));
    } catch {
      return isoDate;
    }
  }

  protected openDeleted(): void {
    this.menuOpen.set(false);
    this.deletedOpen.set(true);
  }

  protected async restore(chart: PerioChartListItem): Promise<void> {
    try {
      await firstValueFrom(this.api.restore(this.patientId(), chart.id));
      this.deletedOpen.set(false);
      this.toast.success(this.translate.instant('PERIO.DELETE.RESTORED'));
      await this.load();
    } catch (error) {
      console.error('Failed to restore the periodontal chart', error);
      this.toast.error(this.translate.instant('PERIO.SAVE.FAILED'));
    }
  }

  protected toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((v) => !v);
  }

  protected clear(): void {
    this.menuOpen.set(false);
    this.data.set(emptyPerioData());
    this.touch();
    this.toast.info(this.translate.instant('PERIO.CLEARED'));
  }

  protected print(): void {
    const host = this.root().nativeElement;
    const sheet = host.querySelector('app-perio-grid .sheet');
    if (!sheet) return;
    const t = (key: string, params?: object): string => this.translate.instant(key, params);
    const user = this.auth.currentUser();
    const cabinet = this.cabinet.cabinetInfo();
    const opened = openPerioPrint({
      labels: {
        title: t('PERIO.TITLE'), patient: t('PERIO.PRINT.PATIENT'), born: t('PERIO.PRINT.BORN'), chartDate: t('PERIO.PRINT.CHART_DATE'),
        practitioner: t('PERIO.PRINT.PRACTITIONER'), reason: t('PERIO.VISIT.REASON'), notes: t('PERIO.VISIT.NOTES'),
        generated: t('PERIO.PRINT.GENERATED', { date: this.shownDate(new Date().toISOString().slice(0, 10)) }),
      },
      clinicName: cabinet?.name,
      clinicContact: [cabinet?.address, cabinet?.tel].filter((v): v is string => !!v),
      patientName: this.patientName(),
      patientBirthDate: this.patientBirthDate() ? this.shownDate(this.patientBirthDate()!) : null,
      chartDate: this.shownDate(this.chartDate()),
      practitioner: user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : null,
      visitReason: this.visitReason().trim() || null,
      clinicalNotes: this.clinicalNotes().trim() || null,
      sheet,
      summary: host.querySelector('app-perio-summary'),
      direction: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
      language: this.translate.currentLang || 'fr',
    });
    if (!opened) this.toast.error(t('PERIO.PRINT.BLOCKED'));
  }

  /** The trends are drawn from the saved summaries: send what is waiting first so they include it. */
  protected showProgression(): void {
    this.view.set('progression');
    void this.flush();
  }

  protected setNumbering(numbering: ToothNumbering): void {
    this.numbering.set(numbering);
    remember(NUMBERING_KEY, numbering);
  }

  // ── editing ────────────────────────────────────────────────────────────

  protected onValue(change: PerioValueChange): void {
    if (valueAt(this.data(), change.tooth, change.mode, change.site) === change.value) return;
    this.data.update((d) => withValue(d, change.tooth, change.mode, change.site, change.value));
    this.touch();
  }

  protected onStatus(change: PerioStatusChange): void {
    this.toothStatus.update((s) => withToothStatus(s, change.tooth, change.status));
    // A tooth that is not there has nothing to probe.
    if (change.status === 'missing' || change.status === 'pontic') {
      this.data.update((d) => withToothCleared(d, change.tooth));
    }
    this.touch();
  }

  protected setDate(value: string): void {
    if (!value || value === this.chartDate()) return;
    this.chartDate.set(value);
    this.touch();
  }

  protected setReason(value: string): void {
    this.visitReason.set(value);
    this.touch();
  }

  protected setNotes(value: string): void {
    this.clinicalNotes.set(value);
    this.touch();
  }

  // ── saving ───────────────────────────────────────────────────────────

  private touch(): void {
    this.revision++;
    if (this.saveState() === 'conflict') return;
    this.saveState.set('dirty');
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, AUTOSAVE_MS);
  }

  private cancelPending(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.savedRevision = this.revision;
  }

  /** Sends what is waiting, now, and resolves when the server has it (or refused it). */
  private async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.run();
  }

  /** One save at a time, one after the other until nothing is left behind. */
  private run(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      while (this.revision !== this.savedRevision && this.open() && this.saveState() !== 'conflict') {
        if (!(await this.saveOnce())) break;
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private request(chart: OpenChart): SavePerioChartRequest {
    return {
      expectedVersion: chart.version,
      chartDate: this.chartDate(),
      visitReason: this.visitReason().trim() || null,
      clinicalNotes: this.clinicalNotes().trim() || null,
      toothStatus: { ...this.toothStatus() },
      teeth: toApi(this.data()),
    };
  }

  private async saveOnce(): Promise<boolean> {
    const chart = this.open();
    if (!chart) return true;
    const revision = this.revision;
    this.saveState.set('saving');
    try {
      const dto = await firstValueFrom(this.api.save(chart.patientId, chart.id, this.request(chart)));
      this.open.set({ ...chart, version: dto.version });
      this.savedRevision = revision;
      this.charts.update((list) => list.map((c) => (c.id === dto.id
        ? { ...c, chartDate: dto.chartDate, visitReason: dto.visitReason, version: dto.version, updatedAt: dto.updatedAt, summary: dto.summary }
        : c)));
      this.saveState.set(this.revision === this.savedRevision ? 'saved' : 'dirty');
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.saveState.set(status === 409 ? 'conflict' : 'error');
      if (status !== 409) console.error('Failed to save the periodontal chart', error);
      return false;
    }
  }

  protected retry(): void {
    void this.run();
  }

  /** Someone else changed the chart: drop what this screen had and show theirs. */
  protected async reload(): Promise<void> {
    const chart = this.open();
    if (!chart) return;
    this.cancelPending();
    this.saveState.set('idle');
    try {
      this.apply(await firstValueFrom(this.api.get(chart.patientId, chart.id)));
    } catch (error) {
      console.error('Failed to reload the periodontal chart', error);
      this.saveState.set('conflict');
    }
  }
}
