import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  AddToothFindingRequest, FindingKind, FindingOrigin, ToothFinding,
} from '../../../core/models/clinical-record.model';
import {
  FINDING_KIND_ORDER, FINDING_OPTIONS, findingLabel, findingOption,
} from '../../../core/clinical/finding-options';
import { surfaceShorthand } from '../../../core/clinical/tooth-surfaces';
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
          </span>
          <span class="finding-meta">{{ meta(f) }}</span>
          @if (f.note) { <span class="finding-note">{{ f.note }}</span> }
        </div>
        <div class="finding-actions">
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
        <select class="select" [ngModel]="code()" (ngModelChange)="pick($event)">
          <option value="" disabled>{{ 'TOOTH_DETAIL.CHOOSE' | translate }}</option>
          @for (kind of kinds; track kind) {
            <optgroup [label]="('TOOTH_DETAIL.KIND.' + kind) | translate">
              @for (opt of optionsOf(kind); track opt.code) {
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

      @if (chosen()?.kind === 'EXISTING') {
        <div class="field">
          <span class="field-label">{{ 'TOOTH_DETAIL.DONE_BY' | translate }}</span>
          <div class="seg" role="radiogroup" [attr.aria-label]="'TOOTH_DETAIL.DONE_BY' | translate">
            <button type="button" role="radio" [attr.aria-checked]="origin() === 'THIS_CLINIC'"
              [class.on]="origin() === 'THIS_CLINIC'" (click)="origin.set('THIS_CLINIC')">{{ 'TOOTH_DETAIL.THIS_CLINIC' | translate }}</button>
            <button type="button" role="radio" [attr.aria-checked]="origin() === 'EXTERNAL'"
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
    .finding-meta { font-size: .75rem; color: var(--text-muted); }
    .finding.past .finding-meta { color: var(--text-muted-on-tint); }
    .finding-note { font-size: .8125rem; color: var(--text); white-space: pre-line; }
    .finding-actions { display: flex; flex-direction: column; gap: .25rem; flex: none; }
    .act { display: inline-flex; align-items: center; gap: .25rem; font-size: .75rem; padding: .25rem .5rem; border: 1px solid var(--border); border-radius: .375rem; background: var(--surface, #fff); color: var(--action-text); cursor: pointer; }
    .act .material-icons { font-size: 1rem; }
    .act:hover { background: var(--action-tint); }
    .act.danger { color: var(--status-critical-text); }
    .act.danger:hover { background: var(--danger-tint); }
    .empty { margin: 0; font-size: .8125rem; color: var(--text-muted); }
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
  readonly changed = output<void>();

  private readonly records = inject(ClinicalRecordService);
  private readonly charts = inject(DentalChartService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly kinds = FINDING_KIND_ORDER;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly code = signal('');
  protected readonly surface = signal<string | null>(null);
  protected readonly origin = signal<FindingOrigin>('THIS_CLINIC');
  protected provider = '';
  protected performedOn = '';
  protected note = '';
  protected readonly saving = signal(false);

  protected readonly chosen = computed(() => findingOption(this.code()));
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

  protected optionsOf(kind: FindingKind) {
    return FINDING_OPTIONS.filter((o) => o.kind === kind);
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
    this.surface.set(null);
  }

  protected add(): void {
    const code = this.code();
    if (!code || this.saving()) return;
    const isExisting = this.chosen()?.kind === 'EXISTING';
    const request: AddToothFindingRequest = {
      findingCode: code,
      source: 'manual',
      ...(this.chosen()?.surfaces && this.surface() ? { surface: this.surface()! } : {}),
      ...(this.note.trim() ? { note: this.note.trim() } : {}),
      ...(isExisting && this.performedOn ? { performedOn: this.performedOn } : {}),
      ...(isExisting ? { origin: this.origin() } : {}),
      ...(isExisting && this.origin() === 'EXTERNAL' && this.provider.trim() ? { providerName: this.provider.trim() } : {}),
    };
    this.saving.set(true);
    this.records.addFinding(this.patientId(), this.fdi(), request).subscribe({
      next: () => this.afterChange(),
      error: (err) => this.fail(err),
    });
  }

  protected setStatus(finding: ToothFinding, status: 'RESOLVED' | 'RETRACTED'): void {
    this.records.changeFindingStatus(this.patientId(), finding.id, status).subscribe({
      next: () => this.afterChange(false),
      error: (err) => this.fail(err),
    });
  }

  private afterChange(reset = true): void {
    this.saving.set(false);
    if (reset) this.resetForm();
    this.charts.reloadChart(this.patientId());
    this.changed.emit();
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    console.error('Tooth finding change failed', err);
    this.toast.error(this.translate.instant('TOOTH_DETAIL.SAVE_FAILED'));
  }

  private resetForm(): void {
    this.code.set('');
    this.surface.set(null);
    this.origin.set('THIS_CLINIC');
    this.provider = '';
    this.performedOn = '';
    this.note = '';
  }
}
