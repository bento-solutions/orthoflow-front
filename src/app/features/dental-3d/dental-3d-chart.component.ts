import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, NgZone, afterNextRender, computed, effect, inject, input, model, output, signal, untracked, viewChild, viewChildren,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DentalChartState, ToothStatus } from '../../core/models/patient.model';
import { ToothFinding } from '../../core/models/clinical-record.model';
import { PatientTreatment } from '../../core/models/patient-treatment.model';
import { findingLabel } from '../../core/clinical/finding-options';
import { PAINT_ZONES, PaintZone, StagedFinding, ToothPaint, paintChart, surfaceOfZone } from '../../core/clinical/tooth-paint';
import { SURFACE_LETTER, SURFACE_ZONES, SURFACE_ZONE_PATH, SurfaceZone, ToothSurface, formatSurface, isRootSurface, parseSurface, surfaceMarks, surfaceShorthand } from '../../core/clinical/tooth-surfaces';
import { FAMILY_PAINT, PLANNED_PAINT, TREATMENT_PLAN_INK, toothStatusLabelKey } from '../../core/clinical/tooth-status';
import { ToothNumberTyping, stepInGrid, toothGrid } from '../../core/clinical/tooth-grid';
import { gumPaints } from '../../core/clinical/gum-regions';
import { AnnouncerService } from '../../core/services/announcer.service';
import { DENTITION_VIEWS, Dental3dViewService, DentitionView } from '../../core/services/dental-3d-view.service';
import { ClinicalRecordService } from '../../core/services/clinical-record.service';
import { DentalChartService } from '../../core/services/dental-chart.service';
import { ChartKeysComponent } from '../dental-chart/chart-keys.component';
import { DentalChartComponent } from '../dental-chart/dental-chart.component';
import { ToothDetailComponent } from '../dental-chart/tooth-detail/tooth-detail.component';
import { DentitionEngine, DentitionHit, FACES, ToothFace, dentitionEngine, webGl2Available } from './dentition-engine';

/** One press of a turn key or button: enough to see it has turned, small enough to stop where wanted. */
const TURN_STEP = Math.PI / 12;

let nextId = 1;

interface HoverCard {
  readonly fdi: string;
  readonly left: number;
  readonly top: number;
  readonly title: string;
  readonly zone: string | null;
  readonly lines: readonly string[];
}

interface SummaryGroup {
  readonly key: string;
  readonly kind: string;
  readonly teeth: readonly string[];
}

/**
 * The patient's mouth in one view, and the way to chart on it.
 *
 * Everything the 2D chart could do it can do: a tooth is selected with a click, by
 * its number on the keyboard or by voice; the panel beside it records findings and
 * notes through the same component the 2D chart used; findings dictated and not yet
 * saved appear on it as they are spoken. When the browser cannot draw it, the 2D
 * chart takes its place, so charting never depends on a graphics card.
 */
