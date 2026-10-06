import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import {
  Appointment, LAB_ITEM_TYPES, LAB_STATUSES, Lab, LabOrder, LabOrderInput, LabOrderQuery, LabStatus, OperationsApi,
} from '../../core/services/operations-api.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { isoDate } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../shared/ui/patient-picker.component';

/** Where an order can go from each status; the server enforces the same graph and refuses anything else. */
const NEXT: Record<LabStatus, LabStatus[]> = {
  SENT: ['IN_PROGRESS', 'RECEIVED'],
  IN_PROGRESS: ['RECEIVED'],
  RECEIVED: ['FITTED', 'REMAKE'],
  FITTED: ['REMAKE'],
  REMAKE: ['SENT', 'IN_PROGRESS'],
};

export function nextStatuses(status: LabStatus): LabStatus[] {
  return NEXT[status];
}

/** Waiting on the lab is amber, back at the clinic or fitted is settled, a remake is a problem. */
export function labTone(status: LabStatus): string {
  return { SENT: 'pill-attention', IN_PROGRESS: 'pill-active', RECEIVED: 'pill-done', FITTED: 'pill-done', REMAKE: 'pill-critical' }[status];
}

export interface LabFilter {
  status: LabStatus[];
  search: string;
  labId: string;
  dueFrom: string;
  dueTo: string;
  updatedFrom: string;
  updatedTo: string;
  urgentOnly: boolean;
  overdueOnly: boolean;
}

export const EMPTY_LAB_FILTER: LabFilter = { status: [], search: '', labId: '', dueFrom: '', dueTo: '', updatedFrom: '', updatedTo: '', urgentOnly: false, overdueOnly: false };

/** Filters live in the address, so a filtered list can be bookmarked, shared and survives a refresh. */
export function filterFromParams(get: (key: string) => string | null): LabFilter {
  const statuses = (get('status') ?? '').split(',').filter((s): s is LabStatus => (LAB_STATUSES as readonly string[]).includes(s));
  return {
    status: statuses,
    search: get('q') ?? '',
    labId: get('lab') ?? '',
    dueFrom: get('dueFrom') ?? '',
    dueTo: get('dueTo') ?? '',
    updatedFrom: get('updatedFrom') ?? '',
    updatedTo: get('updatedTo') ?? '',
    urgentOnly: get('urgent') === '1',
    overdueOnly: get('overdue') === '1',
  };
}

/** Only what differs from "no filter" goes in the address, so the plain list has a plain URL. */
export function filterToParams(f: LabFilter): Record<string, string | null> {
  return {
    status: f.status.length ? f.status.join(',') : null,
    q: f.search || null,
    lab: f.labId || null,
    dueFrom: f.dueFrom || null,
    dueTo: f.dueTo || null,
    updatedFrom: f.updatedFrom || null,
    updatedTo: f.updatedTo || null,
    urgent: f.urgentOnly ? '1' : null,
    overdue: f.overdueOnly ? '1' : null,
  };
}

export function filterToQuery(f: LabFilter): LabOrderQuery {
  return {
    status: f.status, search: f.search.trim() || undefined, labId: f.labId || undefined, dueFrom: f.dueFrom || undefined, dueTo: f.dueTo || undefined,
    updatedFrom: f.updatedFrom || undefined, updatedTo: f.updatedTo || undefined, urgentOnly: f.urgentOnly || undefined, overdueOnly: f.overdueOnly || undefined,
  };
}

interface OrderForm {
  labId: string;
  practitionerId: string;
  itemType: LabOrderInput['itemType'];
  description: string;
  sentDate: string;
  dueDate: string;
  urgent: boolean;
  cost: number;
  fittingAppointmentId: string;
  notes: string;
}

const blankOrder = (): OrderForm => ({ labId: '', practitionerId: '', itemType: 'ALIGNER', description: '', sentDate: isoDate(new Date()), dueDate: '', urgent: false, cost: 0, fittingAppointmentId: '', notes: '' });

/**
 * Work sent to a dental laboratory: aligners, retainers, expanders, crowns. Each order is followed
 * from sent to fitted, linked to the appointment where it will be fitted, and flagged when the
 * lab is late or when the fitting is booked before the work is due back. Receiving an order books
 * the lab's fee as an expense on its own.
 */
