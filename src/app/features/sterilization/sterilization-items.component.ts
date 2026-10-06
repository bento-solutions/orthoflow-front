import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { ITEM_KINDS, ITEM_STATES, ItemKind, SterilItem, SterilizationApi, TraceEntry } from '../../core/services/sterilization-api.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { ItemActionsComponent, stateTone } from './item-actions.component';
import { SterilizationHandoff } from './sterilization-handoff.service';
import { Router } from '@angular/router';

/** Which of the chosen ids still exist in the list (an item can be retired or filtered away between selecting and printing). */
export function stillListed(selected: ReadonlySet<string>, items: readonly Pick<SterilItem, 'id'>[]): string[] {
  const ids = new Set(items.map(i => i.id));
  return [...selected].filter(id => ids.has(id));
}

interface ItemForm {
  code: string;
  name: string;
  kind: ItemKind;
  serialNumber: string;
  notes: string;
  markSterile: boolean;
}

const blankItem = (): ItemForm => ({ code: '', name: '', kind: 'INSTRUMENT', serialNumber: '', notes: '', markSterile: false });

/**
 * Everything that goes through sterilization, with where each piece is now. Adding an item gives
 * it a QR label to print (a label carries a code, never a patient). A new item starts dirty:
 * nothing is assumed sterile until a cycle whose control passed has said so, unless it is known
 * to be, in which case "already sterile" is ticked once. Retiring keeps the history.
 */
