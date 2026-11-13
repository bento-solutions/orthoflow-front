import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, model, output, signal, viewChild } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { ToastService } from '../../../core/services/toast.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import {
  AddToothFindingRequest, FindingCertainty, FindingOrigin, Severity, ToothFinding,
} from '../../../core/models/clinical-record.model';
import {
  FINDING_OPTIONS, findingGroupsInUse, findingLabel, findingOption,
} from '../../../core/clinical/finding-options';
import { FindingGroup, MEASURES } from '../../../core/clinical/finding-referential';
import {
  ROOT_SURFACES, RootSurface, ToothSurface, formatSurface, parseSurface, surfaceShorthand,
} from '../../../core/clinical/tooth-surfaces';
import { SurfacePickerComponent } from './surface-picker.component';

/**
 * Everything the chart knows about one tooth, and the way to add to it.
 *
 * A tooth carries as many states as the examination produced — caries on the
 * mesial and an amalgam on the occlusal are two rows here, not one status
 * overwriting the other — each with the surface it is on, and, for work that
 * is already there, when and by whom it was done (a patient from another
 * dentist arrives with fillings this clinic did not place).
 *
 * Replaces the one-status picker: a status written straight onto the tooth is
 * overwritten the next time a finding changes, because the server derives it.
 */
