import { Component, Input, Output, EventEmitter, AfterViewInit, ElementRef, ViewChild, OnChanges, SimpleChanges, computed, inject, OnDestroy, Renderer2, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DentalChartService } from '../../core/services/dental-chart.service';
import { ToothState, ToothStatus, DentalChartType } from '../../core/models/patient.model';
import { PatientTreatment } from '../../core/models/patient-treatment.model';
import { ToothFinding } from '../../core/models/clinical-record.model';
import { ADULT_SVG, CHILD_SVG } from './dental-chart-svg-data';
import {
  FAMILY_PAINT,
  PLANNED_PAINT,
  ToothOverlay,
  TOOTH_STATUS_GROUPS,
  TREATMENT_PLAN_INK,
  VOICE_FOCUS_INK,
  VOICE_STAGED_INK,
  odontogramPatternDefs,
  toothOverlays,
  toothPaint,
  toothStatusDefinition,
} from '../../core/clinical/tooth-status';

import { SURFACE_ZONES, SURFACE_ZONE_PATH, surfaceMarks, surfaceShorthand } from '../../core/clinical/tooth-surfaces';
import { findingLabel } from '../../core/clinical/finding-options';
import { ToothNumberTyping, stepInGrid, toothGrid } from '../../core/clinical/tooth-grid';
import { AnnouncerService } from '../../core/services/announcer.service';
import { ModalComponent } from '../../shared/ui/modal.component';
import { ChartKeysComponent } from './chart-keys.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../core/services/toast.service';

import { FormsModule } from '@angular/forms';
import { ToothDetailComponent } from './tooth-detail/tooth-detail.component';

