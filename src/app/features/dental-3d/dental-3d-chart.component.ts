import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, NgZone, afterNextRender, computed, effect, inject, input, model, output, signal, untracked, viewChild, viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DentalChartType, DentalChartState, ToothStatus } from '../../core/models/patient.model';
import { ToothFinding } from '../../core/models/clinical-record.model';
import { PatientTreatment } from '../../core/models/patient-treatment.model';
import { findingLabel } from '../../core/clinical/finding-options';
import { PAINT_ZONES, PaintZone, StagedFinding, ToothPaint, paintChart, surfaceOfZone } from '../../core/clinical/tooth-paint';
import { SURFACE_LETTER, SURFACE_ZONES, SURFACE_ZONE_PATH, SurfaceZone, ToothSurface, formatSurface, parseSurface, surfaceMarks } from '../../core/clinical/tooth-surfaces';
import { FAMILY_PAINT, PLANNED_PAINT, TREATMENT_PLAN_INK, toothStatusLabelKey } from '../../core/clinical/tooth-status';
import { DENTITION_VIEWS, Dental3dViewService, DentitionView } from '../../core/services/dental-3d-view.service';
import { ClinicalRecordService } from '../../core/services/clinical-record.service';
import { DentalChartService } from '../../core/services/dental-chart.service';
import { DentalChartComponent } from '../dental-chart/dental-chart.component';
import { ToothDetailComponent } from '../dental-chart/tooth-detail/tooth-detail.component';
import { DentitionEngine, DentitionHit, FACES, ToothFace, dentitionEngine, webGl2Available } from './dentition-engine';