@Component({
  selector: 'app-tooth-detail',
  standalone: true,
  imports: [FormsModule, DatePipe, NgTemplateOutlet, TranslateModule, SurfacePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #row let-f let-done="done">
      <li class="finding" [attr.data-kind]="f.kind">
        <span class="dot" [attr.data-kind]="f.kind" aria-hidden="true"></span>
        <div class="finding-main">
          <span class="finding-label">
            {{ label(f.findingCode) }}
            @if (f.surface) { <span class="surface-badge" [title]="f.surface">{{ shorthand(f.surface) }}</span> }
            @if (f.certainty === 'SUSPECTED') { <span class="suspect-badge">{{ 'TOOTH_DETAIL.CERTAINTY.SUSPECTED_BADGE' | translate }}</span> }
          </span>
          <span class="finding-meta">{{ meta(f) }}</span>
          @if (f.note) { <span class="finding-note">{{ f.note }}</span> }
        </div>
        <div class="finding-actions">
          @if (f.certainty === 'SUSPECTED') {
            <button type="button" class="act" (click)="confirm(f)" [title]="'TOOTH_DETAIL.CERTAINTY.CONFIRM_HINT' | translate">
              <span class="material-icons" aria-hidden="true">verified</span>{{ 'TOOTH_DETAIL.CERTAINTY.CONFIRM' | translate }}
            </button>
          }
          <button type="button" class="act" (click)="setStatus(f, 'RESOLVED')"
            [title]="(done ? 'TOOTH_DETAIL.MARK_DONE_HINT' : 'TOOTH_DETAIL.MARK_TREATED_HINT') | translate">
            <span class="material-icons" aria-hidden="true">check_circle</span>{{ (done ? 'TOOTH_DETAIL.MARK_DONE' : 'TOOTH_DETAIL.MARK_TREATED') | translate }}
          </button>
          <button type="button" class="act danger" (click)="setStatus(f, 'RETRACTED')"
            [title]="'TOOTH_DETAIL.REMOVE_HINT' | translate">
            <span class="material-icons" aria-hidden="true">close</span>{{ 'TOOTH_DETAIL.REMOVE' | translate }}
          </button>
        </div>
      </li>
    </ng-template>

    <!-- États (what the tooth is) and soins (what is to be done to it) are two lists: a
         finished soin leaves the second and joins the tooth's history below. -->
    <section class="block" [attr.aria-label]="'TOOTH_DETAIL.STATES' | translate">
      <h4 class="block-title">{{ 'TOOTH_DETAIL.STATES' | translate }}</h4>
      @if (states().length) {
        <ul class="findings">
          @for (f of states(); track f.id) {
            <ng-container *ngTemplateOutlet="row; context: { $implicit: f, done: false }" />
          }
        </ul>
      } @else {
        <p class="empty">{{ 'TOOTH_DETAIL.NO_STATES' | translate }}</p>
      }
    </section>

    <section class="block" [attr.aria-label]="'TOOTH_DETAIL.CARE' | translate">
      <h4 class="block-title">{{ 'TOOTH_DETAIL.CARE' | translate }}</h4>
      @if (care().length) {
        <ul class="findings">
          @for (f of care(); track f.id) {
            <ng-container *ngTemplateOutlet="row; context: { $implicit: f, done: true }" />
          }
        </ul>
      } @else {
        <p class="empty">{{ 'TOOTH_DETAIL.NO_CARE' | translate }}</p>
      }
    </section>

    <section class="block" [attr.aria-label]="'TOOTH_DETAIL.ADD' | translate">
      <h4 class="block-title">{{ 'TOOTH_DETAIL.ADD' | translate }}</h4>

      <label class="field">
        <span class="field-label">{{ 'TOOTH_DETAIL.WHAT' | translate }}</span>
        <select #what class="select" [ngModel]="code()" (ngModelChange)="pick($event)">
          <option value="" disabled>{{ 'TOOTH_DETAIL.CHOOSE' | translate }}</option>
          @for (group of groups; track group) {
            <optgroup [label]="('TOOTH_DETAIL.GROUP.' + group) | translate">
              @for (opt of optionsOf(group); track opt.code) {
                <option [value]="opt.code">{{ label(opt.code) }}</option>
              }
            </optgroup>
          }
        </select>
      </label>

      @if (chosen()?.surfaces) {
        <div class="field">
          <span class="field-label">{{ 'TOOTH_DETAIL.WHERE' | translate }}</span>
          <app-surface-picker [fdi]="fdi()" [value]="surface()" (valueChange)="surface.set($event)" />
        </div>
      }

      @if (chosen()?.roots && multiRooted()) {
        <!-- A back tooth has several roots, and a lesion, a fracture or a resorption is in one of them. -->
        <div class="field">
          <span class="field-label">{{ 'TOOTH_DETAIL.ROOT' | translate }}</span>
          <div class="seg seg-wrap" role="group" [attr.aria-label]="'TOOTH_DETAIL.ROOT' | translate">
            @for (root of roots; track root) {
              <button type="button" [attr.aria-pressed]="isRootPicked(root)" [class.on]="isRootPicked(root)"
                (click)="toggleRoot(root)">{{ ('SURFACE.' + root.toUpperCase()) | translate }}</button>
            }
          </div>
        </div>
      }

      @if (measure(); as kind) {
        <label class="field">
          <span class="field-label">{{ (kind === 'mm' ? 'TOOTH_DETAIL.MEASURE_MM' : 'TOOTH_DETAIL.MEASURE_GRADE') | translate }}</span>
          @if (kind === 'mm') {
            <input class="input" type="number" min="0" max="20" step="0.5" inputmode="decimal" [(ngModel)]="millimetres"
              [placeholder]="'TOOTH_DETAIL.MEASURE_MM_PLACEHOLDER' | translate" />
          } @else {
            <select class="select" [(ngModel)]="grade">
              <option value="">{{ 'TOOTH_DETAIL.MEASURE_NONE' | translate }}</option>
              <option value="1">{{ gradeLabel(1) }}</option>
              <option value="2">{{ gradeLabel(2) }}</option>
              <option value="3">{{ gradeLabel(3) }}</option>
            </select>
          }
        </label>
      }

      <div class="field">
        <span class="field-label">{{ 'TOOTH_DETAIL.CERTAINTY.LABEL' | translate }}</span>
        <div class="seg" role="group" [attr.aria-label]="'TOOTH_DETAIL.CERTAINTY.LABEL' | translate">
          <button type="button" [attr.aria-pressed]="certainty() === 'CONFIRMED'" [class.on]="certainty() === 'CONFIRMED'"
            (click)="certainty.set('CONFIRMED')">{{ 'TOOTH_DETAIL.CERTAINTY.CONFIRMED' | translate }}</button>
          <button type="button" [attr.aria-pressed]="certainty() === 'SUSPECTED'" [class.on]="certainty() === 'SUSPECTED'"
            (click)="certainty.set('SUSPECTED')">{{ 'TOOTH_DETAIL.CERTAINTY.SUSPECTED' | translate }}</button>
        </div>
        @if (certainty() === 'SUSPECTED') {
          <span class="field-hint">{{ 'TOOTH_DETAIL.CERTAINTY.HINT' | translate }}</span>
        }
      </div>

      @if (chosen()?.kind === 'EXISTING') {
        <div class="field">
          <span class="field-label">{{ 'TOOTH_DETAIL.DONE_BY' | translate }}</span>
          <div class="seg" role="group" [attr.aria-label]="'TOOTH_DETAIL.DONE_BY' | translate">
            <button type="button" [attr.aria-pressed]="origin() === 'THIS_CLINIC'"
              [class.on]="origin() === 'THIS_CLINIC'" (click)="origin.set('THIS_CLINIC')">{{ 'TOOTH_DETAIL.THIS_CLINIC' | translate }}</button>
            <button type="button" [attr.aria-pressed]="origin() === 'EXTERNAL'"
              [class.on]="origin() === 'EXTERNAL'" (click)="origin.set('EXTERNAL')">{{ 'TOOTH_DETAIL.ELSEWHERE' | translate }}</button>
          </div>
        </div>
        @if (origin() === 'EXTERNAL') {
          <label class="field">
            <span class="field-label">{{ 'TOOTH_DETAIL.PROVIDER' | translate }}</span>
            <input class="input" type="text" maxlength="160" [(ngModel)]="provider"
              [placeholder]="'TOOTH_DETAIL.PROVIDER_PLACEHOLDER' | translate" />
          </label>
        }
        <label class="field">
          <span class="field-label">{{ 'TOOTH_DETAIL.WHEN' | translate }}</span>
          <input class="input" type="date" [max]="today" [(ngModel)]="performedOn" />
          <span class="field-hint">{{ 'TOOTH_DETAIL.WHEN_HINT' | translate }}</span>
        </label>
      }

      <label class="field">
        <span class="field-label">{{ 'TOOTH_DETAIL.NOTE' | translate }}</span>
        <input class="input" type="text" maxlength="500" [(ngModel)]="note"
          [placeholder]="'TOOTH_DETAIL.NOTE_PLACEHOLDER' | translate" />
      </label>

      <button type="button" class="btn-add" [disabled]="!code() || saving()" (click)="add()">
        <span class="material-icons" aria-hidden="true">add</span>{{ 'TOOTH_DETAIL.ADD_BUTTON' | translate }}
      </button>
    </section>

    <section class="block">
      <details [open]="treated().length > 0 && !active().length">
        <summary class="block-title summary">{{ 'TOOTH_DETAIL.HISTORY' | translate }} ({{ treated().length }})</summary>
        @if (treated().length) {
          <ul class="findings">
            @for (f of treated(); track f.id) {
              <li class="finding past">
                <span class="dot" data-kind="DONE" aria-hidden="true"></span>
                <div class="finding-main">
                  <span class="finding-label">
                    {{ label(f.findingCode) }}
                    @if (f.surface) { <span class="surface-badge" [title]="f.surface">{{ shorthand(f.surface) }}</span> }
                  </span>
                  <span class="finding-meta">
                    {{ 'TOOTH_DETAIL.TREATED_ON' | translate }} {{ f.updatedAt | date: 'mediumDate' }}
                  </span>
                </div>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">{{ 'TOOTH_DETAIL.NO_HISTORY' | translate }}</p>
        }
      </details>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .block { padding: .75rem 0; border-top: 1px solid var(--border-subtle); }
    .block:first-child { border-top: 0; padding-top: 0; }
    .block-title { margin: 0 0 .5rem; font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
    .summary { cursor: pointer; margin: 0; }
    .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .finding { display: flex; align-items: flex-start; gap: .625rem; padding: .5rem .625rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface, #fff); }
    .finding.past { background: var(--status-idle-tint); border-color: transparent; }
    .dot { flex: none; width: .625rem; height: .625rem; margin-top: .3rem; border-radius: 999px; background: var(--status-idle); }
    .dot[data-kind='CONDITION'] { background: var(--status-critical); }
    .dot[data-kind='EXISTING'] { background: var(--status-active); }
    .dot[data-kind='TREATMENT_REQUIRED'] { background: var(--status-attention); }
    .dot[data-kind='DONE'] { background: var(--status-done); }
    .finding-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .125rem; }
    .finding-label { font-weight: 600; color: var(--text); display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; }
    .surface-badge { font-size: .6875rem; font-weight: 700; letter-spacing: .06em; padding: .0625rem .375rem; border-radius: .25rem; background: var(--action-tint); color: var(--action-text); }
    .suspect-badge { font-size: .6875rem; font-weight: 700; padding: .0625rem .375rem; border-radius: .25rem; border: 1px dashed #6d28d9; background: #f5f3ff; color: #5b21b6; }
    .seg-wrap { flex-wrap: wrap; }
    .finding-meta { font-size: .75rem; color: var(--text-muted); }
    .finding.past .finding-meta { color: var(--text-muted-on-tint); }
    .finding-note { font-size: .8125rem; color: var(--text); white-space: pre-line; }
    .finding-actions { display: flex; flex-direction: column; gap: .25rem; flex: none; }
    .act { display: inline-flex; align-items: center; gap: .25rem; font-size: .75rem; padding: .25rem .5rem; border: 1px solid var(--border); border-radius: .375rem; background: var(--surface, #fff); color: var(--action-text); cursor: pointer; }
    .act .material-icons { font-size: 1rem; }
    .act:hover { background: var(--action-tint); }
    .act.danger { color: var(--status-critical-text); }
    .act.danger:hover { background: var(--danger-tint); }
    /* The page-wide .empty is a large centred state; here it is one quiet line. */
    .empty { display: block; margin: 0; padding: 0; text-align: start; font-size: .8125rem; color: var(--text-muted); }
    .field { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .625rem; }
    .field-label { font-size: .75rem; font-weight: 600; color: var(--text); }
    .field-hint { font-size: .6875rem; color: var(--text-muted); }
    .select, .input { width: 100%; padding: .4375rem .5rem; font: inherit; font-size: .875rem; border: 1px solid var(--border-strong); border-radius: .375rem; background: var(--surface, #fff); color: var(--text); }
    .select:focus-visible, .input:focus-visible, .seg button:focus-visible, .act:focus-visible, .btn-add:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
    .seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: .375rem; overflow: hidden; align-self: flex-start; }
    .seg button { padding: .375rem .75rem; font: inherit; font-size: .8125rem; border: 0; background: var(--surface, #fff); color: var(--text); cursor: pointer; }
    .seg button + button { border-inline-start: 1px solid var(--border-strong); }
    .seg button.on { background: var(--action); color: var(--text-inverse); }
    .btn-add { display: inline-flex; align-items: center; gap: .25rem; padding: .5rem .875rem; font: inherit; font-size: .875rem; font-weight: 600; border: 0; border-radius: .375rem; background: var(--action); color: var(--text-inverse); cursor: pointer; }
    .btn-add:hover:not(:disabled) { background: var(--action-hover); }
    .btn-add:disabled { opacity: .5; cursor: not-allowed; }
  `],
})
export class ToothDetailComponent {
  readonly patientId = input.required<string>();
  readonly fdi = input.required<string>();
  /** Active findings of the whole patient, as the dossier already holds them. */
  readonly findings = input<ToothFinding[]>([]);
  /** The face or faces the next finding is on. Two-way so the 3D chart can set it from a click on the tooth. */
  readonly surface = model<string | null>(null);
  readonly changed = output<void>();

  private readonly records = inject(ClinicalRecordService);
  private readonly charts = inject(DentalChartService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly announcer = inject(AnnouncerService);
  private readonly what = viewChild<ElementRef<HTMLSelectElement>>('what');

  protected readonly groups = findingGroupsInUse();
  protected readonly roots = ROOT_SURFACES;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly code = signal('');
  protected readonly origin = signal<FindingOrigin>('THIS_CLINIC');
  protected readonly certainty = signal<FindingCertainty>('CONFIRMED');
  protected provider = '';
  protected performedOn = '';
  protected note = '';
  protected millimetres: number | null = null;
  protected grade = '';
  protected readonly saving = signal(false);

  protected readonly chosen = computed(() => findingOption(this.code()));
  /** What a number said with the chosen state means: millimetres or a grade, or null when it has none. */
  protected readonly measure = computed(() => MEASURES[this.code()] ?? null);
  /** One root, or one nobody has to be told from the others: the root picker is for back teeth. */
  protected readonly multiRooted = computed(() => Number(this.fdi().charAt(1)) >= 4);
  protected readonly active = computed(() =>
    this.findings().filter((f) => f.fdi === this.fdi() && f.status === 'ACTIVE'));
  /** États: what the tooth is — pathology, work already in the mouth, things to watch. */
  protected readonly states = computed(() => this.active().filter((f) => f.kind !== 'TREATMENT_REQUIRED'));
  /** Soins: what is still to be done to it. Done ones move to the history. */
  protected readonly care = computed(() => this.active().filter((f) => f.kind === 'TREATMENT_REQUIRED'));
  /** Treated work of this tooth, from the full history the panel asks for. */
  protected readonly treated = computed(() =>
    this.records.history().filter((f) => f.fdi === this.fdi() && f.status === 'RESOLVED'));

  constructor() {
    // The panel is opened per tooth: load the history once per patient it is used for.
    effect(() => {
      const id = this.patientId();
      if (id) this.records.loadHistory(id);
    });
    // Another tooth, another form.
    effect(() => {
      this.fdi();
      this.resetForm();
    });
  }

  protected optionsOf(group: FindingGroup) {
    return FINDING_OPTIONS.filter((o) => o.group === group);
  }

  protected isRootPicked(root: RootSurface): boolean {
    return parseSurface(this.surface()).includes(root);
  }

  protected toggleRoot(root: RootSurface): void {
    const next = new Set<ToothSurface>(parseSurface(this.surface()));
    if (next.has(root)) next.delete(root);
    else next.add(root);
    this.surface.set(formatSurface(next));
  }

  /** "Grade 2", or "grade II" for a furcation, as the dentist says it. */
  protected gradeLabel(grade: 1 | 2 | 3): string {
    const word = this.translate.instant('TOOTH_DETAIL.GRADE');
    return `${word} ${this.code() === 'furcation_involvement' ? ['I', 'II', 'III'][grade - 1] : grade}`;
  }

  /** Puts a suspected finding on the record as confirmed. The same finding, said again with no doubt. */
  protected confirm(finding: ToothFinding): void {
    const request: AddToothFindingRequest = {
      findingCode: finding.findingCode ?? '',
      source: 'manual',
      certainty: 'CONFIRMED',
      ...(finding.surface ? { surface: finding.surface } : {}),
      ...(finding.severity ? { severity: finding.severity } : {}),
      ...(finding.note ? { note: finding.note } : {}),
      ...(finding.performedOn ? { performedOn: finding.performedOn } : {}),
      ...(finding.origin ? { origin: finding.origin } : {}),
      ...(finding.providerName ? { providerName: finding.providerName } : {}),
    };
    this.records.addFinding(this.patientId(), this.fdi(), request).subscribe({
      next: () => this.afterChange(this.label(finding.findingCode ?? ''), false),
      error: (err) => this.fail(err),
    });
  }

  protected label(code: string): string {
    return findingLabel(this.translate, code);
  }

  protected shorthand(surface: string): string {
    return surfaceShorthand(surface);
  }

  /** "Elsewhere · Dr Benani · 12 Mar 2019" — only the parts that are known. */
  protected meta(f: ToothFinding): string {
    const parts: string[] = [];
    if (f.origin === 'EXTERNAL') {
      parts.push(this.translate.instant('TOOTH_DETAIL.ELSEWHERE'));
      if (f.providerName) parts.push(f.providerName);
    }
    if (f.performedOn) {
      parts.push(new Date(f.performedOn + 'T00:00:00').toLocaleDateString(this.translate.currentLang || undefined,
        { year: 'numeric', month: 'short', day: 'numeric' }));
    } else if (f.kind === 'EXISTING') {
      parts.push(this.translate.instant('TOOTH_DETAIL.DATE_UNKNOWN'));
    }
    return parts.join(' · ');
  }

  protected pick(code: string): void {
    this.code.set(code);
    this.millimetres = null;
    this.grade = '';
    // A face already picked on the tooth stays for a finding that can have one.
    const option = findingOption(code);
    if (!option?.surfaces && !option?.roots) this.surface.set(null);
  }

  protected add(): void {
    const code = this.code();
    if (!code || this.saving()) return;
    const isExisting = this.chosen()?.kind === 'EXISTING';
    const surface = this.surface();
    const roots = this.chosen()?.roots && this.multiRooted();
    // Only what the chosen state can be about: the faces of the crown, and the roots when it is about one.
    const parts = parseSurface(surface).filter((part) => (this.chosen()?.surfaces && !part.endsWith('root')) || (roots && part.endsWith('root')));
    const named = parts.length ? formatSurface(parts) : null;
    const measure = this.measureNote();
    const note = [measure, this.note.trim()].filter(Boolean).join(' · ');
    const request: AddToothFindingRequest = {
      findingCode: code,
      source: 'manual',
      ...(named ? { surface: named } : {}),
      ...(note ? { note } : {}),
      ...(this.certainty() === 'SUSPECTED' ? { certainty: 'SUSPECTED' as const } : {}),
      ...(this.measure() === 'grade' && this.grade ? { severity: (['MILD', 'MODERATE', 'SEVERE'] as Severity[])[Number(this.grade) - 1] } : {}),
      ...(isExisting && this.performedOn ? { performedOn: this.performedOn } : {}),
      ...(isExisting ? { origin: this.origin() } : {}),
      ...(isExisting && this.origin() === 'EXTERNAL' && this.provider.trim() ? { providerName: this.provider.trim() } : {}),
    };
    this.saving.set(true);
    this.records.addFinding(this.patientId(), this.fdi(), request).subscribe({
      next: () => this.afterChange(this.label(code)),
      error: (err) => this.fail(err),
    });
  }

  protected setStatus(finding: ToothFinding, status: 'RESOLVED' | 'RETRACTED'): void {
    this.records.changeFindingStatus(this.patientId(), finding.id, status).subscribe({
      next: () => this.afterChange(this.label(finding.findingCode), false),
      error: (err) => this.fail(err),
    });
  }

  private afterChange(what: string, reset = true): void {
    this.saving.set(false);
    if (reset) this.resetForm();
    this.charts.reloadChart(this.patientId());
    this.changed.emit();
    // The button just pressed is disabled now or gone with its row, and focus would go with it.
    this.what()?.nativeElement.focus();
    this.announcer.announce(this.translate.instant('TOOTH_DETAIL.SAVED', { what, fdi: this.fdi() }));
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    console.error('Tooth finding change failed', err);
    this.toast.error(this.translate.instant('TOOTH_DETAIL.SAVE_FAILED'));
  }

  /** The measure as the voice records it: "3 mm", "grade 2", "grade II" for a furcation. */
  private measureNote(): string {
    if (this.measure() === 'mm') return this.millimetres != null && this.millimetres > 0 ? `${this.millimetres} mm` : '';
    if (this.measure() === 'grade' && this.grade) {
      return `grade ${this.code() === 'furcation_involvement' ? ['I', 'II', 'III'][Number(this.grade) - 1] : this.grade}`;
    }
    return '';
  }

  private resetForm(): void {
    this.code.set('');
    this.surface.set(null);
    this.origin.set('THIS_CLINIC');
    this.certainty.set('CONFIRMED');
    this.provider = '';
    this.performedOn = '';
    this.note = '';
    this.millimetres = null;
    this.grade = '';
  }
}