/** Where a tooth is on the drawing, in percent of the drawing. */
interface ToothCell {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

let nextId = 1;

/** How much of the chart a tooth takes up in close-up, in percent of its longer side. */
const CLOSE_UP_SHARE = 45;

@Component({
  selector: 'app-dental-chart',
  standalone: true,
  imports: [CommonModule, TranslateModule, FormsModule, ToothDetailComponent, ModalComponent, ChartKeysComponent],
  template: `
    <div class="dental-chart-wrapper" [class.summary]="summary">
      <div class="chart-header">
        <div class="header-left">
          <span class="chart-type-badge" [class.adult]="chartType === 'adult'" [class.child]="chartType === 'child'">
            <span class="material-icons" aria-hidden="true">{{ chartType === 'adult' ? 'person' : 'child_care' }}</span>
            {{ (chartType === 'adult' ? 'DENTAL_CHART.ADULT_TITLE' : 'DENTAL_CHART.CHILD_TITLE') | translate }}
          </span>
          <span class="tooth-info">
            @if (hoveredTooth(); as hovered) {
              <span class="tooth-num">#{{ hovered }}</span>
              <span class="tooth-name">{{ getToothName(hovered) }}</span>
              <span class="tooth-status-label" [style.color]="getStatusColor(hovered)">{{ getToothStatusLabel(hovered) | translate }}</span>
            } @else {
              <span class="placeholderText">{{ 'DENTAL_CHART.HOVER_PROMPT' | translate }}</span>
            }
          </span>
        </div>
        <div class="header-right" *ngIf="interactive && !summary">
          <button type="button" class="btn-icon-sm" (click)="copyStateString($event)" [title]="'DENTAL_CHART.COPY_STATE' | translate" [attr.aria-label]="'DENTAL_CHART.COPY_STATE' | translate">
            <span class="material-icons" aria-hidden="true">content_copy</span>
          </button>
        </div>
      </div>

      <div class="svg-container" [class.close-up]="!!zoomedTooth()" (keydown)="onKeydown($event)">
        <div class="svg-stage" [style.transform]="stageTransform()">
          <!-- The drawing is for the eye. Under the keyboard and a screen reader are the buttons laid over it, one per tooth. -->
          <div #chartContainer class="svg-drawing" aria-hidden="true" [innerHTML]="svgContent"></div>
          <div class="tooth-cells" role="grid" [attr.aria-label]="'DENTAL_CHART.TEETH' | translate" [attr.aria-readonly]="!interactive" [attr.aria-describedby]="keysId">
            @for (row of rows; track $index; let upper = $first) {
              <div role="row" [attr.aria-label]="(upper ? 'DENTAL_3D.UPPER_ARCH' : 'DENTAL_3D.LOWER_ARCH') | translate">
                @for (fdi of row; track fdi) {
                  <button type="button" role="gridcell" class="tooth-cell" [attr.data-fdi]="fdi"
                    [style.left.%]="cells().get(fdi)?.left" [style.top.%]="cells().get(fdi)?.top"
                    [style.width.%]="cells().get(fdi)?.width" [style.height.%]="cells().get(fdi)?.height"
                    [attr.aria-label]="toothAria(fdi)" [attr.aria-selected]="zoomedTooth() === fdi"
                    [attr.tabindex]="tabStop() === fdi ? 0 : -1"
                    (click)="onToothClick(fdi)" (focus)="onCellFocus(fdi)" (blur)="onToothLeave(fdi)"></button>
                }
              </div>
            }
          </div>
        </div>
      </div>
      <p class="sr-only" [id]="keysId">{{ keysHelp() | translate }}</p>
      <app-chart-keys class="chart-keys" [closeUp]="!!zoomedTooth()" [detail]="opensDetail" [spaceAction]="opensDetail ? 'TOOTH_KEYS.DETAIL' : interactive ? 'TOOTH_KEYS.SELECT' : null" />

      <!-- Status selection popup -->
      @if (selectedTooth(); as fdi) {
      <app-modal [open]="true" size="md" [title]="('DENTAL_CHART.TOOTH_NUMBER' | translate) + ' ' + fdi" (closed)="closeStatusMenu()">
          <div class="status-sections">
            @if (patientId) {
              <!-- A tooth can carry several states, each on its own surface: the panel
                   records findings (the server derives the painted status from them). -->
              <app-tooth-detail [patientId]="patientId" [fdi]="fdi" [findings]="findings" />
            } @else {
            @for (group of statusGroups; track group.family) {
              <div class="status-group">
                <h4 class="status-group-title">{{ group.titleKey | translate }}</h4>
                <div class="status-grid">
                  @for (opt of group.options; track opt.value) {
                    <button type="button"
                      class="status-option"
                      [class.active]="(teeth && teeth[fdi]?.status) === opt.value"
                      [attr.aria-pressed]="(teeth && teeth[fdi]?.status) === opt.value"
                      (click)="selectStatus(fdi, opt.value)"
                    >
                      <span class="status-dot" [style.background]="opt.color"></span>
                      {{ opt.label | translate }}
                    </button>
                  }
                </div>
              </div>
            }
            }

            <div class="note-section">
              <label class="note-label" [for]="noteId">
                <span class="material-icons" aria-hidden="true">edit_note</span>
                {{ 'DENTAL_CHART.NOTE_LABEL' | translate }}
              </label>
              <textarea
                [id]="noteId"
                class="note-textarea"
                [placeholder]="'DENTAL_CHART.NOTE_PLACEHOLDER' | translate"
                [(ngModel)]="currentToothNote"
                (ngModelChange)="saveToothNote()"
              ></textarea>
            </div>
          </div>

          @if (!patientId) {
            <div class="menu-footer">
              <button type="button" class="btn-reset" (click)="selectStatus(fdi, 'present')">
                {{ 'DENTAL_CHART.RESET_PRESENT' | translate }}
              </button>
            </div>
          }
      </app-modal>
      }

      @if (!summary) {
      <div class="chart-footer">
        <div class="legend">
          @for (group of statusGroups; track group.family) {
            @for (opt of group.options; track opt.value) {
              <span class="legend-item">
                <span class="legend-dot" [style.background]="opt.color"></span>
                {{ opt.label | translate }}
              </span>
            }
          }
          @if (hasPlannedWork()) {
            <span class="legend-item">
              <span class="legend-dot legend-dot-planned" [style.borderColor]="plannedColor"></span>
              {{ 'DENTAL_CHART.PLANNED_WORK_PENDING' | translate }}
            </span>
          }
        </div>
      </div>

      <!-- Report Section -->
      <div class="report-container" [class.open]="showReport">
        <button type="button" class="report-toggle" [attr.aria-expanded]="showReport" (click)="showReport = !showReport">
          <div class="toggle-left">
            <span class="material-icons" aria-hidden="true">{{ showReport ? 'expand_less' : 'description' }}</span>
            <span class="report-title">{{ 'DENTAL_CHART.REPORT_TITLE' | translate }}</span>
            <span class="note-count" *ngIf="teethWithNotes.length > 0">{{ teethWithNotes.length }}</span>
          </div>
          <div class="toggle-right">
            <span class="material-icons toggle-arrow" aria-hidden="true">{{ showReport ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</span>
          </div>
        </button>
        
        <div class="report-content" *ngIf="showReport">
          @if (teethWithNotes.length > 0) {
            <div class="report-list">
              @for (tooth of teethWithNotes; track tooth.id) {
                <div class="report-item" (mouseenter)="highlightTooth(tooth.id, true)" (mouseleave)="highlightTooth(tooth.id, false)">
                  <div class="item-header">
                    <span class="tooth-badge">#{{ tooth.id }}</span>
                    <span class="tooth-name-sm">{{ getToothName(tooth.id) }}</span>
                    <span class="status-indicator" [style.background]="getStatusColor(tooth.id)"></span>
                    <span class="status-text-sm">{{ getToothStatusLabel(tooth.id) | translate }}</span>
                  </div>
                  <div class="item-note">{{ tooth.notes }}</div>
                </div>
              }
            </div>
          } @else {
            <div class="no-notes-state">
              <span class="material-icons" aria-hidden="true">notes</span>
              <p>{{ 'DENTAL_CHART.NO_NOTES' | translate }}</p>
            </div>
          }
        </div>
      </div>
      }
    </div>

  `,
  styleUrl: './dental-chart.component.css'
})
export class DentalChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() chartType: DentalChartType = 'adult';
  @Input() patientId = '';
  @Input() teeth: Record<string, ToothState> = {};
  @Input() interactive = true;
  @Input() patientTreatments: PatientTreatment[] = [];
  /** Active clinical findings, used to draw the planned-work overlay (audit VIII.10 / IX). */
  @Input() findings: ToothFinding[] = [];
  /** Teeth a voice session has dictated findings on that are not saved yet. */
  @Input() stagedTeeth: string[] = [];
  /** The tooth the last voice command was about, drawn so it can be checked at a glance. */
  @Input() focusFdi: string | null = null;
  /**
   * Whether clicking a tooth opens the status picker. Off in the voice
   * session panel, where a tap only tells the assistant what "that tooth"
   * means — a picker covering the chart mid-dictation hides what it verifies.
   */
  @Input() statusMenu = true;
  /**
   * The chart as part of a treatment summary: to read, with its legend beside it.
   * Only the drawing, without the picker, the short key or the observations list.
   */
  @Input() summary = false;
  /** Legend letters to draw beside each tooth. */
  @Input() toothKeys: Readonly<Record<string, readonly string[]>> = {};
  /** Teeth that have had treatment administered: ringed, as in the printed chart. */
  @Input() doneTeeth: readonly string[] = [];
  /** Teeth to pick out, from pointing at a line of the legend. */
  @Input() highlightTeeth: readonly string[] = [];
  /** What the legend says about each tooth: the letters drawn beside it mean nothing to a screen reader. */
  @Input() toothNotes: Readonly<Record<string, readonly string[]>> = {};