const ROWS: Record<DentalChartType, readonly (readonly string[])[]> = {
  adult: [
    ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
    ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'],
  ],
  child: [
    ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'],
    ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'],
  ],
};

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
  imports: [FormsModule, TranslateModule, DentalChartComponent, ToothDetailComponent],
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
            <div class="d3-views" role="group" [attr.aria-label]="'DENTAL_3D.VIEW' | translate">
              @for (v of views; track v) {
                <button type="button" [attr.aria-pressed]="view.view() === v" [class.on]="view.view() === v"
                  [title]="('DENTAL_3D.VIEW_HINT.' + v) | translate" (click)="view.view.set(v)">
                  {{ ('DENTAL_3D.VIEW_NAME.' + v) | translate }}
                </button>
              }
            </div>
            @if (focusCard(); as card) {
              <div class="d3-focus" role="status">
                <b>{{ card.title }}</b>
                @if (card.lines.length) { <span>{{ card.lines.join(' · ') }}</span> }
              </div>
            }
            <div class="d3-tools">
              @if (view.zoomedFdi()) {
                <button type="button" class="d3-back" (click)="view.zoomedFdi.set(null)">
                  <span class="material-icons" aria-hidden="true">arrow_back</span>{{ 'DENTAL_3D.WHOLE_MOUTH' | translate }}
                </button>
              } @else if (selected(); as fdi) {
                <button type="button" class="d3-tool" [title]="'DENTAL_3D.ZOOM_TOOTH' | translate: { fdi: fdi }"
                  [attr.aria-label]="'DENTAL_3D.ZOOM_TOOTH' | translate: { fdi: fdi }" (click)="view.zoomedFdi.set(fdi)">
                  <span class="material-icons" aria-hidden="true">center_focus_strong</span>
                </button>
              }
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

            @if (!view.zoomedFdi()) {
              <div class="d3-sides" aria-hidden="true">
                <span>{{ 'DENTAL_3D.PATIENT_RIGHT' | translate }}</span>
                <span>{{ 'DENTAL_3D.PATIENT_LEFT' | translate }}</span>
              </div>
            }

            <div class="d3-labels">
              @for (fdi of allTeeth(); track fdi) {
                <button #label type="button" class="d3-label" [attr.data-fdi]="fdi" [attr.data-state]="labelState(fdi)"
                  [attr.data-ring]="paintOf(fdi)?.treatment"
                  [class.selected]="selected() === fdi" [class.focus]="focusFdi() === fdi"
                  [class.staged]="paintOf(fdi)?.staged" [class.planned]="paintOf(fdi)?.planned"
                  [attr.aria-label]="labelAria(fdi)" [attr.aria-pressed]="selected() === fdi"
                  [attr.tabindex]="roving() === fdi ? 0 : -1"
                  (click)="select(fdi)" (dblclick)="view.zoomedFdi.set(fdi)"
                  (pointerenter)="hoverFromLabel(fdi, $event)" (pointerleave)="hoverFromLabel(null, $event)" (focus)="roving.set(fdi)">
                  <span class="d3-num">{{ fdi }}</span>
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

            <div class="d3-labels">
              @if (view.zoomedFdi(); as zoomed) {
                @for (face of faces; track face) {
                  <button #faceLabel type="button" class="d3-face" [attr.data-face]="face"
                    [class.on]="pickedFaces().has(faceSurface(face, zoomed))"
                    [attr.aria-label]="('SURFACE.' + faceSurface(face, zoomed).toUpperCase()) | translate"
                    [attr.aria-pressed]="pickedFaces().has(faceSurface(face, zoomed))"
                    [title]="('SURFACE.' + faceSurface(face, zoomed).toUpperCase()) | translate"
                    (click)="toggleFace(face, zoomed)">{{ faceLetter(face, zoomed) }}</button>
                }
              }
            </div>

            @if (hoverCard(); as card) {
              <div class="d3-tip" [style.transform]="'translate(' + card.left + 'px,' + card.top + 'px)'">
                <b>{{ card.title }}</b>
                @if (card.zone) { <span class="d3-tip-zone">{{ card.zone }}</span> }
                @for (line of card.lines; track line) { <span>{{ line }}</span> }
              </div>
            }

            @if (state() === 'loading') {
              <div class="d3-overlay"><span class="d3-spinner" aria-hidden="true"></span>{{ 'DENTAL_3D.LOADING' | translate }}</div>
            }
          </div>

          <div class="d3-legend">
            <span class="d3-key"><i class="sw sw-existing"></i>{{ 'DENTAL_3D.LEGEND.EXISTING' | translate }}</span>
            <span class="d3-key"><i class="sw sw-condition"></i>{{ 'DENTAL_3D.LEGEND.CONDITION' | translate }}</span>
            <span class="d3-key"><i class="sw sw-planned"></i>{{ 'DENTAL_3D.LEGEND.PLANNED' | translate }}</span>
            <span class="d3-key"><i class="sw sw-absent"></i>{{ 'DENTAL_3D.LEGEND.ABSENT' | translate }}</span>
            <span class="d3-key"><i class="sw sw-lesion"></i>{{ 'DENTAL_3D.LEGEND.LESION' | translate }}</span>
            @if (stagedTeeth().length) {
              <span class="d3-key"><i class="sw sw-staged"></i>{{ 'VOICE.LEGEND_STAGED' | translate }}</span>
            }
            @for (ring of ringsInUse(); track ring) {
              <span class="d3-key"><i class="sw sw-ring" [style.borderColor]="ringColour(ring)"></i>{{ ('DENTAL_3D.LEGEND.RING_' + ring) | translate }}</span>
            }
          </div>
          <p class="d3-credit">
            {{ 'DENTAL_3D.ILLUSTRATIVE' | translate }}
            @if (chart().chartType === 'child') { {{ 'DENTAL_3D.ILLUSTRATIVE_CHILD' | translate }} }
            <a href="https://sketchfab.com/3d-models/permanent-dentition-2f69d7b59c3e4a6a8bcae041bd8e591b" target="_blank" rel="noopener noreferrer">“Permanent Dentition”</a>,
            University of Dundee, School of Dentistry,
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
            {{ 'DENTAL_3D.ADAPTED' | translate }}
          </p>
        </div>

        @if (sidePanel()) {
          <aside class="d3-panel" [attr.aria-label]="'DENTAL_3D.PANEL' | translate">
            @if (selected(); as fdi) {
              <header class="d3-panel-head">
                <span class="d3-panel-fdi">{{ fdi }}</span>
                <div class="d3-panel-title">
                  <h3>{{ ('TOOTH_NAME.' + fdi) | translate }}</h3>
                  <p>{{ statusLabel(fdi) | translate }}</p>
                </div>
                <button type="button" class="d3-tool" [attr.aria-label]="'COMMON.CLOSE' | translate" (click)="select(null)">
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
                      <button type="button" class="d3-chip" [attr.aria-label]="'TOOTH_NAME.' + fdi | translate" (click)="select(fdi)">{{ fdi }}</button>
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

  readonly assignTreatment = output<string>();

  protected readonly view = inject(Dental3dViewService);
  private readonly charts = inject(DentalChartService);
  private readonly records = inject(ClinicalRecordService);
  private readonly translate = inject(TranslateService);
  private readonly zone = inject(NgZone);

  private readonly canvasHost = viewChild<ElementRef<HTMLDivElement>>('canvasHost');
  private readonly labelRefs = viewChildren<ElementRef<HTMLButtonElement>>('label');
  private readonly faceRefs = viewChildren<ElementRef<HTMLButtonElement>>('faceLabel');
  private labels = new Map<string, HTMLButtonElement>();
  private readonly placed = new Map<string, number>();

  protected readonly engine = signal<DentitionEngine | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly fallback = signal(false);
  protected readonly moved = signal(false);
  protected readonly roving = signal<string | null>(null);
  protected readonly pickedSurface = signal<string | null>(null);
  private readonly hover = signal<{ hit: DentitionHit | null; fdi: string; x: number; y: number } | null>(null);

  protected readonly views = DENTITION_VIEWS;
  protected readonly faces = FACES;
  protected readonly surfaceZones = SURFACE_ZONES;
  protected readonly zonePaths = SURFACE_ZONE_PATH;

  private readonly rows = computed(() => ROWS[this.chart().chartType]);
  protected readonly allTeeth = computed(() => this.rows().flat());
  protected readonly stagedTeeth = computed(() => [...new Set(this.staged().map((s) => s.fdi))]);

  private readonly paints = computed(() => paintChart(this.chart().teeth, this.findings(), this.staged(), this.treatments()));
  private readonly paintByFdi = computed(() => new Map<string, ToothPaint>(this.paints().map((p) => [p.fdi, p])));
  private readonly marks = computed(() => surfaceMarks([
    ...this.findings().filter((f) => f.status === 'ACTIVE').map((f) => ({ fdi: f.fdi, kind: f.kind, surface: f.surface })),
  ]));
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
    const groups: Record<'condition' | 'planned' | 'existing' | 'absent', string[]> = { condition: [], planned: [], existing: [], absent: [] };
    for (const fdi of this.allTeeth()) {
      const paint = this.paintByFdi().get(fdi);
      if (!paint) continue;
      const families = new Set(PAINT_ZONES.map((zone) => paint.zones[zone]?.family));
      if (paint.absent) groups.absent.push(fdi);
      if (families.has('condition') || paint.lesion || paint.flagged) groups.condition.push(fdi);
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
    const stage = this.canvasHost()?.nativeElement.getBoundingClientRect();
    if (!stage) return null;
    const left = Math.min(Math.max(x - stage.left + 14, 4), stage.width - 230);
    const top = Math.min(Math.max(y - stage.top + 16, 4), stage.height - 96);
    const surface = hit ? surfaceOfZone(hit.zone, fdi) : null;
    const zone = hit
      ? hit.zone === 'root' ? this.translate.instant('DENTAL_3D.ROOT') : surface ? this.translate.instant(`SURFACE.${surface.toUpperCase()}`) : null
      : null;
    const lines = (this.activeByTooth().get(fdi) ?? []).slice(0, 4).map((f) => findingLabel(this.translate, f.findingCode ?? ''));
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
    effect(() => this.engine()?.setView(this.view.view()));
    effect(() => this.engine()?.setSelected(this.selected()));
    effect(() => this.engine()?.setFocus(this.focusFdi()));
    effect(() => this.engine()?.zoomTo(this.view.zoomedFdi()));
    effect(() => this.engine()?.setPicked(this.pickedZones()));
    effect(() => {
      this.labels = new Map(this.labelRefs().map((ref) => [ref.nativeElement.dataset['fdi']!, ref.nativeElement]));
      this.placed.clear();
    });
    effect(() => {
      const patientId = this.chart().patientId;
      if (this.sidePanel()) untracked(() => this.records.loadPeriodontal(patientId));
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

  private readonly pickedZones = computed<PaintZone[]>(() =>
    parseSurface(this.pickedSurface()).map((surface) => (surface === 'incisal' ? 'occlusal' : surface)));

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
        doubleClick: (hit) => this.view.zoomedFdi.set(hit.fdi),
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

  protected labelAria(fdi: string): string {
    const lines = (this.activeByTooth().get(fdi) ?? []).map((f) => findingLabel(this.translate, f.findingCode ?? ''));
    return [`${fdi}, ${this.translate.instant(`TOOTH_NAME.${fdi}`)}`, ...lines].join(', ');
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

  private typed = '';
  private typedAt = 0;

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement).closest('input, textarea, select')) return;
    const current = this.roving() ?? this.selected() ?? this.rows()[0][0];
    switch (event.key) {
      case 'ArrowRight': this.moveFocus(current, 1, 0); break;
      case 'ArrowLeft': this.moveFocus(current, -1, 0); break;
      case 'ArrowDown': this.moveFocus(current, 0, 1); break;
      case 'ArrowUp': this.moveFocus(current, 0, -1); break;
      case 'Escape':
        if (this.view.zoomedFdi()) this.view.zoomedFdi.set(null);
        else this.select(null);
        break;
      default:
        if (/^\d$/.test(event.key)) { this.typeDigit(event.key); break; }
        return;
    }
    event.preventDefault();
  }

  private moveFocus(fdi: string, across: number, down: number): void {
    const rows = this.rows();
    const row = rows.findIndex((r) => r.includes(fdi));
    if (row < 0) return;
    const nextRow = Math.min(rows.length - 1, Math.max(0, row + down));
    const column = rows[row].indexOf(fdi);
    const nextColumn = Math.min(rows[nextRow].length - 1, Math.max(0, column + across));
    this.focusLabel(rows[nextRow][nextColumn]);
  }

  /** Typing "16" goes to tooth 16: the shortest way there for anyone with a keyboard. */
  private typeDigit(digit: string): void {
    const now = performance.now();
    this.typed = now - this.typedAt < 900 ? this.typed + digit : digit;
    this.typedAt = now;
    if (this.typed.length < 2) return;
    const fdi = this.typed;
    this.typed = '';
    if (this.allTeeth().includes(fdi)) {
      this.focusLabel(fdi);
      this.select(fdi);
    }
  }

  private focusLabel(fdi: string): void {
    this.roving.set(fdi);
    this.labels.get(fdi)?.focus();
  }
}
