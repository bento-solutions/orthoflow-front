import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { merge } from 'rxjs';
import { ApiErrors } from '../../core/services/api-error.service';
import { AgendaConfigService } from '../../core/services/agenda-config.service';
import { LiveEventsService } from '../../core/services/live-events.service';
import { PermissionService } from '../../core/services/permission.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../shared/ui/patient-picker.component';
import { Appointment, ChairBoard, FrontDesk, FrontDeskApi, WaitingCard } from './front-desk-api.service';
import { AbsencesComponent } from './absences.component';
import { WaitingListComponent } from './waiting-list.component';

type Tab = 'today' | 'list' | 'absences';

/** How long is too long to wait: after this many minutes the figure turns amber, then red. */
export const WAIT_WARNING_MINUTES = 20;
export const WAIT_CRITICAL_MINUTES = 40;

export function waitTone(minutes: number): 'ok' | 'warn' | 'critical' {
  return minutes >= WAIT_CRITICAL_MINUTES ? 'critical' : minutes >= WAIT_WARNING_MINUTES ? 'warn' : 'ok';
}

/** The front desk's working view of today: who is here, who is next, who is in which chair, and who is still expected. */
@Component({
  selector: 'app-front-desk',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent, ModalComponent, PatientPickerComponent, WaitingListComponent, AbsencesComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'FD.TITLE' | translate }}</h1>
        <p class="page-sub">{{ 'FD.SUBTITLE' | translate }}</p>
      </div>
      <div class="page-actions">
        @if (!live.connected()) { <span class="pill pill-attention" role="status">{{ 'FD.OFFLINE' | translate }}</span> }
        <button type="button" class="btn btn-secondary btn-sm" (click)="reload()"><app-icon name="refresh" [size]="15" /> {{ 'COMMON.REFRESH' | translate }}</button>
        @if (canManage()) {
          <button type="button" class="btn btn-primary btn-sm" (click)="openWalkIn()"><app-icon name="user-plus" [size]="15" /> {{ 'FD.WALK_IN' | translate }}</button>
        }
      </div>
    </div>

    <nav class="tabs mb-6" role="tablist" [attr.aria-label]="'FD.TITLE' | translate">
      @for (t of tabs; track t.id) {
        <button type="button" class="tab" role="tab" [class.is-active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ t.key | translate }}</button>
      }
    </nav>

    @if (tab() === 'today') {
      @if (board.data(); as b) {
        <section class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" [attr.aria-label]="'FD.KPIS' | translate">
          @for (k of kpis(); track k.key) {
            <div class="tile p-4">
              <p class="text-2xs font-bold uppercase tracking-wider text-ink-500">{{ k.key | translate }}</p>
              <p class="mt-1 text-2xl font-extrabold tabular-nums" [class.text-critical-700]="k.tone === 'critical'" [class.text-caution-700]="k.tone === 'warn'" [class.text-ink-900]="k.tone === 'ok'">{{ k.value }}</p>
            </div>
          }
        </section>

        <div class="grid gap-6 xl:grid-cols-5">
          <section class="card xl:col-span-3">
            <div class="card-head"><h2 class="text-lg font-bold text-ink-900">{{ 'FD.WAITING_ROOM' | translate }} <span class="pill pill-active ms-1">{{ b.waiting.length }}</span></h2></div>
            <ul class="divide-y divide-ink-100">
              @for (w of b.waiting; track w.appointmentId; let i = $index; let last = $last) {
                <li class="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span class="h-10 w-1.5 shrink-0 rounded-full" [style.background]="w.typeColor || '#64748b'" aria-hidden="true"></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-bold text-ink-900">{{ w.patientName }} @if (w.walkIn) { <span class="pill pill-attention ms-1">{{ 'FD.WALK_IN_TAG' | translate }}</span> }</p>
                    <p class="truncate text-sm text-ink-500">{{ w.typeName }} · {{ w.practitionerName || '—' }} @if (!w.walkIn) { · {{ w.scheduledFor | date: 'shortTime' }} }</p>
                  </div>
                  <span class="text-sm font-bold tabular-nums" [class.text-critical-700]="tone(w) === 'critical'" [class.text-caution-700]="tone(w) === 'warn'" [attr.title]="'FD.WAITING_SINCE' | translate">
                    {{ w.waitMinutes }} min
                  </span>
                  @if (canManage()) {
                    <div class="flex items-center gap-1">
                      <button type="button" class="btn btn-ghost btn-icon" [disabled]="i === 0" (click)="move(i, -1)" [attr.aria-label]="('FD.MOVE_UP' | translate) + ' ' + w.patientName"><app-icon name="chevron-up" [size]="16" /></button>
                      <button type="button" class="btn btn-ghost btn-icon" [disabled]="last" (click)="move(i, 1)" [attr.aria-label]="('FD.MOVE_DOWN' | translate) + ' ' + w.patientName"><app-icon name="chevron-down" [size]="16" /></button>
                      <select class="select w-36" [ngModel]="chairChoice()[w.appointmentId] ?? ''" (ngModelChange)="chooseChair(w.appointmentId, $event)" [attr.aria-label]="('FD.CHAIR' | translate) + ' — ' + w.patientName">
                        <option value="">{{ 'FD.CHOOSE_CHAIR' | translate }}</option>
                        @for (c of freeChairs(); track c.chairId) { <option [value]="c.chairId">{{ c.name }}</option> }
                      </select>
                      <button type="button" class="btn btn-primary btn-sm" [disabled]="!chairChoice()[w.appointmentId]" (click)="seat(w)">{{ 'FD.SEAT' | translate }}</button>
                    </div>
                  }
                </li>
              } @empty {
                <li class="px-5 py-10 text-center text-sm text-ink-500">{{ 'FD.NOBODY_WAITING' | translate }}</li>
              }
            </ul>
          </section>

          <section class="card xl:col-span-2">
            <div class="card-head"><h2 class="text-lg font-bold text-ink-900">{{ 'FD.CHAIRS' | translate }}</h2></div>
            <ul class="divide-y divide-ink-100">
              @for (c of b.chairs; track c.chairId) {
                <li class="flex items-center gap-3 px-5 py-3">
                  <span class="h-3 w-3 shrink-0 rounded-full" [class.bg-positive-500]="!c.occupied" [class.bg-petrol-500]="c.occupied" aria-hidden="true"></span>
                  <div class="min-w-0 flex-1">
                    <p class="font-bold text-ink-900">{{ c.name }}</p>
                    @if (c.occupied) {
                      <p class="truncate text-sm text-ink-600">{{ c.patientName }} · {{ c.practitionerName || '—' }} · {{ c.minutes }} min</p>
                    } @else {
                      <p class="text-sm text-ink-500">{{ 'FD.FREE' | translate }}</p>
                    }
                  </div>
                  @if (c.occupied && canManage()) {
                    <button type="button" class="btn btn-secondary btn-sm" (click)="backToWaiting(c)">{{ 'FD.BACK_TO_WAITING' | translate }}</button>
                    <button type="button" class="btn btn-primary btn-sm" (click)="finish(c)">{{ 'FD.FINISH' | translate }}</button>
                  }
                </li>
              }
            </ul>
          </section>
        </div>

        <section class="card mt-6">
          <div class="card-head"><h2 class="text-lg font-bold text-ink-900">{{ 'FD.EXPECTED' | translate }} <span class="pill pill-idle ms-1">{{ expected().length }}</span></h2></div>
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>{{ 'COMMON.TIME' | translate }}</th><th>{{ 'COMMON.PATIENT' | translate }}</th><th>{{ 'COMMON.TYPE' | translate }}</th><th>{{ 'COMMON.PRACTITIONER' | translate }}</th><th>{{ 'COMMON.STATUS' | translate }}</th><th></th></tr></thead>
              <tbody>
                @for (a of expected(); track a.id) {
                  <tr>
                    <td class="tabular-nums font-semibold">{{ a.dateTime | date: 'shortTime' }}</td>
                    <td class="font-semibold">{{ a.patientName }}<span class="block text-xs font-normal text-ink-500">{{ a.patientPhone }}</span></td>
                    <td>{{ a.type }}</td>
                    <td>{{ a.practitionerName || '—' }}</td>
                    <td><span class="pill pill-idle">{{ 'SCHEDULE.STATUS.' + a.status | translate }}</span></td>
                    <td class="cell-actions">
                      @if (canManage()) { <button type="button" class="btn btn-secondary btn-sm" (click)="checkIn(a)">{{ 'FD.CHECK_IN' | translate }}</button> }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="py-8 text-center text-ink-500">{{ 'FD.NOBODY_EXPECTED' | translate }}</td></tr>
                }
              </tbody>
            </table>
          </div></div>
        </section>
      } @else if (board.loading()) {
        <div class="skeleton h-40" aria-busy="true"></div>
      }
    }

    @if (tab() === 'list') { <app-waiting-list /> }
    @if (tab() === 'absences') { <app-absences /> }

    <app-modal [open]="walkInOpen()" [title]="'FD.WALK_IN' | translate" (closed)="walkInOpen.set(false)">
      <form id="walkin-form" class="space-y-4" (ngSubmit)="saveWalkIn()">
        <div class="field"><span class="label">{{ 'COMMON.PATIENT' | translate }}</span>
          <app-patient-picker [value]="walkInPatient()" (valueChange)="walkInPatient.set($event)" [label]="'COMMON.PATIENT' | translate" />
          <span class="hint">{{ 'FD.WALK_IN_NEW_HINT' | translate }}</span></div>
        @if (!walkInPatient()) {
          <div class="grid gap-4 sm:grid-cols-3">
            <label class="field"><span class="label label-required">{{ 'SET.USERS.FIRST_NAME' | translate }}</span><input class="input" name="firstName" [ngModel]="walkIn.value().firstName" (ngModelChange)="walkIn.set('firstName', $event)" /></label>
            <label class="field"><span class="label label-required">{{ 'SET.USERS.LAST_NAME' | translate }}</span><input class="input" name="lastName" [ngModel]="walkIn.value().lastName" (ngModelChange)="walkIn.set('lastName', $event)" /></label>
            <label class="field"><span class="label">{{ 'SET.PROFILE.PHONE' | translate }}</span><input class="input" name="phone" [ngModel]="walkIn.value().phone" (ngModelChange)="walkIn.set('phone', $event)" /></label>
          </div>
        }
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field"><span class="label">{{ 'COMMON.TYPE' | translate }}</span>
            <select class="select" name="type" [ngModel]="walkIn.value().typeId" (ngModelChange)="walkIn.set('typeId', $event)">
              <option value="">—</option>@for (t of config.types(); track t.id) { <option [value]="t.id">{{ config.label(t) }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
            <select class="select" name="practitioner" [ngModel]="walkIn.value().practitionerId" (ngModelChange)="walkIn.set('practitionerId', $event)">
              <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
            </select></label>
        </div>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="walkIn.value().notes" (ngModelChange)="walkIn.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="walkInOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="walkin-form" class="btn btn-primary" [disabled]="saving() || !walkInValid()">{{ 'FD.ADD_TO_WAITING' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class FrontDeskComponent {
  private readonly api = inject(FrontDeskApi);
  private readonly errors = inject(ApiErrors);
  private readonly permissions = inject(PermissionService);
  protected readonly live = inject(LiveEventsService);
  protected readonly config = inject(AgendaConfigService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly tabs: { id: Tab; key: string }[] = [
    { id: 'today', key: 'FD.TAB_TODAY' },
    { id: 'list', key: 'FD.TAB_LIST' },
    { id: 'absences', key: 'FD.TAB_ABSENCES' },
  ];
  protected readonly tab = signal<Tab>('today');
  protected readonly board = loadable<FrontDesk | null>(null);
  protected readonly today = loadable<Appointment[]>([]);
  protected readonly chairChoice = signal<Record<string, string>>({});
  protected readonly walkInOpen = signal(false);
  protected readonly walkInPatient = signal<PickedPatient | null>(null);
  protected readonly walkIn = formState({ firstName: '', lastName: '', phone: '', typeId: '', practitionerId: '', notes: '' });
  protected readonly saving = signal(false);
  protected readonly canManage = computed(() => this.permissions.can('WAITING_ROOM_MANAGE'));

  protected readonly freeChairs = computed(() => (this.board.data()?.chairs ?? []).filter(c => !c.occupied));
  protected readonly kpis = computed(() => {
    const k = this.board.data()?.kpis;
    if (!k) {
      return [];
    }
    return [
      { key: 'FD.KPI.WAITING', value: String(k.waiting), tone: 'ok' as const },
      { key: 'FD.KPI.IN_TREATMENT', value: String(k.inTreatment), tone: 'ok' as const },
      { key: 'FD.KPI.ARRIVED', value: String(k.arrivedToday), tone: 'ok' as const },
      { key: 'FD.KPI.AVG_WAIT', value: `${Math.round(k.averageWaitMinutes)} min`, tone: waitTone(k.averageWaitMinutes) },
      { key: 'FD.KPI.LONGEST', value: `${k.longestWaitMinutes} min`, tone: waitTone(k.longestWaitMinutes) },
      { key: 'FD.KPI.CHAIRS', value: `${k.chairsOccupied} / ${k.chairsTotal}`, tone: 'ok' as const },
    ];
  });
  /** Booked visits that have not started: the people the desk is still waiting for. */
  protected readonly expected = computed(() =>
    this.today.data()
      .filter(a => a.status === 'SCHEDULED' || a.status === 'CONFIRMED' || a.status === 'LATE')
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime)),
  );
  protected readonly walkInValid = computed(() => !!this.walkInPatient() || (this.walkIn.value().firstName.trim() !== '' && this.walkIn.value().lastName.trim() !== ''));

  constructor() {
    void this.reload();
    const destroyRef = inject(DestroyRef);
    // The server says when anything on this screen changed; a quiet minute also refreshes, because waiting times grow on their own.
    merge(this.live.of('appointment', 'waiting-list', 'agenda-config')).pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.reload());
    const timer = setInterval(() => void this.reload(), 60_000);
    destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected tone(w: WaitingCard): 'ok' | 'warn' | 'critical' {
    return waitTone(w.waitMinutes);
  }

  protected async reload(): Promise<void> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    await Promise.all([this.board.load(() => this.api.board()), this.today.load(() => this.api.appointmentsBetween(start, end))]);
  }

  private async act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected chooseChair(appointmentId: string, chairId: string): void {
    this.chairChoice.update(c => ({ ...c, [appointmentId]: chairId }));
  }

  protected seat(w: WaitingCard): Promise<void> {
    return this.act(async () => {
      await this.api.seat(w.appointmentId, this.chairChoice()[w.appointmentId]);
      this.chairChoice.update(c => ({ ...c, [w.appointmentId]: '' }));
    });
  }

  protected checkIn(a: Appointment): Promise<void> {
    return this.act(() => this.api.checkIn(a.id));
  }

  protected finish(c: ChairBoard): Promise<void> {
    return this.act(() => this.api.finish(c.appointmentId));
  }

  protected backToWaiting(c: ChairBoard): Promise<void> {
    return this.act(() => this.api.backToWaiting(c.appointmentId));
  }

  protected move(index: number, by: -1 | 1): Promise<void> {
    const ids = (this.board.data()?.waiting ?? []).map(w => w.appointmentId);
    const target = index + by;
    if (target < 0 || target >= ids.length) {
      return Promise.resolve();
    }
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return this.act(() => this.api.reorder(ids));
  }

  protected openWalkIn(): void {
    this.walkInPatient.set(null);
    this.walkIn.reset({ firstName: '', lastName: '', phone: '', typeId: '', practitionerId: '', notes: '' });
    this.walkInOpen.set(true);
  }

  protected async saveWalkIn(): Promise<void> {
    const f = this.walkIn.value();
    const patient = this.walkInPatient();
    this.saving.set(true);
    try {
      await this.api.walkIn({
        patientId: patient?.id,
        firstName: patient ? undefined : f.firstName.trim(),
        lastName: patient ? undefined : f.lastName.trim(),
        phone: patient ? undefined : f.phone.trim() || undefined,
        appointmentTypeId: f.typeId || undefined,
        practitionerId: f.practitionerId || undefined,
        notes: f.notes.trim() || undefined,
      });
      this.walkInOpen.set(false);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }
}
