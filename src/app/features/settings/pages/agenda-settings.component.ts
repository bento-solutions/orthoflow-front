import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  APPOINTMENT_STATUSES, AgendaConfigService, AppointmentType, AppointmentTypeInput, AppointmentStatusName, Chair, DEFAULT_STATUS_COLORS, WaitingRoom, typeName,
} from '../../../core/services/agenda-config.service';
import { ApiErrors } from '../../../core/services/api-error.service';
import { LanguageService } from '../../../core/services/language.service';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { loadable } from '../../../core/utils/loadable';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';

export const SPECIALTY_GROUPS = ['ANY', 'ORTHODONTICS', 'GENERAL'] as const;

export interface TypeForm {
  code: string;
  nameFr: string;
  nameEn: string;
  nameAr: string;
  color: string;
  duration: number;
  bookableOnline: boolean;
  specialtyGroup: (typeof SPECIALTY_GROUPS)[number];
  active: boolean;
  displayOrder: number;
}

export const blankType = (order = 100): TypeForm => ({ code: '', nameFr: '', nameEn: '', nameAr: '', color: '#2f8fa2', duration: 30, bookableOnline: false, specialtyGroup: 'ANY', active: true, displayOrder: order });

/** A code the server will accept: capitals, digits and underscores, made from what was typed (spaces and accents become underscores). */
export function codeFrom(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/** Whether a type form can be saved, and if not which rule it breaks. */
export function typeProblem(f: TypeForm): string | null {
  if (!f.nameFr.trim() || !f.nameEn.trim() || !f.nameAr.trim()) return 'SET.AGENDA.PROBLEM.NAMES';
  if (!(f.duration >= 5 && f.duration <= 480)) return 'SET.AGENDA.PROBLEM.DURATION';
  if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) return 'SET.AGENDA.PROBLEM.COLOR';
  return null;
}

export function typeRequest(f: TypeForm): AppointmentTypeInput {
  return {
    code: f.code.trim() || codeFrom(f.nameEn || f.nameFr), nameFr: f.nameFr.trim(), nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(), color: f.color,
    defaultDurationMinutes: f.duration, bookableOnline: f.bookableOnline, specialtyGroup: f.specialtyGroup, active: f.active, displayOrder: f.displayOrder,
  };
}

/** The colours that differ from the built-in ones: only these are saved, so a status left alone follows any future change of the defaults. */
export function customColors(chosen: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(chosen).filter(([status, color]) => color.toLowerCase() !== DEFAULT_STATUS_COLORS[status as AppointmentStatusName].toLowerCase()));
}

interface NamedForm {
  name: string;
  active: boolean;
  displayOrder: number;
}

/**
 * How the agenda is laid out: the kinds of appointment (with their colour, usual length and
 * whether patients may book them online), the chairs, the waiting rooms, and the colour of each
 * appointment status. Changing a type's name or colour changes how past appointments look too;
 * nothing is deleted, a type or chair that is no longer used is switched off.
 */