@Component({
  selector: 'app-lab-orders',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, IconComponent, ModalComponent, PatientPickerComponent, CanDirective],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'LAB.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'LAB.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> {{ 'LAB.NEW' | translate }}</button>
        </div>
      </header>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <div class="seg flex-wrap" role="group" [attr.aria-label]="'COMMON.STATUS' | translate">
          @for (s of statuses; track s) {
            <button type="button" class="seg-item" [class.is-active]="filter().status.includes(s)" [attr.aria-pressed]="filter().status.includes(s)" (click)="toggleStatus(s)">{{ 'LAB.STATUSES.' + s | translate }}</button>
          }
        </div>
        <label class="flex items-center gap-1.5 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="filter().urgentOnly" (ngModelChange)="patch({ urgentOnly: $event })" /> {{ 'LAB.URGENT_ONLY' | translate }}</label>
        <label class="flex items-center gap-1.5 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="filter().overdueOnly" (ngModelChange)="patch({ overdueOnly: $event })" /> {{ 'LAB.OVERDUE_ONLY' | translate }}</label>
      </div>
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <label class="search"><span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span><app-icon name="search" [size]="16" />
          <input class="input" type="search" [placeholder]="'LAB.SEARCH' | translate" [ngModel]="searchInput()" (ngModelChange)="searchInput.set($event)" /></label>
        <label class="field w-auto"><span class="label">{{ 'LAB.LAB' | translate }}</span>
          <select class="select w-auto" [ngModel]="filter().labId" (ngModelChange)="patch({ labId: $event })">
            <option value="">{{ 'LAB.ALL_LABS' | translate }}</option>
            @for (l of labs(); track l.id) { <option [value]="l.id">{{ l.name }}</option> }
          </select></label>
        <label class="field w-auto"><span class="label">{{ 'LAB.DUE_FROM' | translate }}</span><input class="input" type="date" [ngModel]="filter().dueFrom" (ngModelChange)="patch({ dueFrom: $event })" /></label>
        <label class="field w-auto"><span class="label">{{ 'LAB.DUE_TO' | translate }}</span><input class="input" type="date" [ngModel]="filter().dueTo" (ngModelChange)="patch({ dueTo: $event })" /></label>
        <label class="field w-auto"><span class="label">{{ 'LAB.UPDATED_FROM' | translate }}</span><input class="input" type="date" [ngModel]="filter().updatedFrom" (ngModelChange)="patch({ updatedFrom: $event })" /></label>
        <label class="field w-auto"><span class="label">{{ 'LAB.UPDATED_TO' | translate }}</span><input class="input" type="date" [ngModel]="filter().updatedTo" (ngModelChange)="patch({ updatedTo: $event })" /></label>
        @if (filtered()) { <button type="button" class="btn btn-ghost btn-sm" (click)="clear()">{{ 'COMMON.CLEAR_FILTERS' | translate }}</button> }
      </div>

      <div class="table-wrap" [attr.aria-busy]="orders.loading()"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th scope="col">{{ 'COMMON.PATIENT' | translate }}</th><th scope="col">{{ 'LAB.ITEM' | translate }}</th><th scope="col">{{ 'LAB.LAB' | translate }}</th>
            <th scope="col">{{ 'LAB.DUE' | translate }}</th><th scope="col">{{ 'LAB.FITTING' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
            <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
          </tr></thead>
          <tbody>
            @for (o of orders.data(); track o.id) {
              <tr>
                <td><a class="font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', o.patientId]">{{ o.patientName }}</a>
                  @if (o.urgent) { <span class="pill pill-critical pill-nodot ms-2">{{ 'LAB.URGENT' | translate }}</span> }
                  @if (o.practitionerName) { <span class="block text-xs text-ink-500">{{ o.practitionerName }}</span> }</td>
                <td>{{ 'LAB.ITEMS.' + o.itemType | translate }}@if (o.description) { <span class="block text-xs text-ink-500">{{ o.description }}</span> }
                  @if (o.cost) { <span class="block text-xs text-ink-500">{{ o.cost | money }}</span> }</td>
                <td>{{ o.labName }}</td>
                <td>{{ o.dueDate ? (o.dueDate | date: 'mediumDate') : '—' }}
                  @if (o.warnings.includes('OVERDUE')) { <span class="block"><span class="pill pill-critical pill-nodot">{{ 'LAB.WARNINGS.OVERDUE' | translate }}</span></span> }</td>
                <td>{{ o.fittingAt ? (o.fittingAt | date: 'medium') : '—' }}
                  @if (o.warnings.includes('FITTING_BEFORE_DUE')) { <span class="block"><span class="pill pill-attention pill-nodot">{{ 'LAB.WARNINGS.FITTING_BEFORE_DUE' | translate }}</span></span> }
                  @if (o.warnings.includes('NOT_RECEIVED_BEFORE_FITTING')) { <span class="block"><span class="pill pill-attention pill-nodot">{{ 'LAB.WARNINGS.NOT_RECEIVED_BEFORE_FITTING' | translate }}</span></span> }</td>
                <td><span class="pill" [class]="'pill ' + tone(o.status)">{{ 'LAB.STATUSES.' + o.status | translate }}</span></td>
                <td class="cell-actions">
                  <span class="inline-flex flex-wrap justify-end gap-1">
                    @for (n of next(o); track n) { <button type="button" class="btn btn-secondary btn-sm" (click)="openMove(o, n)">{{ 'LAB.MOVE.' + n | translate }}</button> }
                    <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(o)" [title]="'COMMON.EDIT' | translate" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + o.patientName"><app-icon name="edit" [size]="16" /></button>
                    <button type="button" class="btn btn-ghost btn-icon" (click)="print(o)" [title]="'LAB.PRINT' | translate" [attr.aria-label]="('LAB.PRINT' | translate) + ' ' + o.patientName"><app-icon name="print" [size]="16" /></button>
                  </span>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ (filtered() ? 'LAB.NO_MATCH' : 'LAB.EMPTY') | translate }}</td></tr>
            }
          </tbody>
        </table>
      </div></div>
    </div>

    <app-modal [open]="editing() !== null" [title]="(editing()?.id ? 'LAB.EDIT' : 'LAB.NEW') | translate" size="lg" [dismissable]="!busy()" (closed)="editing.set(null)">
      <form id="lab-form" class="space-y-4" (ngSubmit)="save()">
        @if (!editing()?.id) {
          <div class="field"><span class="label label-required">{{ 'COMMON.PATIENT' | translate }}</span>
            <app-patient-picker [value]="patient()" (valueChange)="pickPatient($event)" [label]="'COMMON.PATIENT' | translate" /></div>
        } @else { <p class="text-sm"><strong>{{ editing()?.patientName }}</strong></p> }
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">{{ 'LAB.LAB' | translate }}</span>
            <select class="select" name="lab" required [ngModel]="form.value().labId" (ngModelChange)="form.set('labId', $event)">
              <option value="">—</option>@for (l of labs(); track l.id) { <option [value]="l.id">{{ l.name }}</option> }
            </select></label>
          <label class="field"><span class="label label-required">{{ 'LAB.ITEM' | translate }}</span>
            <select class="select" name="item" [ngModel]="form.value().itemType" (ngModelChange)="form.set('itemType', $event)">
              @for (t of itemTypes; track t) { <option [value]="t">{{ 'LAB.ITEMS.' + t | translate }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
            <select class="select" name="doctor" [ngModel]="form.value().practitionerId" (ngModelChange)="form.set('practitionerId', $event)">
              <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
            </select></label>
        </div>
        @if (labs().length === 0) {
          <p class="rounded-md bg-caution-50 p-3 text-sm text-caution-800">{{ 'LAB.NO_LABS' | translate }}</p>
        }
        <div *appCan="'STOCK_WRITE'" class="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-ink-200 p-3">
          <label class="field flex-1"><span class="label">{{ 'LAB.NEW_LAB' | translate }}</span><input class="input" name="newLab" [ngModel]="newLabName()" (ngModelChange)="newLabName.set($event)" maxlength="120" /></label>
          <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy() || !newLabName().trim()" (click)="addLab()">{{ 'COMMON.ADD' | translate }}</button>
        </div>
        <div class="grid gap-4 sm:grid-cols-4">
          <label class="field"><span class="label">{{ 'LAB.SENT' | translate }}</span><input class="input" type="date" name="sent" [ngModel]="form.value().sentDate" (ngModelChange)="form.set('sentDate', $event)" /></label>
          <label class="field"><span class="label">{{ 'LAB.DUE' | translate }}</span><input class="input" type="date" name="due" [min]="form.value().sentDate" [ngModel]="form.value().dueDate" (ngModelChange)="form.set('dueDate', $event)" /></label>
          <label class="field"><span class="label">{{ 'LAB.COST' | translate }}</span><input class="input" type="number" min="0" step="0.01" name="cost" [ngModel]="form.value().cost || null" (ngModelChange)="form.set('cost', +$event || 0)" /></label>
          <label class="flex items-center gap-2 self-end pb-2 text-sm font-semibold"><input type="checkbox" name="urgent" [ngModel]="form.value().urgent" (ngModelChange)="form.set('urgent', $event)" /> {{ 'LAB.URGENT' | translate }}</label>
        </div>
        <label class="field"><span class="label">{{ 'LAB.FITTING_APPOINTMENT' | translate }}</span>
          <select class="select" name="fitting" [ngModel]="form.value().fittingAppointmentId" (ngModelChange)="form.set('fittingAppointmentId', $event)" [disabled]="!patient() && !editing()?.id">
            <option value="">{{ 'LAB.NO_FITTING' | translate }}</option>
            @for (a of appointments(); track a.id) { <option [value]="a.id">{{ a.dateTime | date: 'medium' }} — {{ a.type }}</option> }
          </select>
          @if (fittingWarning()) { <span class="hint text-caution-700">{{ 'LAB.WARNINGS.FITTING_BEFORE_DUE' | translate }}</span> }
        </label>
        <label class="field"><span class="label">{{ 'LAB.DESCRIPTION' | translate }}</span><input class="input" name="description" maxlength="500" [ngModel]="form.value().description" (ngModelChange)="form.set('description', $event)" /></label>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="lab-form" class="btn btn-primary" [disabled]="busy() || !form.value().labId || (!editing()?.id && !patient())">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="moving() !== null" [title]="'LAB.MOVE_TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="moving.set(null)">
      <form id="move-form" class="space-y-3" (ngSubmit)="move()">
        @if (moving(); as m) {
          <p class="text-sm text-ink-700"><strong>{{ m.order.patientName }}</strong> · {{ 'LAB.ITEMS.' + m.order.itemType | translate }} → <strong>{{ 'LAB.STATUSES.' + m.to | translate }}</strong></p>
          @if (m.to === 'RECEIVED') { <p class="rounded-md bg-ink-50 p-2 text-sm text-ink-600">{{ 'LAB.RECEIVED_HINT' | translate }}</p> }
          @if (m.to === 'REMAKE') { <p class="rounded-md bg-caution-50 p-2 text-sm text-caution-800">{{ 'LAB.REMAKE_HINT' | translate }}</p> }
          <label class="field"><span class="label">{{ 'LAB.MOVE_DATE' | translate }}</span><input class="input" type="date" name="date" [max]="today" [ngModel]="moveDate()" (ngModelChange)="moveDate.set($event)" /></label>
        }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="moving.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="move-form" class="btn btn-primary" [disabled]="busy()">{{ 'COMMON.CONFIRM' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class LabOrdersComponent {
  private readonly api = inject(OperationsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly downloads = inject(DownloadService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly statuses = LAB_STATUSES;
  protected readonly itemTypes = LAB_ITEM_TYPES;
  protected readonly today = isoDate(new Date());
  protected readonly next = (o: LabOrder) => nextStatuses(o.status);
  protected readonly tone = labTone;
  private readonly route = inject(ActivatedRoute);

  protected readonly filter = signal<LabFilter>(filterFromParams(key => this.route.snapshot.queryParamMap.get(key)));
  protected readonly searchInput = signal(this.filter().search);
  protected readonly filtered = computed(() => JSON.stringify(this.filter()) !== JSON.stringify(EMPTY_LAB_FILTER));
  protected readonly orders = loadable<LabOrder[]>([]);
  protected readonly labs = signal<Lab[]>([]);

  protected readonly busy = signal(false);
  protected readonly editing = signal<{ id: string | null; patientName?: string } | null>(null);
  protected readonly patient = signal<PickedPatient | null>(null);
  protected readonly form = formState<OrderForm>(blankOrder());
  protected readonly newLabName = signal('');
  protected readonly appointments = signal<Appointment[]>([]);
  protected readonly fittingWarning = computed(() => {
    const appointment = this.appointments().find(a => a.id === this.form.value().fittingAppointmentId);
    const due = this.form.value().dueDate;
    return !!appointment && !!due && isoDate(new Date(appointment.dateTime)) < due;
  });

  protected readonly moving = signal<{ order: LabOrder; to: LabStatus } | null>(null);
  protected readonly moveDate = signal(this.today);

  constructor() {
    void this.loadLabs();
    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const typed = this.searchInput();
      pause = setTimeout(() => untracked(() => this.patch({ search: typed })), 300);
      onCleanup(() => clearTimeout(pause));
    });
    effect(() => {
      const filter = this.filter();
      untracked(() => {
        void this.router.navigate([], { queryParams: filterToParams(filter), replaceUrl: true });
        void this.orders.load(() => this.api.labOrders(filterToQuery(filter)));
      });
    });
    refreshOnLive(['lab-order'], () => void this.orders.load(() => this.api.labOrders(filterToQuery(this.filter()))));
  }

  protected patch(change: Partial<LabFilter>): void {
    const next = { ...this.filter(), ...change };
    if (JSON.stringify(next) !== JSON.stringify(this.filter())) {
      this.filter.set(next);
    }
  }

  protected toggleStatus(status: LabStatus): void {
    const current = this.filter().status;
    this.patch({ status: current.includes(status) ? current.filter(s => s !== status) : [...current, status] });
  }

  protected clear(): void {
    this.searchInput.set('');
    this.filter.set({ ...EMPTY_LAB_FILTER });
  }

  private async loadLabs(): Promise<void> {
    try {
      this.labs.set(await this.api.labs());
    } catch (error) {
      this.errors.report(error);
    }
  }

  // ── create and edit ───────────────────────────────────────────────
  protected openNew(): void {
    this.patient.set(null);
    this.appointments.set([]);
    this.form.reset({ ...blankOrder(), labId: this.labs().length === 1 ? this.labs()[0].id : '' });
    this.editing.set({ id: null });
  }

  protected openEdit(o: LabOrder): void {
    this.patient.set({ id: o.patientId, name: o.patientName });
    this.form.reset({
      labId: o.labId, practitionerId: o.practitionerId ?? '', itemType: o.itemType, description: o.description ?? '', sentDate: o.sentDate ?? '', dueDate: o.dueDate ?? '',
      urgent: o.urgent, cost: o.cost ?? 0, fittingAppointmentId: o.fittingAppointmentId ?? '', notes: o.notes ?? '',
    });
    this.editing.set({ id: o.id, patientName: o.patientName });
    void this.loadAppointments(o.patientId);
  }

  protected async pickPatient(patient: PickedPatient | null): Promise<void> {
    this.patient.set(patient);
    this.form.set('fittingAppointmentId', '');
    this.appointments.set([]);
    if (patient) {
      await this.loadAppointments(patient.id);
    }
  }

  /** The patient's coming appointments, to link the one where the piece will be fitted. */
  private async loadAppointments(patientId: string): Promise<void> {
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 180 * 86_400_000);
      const all = await this.api.upcomingAppointments(from.toISOString(), to.toISOString());
      if (this.patient()?.id === patientId) {
        this.appointments.set(all.filter(a => a.patientId === patientId && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW'));
      }
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async addLab(): Promise<void> {
    const name = this.newLabName().trim();
    if (!name || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.createLab(name);
      this.newLabName.set('');
      await this.loadLabs();
      const created = this.labs().find(l => l.name === name);
      if (created) {
        this.form.set('labId', created.id);
      }
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(): Promise<void> {
    const target = this.editing();
    const f = this.form.value();
    const patientId = this.patient()?.id;
    if (!target || this.busy() || !f.labId || !patientId) {
      return;
    }
    const body: LabOrderInput = {
      patientId, labId: f.labId, practitionerId: f.practitionerId || undefined, itemType: f.itemType, description: f.description.trim() || undefined,
      sentDate: f.sentDate || undefined, dueDate: f.dueDate || undefined, urgent: f.urgent, cost: f.cost > 0 ? f.cost : undefined,
      fittingAppointmentId: f.fittingAppointmentId || undefined, notes: f.notes.trim() || undefined,
    };
    await this.run(async () => {
      await (target.id ? this.api.updateLabOrder(target.id, body) : this.api.createLabOrder(body));
      this.editing.set(null);
    });
  }

  // ── move along ────────────────────────────────────────────────────
  protected openMove(order: LabOrder, to: LabStatus): void {
    this.moveDate.set(this.today);
    this.moving.set({ order, to });
  }

  protected async move(): Promise<void> {
    const target = this.moving();
    if (!target || this.busy()) {
      return;
    }
    await this.run(async () => {
      await this.api.transitionLabOrder(target.order.id, target.to, this.moveDate() || undefined);
      this.moving.set(null);
      this.toast.success(this.translate.instant('LAB.MOVED'));
    });
  }

  protected async print(order: LabOrder): Promise<void> {
    try {
      await this.downloads.open(`/lab-orders/${order.id}/document`, { lang: this.language.currentLang() });
    } catch (error) {
      this.errors.report(error);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.orders.load(() => this.api.labOrders(filterToQuery(this.filter())));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