  @Output() toothSelected = new EventEmitter<ToothState>();
  @Output() toothHovered = new EventEmitter<ToothState | null>();
  @Output() chartUpdated = new EventEmitter<string>();

  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef<HTMLDivElement>;

  chartService = inject(DentalChartService);
  private sanitizer = inject(DomSanitizer);
  private renderer = inject(Renderer2);
  /** Unlisten functions from the last attachToothListeners() pass — every tooth path gets 2-3 listeners, and initChart() re-runs on every chartType change, so without tracking these they accumulate and multi-fire (audit III.6). */
  private toothListenerCleanups: Array<() => void> = [];
  private translate = inject(TranslateService);
  private toast = inject(ToastService);
  private announcer = inject(AnnouncerService);

  svgContent: SafeHtml = '';
  // Signals: these are set from listeners on the drawing, which Angular does not watch.
  readonly hoveredTooth = signal<string | null>(null);
  readonly selectedTooth = signal<string | null>(null);
  readonly zoomedTooth = signal<string | null>(null);
  private readonly roving = signal<string | null>(null);
  protected readonly cells = signal<ReadonlyMap<string, ToothCell>>(new Map());
  currentToothNote: string = '';
  showReport: boolean = false;
  private listenersAttached = false;
  private readonly typing = new ToothNumberTyping();

  protected readonly keysId = `dental-chart-keys-${nextId}`;
  protected readonly noteId = `dental-chart-note-${nextId++}`;

  get rows() {
    return toothGrid(this.chartType);
  }

  /** Clicking a tooth opens its panel, so Enter on one in close-up can too. */
  get opensDetail(): boolean {
    return this.interactive && this.statusMenu;
  }

  /** The one tooth Tab lands on. */
  protected tabStop(): string {
    const teeth = this.rows.flat();
    const known = (fdi: string | null) => (fdi && teeth.includes(fdi) ? fdi : null);
    return known(this.zoomedTooth()) ?? known(this.roving()) ?? teeth[0];
  }

  protected keysHelp(): string {
    if (this.zoomedTooth()) return this.opensDetail ? 'DENTAL_CHART.KEYS_CLOSE_UP' : 'DENTAL_CHART.KEYS_CLOSE_UP_READ';
    return this.opensDetail ? 'DENTAL_CHART.KEYS_MOUTH' : 'DENTAL_CHART.KEYS_MOUTH_READ';
  }

  /** Slides and enlarges the drawing so the tooth is in the middle of it, its neighbours in sight. */
  protected readonly stageTransform = computed(() => {
    const fdi = this.zoomedTooth();
    const cell = fdi ? this.cells().get(fdi) : undefined;
    if (!cell) return null;
    const scale = Math.min(4, CLOSE_UP_SHARE / Math.max(cell.width, cell.height, 1));
    const x = 50 - (cell.left + cell.width / 2) * scale;
    const y = 50 - (cell.top + cell.height / 2) * scale;
    return `translate(${x.toFixed(2)}%, ${y.toFixed(2)}%) scale(${scale.toFixed(3)})`;
  });

  /**
   * The picker and legend, grouped by clinical family (absent / active
   * condition / existing restoration) rather than presented as one flat grid
   * of fifteen colours — see core/clinical/tooth-status.ts for why. Every
   * status keeps its own dot and its own translated label; the colour is
   * shared within a family by design, so the family — not the individual
   * shade — is what a clinician has to recognise on sight.
   */
  statusGroups = TOOTH_STATUS_GROUPS.map((group) => ({
    family: group.family,
    titleKey: group.titleKey,
    options: group.statuses.map((status) => ({
      value: status,
      label: `DENTAL_CHART.STATUS.${status.toUpperCase()}`,
      color: FAMILY_PAINT[group.family].solid,
    })),
  }));

  readonly plannedColor = PLANNED_PAINT.solid;

  /** fdi → active planned/hidden-condition findings, recomputed on teeth/findings change. */
  private overlays = new Map<string, ToothOverlay>();

  hasPlannedWork(): boolean {
    for (const overlay of this.overlays.values()) {
      if (overlay.planned.length) return true;
    }
    return false;
  }

  constructor() {
    this.updateSvgContent();
  }

