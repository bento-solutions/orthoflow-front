import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import {
  AllergyWarning, Prescription, PrescriptionLibraryEntry, PrescriptionLine, PrescriptionTemplate, PrescriptionsApi,
} from '../../../core/services/prescriptions-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { IconComponent } from '../../ui/icon.component';
import { ModalComponent } from '../../ui/modal.component';

/** A line as the form edits it: every field a string, so an empty input is '' rather than null. */
export interface LineDraft {
  drug: string;
  form: string;
  dci: string;
  posology: string;
}

const blankLine = (): LineDraft => ({ drug: '', form: '', dci: '', posology: '' });

/** The lines worth sending: a drug and how to take it are both needed; the rest is optional. */
export function completeLines(lines: readonly LineDraft[]): PrescriptionLine[] {
  return lines
    .filter(l => l.drug.trim() && l.posology.trim())
    .map(l => ({ drug: l.drug.trim(), form: l.form.trim() || null, dci: l.dci.trim() || null, posology: l.posology.trim() }) as PrescriptionLine);
}

/** Lines half-filled: a drug without a posology or the reverse. Issuing waits until they are complete or cleared. */
export function incompleteLines(lines: readonly LineDraft[]): number {
  return lines.filter(l => !!l.drug.trim() !== !!l.posology.trim()).length;
}

/** A start: the clinic's template, or a reference entry from the library (to be read before use). */
type Source = { kind: 'template'; template: PrescriptionTemplate } | { kind: 'library'; entry: PrescriptionLibraryEntry };

/**
 * Writing an ordonnance. The doctor starts from one of the clinic's templates or from the
 * reference library, edits the drugs, and issues it; the server numbers it and renders the
 * PDF, which opens for printing.
 *
 * Before issuing, the drugs are checked against the patient's recorded allergies. A drug
 * related to one is shown with the allergy and the reason, and issuing then needs the
 * prescriber to say they saw it. The check knows a limited set of drug families, and says
 * so: no warning is not a clearance.
 */
