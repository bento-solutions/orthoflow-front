import { Component, Input, Output, EventEmitter, AfterViewInit, ElementRef, ViewChild, OnChanges, SimpleChanges, inject, OnDestroy, Renderer2 } from '@angular/core';
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
  odontogramPatternDefs,
  toothOverlays,
  toothPaint,
  toothStatusDefinition,
  toothStatusHex,
} from '../../core/clinical/tooth-status';

import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../core/services/toast.service';

import { FormsModule } from '@angular/forms';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

@Component({
  selector: 'app-dental-chart',
  standalone: true,
  imports: [CommonModule, TranslateModule, FormsModule],
  template: `
    <div class="dental-chart-wrapper" (click)="closeStatusMenu()">
      <div class="chart-header">
        <div class="header-left">
          <span class="chart-type-badge" [class.adult]="chartType === 'adult'" [class.child]="chartType === 'child'">
            <span class="material-icons">{{ chartType === 'adult' ? 'person' : 'child_care' }}</span>
            {{ (chartType === 'adult' ? 'DENTAL_CHART.ADULT_TITLE' : 'DENTAL_CHART.CHILD_TITLE') | translate }}
          </span>
          <span class="tooth-info">
            @if (hoveredTooth) {
              <span class="tooth-num">#{{ hoveredTooth }}</span>
              <span class="tooth-name">{{ getToothName(hoveredTooth) }}</span>
              <span class="tooth-status-label" [style.color]="getStatusColor(hoveredTooth)">{{ getToothStatusLabel(hoveredTooth) | translate }}</span>
            } @else {
              <span class="placeholderText">{{ 'DENTAL_CHART.HOVER_PROMPT' | translate }}</span>
            }
          </span>
        </div>
        <div class="header-right" *ngIf="interactive">
          <button type="button" class="btn-icon-sm" (click)="copyStateString($event)" [title]="'DENTAL_CHART.COPY_STATE' | translate" [attr.aria-label]="'DENTAL_CHART.COPY_STATE' | translate">
            <span class="material-icons" aria-hidden="true">content_copy</span>
          </button>
        </div>
      </div>

      <div class="svg-container" #chartContainer [innerHTML]="svgContent"></div>

      <!-- Status selection popup -->
      @if (selectedTooth && interactive) {
      <div class="status-menu-overlay" (click)="closeStatusMenu()">
        <div class="status-menu" (click)="$event.stopPropagation()">
          <header class="menu-header">
            <div class="menu-title">
              <span class="material-icons">toll</span>
              {{ 'DENTAL_CHART.TOOTH_NUMBER' | translate }} {{ selectedTooth }}
            </div>
            <button type="button" class="close-btn" [attr.aria-label]="'COMMON.CLOSE' | translate" (click)="closeStatusMenu()">
              <span class="material-icons" aria-hidden="true">close</span>
            </button>
          </header>
          
          <div class="status-sections">
            @for (group of statusGroups; track group.family) {
              <div class="status-group">
                <h4 class="status-group-title">{{ group.titleKey | translate }}</h4>
                <div class="status-grid">
                  @for (opt of group.options; track opt.value) {
                    <button type="button"
                      class="status-option"
                      [class.active]="(teeth && teeth[selectedTooth!]?.status) === opt.value"
                      (click)="selectStatus(selectedTooth!, opt.value)"
                    >
                      <span class="status-dot" [style.background]="opt.color"></span>
                      {{ opt.label | translate }}
                    </button>
                  }
                </div>
              </div>
            }

            <div class="note-section">
              <label class="note-label">
                <span class="material-icons">edit_note</span>
                {{ 'DENTAL_CHART.NOTE_LABEL' | translate }}
              </label>
              <textarea 
                class="note-textarea"
                [placeholder]="'DENTAL_CHART.NOTE_PLACEHOLDER' | translate"
                [(ngModel)]="currentToothNote"
                (ngModelChange)="saveToothNote()"
              ></textarea>
            </div>
          </div>
          
          <div class="menu-footer">
            <button type="button" class="btn-reset" (click)="selectStatus(selectedTooth!, 'present')">
              {{ 'DENTAL_CHART.RESET_PRESENT' | translate }}
            </button>
          </div>
        </div>
      </div>
      }

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
        <button type="button" class="report-toggle" (click)="showReport = !showReport">
          <div class="toggle-left">
            <span class="material-icons">{{ showReport ? 'expand_less' : 'description' }}</span>
            <span class="report-title">{{ 'DENTAL_CHART.REPORT_TITLE' | translate }}</span>
            <span class="note-count" *ngIf="teethWithNotes.length > 0">{{ teethWithNotes.length }}</span>
          </div>
          <div class="toggle-right">
            <button type="button" class="btn-export-sm" (click)="exportReport($event)" [title]="'DENTAL_CHART.EXPORT_REPORT' | translate" [attr.aria-label]="'DENTAL_CHART.EXPORT_REPORT' | translate">
              <span class="material-icons" aria-hidden="true">picture_as_pdf</span>
            </button>
            <span class="material-icons toggle-arrow">{{ showReport ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</span>
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
              <span class="material-icons">notes</span>
              <p>{{ 'DENTAL_CHART.NO_NOTES' | translate }}</p>
            </div>
          }
        </div>
      </div>
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

  svgContent: SafeHtml = '';
  hoveredTooth: string | null = null;
  selectedTooth: string | null = null;
  currentToothNote: string = '';
  showReport: boolean = false;
  private listenersAttached = false;

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

  /** Flat view of statusGroups, kept for the reset button and PDF export. */
  private get statusOptions(): { value: ToothStatus; label: string; color: string }[] {
    return this.statusGroups.flatMap((g) => g.options);
  }

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
      this.updateSvgContent();
      this.initChart();
    }
    if (changes['findings'] || changes['teeth']) {
      this.overlays = toothOverlays(this.findings ?? []);
    }
    const repaintKeys = ['teeth', 'patientTreatments', 'findings', 'stagedTeeth', 'focusFdi'];
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
    this.applyOverlays();
    this.applyVoiceMarks();
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

  /** Ordered tooth ids discovered in the SVG, used for arrow-key navigation between teeth. */
  private toothOrder: string[] = [];

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
    this.toothOrder = [];

    allToothPaths.forEach((path: any) => {
      const classes = path.getAttribute('class') || '';
      const regex = new RegExp(`${prefix}(\\d+)`);
      const match = classes.match(regex);
      if (!match) return;

      const toothId = match[1];
      const el = path as HTMLElement;
      this.toothOrder.push(toothId);

      this.renderer.setAttribute(el, 'role', 'button');
      this.renderer.setAttribute(el, 'aria-label', this.getToothAriaLabel(toothId));

      this.toothListenerCleanups.push(
        this.renderer.listen(el, 'mouseenter', () => this.onToothHover(toothId)),
        this.renderer.listen(el, 'mouseleave', () => this.onToothLeave(toothId)),
        this.renderer.listen(el, 'focus', () => this.onToothHover(toothId)),
        this.renderer.listen(el, 'blur', () => this.onToothLeave(toothId)),
      );

      if (this.interactive) {
        this.renderer.setAttribute(el, 'tabindex', '0');
        this.toothListenerCleanups.push(
          this.renderer.listen(el, 'click', (e: MouseEvent) => {
            e.stopPropagation();
            this.onToothClick(toothId);
          }),
          this.renderer.listen(el, 'keydown', (e: KeyboardEvent) => this.onToothKeydown(e, toothId))
        );
        el.style.cursor = 'pointer';
      }
    });

    this.listenersAttached = true;
  }

  /** Enter/Space selects the focused tooth; arrow keys move focus between teeth (WAI-ARIA-style roving navigation). */
  private onToothKeydown(event: KeyboardEvent, toothId: string) {
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        event.stopPropagation();
        this.onToothClick(toothId);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.focusAdjacentTooth(toothId, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.focusAdjacentTooth(toothId, -1);
        break;
    }
  }

  private focusAdjacentTooth(currentToothId: string, delta: number) {
    if (!this.toothOrder.length || !this.chartContainer) return;
    const currentIndex = this.toothOrder.indexOf(currentToothId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + delta + this.toothOrder.length) % this.toothOrder.length;
    const nextToothId = this.toothOrder[nextIndex];
    const prefix = this.getToothPrefix();
    const nextEl = this.chartContainer.nativeElement.querySelector(`path.${prefix}${nextToothId}`) as HTMLElement;
    nextEl?.focus();
  }

  /** Rebuilds the aria-label for a tooth to reflect its current status; called after status changes. */
  private refreshToothAriaLabel(toothId: string) {
    if (!this.chartContainer) return;
    const prefix = this.getToothPrefix();
    const el = this.chartContainer.nativeElement.querySelector(`path.${prefix}${toothId}`) as HTMLElement;
    if (el) this.renderer.setAttribute(el, 'aria-label', this.getToothAriaLabel(toothId));
  }

  getToothAriaLabel(toothId: string): string {
    const name = this.getToothName(toothId);
    const status = (this.teeth && this.teeth[toothId])?.status || 'present';
    return `FDI ${toothId} - ${name} - ${status}`;
  }

  private detachToothListeners() {
    for (const unlisten of this.toothListenerCleanups) unlisten();
    this.toothListenerCleanups = [];
  }

  onToothHover(toothId: string) {
    this.hoveredTooth = toothId;
    this.highlightTooth(toothId, true);
    const state = (this.teeth && this.teeth[toothId]) || { id: toothId, status: 'present' };
    this.toothHovered.emit(state);
  }

  onToothLeave(toothId: string) {
    this.hoveredTooth = null;
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
    const state = (this.teeth && this.teeth[toothId]) || { id: toothId, status: 'present' };
    if (this.statusMenu) {
      this.selectedTooth = toothId;
      this.currentToothNote = state.notes || '';
    }
    this.toothSelected.emit(state);
  }

  saveToothNote() {
    if (this.selectedTooth && this.patientId) {
      const status = this.teeth[this.selectedTooth]?.status || 'present';
      this.chartService.updateToothStatus(this.patientId, this.selectedTooth, status, this.currentToothNote);
      this.teeth = { 
        ...this.teeth, 
        [this.selectedTooth]: { 
          ...this.teeth[this.selectedTooth],
          id: this.selectedTooth, 
          status, 
          notes: this.currentToothNote 
        } 
      };
      const serialized = this.chartService.exportAsCompactString(this.patientId);
      this.chartUpdated.emit(serialized);
    }
  }

  async exportReport(event: MouseEvent) {
    event.stopPropagation();
    const container = this.chartContainer.nativeElement;
    
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(79, 70, 229); // Indigo-600
    doc.text('ORTHOFLOW', pageWidth / 2, y, { align: 'center' });
    y += 8;
    
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42); // Slate-900
    doc.text('DENTAL CLINICAL REPORT', pageWidth / 2, y, { align: 'center' });
    y += 12;

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // Slate-500
    doc.text(`Patient ID: ${this.patientId || 'N/A'}`, 20, y);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - 20, y, { align: 'right' });
    y += 5;
    doc.text(`Chart Type: ${this.chartType.toUpperCase()}`, 20, y);
    y += 10;

    // Capture Chart
    try {
      const chartCanvas = await html2canvas(container, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true
      });
      const chartImgData = chartCanvas.toDataURL('image/png');
      const chartWidth = 120; // mm
      const chartHeight = (chartCanvas.height * chartWidth) / chartCanvas.width;
      doc.addImage(chartImgData, 'PNG', (pageWidth - chartWidth) / 2, y, chartWidth, chartHeight);
      y += chartHeight + 15;
    } catch (err) {
      console.error('Failed to capture dental chart SVG', err);
      doc.setTextColor(239, 68, 68);
      doc.text('Error: Could not render dental chart figure.', 20, y);
      y += 10;
    }

    // Legend Section
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('EXPLANATORY LEGEND', 20, y);
    doc.setDrawColor(79, 70, 229);
    doc.line(20, y + 2, 60, y + 2);
    y += 10;

    doc.setFontSize(8);
    let x = 20;
    const colWidth = 45;
    this.statusOptions.forEach((opt) => {
      if (opt.value === 'present') return;
      
      if (x + colWidth > pageWidth - 10) {
        x = 20;
        y += 6;
      }
      
      // Color dot — jsPDF wants r,g,b numbers, not the `rgb()` CSS syntax
      // `opt.color` carries for the on-screen swatch, so read the same
      // family colour back out as a hex triplet.
      const hex = toothStatusHex(opt.value) ?? 0x64748b;
      doc.setFillColor((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
      doc.circle(x + 2, y - 1, 1.5, 'F');
      
      // Label
      doc.setTextColor(71, 85, 105);
      doc.text(this.translate.instant(opt.label), x + 6, y);
      x += colWidth;
    });
    y += 15;

    // Observations Section
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('CLINICAL OBSERVATIONS', 20, y);
    doc.line(20, y + 2, 70, y + 2);
    y += 10;

    if (this.teethWithNotes.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);
      doc.text('No specific observations recorded for this patient.', 20, y);
    } else {
      for (const t of this.teethWithNotes) {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFontSize(10);
        doc.setTextColor(79, 70, 229);
        doc.text(`TOOTH #${t.id} - ${this.getToothName(t.id).toUpperCase()}`, 20, y);
        y += 5;
        
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`STATUS: ${this.translate.instant(this.getToothStatusLabel(t.id))}`, 20, y);
        y += 5;

        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        const splitNote = doc.splitTextToSize(t.notes || '', pageWidth - 40);
        doc.text(splitNote, 20, y);
        y += (splitNote.length * 5) + 8;
      }
    }

    // Treatments Section
    if (this.patientTreatments && this.patientTreatments.length > 0) {
      if (y > 230) {
        doc.addPage();
        y = 20;
      } else {
        y += 10;
      }
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('CLINICAL TREATMENTS HISTORY', 20, y);
      doc.setDrawColor(79, 70, 229);
      doc.line(20, y + 2, 90, y + 2);
      y += 10;

      for (const t of this.patientTreatments) {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(10);
        doc.setTextColor(79, 70, 229);
        doc.text(`${t.treatment.name} (Teeth: ${t.teeth})`, 20, y);
        y += 5;

        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Status: ${t.status} | Progress: ${t.progress}% | Doctor: ${t.doctorName || 'N/A'}`, 20, y);
        y += 4;

        if (t.notes) {
          doc.setTextColor(30, 41, 59);
          const splitNote = doc.splitTextToSize(`Notes: ${t.notes}`, pageWidth - 40);
          doc.text(splitNote, 20, y);
          y += (splitNote.length * 4.5);
        }

        if (t.consumables && t.consumables.length > 0) {
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          const materials = t.consumables.map(c => `${c.stockItem.name} (${c.quantityUsed} ${c.stockItem.unitLabel || 'Units'})`).join(', ');
          const splitMaterials = doc.splitTextToSize(`Materials Consumed: ${materials}`, pageWidth - 40);
          doc.text(splitMaterials, 20, y);
          y += (splitMaterials.length * 4.5);
        }

        y += 5;
      }
    }

    // Footer on last page
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Generated by OrthoFlow Dental Management System', pageWidth / 2, 285, { align: 'center' });

    doc.save(`dental_report_${this.patientId || 'patient'}_${new Date().getTime()}.pdf`);
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
    this.refreshToothAriaLabel(toothId);
  }

  closeStatusMenu() {
    this.selectedTooth = null;
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
    const id = parseInt(toothId);
    const names: Record<number, string> = {
      11: 'Upper Right Central Incisor', 12: 'Upper Right Lateral Incisor', 13: 'Upper Right Canine',
      14: 'Upper Right 1st Premolar', 15: 'Upper Right 2nd Premolar', 16: 'Upper Right 1st Molar',
      17: 'Upper Right 2nd Molar', 18: 'Upper Right 3rd Molar (Wisdom)',
      21: 'Upper Left Central Incisor', 22: 'Upper Left Lateral Incisor', 23: 'Upper Left Canine',
      24: 'Upper Left 1st Premolar', 25: 'Upper Left 2nd Premolar', 26: 'Upper Left 1st Molar',
      27: 'Upper Left 2nd Molar', 28: 'Upper Left 3rd Molar (Wisdom)',
      31: 'Lower Left Central Incisor', 32: 'Lower Left Lateral Incisor', 33: 'Lower Left Canine',
      34: 'Lower Left 1st Premolar', 35: 'Lower Left 2nd Premolar', 36: 'Lower Left 1st Molar',
      37: 'Lower Left 2nd Molar', 38: 'Lower Left 3rd Molar (Wisdom)',
      41: 'Lower Right Central Incisor', 42: 'Lower Right Lateral Incisor', 43: 'Lower Right Canine',
      44: 'Lower Right 1st Premolar', 45: 'Lower Right 2nd Premolar', 46: 'Lower Right 1st Molar',
      47: 'Lower Right 2nd Molar', 48: 'Lower Right 3rd Molar (Wisdom)',
      51: 'Upper Right Primary Central', 52: 'Upper Right Primary Lateral', 53: 'Upper Right Primary Canine',
      54: 'Upper Right Primary 1st Molar', 55: 'Upper Right Primary 2nd Molar',
      61: 'Upper Left Primary Central', 62: 'Upper Left Primary Lateral', 63: 'Upper Left Primary Canine',
      64: 'Upper Left Primary 1st Molar', 65: 'Upper Left Primary 2nd Molar',
      71: 'Lower Left Primary Central', 72: 'Lower Left Primary Lateral', 73: 'Lower Left Primary Canine',
      74: 'Lower Left Primary 1st Molar', 75: 'Lower Left Primary 2nd Molar',
      81: 'Lower Right Primary Central', 82: 'Lower Right Primary Lateral', 83: 'Lower Right Primary Canine',
      84: 'Lower Right Primary 1st Molar', 85: 'Lower Right Primary 2nd Molar'
    };
    return names[id] || 'Unknown Tooth';
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
      const titleKey = overlay.unpaintedConditions.length
        ? 'DENTAL_CHART.CONDITION_NOT_SHOWN'
        : 'DENTAL_CHART.PLANNED_WORK_PENDING';
      this.translate.get(titleKey).subscribe((label) => marker.setAttribute('aria-label', label));
      marker.setAttribute('role', 'img');
      svg.appendChild(marker);
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
      marker.setAttribute('role', 'img');
      this.translate.get('VOICE.CHART_STAGED').subscribe((label) => marker.setAttribute('aria-label', label));
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

/** Dictated, not yet saved. Amber reads as "pending" beside every status family. */
const VOICE_STAGED_INK = '#d97706';
/** The tooth the last command was about. */
const VOICE_FOCUS_INK = '#0e7490';