@Component({
  selector: 'app-dental-3d-chart',
  standalone: true,
  host: { '[class.d3-compact]': 'compact()' },
  imports: [FormsModule, NgClass, TranslateModule, ChartKeysComponent, DentalChartComponent, ToothDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (fallback()) {
      <p class="d3-note" role="status">{{ 'DENTAL_3D.UNAVAILABLE' | translate }}</p>
      <app-dental-chart
        [chartType]="chart().chartType"
        [patientId]="chart().patientId"
        [teeth]="chart().teeth"
        [interactive]="true"
        [statusMenu]="sidePanel()"
        [patientTreatments]="treatments()"
        [findings]="findings()"
        [stagedTeeth]="stagedTeeth()"
        [focusFdi]="focusFdi()"
        (toothSelected)="select($event.id)"
      />
    } @else {
      <div class="d3" [class.d3--panel]="sidePanel()">
        <div class="d3-main">
          <div class="d3-toolbar">
            @if (!compact()) {
              <div class="d3-views" role="group" [attr.aria-label]="'DENTAL_3D.VIEW' | translate">
                @for (v of views; track v) {
                  <button type="button" [attr.aria-pressed]="view.view() === v" [class.on]="view.view() === v"
                    [title]="('DENTAL_3D.VIEW_HINT.' + v) | translate" (click)="view.view.set(v)">
                    {{ ('DENTAL_3D.VIEW_NAME.' + v) | translate }}
                  </button>
                }
              </div>
            }
            @if (focusCard(); as card) {
              <div class="d3-focus" role="status">
                <b>{{ card.title }}</b>
                @if (card.lines.length) { <span>{{ card.lines.join(' · ') }}</span> }
              </div>
            }
            <div class="d3-tools">
              @if (view.view() === 'overview' && !view.zoomedFdi()) {
                <!-- The gums hide the roots' surroundings and the palate hides nothing: the mouth with or without them. -->
                <button type="button" class="d3-tool" [class.on]="view.gums()" [attr.aria-pressed]="view.gums()"
                  [title]="(view.gums() ? 'DENTAL_3D.GUMS_HIDE' : 'DENTAL_3D.GUMS_SHOW') | translate"
                  [attr.aria-label]="'DENTAL_3D.GUMS' | translate" (click)="view.showGums()">
                  <span class="material-icons" aria-hidden="true">{{ view.gums() ? 'visibility' : 'visibility_off' }}</span>
                </button>
              }
              @if (!view.zoomedFdi() && selected(); as fdi) {
                <button type="button" class="d3-tool" [title]="'DENTAL_3D.ZOOM_TOOTH' | translate: { fdi: fdi }"
                  [attr.aria-label]="'DENTAL_3D.ZOOM_TOOTH' | translate: { fdi: fdi }" (click)="enterCloseUp(fdi)">
                  <span class="material-icons" aria-hidden="true">center_focus_strong</span>
                </button>
              }
              <!-- Everything dragging does, without dragging. -->
              <button type="button" class="d3-tool" [title]="'DENTAL_3D.TURN_LEFT' | translate" [attr.aria-label]="'DENTAL_3D.TURN_LEFT' | translate" (click)="turn(-1, 0)">
                <span class="material-icons" aria-hidden="true">rotate_left</span>
              </button>
              <button type="button" class="d3-tool" [title]="'DENTAL_3D.TURN_RIGHT' | translate" [attr.aria-label]="'DENTAL_3D.TURN_RIGHT' | translate" (click)="turn(1, 0)">
                <span class="material-icons" aria-hidden="true">rotate_right</span>
              </button>
              <button type="button" class="d3-tool" [title]="'DENTAL_3D.TURN_UP' | translate" [attr.aria-label]="'DENTAL_3D.TURN_UP' | translate" (click)="turn(0, -1)">
                <span class="material-icons" aria-hidden="true">keyboard_arrow_up</span>
              </button>
              <button type="button" class="d3-tool" [title]="'DENTAL_3D.TURN_DOWN' | translate" [attr.aria-label]="'DENTAL_3D.TURN_DOWN' | translate" (click)="turn(0, 1)">
                <span class="material-icons" aria-hidden="true">keyboard_arrow_down</span>
              </button>
              <button type="button" class="d3-tool" [title]="'DENTAL_3D.ZOOM_IN' | translate" [attr.aria-label]="'DENTAL_3D.ZOOM_IN' | translate" (click)="engine()?.zoomBy(0.8)">
                <span class="material-icons" aria-hidden="true">add</span>
              </button>
              <button type="button" class="d3-tool" [title]="'DENTAL_3D.ZOOM_OUT' | translate" [attr.aria-label]="'DENTAL_3D.ZOOM_OUT' | translate" (click)="engine()?.zoomBy(1.25)">
                <span class="material-icons" aria-hidden="true">remove</span>
              </button>
              <button type="button" class="d3-tool" [disabled]="!moved()" [title]="'DENTAL_3D.RESET' | translate" [attr.aria-label]="'DENTAL_3D.RESET' | translate" (click)="reset()">
                <span class="material-icons" aria-hidden="true">restart_alt</span>
              </button>
            </div>
          </div>

          <div class="d3-stage" dir="ltr" role="group" [attr.aria-label]="'DENTAL_3D.STAGE' | translate" (keydown)="onKeydown($event)">
            <div class="d3-canvas" #canvasHost aria-hidden="true"></div>

            @if (view.zoomedFdi()) {
              <!-- On the stage, where the corner is free: in the toolbar it would wrap it, and the stage would jump. -->
              <button type="button" class="d3-back" dir="auto" (click)="leaveCloseUp()">
                <span class="material-icons" aria-hidden="true">arrow_back</span>{{ 'DENTAL_3D.WHOLE_MOUTH' | translate }}
              </button>
            } @else {
              <div class="d3-sides" aria-hidden="true">
                <span>{{ 'DENTAL_3D.PATIENT_RIGHT' | translate }}</span>
                <span>{{ 'DENTAL_3D.PATIENT_LEFT' | translate }}</span>
              </div>
            }

            <!-- A grid: one stop on Tab, and arrows from there, rather than thirty-two stops before the panel. -->
            <div class="d3-labels" role="grid" [attr.aria-label]="'DENTAL_3D.TEETH' | translate" [attr.aria-describedby]="keysId">
              @for (row of rows(); track $index; let upper = $first) {
                <div role="row" [attr.aria-label]="(upper ? 'DENTAL_3D.UPPER_ARCH' : 'DENTAL_3D.LOWER_ARCH') | translate">
                  @for (fdi of row; track fdi) {
                    <button #label type="button" role="gridcell" class="d3-label" [attr.data-fdi]="fdi" [attr.data-state]="labelState(fdi)"
                      [attr.data-ring]="paintOf(fdi)?.treatment"
                      [class.selected]="selected() === fdi" [class.focus]="focusFdi() === fdi"
                      [class.staged]="paintOf(fdi)?.staged" [class.planned]="paintOf(fdi)?.planned"
                      [attr.aria-label]="labelAria(fdi)" [attr.aria-selected]="selected() === fdi"
                      [attr.tabindex]="tabStop() === fdi ? 0 : -1"
                      (click)="select(fdi)" (dblclick)="enterCloseUp(fdi)"
                      (pointerenter)="hoverFromLabel(fdi, $event)" (pointerleave)="hoverFromLabel(null, $event)"
                      (focus)="onLabelFocus(fdi)" (blur)="onLabelBlur()">
                      <span class="d3-num">{{ fdi }}</span>
                      @if (view.zoomedFdi() === fdi) { <span class="d3-name">{{ ('TOOTH_NAME.' + fdi) | translate }}</span> }
                      @if (marksOf(fdi); as marks) {
                        <svg class="d3-marks" viewBox="0 0 30 30" aria-hidden="true">
                          @for (zone of surfaceZones; track zone) {
                            <path [attr.d]="zonePaths[zone]" [attr.fill]="markFill(marks.get(zone))" stroke="#334155" stroke-width="1.6" />
                          }
                        </svg>
                      }
                      @if (paintOf(fdi)?.flagged || paintOf(fdi)?.lesion) { <span class="d3-flag" aria-hidden="true"></span> }
                    </button>
                  }
                </div>
              }
            </div>

            <div class="d3-labels" role="group" [attr.aria-label]="'DENTAL_3D.FACES' | translate">
              @if (view.zoomedFdi(); as zoomed) {
                @for (face of faces; track face; let i = $index) {
                  <button #faceLabel type="button" class="d3-face" [attr.data-face]="face"
                    [class.on]="pickedFaces().has(faceSurface(face, zoomed))"
                    [attr.tabindex]="faceStop() === i ? 0 : -1"
                    [attr.aria-label]="('SURFACE.' + faceSurface(face, zoomed).toUpperCase()) | translate"
                    [attr.aria-pressed]="pickedFaces().has(faceSurface(face, zoomed))"
                    [title]="('SURFACE.' + faceSurface(face, zoomed).toUpperCase()) | translate"
                    (focus)="faceStop.set(i)"
                    (click)="toggleFace(face, zoomed)">{{ faceLetter(face, zoomed) }}</button>
                }
              }
            </div>

            @if (hoverCard(); as card) {
              <div class="d3-tip" aria-hidden="true" [style.transform]="'translate(' + card.left + 'px,' + card.top + 'px)'">
                <b>{{ card.title }}</b>
                @if (card.zone) { <span class="d3-tip-zone">{{ card.zone }}</span> }
                @for (line of card.lines; track line) { <span>{{ line }}</span> }
              </div>
            }

            @if (state() === 'loading') {
              <div class="d3-overlay" role="status"><span class="d3-spinner" aria-hidden="true"></span>{{ 'DENTAL_3D.LOADING' | translate }}</div>
            }
          </div>

          <p class="sr-only" [id]="keysId">{{ (view.zoomedFdi() ? 'DENTAL_3D.KEYS_CLOSE_UP' : 'DENTAL_3D.KEYS_MOUTH') | translate }}</p>
          @if (!compact()) {
          <app-chart-keys [closeUp]="!!view.zoomedFdi()" [faces]="closeUpLetters()" [detail]="sidePanel()" [turnable]="true" />
          }

          <div class="d3-legend" [class.d3-legend--compact]="compact()">
            <span class="d3-key"><i class="sw sw-existing"></i>{{ 'DENTAL_3D.LEGEND.EXISTING' | translate }}</span>
            <span class="d3-key"><i class="sw sw-condition"></i>{{ 'DENTAL_3D.LEGEND.CONDITION' | translate }}</span>
            <span class="d3-key"><i class="sw sw-planned"></i>{{ 'DENTAL_3D.LEGEND.PLANNED' | translate }}</span>
            <span class="d3-key"><i class="sw sw-absent"></i>{{ 'DENTAL_3D.LEGEND.ABSENT' | translate }}</span>
            <span class="d3-key"><i class="sw sw-lesion"></i>{{ 'DENTAL_3D.LEGEND.LESION' | translate }}</span>
            @if (stagedTeeth().length) {
              <span class="d3-key"><i class="sw sw-staged"></i>{{ 'VOICE.LEGEND_STAGED' | translate }}</span>
            }
            @for (key of mouthLegend(); track key) {
              <span class="d3-key"><i class="sw" [ngClass]="'sw-' + key.toLowerCase()"></i>{{ ('DENTAL_3D.LEGEND.' + key) | translate }}</span>
            }
            @for (ring of ringsInUse(); track ring) {
              <span class="d3-key"><i class="sw sw-ring" [style.borderColor]="ringColour(ring)"></i>{{ ('DENTAL_3D.LEGEND.RING_' + ring) | translate }}</span>
            }
          </div>
          <p class="d3-credit">
            {{ 'DENTAL_3D.ILLUSTRATIVE' | translate }}
            @if (chart().chartType === 'child') { {{ 'DENTAL_3D.ILLUSTRATIVE_CHILD' | translate }} }
            <a href="https://sketchfab.com/3d-models/permanent-dentition-2f69d7b59c3e4a6a8bcae041bd8e591b" target="_blank" rel="noopener noreferrer" lang="en">“Permanent Dentition”</a>,
            <span lang="en">University of Dundee, School of Dentistry</span>,
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
            {{ 'DENTAL_3D.ADAPTED' | translate }}
          </p>
        </div>

        @if (sidePanel()) {
          <aside #panel class="d3-panel" [attr.aria-label]="'DENTAL_3D.PANEL' | translate" (keydown.escape)="backFromPanel($event)">
            @if (selected(); as fdi) {
              <header class="d3-panel-head">
                <span class="d3-panel-fdi">{{ fdi }}</span>
                <div class="d3-panel-title">
                  <h3>{{ ('TOOTH_NAME.' + fdi) | translate }}</h3>
                  <p>{{ statusLabel(fdi) | translate }}</p>
                </div>
                <button type="button" class="d3-tool" [attr.aria-label]="'COMMON.CLOSE' | translate" (click)="closePanel(fdi)">
                  <span class="material-icons" aria-hidden="true">close</span>
                </button>
              </header>
              <app-tooth-detail [patientId]="chart().patientId" [fdi]="fdi" [findings]="findings()" [(surface)]="pickedSurface" />
              <p class="d3-hint">{{ 'DENTAL_3D.SURFACE_HINT' | translate }}</p>

              @if (toothTreatments().length) {
                <section class="d3-block">
                  <h4>{{ 'DENTAL_3D.ASSIGNED' | translate }}</h4>
                  <ul class="d3-treatments">
                    @for (t of toothTreatments(); track t.id) {
                      <li><span class="d3-dot" [style.background]="ringColour(t.status)"></span>{{ t.treatment.name }}<span class="d3-muted">{{ t.progress }}%</span></li>
                    }
                  </ul>
                </section>
              }

              <section class="d3-block">
                <label class="d3-field">
                  <span>{{ 'DENTAL_CHART.NOTE_LABEL' | translate }}</span>
                  <textarea rows="2" [ngModel]="noteOf(fdi)" (change)="saveNote(fdi, $any($event.target).value)"
                    [placeholder]="'DENTAL_CHART.NOTE_PLACEHOLDER' | translate"></textarea>
                </label>
              </section>

              <button type="button" class="d3-assign" (click)="assignTreatment.emit(fdi)">
                <span class="material-icons" aria-hidden="true">add</span>{{ 'DENTAL_3D.ASSIGN' | translate: { fdi: fdi } }}
              </button>
            } @else {
              <h3 class="d3-panel-idle">{{ 'DENTAL_3D.SUMMARY' | translate }}</h3>
              @for (group of summary(); track group.key) {
                <section class="d3-block">
                  <h4 [attr.data-kind]="group.kind">{{ group.key | translate }}</h4>
                  <div class="d3-chips">
                    @for (fdi of group.teeth; track fdi) {
                      <button type="button" class="d3-chip" [attr.aria-label]="fdi + ', ' + ('TOOTH_NAME.' + fdi | translate)" (click)="select(fdi); focusLabel(fdi)">{{ fdi }}</button>
                    }
                  </div>
                </section>
              } @empty {
                <p class="d3-hint">{{ 'DENTAL_3D.NOTHING_RECORDED' | translate }}</p>
              }
              @if (gums().length) {
                <section class="d3-block">
                  <h4>{{ 'GUMS.TITLE' | translate }}</h4>
                  <ul class="d3-gums">
                    @for (g of gums(); track g.region) {
                      <li [attr.data-state]="g.condition">{{ ('GUMS.REGION.' + g.region) | translate }} : <b>{{ ('GUMS.CONDITION.' + g.condition) | translate }}</b></li>
                    }
                  </ul>
                </section>
              }
              <p class="d3-hint">{{ 'DENTAL_3D.HOW_TO' | translate }}</p>
            }
          </aside>
        }
      </div>
    }
  `,
  styleUrl: './dental-3d-chart.component.css',
})
export class Dental3dChartComponent {
  readonly chart = input.required<DentalChartState>();
  readonly findings = input<ToothFinding[]>([]);
  readonly treatments = input<PatientTreatment[]>([]);
  /** Dictated and not saved yet, drawn on the tooth as it is spoken. */
  readonly staged = input<readonly StagedFinding[]>([]);
  /** The tooth the last voice command was about. */
  readonly focusFdi = input<string | null>(null);
  /** The tooth in hand, from a click or from voice. */
  readonly selected = model<string | null>(null);
  /**
   * The panel beside the mouth. Off in the voice session, which has its own column and
   * where a tap only tells the assistant what "that tooth" means.
   */
  readonly sidePanel = input(true);
  /**
   * The consultation cockpit's stage: the chart fills the height it is given, the
   * keyboard legend and the view names go (voice and the toolbar's icons still
   * reach them), and the credit line stays — it is the model's licence.
   */
  readonly compact = input(false);
  /**
   * The camera follows the tooth voice is about: in a close-up it moves to the
   * tooth just spoken of, and a zoomed-in view that has it off screen re-frames
   * it. Otherwise it stays still. The cockpit turns this off when the doctor
   * pinned the view.
   */
  readonly cameraFollows = input(false);

  readonly assignTreatment = output<string>();

  protected readonly view = inject(Dental3dViewService);
  private readonly charts = inject(DentalChartService);
  private readonly records = inject(ClinicalRecordService);
  private readonly translate = inject(TranslateService);
  private readonly zone = inject(NgZone);
  private readonly announcer = inject(AnnouncerService);

  protected readonly keysId = `d3-keys-${nextId++}`;

  private readonly canvasHost = viewChild<ElementRef<HTMLDivElement>>('canvasHost');
  private readonly labelRefs = viewChildren<ElementRef<HTMLButtonElement>>('label');
  private readonly faceRefs = viewChildren<ElementRef<HTMLButtonElement>>('faceLabel');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');
  private labels = new Map<string, HTMLButtonElement>();
  private readonly placed = new Map<string, number>();

  protected readonly engine = signal<DentitionEngine | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly fallback = signal(false);
  protected readonly moved = signal(false);
  private readonly roving = signal<string | null>(null);
  /** The one tooth Tab lands on. In close-up it can only be the tooth in the frame: the others are off the stage. */
  protected readonly tabStop = computed(() => {
    const teeth = this.allTeeth();
    const known = (fdi: string | null) => (fdi && teeth.includes(fdi) ? fdi : null);
    return known(this.view.zoomedFdi()) ?? known(this.roving()) ?? known(this.selected()) ?? teeth[0];
  });
  protected readonly faceStop = signal(0);
  protected readonly pickedSurface = signal<string | null>(null);
  private readonly hover = signal<{ hit: DentitionHit | null; fdi: string; x: number; y: number } | null>(null);

  protected readonly views = DENTITION_VIEWS;
  protected readonly faces = FACES;
  protected readonly surfaceZones = SURFACE_ZONES;
  protected readonly zonePaths = SURFACE_ZONE_PATH;

  protected readonly rows = computed(() => toothGrid(this.chart().chartType));
  protected readonly allTeeth = computed(() => this.rows().flat());
  protected readonly stagedTeeth = computed(() => [...new Set(this.staged().map((s) => s.fdi))]);

  private readonly paints = computed(() => paintChart(this.chart().teeth, this.findings(), this.staged(), this.treatments()));
  private readonly paintByFdi = computed(() => new Map<string, ToothPaint>(this.paints().map((p) => [p.fdi, p])));
  private readonly marks = computed(() => surfaceMarks([
    ...this.findings().filter((f) => f.status === 'ACTIVE').map((f) => ({ fdi: f.fdi, kind: f.kind, surface: f.surface })),
  ]));
  /**
   * The gum round each tooth: its own findings and the assessment of its part of the mouth. Read from the
   * gum assessments whether or not the panel is open, because the mouth draws them wherever it is.
   */
  private readonly gumByTooth = computed(() => gumPaints(this.allTeeth(), this.paintByFdi(), this.records.periodontal()?.current ?? []));

  /** What the mouth shows that the base legend does not say: the gum's state, tartar and plaque, a suspicion. */
  protected readonly mouthLegend = computed(() => {
    const keys: string[] = [];
    const gums = [...this.gumByTooth().values()];
    const paints = this.paints();
    const some = (test: (g: (typeof gums)[number]) => boolean) => gums.some(test);
    if (some((g) => (g.inflamed ?? 0) >= 0.3 || (g.swollen ?? 0) >= 0.3 || (g.bleeding ?? 0) > 0)) keys.push('INFLAMED');
    if (some((g) => (g.perio ?? 0) > 0.3)) keys.push('PERIO');
    if (some((g) => (g.recession ?? 0) > 0.2 || g.recessionMm !== undefined)) keys.push('RECESSION');
    if (paints.some((p) => p.deposit.calculus)) keys.push('CALCULUS');
    if (paints.some((p) => p.deposit.plaque)) keys.push('PLAQUE');
    if (paints.some((p) => p.suspected)) keys.push('SUSPECTED');
    return keys;
  });

  private readonly activeByTooth = computed(() => {
    const byTooth = new Map<string, ToothFinding[]>();
    for (const finding of this.findings()) {
      if (finding.status !== 'ACTIVE' || !finding.fdi) continue;
      (byTooth.get(finding.fdi) ?? byTooth.set(finding.fdi, []).get(finding.fdi)!).push(finding);
    }
    return byTooth;
  });

  protected readonly toothTreatments = computed(() => {
    const fdi = this.selected();
    if (!fdi) return [];
    return this.treatments().filter((t) => (t.teeth ?? '').split(',').map((x) => x.trim()).includes(fdi));
  });

  protected readonly summary = computed<SummaryGroup[]>(() => {
    const groups: Record<'condition' | 'planned' | 'existing' | 'absent' | 'suspected', string[]> = { condition: [], planned: [], existing: [], absent: [], suspected: [] };
    for (const fdi of this.allTeeth()) {
      const paint = this.paintByFdi().get(fdi);
      if (!paint) continue;
      const families = new Set(PAINT_ZONES.map((zone) => paint.zones[zone]?.family));
      if (paint.absent) groups.absent.push(fdi);
      // Tartar and plaque are findings of the tooth even though nothing is painted on a part of it.
      if (families.has('condition') || paint.lesion || paint.flagged || paint.deposit.calculus || paint.deposit.plaque) groups.condition.push(fdi);
      if (paint.suspected) groups.suspected.push(fdi);
      if (paint.planned || families.has('planned')) groups.planned.push(fdi);
      if (families.has('existing')) groups.existing.push(fdi);
    }
    return (Object.entries(groups) as [keyof typeof groups, string[]][])
      .filter(([, teeth]) => teeth.length)
      .map(([kind, teeth]) => ({ kind, key: `DENTAL_3D.GROUP.${kind.toUpperCase()}`, teeth }));
  });

  protected readonly ringsInUse = computed(() => {
    const rings = new Set(this.paints().map((p) => p.treatment).filter((ring) => !!ring));
    return (['COMPLETED', 'ACTIVE', 'PLANNED'] as const).filter((ring) => rings.has(ring));
  });

  /** Gum state beside the teeth: it is part of the mouth, and has no shape of its own in the model. */
  protected readonly gums = computed(() => (this.sidePanel() ? this.records.periodontal()?.current ?? [] : []));

  /** A finding as it is said on the chart: its name, its faces, and that it is only suspected when it is. */
  private findingText(f: ToothFinding): string {
    const label = findingLabel(this.translate, f.findingCode ?? '');
    const said = f.surface ? `${label} ${surfaceShorthand(f.surface)}` : label;
    return f.certainty === 'SUSPECTED' ? `${said} (${this.translate.instant('TOOTH_DETAIL.CERTAINTY.SUSPECTED_BADGE')})` : said;
  }

  protected readonly focusCard = computed(() => {
    const fdi = this.focusFdi();
    if (!fdi) return null;
    const stagedHere = this.staged().filter((s) => s.fdi === fdi).map((s) => findingLabel(this.translate, s.code));
    return { title: this.translate.instant('DENTAL_3D.FOCUS_TITLE', { fdi, name: this.translate.instant(`TOOTH_NAME.${fdi}`) }), lines: stagedHere };
  });

  protected readonly hoverCard = computed<HoverCard | null>(() => {
    const hover = this.hover();
    if (!hover) return null;
    const { fdi, hit, x, y } = hover;
    // From the keyboard, the card stands for pointing at a tooth among the others; alone in the frame it would only cover it.
    if (!hit && this.view.zoomedFdi()) return null;
    const stage = this.canvasHost()?.nativeElement.getBoundingClientRect();
    if (!stage) return null;
    const left = Math.min(Math.max(x - stage.left + 14, 4), stage.width - 230);
    const top = Math.min(Math.max(y - stage.top + 16, 4), stage.height - 96);
    const surface = hit ? surfaceOfZone(hit.zone, fdi) : null;
    const zone = hit
      ? hit.gum ? this.translate.instant('DENTAL_3D.GUM')
        : hit.zone === 'root' ? this.translate.instant('DENTAL_3D.ROOT') : surface ? this.translate.instant(`SURFACE.${surface.toUpperCase()}`) : null
      : null;
    const lines = (this.activeByTooth().get(fdi) ?? []).slice(0, 4).map((f) => this.findingText(f));
    return { fdi, left, top, title: `${fdi} · ${this.translate.instant(`TOOTH_NAME.${fdi}`)}`, zone, lines };
  });

  /** Which families' colours the five-part mark on a number uses. */
  protected markFill(family: 'condition' | 'existing' | 'planned' | undefined): string {
    switch (family) {
      case 'condition': return FAMILY_PAINT.condition.solid;
      case 'existing': return FAMILY_PAINT.existing.solid;
      case 'planned': return PLANNED_PAINT.solid;
      default: return '#ffffff';
    }
  }

  protected ringColour(status: string | null | undefined): string {
    return TREATMENT_PLAN_INK[status as keyof typeof TREATMENT_PLAN_INK] ?? FAMILY_PAINT.sound.solid;
  }

  constructor() {
    afterNextRender(() => this.start());

    effect(() => {
      const engine = this.engine();
      if (!engine) return;
      const dentition = this.chart().chartType;
      this.state.set('loading');
      engine.show(dentition).then(
        () => this.state.set('ready'),
        (err) => {
          console.error('The 3D chart could not load its model', err);
          this.state.set('failed');
          this.fallback.set(true);
        },
      );
    });
    effect(() => this.engine()?.setPaint(this.paints()));
    effect(() => this.engine()?.setGumPaint(this.gumByTooth()));
    effect(() => this.engine()?.setGums(this.view.gums()));
    effect(() => this.engine()?.setView(this.view.view()));
    effect(() => this.engine()?.setSelected(this.selected()));
    effect(() => this.engine()?.setFocus(this.focusFdi()));
    effect(() => this.engine()?.zoomTo(this.view.zoomedFdi()));
    // Camera moves asked by voice: each applied once, by whichever chart is on screen.
    effect(() => {
      const request = this.view.pending();
      const engine = this.engine();
      if (!request || !engine || this.state() !== 'ready') return;
      untracked(() => {
        this.view.consumed(request.id);
        switch (request.kind) {
          case 'zoom': this.view.atLimit.set(engine.zoomBy(request.factor)); break;
          case 'rotate': engine.rotateBy(request.azimuth, request.polar); break;
          case 'reset': this.view.zoomedFdi.set(null); engine.resetCamera(); this.view.atLimit.set(null); break;
          case 'frame': engine.frameTooth(request.fdi); break;
        }
      });
    });
    // Following the tooth spoken of, only when asked to and only when it has to move.
    effect(() => {
      const fdi = this.focusFdi();
      const engine = this.engine();
      if (!fdi || !engine || !this.cameraFollows() || this.state() !== 'ready') return;
      untracked(() => {
        const zoomed = this.view.zoomedFdi();
        if (zoomed && zoomed !== fdi) {
          this.view.zoomedFdi.set(fdi);
        } else if (!zoomed && this.moved() && !engine.isToothInView(fdi)) {
          engine.frameTooth(fdi);
        }
      });
    });
    effect(() => this.engine()?.setPicked(this.pickedZones()));
    effect(() => {
      this.labels = new Map(this.labelRefs().map((ref) => [ref.nativeElement.dataset['fdi']!, ref.nativeElement]));
      this.placed.clear();
    });
    effect(() => {
      const patientId = this.chart().patientId;
      untracked(() => this.records.loadPeriodontal(patientId));
    });
    effect(() => {
      // Another tooth: the face picked on the last one means nothing on this one.
      this.selected();
      this.pickedSurface.set(null);
    });

    this.view.mounted.update((n) => n + 1);
    inject(DestroyRef).onDestroy(() => {
      this.view.mounted.update((n) => n - 1);
      this.onAfterPrint();
      this.engine()?.detach(this.attachedTo ?? undefined);
    });
  }

  protected readonly pickedFaces = computed(() => new Set(parseSurface(this.pickedSurface())));

  /** Only where a face can be picked: without the panel, in the voice session, there is nothing to pick it for. */
  protected readonly closeUpLetters = computed(() => {
    const fdi = this.view.zoomedFdi();
    return fdi && this.sidePanel() ? this.faces.map((face) => this.faceLetter(face, fdi)) : [];
  });

  private readonly pickedZones = computed<PaintZone[]>(() =>
    parseSurface(this.pickedSurface()).map((surface): PaintZone =>
      surface === 'incisal' ? 'occlusal' : isRootSurface(surface) ? 'root' : surface));

  private attachedTo: HTMLElement | null = null;

  private start(): void {
    if (!webGl2Available()) {
      this.fallback.set(true);
      return;
    }
    const canvasHost = this.canvasHost()?.nativeElement;
    if (!canvasHost) return;
    try {
      const engine = dentitionEngine();
      this.attachedTo = canvasHost;
      // Three.js events and frames never need change detection; only what they report does.
      this.zone.runOutsideAngular(() => engine.attach(canvasHost, {
        hover: (hit, x, y) => this.hover.set(hit ? { hit, fdi: hit.fdi, x, y } : null),
        click: (hit) => this.onCanvasClick(hit),
        doubleClick: (hit) => this.enterCloseUp(hit.fdi),
        place: (fdi, x, y, facing) => this.placeLabel(fdi, x, y, facing),
        placeFace: (face, x, y, facing) => this.placeFace(face, x, y, facing),
        moved: (moved) => this.moved.set(moved),
        contextGone: () => this.fallback.set(true),
      }));
      this.engine.set(engine);
    } catch (err) {
      console.error('The 3D chart could not start', err);
      this.fallback.set(true);
    }
  }

  /* ── Printing ─────────────────────────────────────────────────────────── */

  private printPicture: HTMLCanvasElement | null = null;

  /**
   * Printing happens straight after this returns, before Angular would render anything, so the
   * picture goes into the page by hand: the view with its tooth numbers painted on, as a plain
   * canvas, which unlike a WebGL one prints what it shows.
   */
  @HostListener('window:beforeprint')
  protected onBeforePrint(): void {
    const engine = this.engine();
    const stage = this.canvasHost()?.nativeElement.parentElement;
    if (!engine || !stage) return;
    const picture = engine.capture();
    const context = picture.getContext('2d');
    if (context) {
      const scale = picture.width / Math.max(stage.clientWidth, 1);
      context.font = `700 ${11 * scale}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const [fdi, at] of this.positions) {
        if (at.x < 0) continue;
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(at.x * scale, at.y * scale, 10 * scale, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#000000';
        context.fillText(fdi, at.x * scale, at.y * scale);
      }
    }
    picture.className = 'd3-print';
    // Added by hand, so the component's scoped stylesheet does not reach it.
    picture.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    stage.appendChild(picture);
    this.printPicture = picture;
    stage.classList.add('d3-printing');
  }

  @HostListener('window:afterprint')
  protected onAfterPrint(): void {
    this.printPicture?.parentElement?.classList.remove('d3-printing');
    this.printPicture?.remove();
    this.printPicture = null;
  }

  private readonly positions = new Map<string, { x: number; y: number }>();

  private placeLabel(fdi: string, x: number, y: number, facing: number): void {
    this.positions.set(fdi, { x, y });
    const label = this.labels.get(fdi);
    if (!label) return;
    label.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;
    const dim = facing < -0.1 ? 1 : 0;
    if (this.placed.get(fdi) !== dim) {
      this.placed.set(fdi, dim);
      label.classList.toggle('behind', dim === 1);
    }
  }

  private placeFace(face: ToothFace, x: number, y: number, facing: number): void {
    const label = this.faceRefs().find((ref) => ref.nativeElement.dataset['face'] === face)?.nativeElement;
    if (!label) return;
    label.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;
    label.classList.toggle('behind', facing < -0.05);
  }

  /** A front tooth bites on its edge: the same place on it has another name. */
  protected faceSurface(face: ToothFace, fdi: string): ToothSurface {
    return face === 'occlusal' ? (Number(fdi.charAt(1)) <= 3 ? 'incisal' : 'occlusal') : face;
  }

  protected faceLetter(face: ToothFace, fdi: string): string {
    return SURFACE_LETTER[this.faceSurface(face, fdi)];
  }

  protected toggleFace(face: ToothFace, fdi: string): void {
    if (this.selected() !== fdi) this.select(fdi);
    this.toggleSurface(this.faceSurface(face, fdi));
  }

  private onCanvasClick(hit: DentitionHit | null): void {
    if (!hit) {
      if (!this.view.zoomedFdi()) this.select(null);
      return;
    }
    if (hit.fdi === this.selected()) {
      this.togglePickedSurface(hit);
      return;
    }
    this.select(hit.fdi);
  }

  /** A click on the tooth in hand says which face the next finding is on. */
  private togglePickedSurface(hit: DentitionHit): void {
    const surface = surfaceOfZone(hit.zone, hit.fdi);
    if (surface) this.toggleSurface(surface);
  }

  private toggleSurface(surface: ToothSurface): void {
    if (!this.sidePanel()) return;
    const current = new Set(parseSurface(this.pickedSurface()));
    if (current.has(surface)) current.delete(surface);
    else current.add(surface);
    this.pickedSurface.set(formatSurface(current));
  }

  protected hoverFromLabel(fdi: string | null, event: PointerEvent): void {
    this.engine()?.hoverTooth(fdi);
    this.hover.set(fdi ? { hit: null, fdi, x: event.clientX, y: event.clientY } : null);
  }

  protected select(fdi: string | null): void {
    this.selected.set(fdi);
    if (fdi) this.roving.set(fdi);
  }

  protected reset(): void {
    this.view.zoomedFdi.set(null);
    this.engine()?.resetCamera();
    // The button goes disabled under the keyboard's focus, and focus would be lost with it.
    this.focusLabel(this.tabStop());
  }

  protected turn(azimuth: number, polar: number): void {
    this.engine()?.rotateBy(azimuth * TURN_STEP, polar * TURN_STEP);
  }

  protected enterCloseUp(fdi: string): void {
    this.select(fdi);
    this.view.zoomedFdi.set(fdi);
    this.focusLabel(fdi);
    this.announcer.announce(this.translate.instant('DENTAL_3D.ZOOMED', { fdi, name: this.translate.instant(`TOOTH_NAME.${fdi}`) }));
  }

  protected leaveCloseUp(): void {
    const fdi = this.view.zoomedFdi();
    this.view.zoomedFdi.set(null);
    if (fdi) this.focusLabel(fdi);
    this.announcer.announce(this.translate.instant('DENTAL_3D.ZOOMED_OUT'));
  }

  protected closePanel(fdi: string): void {
    this.select(null);
    this.focusLabel(fdi);
  }

  /** Escape from the panel goes back to the tooth it is about, which stays selected. */
  protected backFromPanel(event: Event): void {
    const fdi = this.selected();
    if (!fdi) return;
    event.preventDefault();
    event.stopPropagation();
    this.focusLabel(fdi);
  }

  protected paintOf(fdi: string): ToothPaint | undefined {
    return this.paintByFdi().get(fdi);
  }

  protected marksOf(fdi: string): ReadonlyMap<SurfaceZone, 'condition' | 'existing' | 'planned'> | null {
    return this.marks().get(fdi) ?? null;
  }

  protected labelState(fdi: string): string | null {
    const paint = this.paintOf(fdi);
    if (!paint) return null;
    if (paint.absent) return 'absent';
    const families = new Set(PAINT_ZONES.map((zone) => paint.zones[zone]?.family));
    if (families.has('condition') || paint.lesion) return 'condition';
    if (families.has('existing')) return 'existing';
    return null;
  }

  /** What the eye gets from the tooth's colours, its rings and its marks. */
  protected labelAria(fdi: string): string {
    const paint = this.paintOf(fdi);
    return [
      `${fdi}, ${this.translate.instant(`TOOTH_NAME.${fdi}`)}`,
      ...(paint?.absent ? [this.translate.instant('DENTAL_3D.LEGEND.ABSENT')] : []),
      ...(this.activeByTooth().get(fdi) ?? []).map((f) => this.findingText(f)),
      ...(paint?.staged ? [this.translate.instant('VOICE.LEGEND_STAGED')] : []),
      ...(paint?.treatment ? [this.translate.instant(`DENTAL_3D.LEGEND.RING_${paint.treatment}`)] : []),
    ].join(', ');
  }

  protected statusLabel(fdi: string): string {
    const status: ToothStatus = this.chart().teeth[fdi]?.status ?? 'present';
    return toothStatusLabelKey(status);
  }

  protected noteOf(fdi: string): string {
    return this.chart().teeth[fdi]?.notes ?? '';
  }

  protected saveNote(fdi: string, note: string): void {
    if (note === this.noteOf(fdi)) return;
    const { patientId, teeth } = this.chart();
    this.charts.updateToothStatus(patientId, fdi, teeth[fdi]?.status ?? 'present', note, '3d');
  }

  /* ── Keyboard ─────────────────────────────────────────────────────────── */

  private readonly typing = new ToothNumberTyping();

  /**
   * Arrows go from tooth to tooth, Enter goes further in and Escape comes back out, one level at
   * a time: the whole mouth, the tooth in close-up, its panel. The keys that are handled stop
   * here, because Enter and Escape also answer a pending voice confirmation at the window.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') || event.ctrlKey && !['Home', 'End'].includes(event.key) || event.metaKey || event.altKey) return;
    if (this.handleKey(event, target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private handleKey(event: KeyboardEvent, target: HTMLElement): boolean {
    const onFace = target.closest<HTMLElement>('.d3-face');
    const onTooth = target.closest<HTMLElement>('.d3-label')?.dataset['fdi'];
    const zoomed = this.view.zoomedFdi();
    const current = onTooth ?? zoomed ?? this.tabStop();

    switch (event.key) {
      case 'Enter':
        // A face is a plain button, and Enter presses it.
        if (!onTooth) return false;
        if (zoomed === onTooth) return this.focusPanel();
        this.enterCloseUp(onTooth);
        return true;
      case 'Escape':
        return this.stepBack(!!onFace, current);
      case '+':
      case '=':
        this.engine()?.zoomBy(0.8);
        return true;
      case '-':
        this.engine()?.zoomBy(1.25);
        return true;
    }

    if (onFace && event.key.startsWith('Arrow')) {
      this.moveAmongFaces(event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      const across = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const down = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      this.turn(across, down);
      return true;
    }

    const next = stepInGrid(this.keyboardGrid(), current, event.key, event.ctrlKey);
    if (next) {
      this.goToTooth(next);
      return true;
    }

    if (/^\d$/.test(event.key)) {
      const typed = this.typing.type(event.key, this.allTeeth(), performance.now());
      if (typed) {
        this.goToTooth(typed);
        if (!zoomed) this.select(typed);
      }
      return true;
    }
    return !!zoomed && this.pickFaceByLetter(event.key, zoomed);
  }

  /** Arrows follow what is on screen, and a screen taller than wide stands the teeth in four rows. */
  private keyboardGrid() {
    const stage = this.canvasHost()?.nativeElement;
    return toothGrid(this.chart().chartType, !!stage && stage.clientHeight > stage.clientWidth);
  }

  /** In close-up the camera comes along, so walking the teeth shows each one up close in turn. */
  private goToTooth(fdi: string): void {
    if (this.view.zoomedFdi()) {
      this.select(fdi);
      this.view.zoomedFdi.set(fdi);
    }
    this.focusLabel(fdi);
  }

  private stepBack(fromFace: boolean, fdi: string): boolean {
    if (fromFace) {
      this.focusLabel(fdi);
      return true;
    }
    if (this.view.zoomedFdi()) {
      this.leaveCloseUp();
      return true;
    }
    if (this.moved()) {
      this.reset();
      return true;
    }
    if (this.selected()) {
      this.select(null);
      return true;
    }
    return false;
  }

  private moveAmongFaces(delta: number): void {
    const faces = this.faceRefs();
    const next = (this.faceStop() + delta + faces.length) % faces.length;
    this.faceStop.set(next);
    faces[next]?.nativeElement.focus({ preventScroll: true });
  }

  private pickFaceByLetter(key: string, fdi: string): boolean {
    if (!this.sidePanel()) return false;
    const face = this.faces.find((f) => this.faceLetter(f, fdi) === key.toUpperCase());
    if (!face) return false;
    this.toggleFace(face, fdi);
    return true;
  }

  /** The panel's first field is what the doctor came for: what to record on this tooth. */
  private focusPanel(): boolean {
    const panel = this.panelRef()?.nativeElement;
    const field = panel?.querySelector<HTMLElement>('select') ?? panel?.querySelector<HTMLElement>('input, textarea, button');
    field?.focus();
    return !!field;
  }

  protected focusLabel(fdi: string): void {
    this.roving.set(fdi);
    // The stage clips what is off it and would scroll to reach it; the camera brings it in instead.
    this.labels.get(fdi)?.focus({ preventScroll: true });
    // Whatever scrolling is needed is the page's, to keep the whole stage clear of its sticky header.
    this.canvasHost()?.nativeElement.scrollIntoView({ block: 'nearest' });
  }

  /** Whoever cannot point sees on the tooth, and on a card beside it, what pointing would show. */
  protected onLabelFocus(fdi: string): void {
    this.roving.set(fdi);
    const engine = this.engine();
    engine?.hoverTooth(fdi);
    const at = this.positions.get(fdi);
    const stage = this.canvasHost()?.nativeElement.getBoundingClientRect();
    if (at && stage && !this.view.zoomedFdi()) this.hover.set({ hit: null, fdi, x: stage.left + at.x, y: stage.top + at.y });
  }

  protected onLabelBlur(): void {
    this.engine()?.hoverTooth(null);
    this.hover.set(null);
  }
}