  ngAfterViewInit() {
    this.initChart();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['chartType']) {
      this.zoomedTooth.set(null);
      this.updateSvgContent();
      this.initChart();
    }
    if (changes['findings'] || changes['teeth']) {
      this.overlays = toothOverlays(this.findings ?? []);
    }
    const repaintKeys = ['teeth', 'patientTreatments', 'findings', 'stagedTeeth', 'focusFdi', 'toothKeys', 'doneTeeth', 'highlightTeeth'];
    if (repaintKeys.some(key => changes[key]) && this.chartContainer) {
      setTimeout(() => this.repaint(), 0);
    }
  }

  ngOnDestroy() {
    this.detachToothListeners();
  }

  private initChart() {
    this.listenersAttached = false;
    setTimeout(() => {
      this.attachToothListeners();
      this.repaint();
    }, 150); // Increased delay for SVG rendering
  }

  /** Every paint layer, bottom to top; each pass starts from a clean outline. */
  private repaint() {
    this.clearVoiceMarks();
    this.applyAllToothColors();
    this.applyTreatmentIndicators();
    this.applyDoneRings();
    this.applyOverlays();
    this.applySurfaceMarks();
    this.applyToothKeys();
    this.applyVoiceMarks();
    this.applyHighlights();
    this.cropToTeeth();
    this.placeCells();
  }

  /** Lays one button over each tooth. Being in percent, they follow the drawing however large it is shown. */
  private placeCells() {
    const svg = this.chartContainer?.nativeElement.querySelector('svg');
    if (!svg) return;
    const view = svg.viewBox.baseVal;
    if (!view.width || !view.height) return;
    const prefix = this.getToothPrefix();
    const cells = new Map<string, ToothCell>();
    for (const fdi of this.rows.flat()) {
      const box = svg.querySelector<SVGGraphicsElement>(`.${prefix}${fdi}-parent`)?.getBBox?.();
      if (!box) continue;
      cells.set(fdi, {
        left: ((box.x - view.x) / view.width) * 100,
        top: ((box.y - view.y) / view.height) * 100,
        width: (box.width / view.width) * 100,
        height: (box.height / view.height) * 100,
      });
    }
    this.cells.set(cells);
  }

  /** In a summary the drawing fills its space: a child's smaller arches read as large as an adult's, as they print. */
  private cropToTeeth() {
    if (!this.summary) return;
    const svg = this.chartContainer?.nativeElement.querySelector('svg');
    if (!svg || svg.dataset['cropped'] === this.chartType) return;
    const box = svg.getBBox?.();
    if (!box?.width || !box.height) return;
    svg.setAttribute('viewBox', `${box.x - 6} ${box.y - 6} ${box.width + 12} ${box.height + 12}`);
    svg.dataset['cropped'] = this.chartType;
  }

  private updateSvgContent() {
    const raw = this.chartType === 'adult' ? ADULT_SVG : CHILD_SVG;
    // A second sibling <defs> block, inserted ahead of the SVG's own marker
    // defs — legal SVG, and it keeps every status pattern generated from one
    // place (core/clinical/tooth-status.ts) instead of hand-drawn per chart.
    const withPatterns = raw.replace('<defs>', `${odontogramPatternDefs()}<defs>`);
    // Safe to bypass sanitisation here: both inputs are build-time constants —
    // ADULT_SVG / CHILD_SVG and odontogramPatternDefs() (from
    // core/clinical/tooth-status.ts) — with no patient or user data anywhere
    // in the string. Do not let any runtime value into `withPatterns` without
    // sanitising it first (audit L2).
    this.svgContent = this.sanitizer.bypassSecurityTrustHtml(withPatterns);
  }


  private getToothPrefix(): string {
    return this.chartType === 'adult' ? 'tooth-' : 'child-tooth-';
  }

  /** The drawing answers the pointer, by the true shape of each tooth. The keyboard goes through the buttons over it. */
  private attachToothListeners() {
    if (!this.chartContainer) return;
    // initChart() re-runs on every chartType change without ever detaching
    // the previous pass's listeners — clear them first so this is always a
    // fresh attach, not an accumulating one (audit III.6).
    this.detachToothListeners();

    const container = this.chartContainer.nativeElement;
    const prefix = this.getToothPrefix();

    // Select all paths that represent a tooth
    const allToothPaths = container.querySelectorAll(`path[class*="${prefix}"]`);

    allToothPaths.forEach((path: any) => {
      const classes = path.getAttribute('class') || '';
      const regex = new RegExp(`${prefix}(\\d+)`);
      const match = classes.match(regex);
      if (!match) return;

      const toothId = match[1];
      const el = path as HTMLElement;

      this.toothListenerCleanups.push(
        this.renderer.listen(el, 'mouseenter', () => this.onToothHover(toothId)),
        this.renderer.listen(el, 'mouseleave', () => this.onToothLeave(toothId)),
      );

      if (this.interactive) {
        this.toothListenerCleanups.push(
          this.renderer.listen(el, 'click', (e: MouseEvent) => {
            e.stopPropagation();
            this.onToothClick(toothId);
          }),
        );
        el.style.cursor = 'pointer';
      }
    });

    this.listenersAttached = true;
  }

  /**
   * The same keys as the 3D chart: arrows go from tooth to tooth, Enter goes further in, Escape
   * comes back out, one level at a time. Space is left to the button, where it is a click.
   */
  protected onKeydown(event: KeyboardEvent) {
    const fdi = (event.target as HTMLElement).dataset?.['fdi'];
    if (!fdi || event.metaKey || event.altKey) return;
    if (this.handleKey(event, fdi)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private handleKey(event: KeyboardEvent, fdi: string): boolean {
    const zoomed = this.zoomedTooth();
    if (event.key === 'Enter') {
      if (zoomed !== fdi) {
        this.zoomTo(fdi);
      } else if (this.opensDetail) {
        this.onToothClick(fdi);
      }
      return true;
    }
    if (event.key === 'Escape') {
      if (!zoomed) return false;
      this.zoomTo(null);
      return true;
    }
    if (/^\d$/.test(event.key)) {
      const typed = this.typing.type(event.key, this.rows.flat(), performance.now());
      if (typed) this.goToTooth(typed);
      return true;
    }
    const next = stepInGrid(this.rows, fdi, event.key, event.ctrlKey);
    if (!next) return false;
    this.goToTooth(next);
    return true;
  }

  private goToTooth(fdi: string) {
    if (this.zoomedTooth()) this.zoomedTooth.set(fdi);
    this.focusCell(fdi);
  }

  private zoomTo(fdi: string | null) {
    const from = this.zoomedTooth();
    this.zoomedTooth.set(fdi);
    if (fdi) {
      this.focusCell(fdi);
      this.toothSelected.emit((this.teeth && this.teeth[fdi]) || { id: fdi, status: 'present' });
      this.announcer.announce(this.translate.instant('DENTAL_3D.ZOOMED', { fdi, name: this.getToothName(fdi) }));
    } else {
      if (from) this.focusCell(from);
      this.announcer.announce(this.translate.instant('DENTAL_3D.ZOOMED_OUT'));
    }
  }

  private focusCell(fdi: string) {
    this.roving.set(fdi);
    const stage = this.chartContainer?.nativeElement.parentElement;
    stage?.querySelector<HTMLElement>(`[data-fdi="${fdi}"]`)?.focus({ preventScroll: true });
    // In close-up the drawing has moved and the button with it: it is the chart's frame that has to be in view.
    stage?.parentElement?.scrollIntoView({ block: 'nearest' });
  }

  protected onCellFocus(fdi: string) {
    this.roving.set(fdi);
    // A chart opened while hidden had nothing to measure.
    if (!this.cells().size) this.placeCells();
    this.onToothHover(fdi);
  }

  /** What the eye gets from the tooth's fill, its outline and its marks. */
  toothAria(fdi: string): string {
    const status = (this.teeth && this.teeth[fdi])?.status || 'present';
    const findings = (this.findings ?? []).filter((f) => f.fdi === fdi && f.status === 'ACTIVE');
    const treatments = (this.patientTreatments ?? []).filter((t) => (t.teeth ?? '').split(',').map((x) => x.trim()).includes(fdi));
    return [
      `${fdi}, ${this.getToothName(fdi)}`,
      ...(status === 'present' ? [] : [this.translate.instant(this.getToothStatusLabel(fdi))]),
      ...(this.toothNotes?.[fdi] ?? findings.map((f) => {
        const label = findingLabel(this.translate, f.findingCode ?? '');
        return f.surface ? `${label} ${surfaceShorthand(f.surface)}` : label;
      })),
      ...treatments.map((t) => t.treatment.name),
      ...((this.stagedTeeth ?? []).includes(fdi) ? [this.translate.instant('VOICE.CHART_STAGED')] : []),
      ...((this.teeth && this.teeth[fdi]?.notes) ? [this.teeth[fdi].notes!] : []),
    ].join(', ');
  }

  private detachToothListeners() {
    for (const unlisten of this.toothListenerCleanups) unlisten();
    this.toothListenerCleanups = [];
  }

  onToothHover(toothId: string) {
    this.hoveredTooth.set(toothId);
    this.highlightTooth(toothId, true);
    const state = (this.teeth && this.teeth[toothId]) || { id: toothId, status: 'present' };
    this.toothHovered.emit(state);
  }

  onToothLeave(toothId: string) {
    this.hoveredTooth.set(null);
    this.highlightTooth(toothId, false);
    // The hover reset the outline to black; put back whatever it covered.
    if (this.stagedTeeth.length || this.focusFdi || this.patientTreatments.length || this.findings.length) {
      this.repaint();
    }
    this.toothHovered.emit(null);
  }

  private highlightTooth(toothId: string, active: boolean) {
    const prefix = this.getToothPrefix();
    const parentEl = this.chartContainer?.nativeElement.querySelector(`.${prefix}${toothId}-parent`) as HTMLElement;
    if (!parentEl) return;

    if (active) {
      parentEl.style.stroke = '#03045e';
      parentEl.style.strokeWidth = '2px';
      parentEl.style.filter = 'drop-shadow(0 0 2px rgba(3,4,94,0.5))';
    } else {
      parentEl.style.stroke = '#000';
      parentEl.style.strokeWidth = '1px';
      parentEl.style.filter = 'none';
    }
  }

  onToothClick(toothId: string) {
    if (!this.interactive) return;
    const state = (this.teeth && this.teeth[toothId]) || { id: toothId, status: 'present' };
    if (this.statusMenu) {
      this.selectedTooth.set(toothId);
      this.currentToothNote = state.notes || '';
    }
    this.toothSelected.emit(state);
  }

  saveToothNote() {
    const selected = this.selectedTooth();
    if (selected && this.patientId) {
      const status = this.teeth[selected]?.status || 'present';
      this.chartService.updateToothStatus(this.patientId, selected, status, this.currentToothNote);
      this.teeth = { 
        ...this.teeth, 
        [selected]: { 
          ...this.teeth[selected],
          id: selected, 
          status, 
          notes: this.currentToothNote 
        } 
      };
      const serialized = this.chartService.exportAsCompactString(this.patientId);
      this.chartUpdated.emit(serialized);
    }
  }

  get teethWithNotes(): ToothState[] {
    return Object.values(this.teeth || {}).filter(t => t.notes && t.notes.trim() !== '');
  }

  selectStatus(toothId: string, status: ToothStatus) {
    if (this.patientId) {
      this.chartService.updateToothStatus(this.patientId, toothId, status, this.currentToothNote);
      this.teeth = { ...this.teeth, [toothId]: { id: toothId, status, notes: this.currentToothNote } };
      const serialized = this.chartService.exportAsCompactString(this.patientId);
      this.chartUpdated.emit(serialized);
    }
    this.applyToothColor(toothId);
  }

  /** Back on the tooth, whether the panel was opened from the keyboard or with a click. */
  closeStatusMenu() {
    const fdi = this.selectedTooth();
    this.selectedTooth.set(null);
    if (fdi) this.focusCell(fdi);
  }

  private applyAllToothColors() {
    if (!this.chartContainer) return;
    const prefix = this.getToothPrefix();
    const allParents = this.chartContainer.nativeElement.querySelectorAll(`[class*="${prefix}"][class*="-parent"]`);
    allParents.forEach((el: any) => {
      el.style.fill = 'transparent';
      el.style.opacity = '1';
    });

    if (this.teeth) {
      Object.keys(this.teeth).forEach(id => this.applyToothColor(id));
    }
  }

  private applyToothColor(toothId: string) {
    const prefix = this.getToothPrefix();
    const el = this.chartContainer?.nativeElement.querySelector(`.${prefix}${toothId}-parent`) as HTMLElement;
    if (!el) return;

    const status = (this.teeth && this.teeth[toothId])?.status || 'present';
    const paint = toothPaint(status);
    el.style.fill = paint.fill;
    el.style.fillOpacity = paint.fillOpacity;
  }

  getToothStatusLabel(toothId: string): string {
    const status = (this.teeth && this.teeth[toothId])?.status || 'present';
    return `DENTAL_CHART.STATUS.${status.toUpperCase()}`;
  }

  /** Text-safe (AA on its own tint) colour for the hover label and report list. */
  getStatusColor(toothId: string): string {
    const status = (this.teeth && this.teeth[toothId])?.status || 'present';
    return FAMILY_PAINT[toothStatusDefinition(status).family].text;
  }

  getToothName(toothId: string): string {
    return this.translate.instant(`TOOTH_NAME.${toothId}`);
  }

  copyStateString(event: MouseEvent) {
    event.stopPropagation();
    if (this.patientId) {
      const state = this.chartService.exportAsCompactString(this.patientId);
      if (state) {
        navigator.clipboard.writeText(state).then(() => {
          this.translate.get('DENTAL_CHART.STATE_COPIED').subscribe(msg => {
            this.toast.success(msg);
          });
        });
      }
    }
  }

  private applyTreatmentIndicators() {
    if (!this.chartContainer || !this.patientTreatments) return;
    const prefix = this.getToothPrefix();

    this.patientTreatments.forEach(pt => {
      if (!pt.teeth) return;
      const teethIds = pt.teeth.split(',').map(t => t.trim());
      
      teethIds.forEach(toothId => {
        const el = this.chartContainer?.nativeElement.querySelector(`.${prefix}${toothId}-parent`) as HTMLElement;
        if (!el) return;

        if (pt.status === 'COMPLETED') {
          el.style.stroke = TREATMENT_PLAN_INK.COMPLETED;
          el.style.strokeWidth = '3px';
        } else if (pt.status === 'ACTIVE') {
          el.style.stroke = TREATMENT_PLAN_INK.ACTIVE;
          el.style.strokeWidth = '3px';
        } else if (pt.status === 'PLANNED') {
          el.style.stroke = TREATMENT_PLAN_INK.PLANNED;
          el.style.strokeWidth = '2px';
        }
      });
    });
  }

  /** Administered treatment rings the tooth in green, as on the printed chart. Drawn before work still owed, which has the last word. */
  private applyDoneRings() {
    const prefix = this.getToothPrefix();
    for (const fdi of this.doneTeeth ?? []) {
      const el = this.chartContainer?.nativeElement.querySelector(`.${prefix}${fdi}-parent`) as HTMLElement | null;
      if (!el) continue;
      el.style.stroke = TREATMENT_PLAN_INK.COMPLETED;
      el.style.strokeWidth = '2.4px';
    }
  }

  /**
   * The legend's letters, on the inside of the arch where there is room, square to the arch at
   * that tooth: straight at the centre they would drift past the neighbour and read as its
   * letters. The arch is taken as an ellipse through the teeth. The printed chart does the same
   * (OdontogramRenderer on the server).
   */
  private applyToothKeys() {
    const svg = this.chartContainer?.nativeElement.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.odo-tooth-key').forEach((n) => n.remove());
    const keys = Object.entries(this.toothKeys ?? {}).filter(([, letters]) => letters.length);
    if (!keys.length) return;

    const prefix = this.getToothPrefix();
    const CENTRE_X = 145;
    const parents = [...svg.querySelectorAll<SVGGraphicsElement>(`[class*="${prefix}"][class*="-parent"]`)];
    const centres = parents.map((el) => {
      const box = el.getBBox();
      const fdi = el.getAttribute('class')?.match(new RegExp(`${prefix}(\\d+)`))?.[1] ?? '';
      return { fdi, x: box.x + box.width / 2, y: box.y + box.height / 2, box };
    });
    const isUpper = (fdi: string) => ['1', '2', '5', '6'].includes(fdi.charAt(0));
    const arch = (upper: boolean) => {
      const teeth = centres.filter((c) => isUpper(c.fdi) === upper);
      const ys = teeth.map((c) => c.y);
      const backY = upper ? Math.max(...ys) : Math.min(...ys);
      const frontY = upper ? Math.min(...ys) : Math.max(...ys);
      return { backY, halfHeight: Math.max(Math.abs(backY - frontY), 1), halfWidth: Math.max(1, ...teeth.map((c) => Math.abs(c.x - CENTRE_X))) };
    };
    const arches = { upper: arch(true), lower: arch(false) };

    for (const [fdi, letters] of keys) {
      const tooth = centres.find((c) => c.fdi === fdi);
      if (!tooth) continue;
      const { backY, halfHeight, halfWidth } = isUpper(fdi) ? arches.upper : arches.lower;
      let dx = -(tooth.x - CENTRE_X) / (halfWidth * halfWidth);
      // Flattened toward the side: down the arch the neighbour is above and below, not beside.
      let dy = -(tooth.y - backY) / (halfHeight * halfHeight) * 0.55;
      const length = Math.max(Math.hypot(dx, dy), 1e-9);
      dx /= length;
      dy /= length;
      const label = letters.join('\u2009');
      const halfWidth2 = label.length * 1.9 + 1.5;
      const halfHeight2 = 3.9;
      const reach = Math.abs(dx) * (tooth.box.width / 2 + halfWidth2) + Math.abs(dy) * (tooth.box.height / 2 + halfHeight2) + 1.2;
      const x = tooth.x + dx * reach;
      const y = tooth.y + dy * reach;
      // In a small pill of its own: the letters of neighbouring teeth must not read as one group.
      const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      pill.setAttribute('class', 'odo-tooth-key');
      pill.setAttribute('x', String(x - halfWidth2));
      pill.setAttribute('y', String(y - halfHeight2));
      pill.setAttribute('width', String(halfWidth2 * 2));
      pill.setAttribute('height', String(halfHeight2 * 2));
      pill.setAttribute('rx', '1.7');
      pill.setAttribute('fill', '#ffffff');
      pill.setAttribute('stroke', '#103843');
      pill.setAttribute('stroke-width', '0.45');
      pill.setAttribute('pointer-events', 'none');
      svg.appendChild(pill);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'odo-tooth-key');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(y + 2.2));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '6.2');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#103843');
      text.setAttribute('pointer-events', 'none');
      text.textContent = label;
      svg.appendChild(text);
    }
  }

  /** Draws attention to the teeth a line of the legend is about. */
  private applyHighlights() {
    const prefix = this.getToothPrefix();
    for (const fdi of this.highlightTeeth ?? []) {
      const el = this.chartContainer?.nativeElement.querySelector(`.${prefix}${fdi}-parent`) as HTMLElement | null;
      if (!el) continue;
      el.dataset['odoVoice'] = 'highlight';
      el.style.stroke = VOICE_FOCUS_INK;
      el.style.strokeWidth = '3.5px';
      el.style.strokeDasharray = 'none';
      el.style.filter = 'drop-shadow(0 0 3px rgba(14, 116, 144, 0.8))';
    }
  }

  /**
   * Draws the planned-work layer: findings with kind TREATMENT_REQUIRED are
   * invisible in the derived `tooth_states.status` the fill above paints
   * from (every TREATMENT_REQUIRED code in the backend's FindingCatalog has
   * a null implied status), so without this pass a dictated or clicked
   * "extraction required" is recorded and then never seen again on the
   * chart. Drawn as a dashed outline over whatever the tooth's condition
   * already is — never replacing it — because the pathology is what
   * justifies the plan and a consenting patient needs to see both.
   *
   * Also marks the rarer case of an active CONDITION finding that the single
   * derived status can't represent either (a defective crown still paints as
   * a sound crown; see CONDITIONS_THE_FILL_CANNOT_SHOW in tooth-status.ts).
   *
   * Runs after applyTreatmentIndicators() so a clinical finding — a record,
   * not a scheduling label — has the last say over the tooth's outline.
   */
  private applyOverlays() {
    if (!this.chartContainer) return;
    const prefix = this.getToothPrefix();
    const svg = this.chartContainer.nativeElement.querySelector('svg');

    svg?.querySelectorAll('.odo-overlay-marker').forEach((n) => n.remove());
    svg?.querySelectorAll(`[class*="${prefix}"][class*="-parent"]`).forEach((el: any) => {
      if (el.dataset.odoOverlay) {
        el.style.strokeDasharray = 'none';
        delete el.dataset.odoOverlay;
      }
    });

    for (const [fdi, overlay] of this.overlays) {
      const el = svg?.querySelector(`.${prefix}${fdi}-parent`) as SVGGraphicsElement & HTMLElement | null;
      if (!el) continue;

      if (overlay.planned.length) {
        el.style.stroke = PLANNED_PAINT.ink;
        el.style.strokeWidth = '2.5px';
        el.style.strokeDasharray = '3,2';
        el.dataset.odoOverlay = '1';
      }

      if (!svg || (!overlay.planned.length && !overlay.unpaintedConditions.length)) continue;

      const bbox = el.getBBox();
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('class', 'odo-overlay-marker');
      marker.setAttribute('cx', String(bbox.x + bbox.width));
      marker.setAttribute('cy', String(bbox.y));
      marker.setAttribute('r', '2.2');
      marker.setAttribute(
        'fill',
        overlay.unpaintedConditions.length ? FAMILY_PAINT.condition.solid : PLANNED_PAINT.solid,
      );
      marker.setAttribute('stroke', '#ffffff');
      marker.setAttribute('stroke-width', '0.6');
      svg.appendChild(marker);
    }
  }

  /**
   * Draws, on each tooth that has a finding on a particular surface, the
   * five-part mark with those surfaces filled: "caries mesial, amalgam
   * occlusal" is then visible on the chart itself and not only in the panel.
   * The tooth's own fill still speaks for the tooth as a whole; this layer
   * says where on it.
   *
   * A zone takes the strongest thing recorded there — pathology over work in
   * place over work still owed — because the doctor scanning the chart needs
   * the problem to show even where a restoration also exists.
   */
  private applySurfaceMarks() {
    const svg = this.chartContainer?.nativeElement.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.odo-surface-mark').forEach((n) => n.remove());
    const prefix = this.getToothPrefix();

    const byTooth = surfaceMarks((this.findings ?? []).filter((f) => f.status === 'ACTIVE'));

    const ink = {
      condition: FAMILY_PAINT.condition.solid,
      existing: FAMILY_PAINT.existing.solid,
      planned: PLANNED_PAINT.solid,
    };
    for (const [fdi, zones] of byTooth) {
      const el = svg.querySelector(`.${prefix}${fdi}-parent`) as SVGGraphicsElement | null;
      if (!el || !zones.size) continue;
      const box = el.getBBox();
      const size = Math.max(9, Math.min(box.width, box.height) * 0.62);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'odo-surface-mark');
      g.setAttribute('transform',
        `translate(${box.x + box.width / 2 - size / 2} ${box.y + box.height / 2 - size / 2}) scale(${size / 30})`);
      g.setAttribute('pointer-events', 'none');
      for (const zone of SURFACE_ZONES) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', SURFACE_ZONE_PATH[zone]);
        const family = zones.get(zone);
        path.setAttribute('fill', family ? ink[family] : 'rgb(255 255 255 / 0.85)');
        // Planned work is an outline in the rest of the chart: keep it hollow here too.
        if (family === 'planned') {
          path.setAttribute('fill', 'rgb(255 255 255 / 0.85)');
          path.setAttribute('stroke', PLANNED_PAINT.ink);
          path.setAttribute('stroke-dasharray', '3 2');
          path.setAttribute('stroke-width', '2.2');
        } else {
          path.setAttribute('stroke', '#334155');
          path.setAttribute('stroke-width', '1.2');
        }
        path.setAttribute('stroke-linejoin', 'round');
        g.appendChild(path);
      }
      svg.appendChild(g);
    }
  }

  /** Removes the voice layer, restoring the plain outline it was drawn over. */
  private clearVoiceMarks() {
    const svg = this.chartContainer?.nativeElement.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.odo-voice-marker').forEach((n) => n.remove());
    svg.querySelectorAll('[data-odo-voice]').forEach((node) => {
      const el = node as HTMLElement;
      el.style.stroke = '#000';
      el.style.strokeWidth = '1px';
      el.style.strokeDasharray = 'none';
      el.style.filter = 'none';
      delete el.dataset['odoVoice'];
    });
  }

  /**
   * The voice session's layer, drawn last so it has the final say while a
   * consultation is being dictated: an amber outline and dot on every tooth
   * with findings staged but not yet saved, and a heavy petrol outline on the
   * tooth the last command was about. The dentist glances up and sees which
   * tooth was understood — the check a click gives for free and speech does
   * not (audit XII.2).
   */
  private applyVoiceMarks() {
    const svg = this.chartContainer?.nativeElement.querySelector('svg');
    if (!svg) return;
    const prefix = this.getToothPrefix();

    for (const fdi of new Set(this.stagedTeeth ?? [])) {
      const el = svg.querySelector(`.${prefix}${fdi}-parent`) as (SVGGraphicsElement & HTMLElement) | null;
      if (!el) continue;
      el.dataset['odoVoice'] = 'staged';
      el.style.stroke = VOICE_STAGED_INK;
      el.style.strokeWidth = '3px';
      el.style.strokeDasharray = 'none';

      const bbox = el.getBBox();
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('class', 'odo-voice-marker');
      marker.setAttribute('cx', String(bbox.x + bbox.width / 2));
      marker.setAttribute('cy', String(bbox.y + bbox.height / 2));
      marker.setAttribute('r', '2.6');
      marker.setAttribute('fill', VOICE_STAGED_INK);
      marker.setAttribute('stroke', '#ffffff');
      marker.setAttribute('stroke-width', '0.8');
      marker.setAttribute('pointer-events', 'none');
      svg.appendChild(marker);
    }

    if (this.focusFdi) {
      const el = svg.querySelector(`.${prefix}${this.focusFdi}-parent`) as HTMLElement | null;
      if (el) {
        el.dataset['odoVoice'] = 'focus';
        el.style.stroke = VOICE_FOCUS_INK;
        el.style.strokeWidth = '4px';
        el.style.strokeDasharray = 'none';
        el.style.filter = 'drop-shadow(0 0 3px rgba(14, 116, 144, 0.9))';
      }
    }
  }
}