@Component({
  selector: 'app-sterilization-items',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent, ModalComponent, ItemActionsComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="search"><span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span><app-icon name="search" [size]="16" />
        <input class="input" type="search" [placeholder]="'STER.ITEMS.SEARCH' | translate" [ngModel]="searchInput()" (ngModelChange)="searchInput.set($event)" /></label>
      <label class="field w-auto"><span class="label">{{ 'COMMON.STATUS' | translate }}</span>
        <select class="select w-auto" [ngModel]="state()" (ngModelChange)="state.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>@for (s of states; track s) { <option [value]="s">{{ 'STER.STATES.' + s | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'STER.ITEMS.KIND' | translate }}</span>
        <select class="select w-auto" [ngModel]="kind()" (ngModelChange)="kind.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>@for (k of kinds; track k) { <option [value]="k">{{ 'STER.KINDS.' + k | translate }}</option> }
        </select></label>
      <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="includeRetired()" (ngModelChange)="includeRetired.set($event)" /> {{ 'STER.ITEMS.INCLUDE_RETIRED' | translate }}</label>
      <span class="ms-auto flex gap-2">
        <button type="button" class="btn btn-secondary btn-sm" [disabled]="selected().size === 0" (click)="printLabels()"><app-icon name="print" [size]="15" /> {{ 'STER.ITEMS.PRINT_LABELS' | translate }}@if (selected().size) { ({{ selected().size }}) }</button>
        <button type="button" class="btn btn-primary btn-sm" (click)="openNew()"><app-icon name="plus" [size]="15" /> {{ 'STER.ITEMS.NEW' | translate }}</button>
      </span>
    </div>

    <div class="table-wrap" [attr.aria-busy]="items.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col" class="w-8"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($any($event.target).checked)" [attr.aria-label]="'REC.SELECT_ALL' | translate" /></th>
          <th scope="col">{{ 'STER.ITEMS.CODE' | translate }}</th><th scope="col">{{ 'COMMON.NAME' | translate }}</th><th scope="col">{{ 'STER.ITEMS.KIND' | translate }}</th>
          <th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col">{{ 'STER.ITEMS.LAST_USED' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (i of items.data(); track i.id) {
            <tr [class.opacity-60]="!i.active">
              <td><input type="checkbox" [checked]="selected().has(i.id)" (change)="toggle(i.id, $any($event.target).checked)" [attr.aria-label]="('STER.ITEMS.SELECT' | translate) + ' ' + i.code" /></td>
              <td class="mono font-semibold">{{ i.code }}</td>
              <td>{{ i.name }}@if (i.serialNumber) { <span class="block text-xs text-ink-500">{{ i.serialNumber }}</span> }</td>
              <td>{{ 'STER.KINDS.' + i.kind | translate }}</td>
              <td><span class="pill" [class]="'pill ' + tone(i.state)">{{ 'STER.STATES.' + i.state | translate }}</span>
                @if (!i.active) { <span class="ms-1 pill pill-idle pill-nodot">{{ 'STER.ITEMS.RETIRED' | translate }}</span> }
                @if (i.lubricationDue) { <span class="ms-1 pill pill-attention pill-nodot">{{ 'STER.ITEMS.LUBRICATE' | translate }}</span> }
                <span class="block text-xs text-ink-500">{{ i.stateChangedAt | date: 'short' }}</span></td>
              <td>{{ i.lastUsedAt ? (i.lastUsedAt | date: 'short') : '—' }}</td>
              <td class="cell-actions">
                <span class="inline-flex flex-wrap items-center justify-end gap-1">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="openHistory(i)">{{ 'STER.ITEMS.HISTORY' | translate }}</button>
                  <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(i)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + i.code"><app-icon name="edit" [size]="16" /></button>
                  @if (i.active) { <button type="button" class="btn btn-danger-ghost btn-sm" (click)="openRetire(i)">{{ 'STER.ITEMS.RETIRE' | translate }}</button> }
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ 'STER.ITEMS.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="editing() !== null" [title]="(editing()?.id ? 'STER.ITEMS.EDIT' : 'STER.ITEMS.NEW') | translate" size="md" [dismissable]="!busy()" (closed)="editing.set(null)">
      <form id="item-form" class="space-y-4" (ngSubmit)="save()">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field"><span class="label label-required">{{ 'STER.ITEMS.CODE' | translate }}</span><input class="input mono" name="code" required maxlength="40" [disabled]="!!editing()?.id" [ngModel]="form.value().code" (ngModelChange)="form.set('code', $event)" /><span class="hint">{{ 'STER.ITEMS.CODE_HINT' | translate }}</span></label>
          <label class="field"><span class="label label-required">{{ 'COMMON.NAME' | translate }}</span><input class="input" name="name" required maxlength="160" [ngModel]="form.value().name" (ngModelChange)="form.set('name', $event)" /></label>
          <label class="field"><span class="label">{{ 'STER.ITEMS.KIND' | translate }}</span>
            <select class="select" name="kind" [disabled]="!!editing()?.id" [ngModel]="form.value().kind" (ngModelChange)="form.set('kind', $event)">@for (k of kinds; track k) { <option [value]="k">{{ 'STER.KINDS.' + k | translate }}</option> }</select></label>
          <label class="field"><span class="label">{{ 'STER.ITEMS.SERIAL' | translate }}</span><input class="input" name="serial" maxlength="80" [ngModel]="form.value().serialNumber" (ngModelChange)="form.set('serialNumber', $event)" /></label>
        </div>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
        @if (!editing()?.id) {
          <label class="flex items-start gap-2 text-sm"><input type="checkbox" class="mt-0.5" name="sterile" [ngModel]="form.value().markSterile" (ngModelChange)="form.set('markSterile', $event)" /><span>{{ 'STER.ITEMS.ALREADY_STERILE' | translate }}<span class="hint block">{{ 'STER.ITEMS.ALREADY_STERILE_HINT' | translate }}</span></span></label>
        }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="item-form" class="btn btn-primary" [disabled]="busy() || !form.value().code.trim() || !form.value().name.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="retiring() !== null" [title]="'STER.ITEMS.RETIRE' | translate" size="sm" [dismissable]="!busy()" (closed)="retiring.set(null)">
      <form id="retire-form" class="space-y-3" (ngSubmit)="retire()">
        <p class="text-sm text-ink-600">{{ 'STER.ITEMS.RETIRE_HINT' | translate }}</p>
        <label class="field"><span class="label label-required">{{ 'ACC.VOID_REASON' | translate }}</span><input class="input" name="reason" required maxlength="300" [ngModel]="reason()" (ngModelChange)="reason.set($event)" /></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="retiring.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="retire-form" class="btn btn-danger" [disabled]="busy() || !reason().trim()">{{ 'STER.ITEMS.RETIRE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="history() !== null" [title]="history()?.name ?? ''" size="lg" (closed)="history.set(null)">
      @if (history(); as h) {
        <p class="mb-3 text-sm text-ink-600"><span class="mono font-semibold">{{ h.code }}</span> · {{ 'STER.STATES.' + h.state | translate }}</p>
        <div class="mb-4"><app-item-actions [item]="h" (changed)="afterAction($event)" (addToCycle)="loadIntoCycle($event)" /></div>
        <ol class="space-y-2">
          @for (e of events(); track e.eventId) {
            <li class="rounded-md border border-ink-100 p-3 text-sm">
              <p class="font-semibold text-ink-900">{{ 'STER.ACTION_NAMES.' + e.action | translate }} <span class="font-normal text-ink-500">· {{ e.at | date: 'medium' }}@if (e.performedBy) { · {{ e.performedBy }} }</span></p>
              @if (e.patientName) { <p class="text-ink-700">{{ 'STER.TRACE.ON_PATIENT' | translate }} {{ e.patientName }} <span class="mono text-xs text-ink-500">{{ e.patientCode }}</span></p> }
              @if (e.cycleNumber) { <p class="text-ink-700">{{ 'STER.TRACE.CYCLE' | translate }} #{{ e.cycleNumber }} · {{ e.autoclaveName }}@if (e.controlResult) { · {{ 'STER.RESULTS.' + e.controlResult | translate }} }</p> }
              @if (e.note) { <p class="text-ink-600">{{ e.note }}</p> }
            </li>
          } @empty { <li class="text-sm text-ink-500">{{ 'STER.TRACE.EMPTY' | translate }}</li> }
        </ol>
      }
      <div modal-footer><button type="button" class="btn btn-secondary" (click)="history.set(null)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>
  `,
})
export class SterilizationItemsComponent {
  private readonly api = inject(SterilizationApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly downloads = inject(DownloadService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly handoff = inject(SterilizationHandoff);
  private readonly router = inject(Router);

  protected readonly tone = stateTone;
  protected readonly states = ITEM_STATES;
  protected readonly kinds = ITEM_KINDS;
  protected readonly searchInput = signal('');
  private readonly search = signal('');
  protected readonly state = signal('');
  protected readonly kind = signal('');
  protected readonly includeRetired = signal(false);
  protected readonly items = loadable<SterilItem[]>([]);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly allSelected = computed(() => this.items.data().length > 0 && this.selected().size === this.items.data().length);

  protected readonly busy = signal(false);
  protected readonly editing = signal<{ id: string | null } | null>(null);
  protected readonly form = formState<ItemForm>(blankItem());
  protected readonly retiring = signal<SterilItem | null>(null);
  protected readonly reason = signal('');
  protected readonly history = signal<SterilItem | null>(null);
  protected readonly events = signal<TraceEntry[]>([]);

  private readonly query = computed(() => ({ state: this.state(), kind: this.kind(), search: this.search(), includeRetired: this.includeRetired() || undefined }));

  constructor() {
    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const typed = this.searchInput();
      pause = setTimeout(() => untracked(() => this.search.set(typed)), 300);
      onCleanup(() => clearTimeout(pause));
    });
    effect(() => {
      const query = this.query();
      untracked(() => void this.items.load(() => this.api.items(query)).then(() => this.selected.set(new Set(stillListed(this.selected(), this.items.data())))));
    });
    refreshOnLive(['sterilization'], () => void this.items.load(() => this.api.items(this.query())));
  }

  protected toggle(id: string, on: boolean): void {
    this.selected.update(s => {
      const next = new Set(s);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.items.data().map(i => i.id)) : new Set());
  }

  protected async printLabels(): Promise<void> {
    const ids = stillListed(this.selected(), this.items.data());
    if (ids.length === 0) {
      return;
    }
    try {
      await this.downloads.open('/sterilization/labels', { itemId: ids, lang: this.language.currentLang() });
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected openNew(): void {
    this.form.reset(blankItem());
    this.editing.set({ id: null });
  }

  protected openEdit(i: SterilItem): void {
    this.form.reset({ code: i.code, name: i.name, kind: i.kind, serialNumber: i.serialNumber ?? '', notes: i.notes ?? '', markSterile: false });
    this.editing.set({ id: i.id });
  }

  protected async save(): Promise<void> {
    const target = this.editing();
    const f = this.form.value();
    if (!target || this.busy() || !f.code.trim() || !f.name.trim()) {
      return;
    }
    await this.run(async () => {
      if (target.id) {
        await this.api.updateItem(target.id, { name: f.name.trim(), serialNumber: f.serialNumber.trim() || undefined, notes: f.notes.trim() || undefined });
      } else {
        await this.api.createItem({ code: f.code.trim(), name: f.name.trim(), kind: f.kind, serialNumber: f.serialNumber.trim() || undefined, notes: f.notes.trim() || undefined, markSterile: f.markSterile });
        this.toast.success(this.translate.instant('STER.ITEMS.CREATED'));
      }
      this.editing.set(null);
    });
  }

  protected openRetire(i: SterilItem): void {
    this.reason.set('');
    this.retiring.set(i);
  }

  protected async retire(): Promise<void> {
    const i = this.retiring();
    if (!i || this.busy() || !this.reason().trim()) {
      return;
    }
    await this.run(async () => {
      await this.api.retireItem(i.id, this.reason().trim());
      this.retiring.set(null);
    });
  }

  protected async openHistory(i: SterilItem): Promise<void> {
    this.history.set(i);
    this.events.set([]);
    try {
      this.events.set(await this.api.traceByItem(i.id));
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected afterAction(updated: SterilItem): void {
    this.history.set(updated);
    void this.items.load(() => this.api.items(this.query()));
    void this.openHistory(updated);
  }

  protected loadIntoCycle(item: SterilItem): void {
    this.handoff.request.set({ itemIds: [item.id] });
    void this.router.navigate(['/sterilization/cycles']);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.items.load(() => this.api.items(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