@Component({
  selector: 'app-agenda-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent, ModalComponent],
  template: `
    <div class="space-y-6">
      <!-- Appointment types -->
      <section class="card">
        <div class="card-head">
          <div><h2 class="text-lg font-bold text-ink-900">{{ 'SET.AGENDA.TYPES' | translate }}</h2><p class="text-sm text-ink-500">{{ 'SET.AGENDA.TYPES_HINT' | translate }}</p></div>
          <button type="button" class="btn btn-primary btn-sm" (click)="openType(null)"><app-icon name="plus" [size]="15" /> {{ 'SET.AGENDA.NEW_TYPE' | translate }}</button>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th scope="col">{{ 'COMMON.NAME' | translate }}</th><th scope="col" class="cell-num">{{ 'SET.AGENDA.DURATION' | translate }}</th><th scope="col">{{ 'SET.AGENDA.GROUP' | translate }}</th><th scope="col">{{ 'SET.AGENDA.ONLINE' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th></tr></thead>
            <tbody>
              @for (t of types.data(); track t.id) {
                <tr [class.opacity-60]="!t.active">
                  <td class="font-semibold"><span class="me-2 inline-block h-3 w-3 rounded-full align-middle" [style.background]="t.color" aria-hidden="true"></span>{{ name(t) }}<span class="block text-xs font-normal text-ink-500 mono">{{ t.code }}</span></td>
                  <td class="cell-num">{{ t.defaultDurationMinutes }} min</td>
                  <td>{{ 'SET.AGENDA.GROUPS.' + t.specialtyGroup | translate }}</td>
                  <td>{{ (t.bookableOnline ? 'COMMON.YES' : 'COMMON.NO') | translate }}</td>
                  <td>{{ (t.active ? 'COMMON.ACTIVE' : 'COMMON.INACTIVE') | translate }}</td>
                  <td class="cell-actions"><button type="button" class="btn btn-ghost btn-icon" (click)="openType(t)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + name(t)"><app-icon name="edit" [size]="16" /></button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Chairs -->
        <section class="card">
          <div class="card-head"><h2 class="text-lg font-bold text-ink-900">{{ 'SET.AGENDA.CHAIRS' | translate }}</h2><button type="button" class="btn btn-secondary btn-sm" (click)="openNamed('chair', null)"><app-icon name="plus" [size]="14" /> {{ 'COMMON.ADD' | translate }}</button></div>
          <ul class="divide-y divide-ink-100">
            @for (c of chairs(); track c.id) {
              <li class="flex items-center justify-between gap-2 px-4 py-2.5 text-sm" [class.opacity-60]="!c.active"><span class="font-semibold">{{ c.name }}@if (!c.active) { <span class="ms-2 pill pill-idle pill-nodot">{{ 'COMMON.INACTIVE' | translate }}</span> }</span>
                <button type="button" class="btn btn-ghost btn-icon" (click)="openNamed('chair', c)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + c.name"><app-icon name="edit" [size]="16" /></button></li>
            } @empty { <li class="px-4 py-4 text-sm text-ink-500">{{ 'SET.AGENDA.NO_CHAIRS' | translate }}</li> }
          </ul>
        </section>
        <!-- Waiting rooms -->
        <section class="card">
          <div class="card-head"><h2 class="text-lg font-bold text-ink-900">{{ 'SET.AGENDA.ROOMS' | translate }}</h2><button type="button" class="btn btn-secondary btn-sm" (click)="openNamed('room', null)"><app-icon name="plus" [size]="14" /> {{ 'COMMON.ADD' | translate }}</button></div>
          <ul class="divide-y divide-ink-100">
            @for (r of rooms(); track r.id) {
              <li class="flex items-center justify-between gap-2 px-4 py-2.5 text-sm" [class.opacity-60]="!r.active"><span class="font-semibold">{{ r.name }}@if (!r.active) { <span class="ms-2 pill pill-idle pill-nodot">{{ 'COMMON.INACTIVE' | translate }}</span> }</span>
                <button type="button" class="btn btn-ghost btn-icon" (click)="openNamed('room', r)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + r.name"><app-icon name="edit" [size]="16" /></button></li>
            } @empty { <li class="px-4 py-4 text-sm text-ink-500">{{ 'SET.AGENDA.NO_ROOMS' | translate }}</li> }
          </ul>
        </section>
      </div>

      <!-- Status colours -->
      <section class="card">
        <div class="card-head"><div><h2 class="text-lg font-bold text-ink-900">{{ 'SET.AGENDA.COLORS' | translate }}</h2><p class="text-sm text-ink-500">{{ 'SET.AGENDA.COLORS_HINT' | translate }}</p></div></div>
        <form class="p-4" (ngSubmit)="saveColors()">
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            @for (s of statuses; track s) {
              <li class="flex items-center gap-3 rounded-lg border border-ink-200 p-3">
                <input type="color" class="h-9 w-12 shrink-0 cursor-pointer rounded border border-ink-200 bg-transparent p-0.5" [name]="'color-' + s" [value]="colors()[s]" (input)="setColor(s, $any($event.target).value)" [attr.aria-label]="'SCHEDULE.STATUS.' + s | translate" />
                <span class="min-w-0 flex-1"><span class="block text-sm font-semibold text-ink-900">{{ 'SCHEDULE.STATUS.' + s | translate }}</span>
                  <span class="mono text-xs text-ink-500">{{ colors()[s] }}</span></span>
                @if (colors()[s].toLowerCase() !== defaults[s].toLowerCase()) { <button type="button" class="btn btn-ghost btn-sm" (click)="setColor(s, defaults[s])">{{ 'SET.AGENDA.RESET' | translate }}</button> }
              </li>
            }
          </ul>
          <div class="mt-4 flex justify-end"><button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !colorsChanged()">{{ 'COMMON.SAVE' | translate }}</button></div>
        </form>
      </section>
    </div>

    <app-modal [open]="editingType() !== null" [title]="(editingType()?.id ? 'SET.AGENDA.EDIT_TYPE' : 'SET.AGENDA.NEW_TYPE') | translate" size="lg" [dismissable]="!busy()" (closed)="editingType.set(null)">
      <form id="type-form" class="space-y-4" (ngSubmit)="saveType()">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">Français</span><input class="input" name="nameFr" required maxlength="120" [ngModel]="type.value().nameFr" (ngModelChange)="type.set('nameFr', $event)" /></label>
          <label class="field"><span class="label label-required">English</span><input class="input" name="nameEn" required maxlength="120" [ngModel]="type.value().nameEn" (ngModelChange)="type.set('nameEn', $event)" /></label>
          <label class="field"><span class="label label-required">العربية</span><input class="input" name="nameAr" required maxlength="120" dir="rtl" [ngModel]="type.value().nameAr" (ngModelChange)="type.set('nameAr', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.AGENDA.CODE' | translate }}</span><input class="input mono" name="code" maxlength="40" [disabled]="!!editingType()?.id" [placeholder]="suggestedCode()" [ngModel]="type.value().code" (ngModelChange)="type.set('code', $event.toUpperCase())" /><span class="hint">{{ 'SET.AGENDA.CODE_HINT' | translate }}</span></label>
          <label class="field"><span class="label">{{ 'SET.AGENDA.DURATION' | translate }} (min)</span><input class="input" type="number" min="5" max="480" step="5" name="duration" [ngModel]="type.value().duration" (ngModelChange)="type.set('duration', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'SET.AGENDA.COLOR' | translate }}</span><input class="input h-10 p-1" type="color" name="color" [ngModel]="type.value().color" (ngModelChange)="type.set('color', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.AGENDA.GROUP' | translate }}</span>
            <select class="select" name="group" [ngModel]="type.value().specialtyGroup" (ngModelChange)="type.set('specialtyGroup', $event)">@for (g of groups; track g) { <option [value]="g">{{ 'SET.AGENDA.GROUPS.' + g | translate }}</option> }</select></label>
          <label class="field"><span class="label">{{ 'SET.AGENDA.ORDER' | translate }}</span><input class="input" type="number" min="0" name="order" [ngModel]="type.value().displayOrder" (ngModelChange)="type.set('displayOrder', +$event || 0)" /></label>
          <div class="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label class="flex items-center gap-2"><input type="checkbox" name="online" [ngModel]="type.value().bookableOnline" (ngModelChange)="type.set('bookableOnline', $event)" /> {{ 'SET.AGENDA.ONLINE' | translate }}</label>
            <label class="flex items-center gap-2"><input type="checkbox" name="active" [ngModel]="type.value().active" (ngModelChange)="type.set('active', $event)" /> {{ 'COMMON.ACTIVE' | translate }}</label>
          </div>
        </div>
        @if (typeIssue()) { <p class="text-sm text-critical-700" role="alert">{{ typeIssue()! | translate }}</p> }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editingType.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="type-form" class="btn btn-primary" [disabled]="busy() || !!typeIssue()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="editingNamed() !== null" [title]="(editingNamed()?.kind === 'chair' ? 'SET.AGENDA.CHAIR' : 'SET.AGENDA.ROOM') | translate" size="sm" [dismissable]="!busy()" (closed)="editingNamed.set(null)">
      <form id="named-form" class="space-y-4" (ngSubmit)="saveNamed()">
        <label class="field"><span class="label label-required">{{ 'COMMON.NAME' | translate }}</span><input class="input" name="name" required maxlength="100" [ngModel]="named.value().name" (ngModelChange)="named.set('name', $event)" /></label>
        <label class="field"><span class="label">{{ 'SET.AGENDA.ORDER' | translate }}</span><input class="input" type="number" min="0" name="norder" [ngModel]="named.value().displayOrder" (ngModelChange)="named.set('displayOrder', +$event || 0)" /></label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="nactive" [ngModel]="named.value().active" (ngModelChange)="named.set('active', $event)" /> {{ 'COMMON.ACTIVE' | translate }}</label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editingNamed.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="named-form" class="btn btn-primary" [disabled]="busy() || !named.value().name.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class AgendaSettingsComponent {
  private readonly config = inject(AgendaConfigService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  protected readonly groups = SPECIALTY_GROUPS;
  protected readonly statuses = APPOINTMENT_STATUSES;
  protected readonly defaults = DEFAULT_STATUS_COLORS;
  protected readonly busy = signal(false);

  protected readonly types = loadable<AppointmentType[]>([]);
  protected readonly chairs = signal<Chair[]>([]);
  protected readonly rooms = signal<WaitingRoom[]>([]);

  protected readonly editingType = signal<{ id: string | null } | null>(null);
  protected readonly type = formState<TypeForm>(blankType());
  protected readonly typeIssue = computed(() => typeProblem(this.type.value()));
  protected readonly suggestedCode = computed(() => codeFrom(this.type.value().nameEn || this.type.value().nameFr));

  protected readonly editingNamed = signal<{ kind: 'chair' | 'room'; id: string | null } | null>(null);
  protected readonly named = formState<NamedForm>({ name: '', active: true, displayOrder: 100 });

  private readonly saved = signal<Record<string, string>>({});
  protected readonly colors = signal<Record<AppointmentStatusName, string>>({ ...DEFAULT_STATUS_COLORS });
  protected readonly colorsChanged = computed(() => JSON.stringify(customColors(this.colors())) !== JSON.stringify(customColors({ ...DEFAULT_STATUS_COLORS, ...this.saved() })));

  constructor() {
    void this.reload();
  }

  protected name(t: AppointmentType): string {
    return typeName(t, this.language.currentLang());
  }

  private async reload(): Promise<void> {
    await Promise.all([
      this.types.load(() => this.config.allTypes()),
      this.config.allChairs().then(c => this.chairs.set(c)).catch(e => this.errors.report(e)),
      this.config.allRooms().then(r => this.rooms.set(r)).catch(e => this.errors.report(e)),
    ]);
    const custom = this.config.statusColors();
    this.saved.set(custom);
    this.colors.set({ ...DEFAULT_STATUS_COLORS, ...custom } as Record<AppointmentStatusName, string>);
  }

  // ── types ─────────────────────────────────────────────────────────
  protected openType(t: AppointmentType | null): void {
    this.type.reset(t
      ? { code: t.code, nameFr: t.nameFr, nameEn: t.nameEn, nameAr: t.nameAr, color: t.color, duration: t.defaultDurationMinutes, bookableOnline: t.bookableOnline, specialtyGroup: t.specialtyGroup as TypeForm['specialtyGroup'], active: t.active, displayOrder: t.displayOrder }
      : blankType(Math.max(0, ...this.types.data().map(x => x.displayOrder)) + 10));
    this.editingType.set({ id: t?.id ?? null });
  }

  protected async saveType(): Promise<void> {
    const target = this.editingType();
    if (!target || this.busy() || this.typeIssue()) {
      return;
    }
    await this.run(async () => {
      await this.config.saveType(target.id, typeRequest(this.type.value()));
      this.editingType.set(null);
    });
  }

  // ── chairs and rooms ──────────────────────────────────────────────
  protected openNamed(kind: 'chair' | 'room', item: Chair | WaitingRoom | null): void {
    const list = kind === 'chair' ? this.chairs() : this.rooms();
    this.named.reset(item ? { name: item.name, active: item.active, displayOrder: item.displayOrder } : { name: '', active: true, displayOrder: Math.max(0, ...list.map(x => x.displayOrder)) + 10 });
    this.editingNamed.set({ kind, id: item?.id ?? null });
  }

  protected async saveNamed(): Promise<void> {
    const target = this.editingNamed();
    const f = this.named.value();
    if (!target || this.busy() || !f.name.trim()) {
      return;
    }
    const body = { name: f.name.trim(), active: f.active, displayOrder: f.displayOrder };
    await this.run(async () => {
      await (target.kind === 'chair' ? this.config.saveChair(target.id, body) : this.config.saveRoom(target.id, body));
      this.editingNamed.set(null);
    });
  }

  // ── colours ───────────────────────────────────────────────────────
  protected setColor(status: AppointmentStatusName, color: string): void {
    this.colors.update(c => ({ ...c, [status]: color }));
  }

  protected async saveColors(): Promise<void> {
    if (this.busy() || !this.colorsChanged()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.config.saveStatusColors(customColors(this.colors()));
      this.saved.set(this.config.statusColors());
      this.toast.success(this.translate.instant('SET.AGENDA.COLORS_SAVED'));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
