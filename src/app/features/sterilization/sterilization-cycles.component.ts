import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import {
  Autoclave, CONTROL_TYPES, ControlResult, ControlType, Cycle, CycleSummary, Exposure, SterilItem, SterilizationApi,
} from '../../core/services/sterilization-api.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { Period, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';
import { SterilizationHandoff } from './sterilization-handoff.service';

export const PROGRAMS = ['134°C 18 min', '134°C 4 min (instruments emballés)', '121°C 30 min', 'Prion 134°C 18 min'];

export function resultTone(result: ControlResult): string {
  return { PENDING: 'pill-attention', PASSED: 'pill-done', FAILED: 'pill-critical' }[result];
}

/** `yyyy-MM-ddTHH:mm` for a datetime-local input, from a date in the viewer's own clock. */
export function nowLocal(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The server's warnings are English sentences. The ones this screen knows are shown in the
 * person's language; any other is shown as the server wrote it rather than hidden.
 */
export function warningKey(raw: string): { key: string; params: Record<string, string> } | null {
  const lubrication = /^Handpiece (\S+) has not been lubricated/.exec(raw);
  return lubrication ? { key: 'STER.WARNINGS.NOT_LUBRICATED', params: { code: lubrication[1] } } : null;
}

/** Items that can be put in a cycle now: only what is waiting to be sterilised (a sterile one would be reprocessed for nothing, a used one is not clean). */
export function eligible(items: readonly SterilItem[]): SterilItem[] {
  return items.filter(i => i.active && i.nextActions.includes('ADD_TO_CYCLE'));
}

/**
 * Autoclave cycles: what was loaded, with which programme and control, and how the control came
 * out. A cycle that passes releases its items as sterile. One that fails recalls them, and the
 * screen then lists every patient an item from that load was used on since, because a failed
 * control is the one finding that has to reach people.
 */
@Component({
  selector: 'app-sterilization-cycles',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, IconComponent, ModalComponent, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'STER.CYCLES.AUTOCLAVE' | translate }}</span>
        <select class="select w-auto" [ngModel]="autoclaveId()" (ngModelChange)="autoclaveId.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>@for (a of autoclaves(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'STER.CYCLES.CONTROL' | translate }}</span>
        <select class="select w-auto" [ngModel]="result()" (ngModelChange)="result.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>@for (r of results; track r) { <option [value]="r">{{ 'STER.RESULTS.' + r | translate }}</option> }
        </select></label>
      <span class="ms-auto flex gap-2">
        <button type="button" class="btn btn-secondary btn-sm" (click)="autoclavesOpen.set(true)">{{ 'STER.CYCLES.AUTOCLAVES' | translate }}</button>
        <button type="button" class="btn btn-primary btn-sm" (click)="openNew()"><app-icon name="plus" [size]="15" /> {{ 'STER.CYCLES.NEW' | translate }}</button>
      </span>
    </div>

    <div class="table-wrap" [attr.aria-busy]="cycles.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">#</th><th scope="col">{{ 'STER.CYCLES.AUTOCLAVE' | translate }}</th><th scope="col">{{ 'STER.CYCLES.PROGRAM' | translate }}</th><th scope="col">{{ 'STER.CYCLES.STARTED' | translate }}</th>
          <th scope="col">{{ 'STER.CYCLES.OPERATOR' | translate }}</th><th scope="col">{{ 'STER.CYCLES.CONTROL' | translate }}</th><th scope="col" class="cell-num">{{ 'STER.CYCLES.ITEMS' | translate }}</th>
        </tr></thead>
        <tbody>
          @for (c of cycles.data(); track c.id) {
            <tr class="row-clickable" (click)="open(c.id)">
              <td><button type="button" class="font-bold text-ink-900 hover:text-petrol-700" (click)="open(c.id); $event.stopPropagation()">{{ c.number }}</button></td>
              <td>{{ c.autoclaveName }}</td><td>{{ c.program }}</td><td class="whitespace-nowrap">{{ c.startedAt | date: 'short' }}</td><td>{{ c.operatorName }}</td>
              <td><span class="pill" [class]="'pill ' + tone(c.controlResult)">{{ 'STER.RESULTS.' + c.controlResult | translate }}</span><span class="block text-xs text-ink-500">{{ 'STER.CONTROL_TYPES.' + c.controlType | translate }}</span></td>
              <td class="cell-num">{{ c.itemCount }}</td>
            </tr>
          } @empty { <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ 'STER.CYCLES.EMPTY' | translate }}</td></tr> }
        </tbody>
      </table>
    </div></div>

    <!-- A cycle -->
    <app-modal [open]="detail() !== null" [title]="detail() ? ('STER.CYCLES.CYCLE' | translate) + ' #' + detail()!.summary.number : ''" size="lg" (closed)="detail.set(null)">
      @if (detail(); as d) {
        <p class="mb-3 text-sm text-ink-700"><strong>{{ d.summary.autoclaveName }}</strong> · {{ d.summary.program }} · {{ d.summary.startedAt | date: 'medium' }}@if (d.summary.finishedAt) { → {{ d.summary.finishedAt | date: 'shortTime' }} } · {{ d.summary.operatorName }}
          <span class="ms-2 pill" [class]="'pill ' + tone(d.summary.controlResult)">{{ 'STER.RESULTS.' + d.summary.controlResult | translate }}</span></p>
        @for (w of d.warnings; track w) { <p class="mb-2 rounded-md bg-caution-50 p-2 text-sm text-caution-800" role="note">{{ warning(w) }}</p> }
        @if (d.notes) { <p class="mb-3 text-sm text-ink-600">{{ d.notes }}</p> }

        <h3 class="section-title">{{ 'STER.CYCLES.LOADED' | translate }} ({{ d.items.length }})</h3>
        <ul class="mb-4 grid gap-1 sm:grid-cols-2">@for (i of d.items; track i.id) { <li class="rounded border border-ink-100 px-2 py-1 text-sm"><span class="mono font-semibold">{{ i.code }}</span> {{ i.name }}</li> }</ul>

        @if (d.summary.controlResult === 'PENDING') {
          <form id="control-form" class="rounded-lg border border-ink-200 p-3" (ngSubmit)="record('PASSED')">
            <h3 class="section-title">{{ 'STER.CYCLES.RECORD_CONTROL' | translate }}</h3>
            <p class="mb-2 text-xs text-ink-500">{{ 'STER.CYCLES.CONTROL_HINT' | translate }}</p>
            <label class="field"><span class="label">{{ 'STER.CYCLES.CONTROL_NOTE' | translate }}</span><input class="input" name="note" maxlength="500" [ngModel]="controlNote()" (ngModelChange)="controlNote.set($event)" /></label>
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="record('FAILED')">{{ 'STER.CYCLES.FAILED' | translate }}</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'STER.CYCLES.PASSED' | translate }}</button>
            </div>
          </form>
        } @else {
          @if (d.controlNote) { <p class="text-sm text-ink-600"><strong>{{ 'STER.CYCLES.CONTROL_NOTE' | translate }} :</strong> {{ d.controlNote }}</p> }
          @if (d.summary.controlResult === 'PASSED') {
            <!-- A passed cycle can turn out to have failed: a biological indicator is read a day or two after the chemical one. -->
            <div class="mt-3 rounded-lg border border-ink-200 p-3">
              <p class="mb-2 text-sm text-ink-600">{{ 'STER.CYCLES.LATE_HINT' | translate }}</p>
              <label class="field"><span class="label">{{ 'STER.CYCLES.CONTROL_NOTE' | translate }}</span><input class="input" name="lateNote" maxlength="500" [ngModel]="controlNote()" (ngModelChange)="controlNote.set($event)" /></label>
              <div class="mt-3 flex justify-end"><button type="button" class="btn btn-danger btn-sm" [disabled]="busy()" (click)="record('FAILED')">{{ 'STER.CYCLES.LATE_FAILED' | translate }}</button></div>
            </div>
          }
        }

        @if (d.summary.controlResult === 'FAILED') {
          <section class="mt-4 rounded-lg border border-critical-200 bg-critical-50 p-3" role="alert">
            <h3 class="font-bold text-critical-800">{{ 'STER.CYCLES.EXPOSED' | translate }}</h3>
            <p class="mb-2 text-sm text-critical-800">{{ 'STER.CYCLES.EXPOSED_HINT' | translate }}</p>
            @if (exposure(); as e) {
              <ul class="space-y-1 text-sm">
                @for (u of e.uses; track u.eventId) {
                  <li class="rounded bg-surface px-2 py-1.5"><a class="font-semibold text-ink-900 no-underline hover:underline" [routerLink]="['/patients', u.patientId]">{{ u.patientName }}</a> <span class="mono text-xs text-ink-500">{{ u.patientCode }}</span>
                    — {{ u.itemCode }} {{ u.itemName }} · {{ u.at | date: 'medium' }}</li>
                } @empty { <li class="text-critical-800">{{ 'STER.CYCLES.NOBODY_EXPOSED' | translate }}</li> }
              </ul>
            }
          </section>
        }
      }
      <div modal-footer><button type="button" class="btn btn-secondary" (click)="detail.set(null)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>

    <!-- New cycle -->
    <app-modal [open]="creating()" [title]="'STER.CYCLES.NEW' | translate" size="lg" [dismissable]="!busy()" (closed)="creating.set(false)">
      <form id="cycle-form" class="space-y-4" (ngSubmit)="create()">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">{{ 'STER.CYCLES.AUTOCLAVE' | translate }}</span>
            <select class="select" name="autoclave" required [ngModel]="form.value().autoclaveId" (ngModelChange)="form.set('autoclaveId', $event)">
              <option value="">—</option>@for (a of activeAutoclaves(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
            </select></label>
          <label class="field"><span class="label label-required">{{ 'STER.CYCLES.PROGRAM' | translate }}</span>
            <input class="input" name="program" required maxlength="80" list="programs" [ngModel]="form.value().program" (ngModelChange)="form.set('program', $event)" />
            <datalist id="programs">@for (p of programs; track p) { <option [value]="p"></option> }</datalist></label>
          <label class="field"><span class="label">{{ 'STER.CYCLES.CONTROL_TYPE' | translate }}</span>
            <select class="select" name="controlType" [ngModel]="form.value().controlType" (ngModelChange)="form.set('controlType', $event)">@for (t of controlTypes; track t) { <option [value]="t">{{ 'STER.CONTROL_TYPES.' + t | translate }}</option> }</select></label>
          <label class="field"><span class="label">{{ 'STER.CYCLES.STARTED' | translate }}</span><input class="input" type="datetime-local" name="started" [ngModel]="form.value().startedAt" (ngModelChange)="form.set('startedAt', $event)" /></label>
          <label class="field"><span class="label">{{ 'STER.CYCLES.FINISHED' | translate }}</span><input class="input" type="datetime-local" name="finished" [min]="form.value().startedAt" [ngModel]="form.value().finishedAt" (ngModelChange)="form.set('finishedAt', $event)" /></label>
        </div>
        <fieldset>
          <legend class="label label-required">{{ 'STER.CYCLES.LOAD' | translate }} ({{ chosen().size }})</legend>
          <div class="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-ink-200 p-2 sm:grid-cols-2">
            @for (i of candidates(); track i.id) {
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" [checked]="chosen().has(i.id)" (change)="pick(i.id, $any($event.target).checked)" /> <span class="mono font-semibold">{{ i.code }}</span> {{ i.name }}</label>
            } @empty { <p class="p-2 text-sm text-ink-500">{{ 'STER.CYCLES.NOTHING_TO_LOAD' | translate }}</p> }
          </div>
        </fieldset>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><input class="input" name="notes" maxlength="500" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)" /></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="creating.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="cycle-form" class="btn btn-primary" [disabled]="busy() || !form.value().autoclaveId || !form.value().program.trim() || chosen().size === 0">{{ 'STER.CYCLES.START' | translate }}</button>
      </div>
    </app-modal>

    <!-- Autoclaves -->
    <app-modal [open]="autoclavesOpen()" [title]="'STER.CYCLES.AUTOCLAVES' | translate" size="md" (closed)="autoclavesOpen.set(false)">
      <ul class="mb-4 divide-y divide-ink-100 rounded-md border border-ink-200">
        @for (a of autoclaves(); track a.id) {
          <li class="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span><strong>{{ a.name }}</strong> <span class="text-ink-500">{{ a.model }} {{ a.serialNumber }}</span>@if (!a.active) { <span class="ms-2 pill pill-idle pill-nodot">{{ 'COMMON.INACTIVE' | translate }}</span> }</span>
            <button type="button" class="btn btn-ghost btn-icon" (click)="editAutoclave(a)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + a.name"><app-icon name="edit" [size]="16" /></button></li>
        } @empty { <li class="px-3 py-3 text-sm text-ink-500">{{ 'STER.CYCLES.NO_AUTOCLAVE' | translate }}</li> }
      </ul>
      <form id="autoclave-form" class="grid gap-3 rounded-lg border border-ink-200 p-3 sm:grid-cols-2" (ngSubmit)="saveAutoclave()">
        <label class="field"><span class="label label-required">{{ 'COMMON.NAME' | translate }}</span><input class="input" name="acname" required maxlength="80" [ngModel]="autoclave.value().name" (ngModelChange)="autoclave.set('name', $event)" /></label>
        <label class="field"><span class="label">{{ 'STER.CYCLES.MODEL' | translate }}</span><input class="input" name="acmodel" maxlength="80" [ngModel]="autoclave.value().model" (ngModelChange)="autoclave.set('model', $event)" /></label>
        <label class="field"><span class="label">{{ 'STER.ITEMS.SERIAL' | translate }}</span><input class="input" name="acserial" maxlength="80" [ngModel]="autoclave.value().serialNumber" (ngModelChange)="autoclave.set('serialNumber', $event)" /></label>
        <label class="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="acactive" [ngModel]="autoclave.value().active" (ngModelChange)="autoclave.set('active', $event)" /> {{ 'COMMON.ACTIVE' | translate }}</label>
        <div class="flex justify-end gap-2 sm:col-span-2">
          @if (autoclaveId2()) { <button type="button" class="btn btn-secondary btn-sm" (click)="editAutoclave(null)">{{ 'COMMON.CANCEL' | translate }}</button> }
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !autoclave.value().name.trim()">{{ 'COMMON.SAVE' | translate }}</button>
        </div>
      </form>
      <div modal-footer><button type="button" class="btn btn-secondary" (click)="autoclavesOpen.set(false)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>
  `,
  styles: [`.section-title { margin-bottom: .5rem; font-size: var(--text-2xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }`],
})
export class SterilizationCyclesComponent {
  private readonly api = inject(SterilizationApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly handoff = inject(SterilizationHandoff);
  private readonly route = inject(ActivatedRoute);

  protected readonly tone = resultTone;
  protected warning(raw: string): string {
    const known = warningKey(raw);
    return known ? this.translate.instant(known.key, known.params) : raw;
  }
  protected readonly programs = PROGRAMS;
  protected readonly controlTypes = CONTROL_TYPES;
  protected readonly results: ControlResult[] = ['PENDING', 'PASSED', 'FAILED'];
  protected readonly presets: ('week' | 'month' | 'lastMonth' | 'quarter' | 'year')[] = ['week', 'month', 'lastMonth', 'quarter', 'year'];
  protected readonly period = signal<Period>(periodFor('month'));
  protected readonly autoclaveId = signal('');
  protected readonly result = signal('');
  protected readonly cycles = loadable<CycleSummary[]>([]);
  protected readonly autoclaves = signal<Autoclave[]>([]);
  protected readonly activeAutoclaves = computed(() => this.autoclaves().filter(a => a.active));

  protected readonly busy = signal(false);
  protected readonly detail = signal<Cycle | null>(null);
  protected readonly exposure = signal<Exposure | null>(null);
  protected readonly controlNote = signal('');

  protected readonly creating = signal(false);
  protected readonly candidates = signal<SterilItem[]>([]);
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly form = formState<{ autoclaveId: string; program: string; controlType: ControlType; startedAt: string; finishedAt: string; notes: string }>({
    autoclaveId: '', program: PROGRAMS[0], controlType: 'CHEMICAL', startedAt: nowLocal(), finishedAt: '', notes: '',
  });

  protected readonly autoclavesOpen = signal(false);
  protected readonly autoclaveId2 = signal<string | null>(null);
  protected readonly autoclave = formState({ name: '', model: '', serialNumber: '', active: true });

  private readonly query = computed(() => ({ ...this.period(), autoclaveId: this.autoclaveId(), result: this.result() }));

  constructor() {
    void this.loadAutoclaves();
    effect(() => {
      const query = this.query();
      untracked(() => void this.cycles.load(() => this.api.cycles(query)));
    });
    refreshOnLive(['sterilization'], () => void this.cycles.load(() => this.api.cycles(this.query())));
    const handed = this.handoff.take();
    if (handed) {
      void this.openNew(handed.itemIds);
    }
    const open = this.route.snapshot.queryParamMap.get('open');
    if (open) {
      void this.open(open);
    }
  }

  private async loadAutoclaves(): Promise<void> {
    try {
      this.autoclaves.set(await this.api.autoclaves());
    } catch (error) {
      this.errors.report(error);
    }
  }

  // ── a cycle ───────────────────────────────────────────────────────
  protected async open(id: string): Promise<void> {
    try {
      const cycle = await this.api.cycle(id);
      this.controlNote.set('');
      this.exposure.set(null);
      this.detail.set(cycle);
      if (cycle.summary.controlResult === 'FAILED') {
        this.exposure.set(await this.api.exposure(id));
      }
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async record(result: ControlResult): Promise<void> {
    const d = this.detail();
    if (!d || this.busy()) {
      return;
    }
    if (result === 'FAILED' && !(await this.confirm.confirm(this.translate.instant('STER.CYCLES.FAIL_CONFIRM'), { danger: true }))) {
      return;
    }
    this.busy.set(true);
    try {
      const updated = await this.api.recordControl(d.summary.id, result, this.controlNote().trim() || undefined);
      this.detail.set(updated);
      this.exposure.set(result === 'FAILED' ? await this.api.exposure(d.summary.id) : null);
      this.toast.success(this.translate.instant(result === 'PASSED' ? 'STER.CYCLES.PASSED_DONE' : 'STER.CYCLES.FAILED_DONE'));
      await this.cycles.load(() => this.api.cycles(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  // ── new cycle ─────────────────────────────────────────────────────
  protected async openNew(preselected: readonly string[] = []): Promise<void> {
    this.chosen.set(new Set(preselected));
    this.form.reset({ autoclaveId: this.activeAutoclaves().length === 1 ? this.activeAutoclaves()[0].id : '', program: PROGRAMS[0], controlType: 'CHEMICAL', startedAt: nowLocal(), finishedAt: '', notes: '' });
    this.creating.set(true);
    try {
      this.candidates.set(eligible(await this.api.items({ state: 'DIRTY' })));
      if (this.autoclaves().length === 0) {
        await this.loadAutoclaves();
        if (this.activeAutoclaves().length === 1) {
          this.form.set('autoclaveId', this.activeAutoclaves()[0].id);
        }
      }
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected pick(id: string, on: boolean): void {
    this.chosen.update(s => {
      const next = new Set(s);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected async create(): Promise<void> {
    const f = this.form.value();
    if (this.busy() || !f.autoclaveId || !f.program.trim() || this.chosen().size === 0) {
      return;
    }
    this.busy.set(true);
    try {
      const cycle = await this.api.createCycle({
        autoclaveId: f.autoclaveId, program: f.program.trim(), controlType: f.controlType, itemIds: [...this.chosen()],
        startedAt: f.startedAt ? new Date(f.startedAt).toISOString() : undefined, finishedAt: f.finishedAt ? new Date(f.finishedAt).toISOString() : undefined, notes: f.notes.trim() || undefined,
      });
      this.creating.set(false);
      this.toast.success(this.translate.instant('STER.CYCLES.CREATED', { number: cycle.summary.number }));
      await this.cycles.load(() => this.api.cycles(this.query()));
      this.detail.set(cycle);
      this.exposure.set(null);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  // ── autoclaves ────────────────────────────────────────────────────
  protected editAutoclave(a: Autoclave | null): void {
    this.autoclaveId2.set(a?.id ?? null);
    this.autoclave.reset(a ? { name: a.name, model: a.model ?? '', serialNumber: a.serialNumber ?? '', active: a.active } : { name: '', model: '', serialNumber: '', active: true });
  }

  protected async saveAutoclave(): Promise<void> {
    const f = this.autoclave.value();
    const id = this.autoclaveId2();
    if (this.busy() || !f.name.trim()) {
      return;
    }
    this.busy.set(true);
    try {
      const body = { name: f.name.trim(), model: f.model.trim() || undefined, serialNumber: f.serialNumber.trim() || undefined, active: f.active };
      await (id ? this.api.updateAutoclave(id, body) : this.api.createAutoclave(body));
      await this.loadAutoclaves();
      this.editAutoclave(null);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