@Component({
  selector: 'app-prescription-editor',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent, ModalComponent],
  template: `
    <app-modal [open]="open()" [title]="'RX.NEW_TITLE' | translate: { name: patientName() }" size="lg" [dismissable]="!busy()" (closed)="close()">
      <div class="space-y-4">
        <label class="field">
          <span class="label">{{ 'RX.START_FROM' | translate }}</span>
          <select class="select" [ngModel]="sourceKey()" (ngModelChange)="pick($event)" name="source">
            <option value="">{{ 'RX.BLANK' | translate }}</option>
            @if (templates().length) {
              <optgroup [label]="'RX.CLINIC_TEMPLATES' | translate">
                @for (t of templates(); track t.id) {
                  <option [value]="'t:' + t.id">{{ t.name }}{{ t.reviewed ? '' : ' — ' + ('RX.TO_REVIEW' | translate) }}</option>
                }
              </optgroup>
            }
            @if (library().length) {
              <optgroup [label]="'RX.LIBRARY' | translate">
                @for (e of library(); track e.code) { <option [value]="'l:' + e.code">{{ e.name }}</option> }
              </optgroup>
            }
          </select>
        </label>

        @if (source(); as s) {
          @if (s.kind === 'library') {
            <div class="rounded-lg border border-attention-200 bg-attention-50 p-3 text-sm text-ink-800" role="note">
              <p class="font-semibold">{{ 'RX.LIBRARY_NOTE' | translate }}</p>
              @if (s.entry.alternative) { <p class="mt-1"><b>{{ 'RX.ALTERNATIVE' | translate }}</b> {{ s.entry.alternative }}</p> }
              @if (s.entry.warningSigns) { <p class="mt-1"><b>{{ 'RX.WARNING_SIGNS' | translate }}</b> {{ s.entry.warningSigns }}</p> }
              <a class="mt-1 inline-block text-xs underline" [href]="s.entry.sourceUrl" target="_blank" rel="noopener">{{ 'RX.SOURCE' | translate }}</a>
            </div>
          } @else if (!s.template.reviewed) {
            <p class="rounded-lg border border-attention-200 bg-attention-50 p-3 text-sm" role="note">{{ 'RX.TEMPLATE_TO_REVIEW' | translate }}</p>
          }
        }

        <div class="space-y-3">
          @for (line of lines(); track $index; let i = $index) {
            <fieldset class="rounded-lg border border-ink-200 p-3">
              <legend class="px-1 text-xs font-semibold text-ink-500">{{ 'RX.DRUG_N' | translate: { n: i + 1 } }}</legend>
              <div class="grid gap-2 sm:grid-cols-3">
                <input class="input sm:col-span-2" [attr.aria-label]="'RX.DRUG' | translate" [placeholder]="'RX.DRUG' | translate" maxlength="160"
                  [ngModel]="line.drug" (ngModelChange)="setLine(i, 'drug', $event)" [name]="'drug' + i" />
                <input class="input" [attr.aria-label]="'RX.FORM' | translate" [placeholder]="'RX.FORM' | translate" maxlength="80"
                  [ngModel]="line.form" (ngModelChange)="setLine(i, 'form', $event)" [name]="'form' + i" />
                <input class="input sm:col-span-3" [attr.aria-label]="'RX.DCI' | translate" [placeholder]="'RX.DCI' | translate" maxlength="160"
                  [ngModel]="line.dci" (ngModelChange)="setLine(i, 'dci', $event)" [name]="'dci' + i" />
                <textarea class="textarea sm:col-span-3" rows="2" [attr.aria-label]="'RX.POSOLOGY' | translate" [placeholder]="'RX.POSOLOGY' | translate" maxlength="600"
                  [ngModel]="line.posology" (ngModelChange)="setLine(i, 'posology', $event)" [name]="'posology' + i"></textarea>
              </div>
              <button type="button" class="btn btn-ghost btn-sm mt-2 text-critical-700" (click)="removeLine(i)" [disabled]="lines().length === 1">
                <app-icon name="trash" [size]="14" /> {{ 'RX.REMOVE_DRUG' | translate }}
              </button>
            </fieldset>
          }
          <button type="button" class="btn btn-secondary btn-sm" (click)="addLine()" [disabled]="lines().length >= 20"><app-icon name="plus" [size]="14" /> {{ 'RX.ADD_DRUG' | translate }}</button>
        </div>

        <label class="field">
          <span class="label">{{ 'RX.ADVICE' | translate }}</span>
          <textarea class="textarea" rows="3" maxlength="4000" name="advice" [ngModel]="advice()" (ngModelChange)="advice.set($event)"></textarea>
        </label>

        @if (warnings().length) {
          <div class="rounded-lg border border-critical-200 bg-critical-50 p-3 text-sm" role="alert">
            <p class="font-semibold text-critical-800">{{ 'RX.ALLERGY_TITLE' | translate }}</p>
            <ul class="mt-1 list-disc ps-5">
              @for (w of warnings(); track w.drug + w.allergy) {
                <li>{{ 'RX.ALLERGY_LINE' | translate: { drug: w.drug, allergy: w.allergy, reason: w.reason } }}</li>
              }
            </ul>
            <label class="mt-2 flex items-start gap-2">
              <input type="checkbox" name="ack" [ngModel]="acknowledged()" (ngModelChange)="acknowledged.set($event)" />
              <span>{{ 'RX.ALLERGY_ACK' | translate }}</span>
            </label>
          </div>
        } @else if (checked()) {
          <p class="text-xs text-ink-500">{{ 'RX.ALLERGY_NONE' | translate }}</p>
        }
        @if (incomplete() > 0) {
          <p class="text-xs text-attention-800">{{ 'RX.INCOMPLETE' | translate: { count: incomplete() } }}</p>
        }
      </div>

      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="close()" [disabled]="busy()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="button" class="btn btn-primary" (click)="issue()" [disabled]="!canIssue()">
          <app-icon name="print" [size]="16" /> {{ (busy() ? 'RX.ISSUING' : 'RX.ISSUE') | translate }}
        </button>
      </div>
    </app-modal>
  `,
})
export class PrescriptionEditorComponent {
  private readonly api = inject(PrescriptionsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  readonly open = input(false);
  readonly patientId = input.required<string>();
  readonly patientName = input('');
  /** The consultation it is written at the end of, if any. */
  readonly consultationId = input<string | null>(null);
  readonly closed = output<void>();
  readonly issued = output<Prescription>();

  protected readonly templates = signal<PrescriptionTemplate[]>([]);
  /** Library entries the clinic has not adopted yet; adopted ones are among its templates. */
  protected readonly library = signal<PrescriptionLibraryEntry[]>([]);
  protected readonly source = signal<Source | null>(null);
  protected readonly lines = signal<LineDraft[]>([blankLine()]);
  protected readonly advice = signal('');
  protected readonly warnings = signal<AllergyWarning[]>([]);
  /** The current lines have been checked against the allergies (cleared by any edit). */
  protected readonly checked = signal(false);
  protected readonly acknowledged = signal(false);
  protected readonly busy = signal(false);

  protected readonly sourceKey = computed(() => {
    const s = this.source();
    return !s ? '' : s.kind === 'template' ? `t:${s.template.id}` : `l:${s.entry.code}`;
  });
  protected readonly incomplete = computed(() => incompleteLines(this.lines()));
  protected readonly canIssue = computed(() => !this.busy() && this.incomplete() === 0 && completeLines(this.lines()).length > 0
    && (this.warnings().length === 0 || this.acknowledged()));

  constructor() {
    // Fresh each time it opens: last patient's drugs must never carry over.
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.reset();
          void this.loadSources();
        });
      }
    });
  }

  private reset(): void {
    this.source.set(null);
    this.lines.set([blankLine()]);
    this.advice.set('');
    this.warnings.set([]);
    this.checked.set(false);
    this.acknowledged.set(false);
  }

  private async loadSources(): Promise<void> {
    try {
      const [templates, library] = await Promise.all([this.api.templates(), this.api.library()]);
      this.templates.set(templates);
      this.library.set(library.filter(e => !e.adopted));
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected pick(key: string): void {
    const id = key.slice(2);
    const template = key.startsWith('t:') ? this.templates().find(t => t.id === id) : undefined;
    const entry = key.startsWith('l:') ? this.library().find(e => e.code === id) : undefined;
    const source: Source | null = template ? { kind: 'template', template } : entry ? { kind: 'library', entry } : null;
    this.source.set(source);
    const from = template ?? entry;
    this.lines.set(from?.lines.length
      ? from.lines.map(l => ({ drug: l.drug ?? '', form: l.form ?? '', dci: l.dci ?? '', posology: l.posology ?? '' }))
      : [blankLine()]);
    this.advice.set(template?.advice ?? entry?.advice ?? '');
    this.edited();
  }

  protected setLine(index: number, field: keyof LineDraft, value: string): void {
    this.lines.update(lines => lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
    this.edited();
  }

  protected addLine(): void {
    this.lines.update(lines => [...lines, blankLine()]);
  }

  protected removeLine(index: number): void {
    this.lines.update(lines => lines.filter((_, i) => i !== index));
    this.edited();
  }

  /** Any change to the drugs makes the last allergy check stale. */
  private edited(): void {
    this.checked.set(false);
    this.warnings.set([]);
    this.acknowledged.set(false);
  }

  protected async issue(): Promise<void> {
    const lines = completeLines(this.lines());
    if (!lines.length || this.busy()) return;
    this.busy.set(true);
    try {
      if (!this.checked()) {
        const warnings = await this.api.check(this.patientId(), lines);
        this.warnings.set(warnings);
        this.checked.set(true);
        // Stop here so the prescriber reads the warning before anything is issued.
        if (warnings.length) return;
      }
      const s = this.source();
      const prescription = await this.api.issue({
        patientId: this.patientId(),
        consultationId: this.consultationId() ?? undefined,
        templateId: s?.kind === 'template' ? s.template.id : undefined,
        lines,
        advice: this.advice().trim() || undefined,
        acknowledgeWarnings: this.acknowledged(),
      });
      this.toast.success(this.translate.instant('RX.ISSUED', { number: prescription.number }));
      this.issued.emit(prescription);
      this.closed.emit();
      await this.api.open(prescription.id);
    } catch (e) {
      this.errors.report(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    if (!this.busy()) this.closed.emit();
  }
}
