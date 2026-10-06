import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { AgendaConfigService } from '../../core/services/agenda-config.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { LiveEventsService } from '../../core/services/live-events.service';
import { PermissionService } from '../../core/services/permission.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../shared/ui/patient-picker.component';
import { FrontDeskApi, URGENCIES, WaitingEntry } from './front-desk-api.service';

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const URGENCY_PILL: Record<string, string> = { URGENT: 'pill-critical', HIGH: 'pill-attention', NORMAL: 'pill-idle', LOW: 'pill-idle' };

/** Weekday numbers as stored ("1,3,5") to a set, ignoring anything that is not a day. */
export function parseWeekdays(text: string | null | undefined): Set<number> {
  return new Set((text ?? '').split(',').map(s => Number(s.trim())).filter(n => n >= 1 && n <= 7));
}

/** A set of weekdays as stored: sorted, comma-separated, and absent when empty. */
export function formatWeekdays(days: Iterable<number>): string | undefined {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  return sorted.length ? sorted.join(',') : undefined;
}

/**
 * Patients who want an earlier slot than the one they have, or who could not be given one.
 * When a slot opens, the desk offers it to the most urgent entry whose preferences fit.
 */
@Component({
  selector: 'app-waiting-list',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent, ModalComponent, PatientPickerComponent],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'FD.LIST.TITLE' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'FD.LIST.HINT' | translate }}</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" (click)="openAdd()"><app-icon name="plus" [size]="15" /> {{ 'FD.LIST.ADD' | translate }}</button>
      </div>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>{{ 'FD.LIST.URGENCY' | translate }}</th><th>{{ 'COMMON.PATIENT' | translate }}</th><th>{{ 'COMMON.TYPE' | translate }}</th>
            <th>{{ 'COMMON.PRACTITIONER' | translate }}</th><th>{{ 'FD.LIST.PREFERENCES' | translate }}</th><th class="cell-actions">{{ 'COMMON.ACTIONS' | translate }}</th>
          </tr></thead>
          <tbody>
            @for (e of entries.data(); track e.id) {
              <tr>
                <td><span class="pill" [class]="'pill ' + pill(e.urgency)">{{ 'FD.LIST.URGENCIES.' + e.urgency | translate }}</span></td>
                <td class="font-semibold">{{ e.patientName }}<span class="block text-xs font-normal text-ink-500">{{ e.patientPhone }}</span></td>
                <td><span class="me-1 inline-block h-2.5 w-2.5 rounded-full" [style.background]="e.typeColor || '#64748b'" aria-hidden="true"></span>{{ e.typeName || '—' }} · {{ e.durationMinutes }} min</td>
                <td>{{ e.practitionerName || '—' }}</td>
                <td class="text-sm">{{ preferences(e) }}@if (e.notes) { <span class="block text-xs text-ink-500">{{ e.notes }}</span> }</td>
                <td class="cell-actions">
                  <button type="button" class="btn btn-secondary btn-sm" (click)="openSchedule(e)">{{ 'FD.LIST.SCHEDULE' | translate }}</button>
                  <button type="button" class="btn btn-ghost btn-icon" (click)="remove(e)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + e.patientName"><app-icon name="trash" [size]="16" /></button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="py-8 text-center text-ink-500">{{ 'FD.LIST.EMPTY' | translate }}</td></tr>
            }
          </tbody>
        </table>
      </div></div>
    </section>

    <app-modal [open]="adding()" [title]="'FD.LIST.ADD' | translate" size="lg" (closed)="adding.set(false)">
      <form id="wl-form" class="space-y-4" (ngSubmit)="saveAdd()">
        <div class="field"><span class="label label-required">{{ 'COMMON.PATIENT' | translate }}</span>
          <app-patient-picker [value]="patient()" (valueChange)="patient.set($event)" [label]="'COMMON.PATIENT' | translate" /></div>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label">{{ 'COMMON.TYPE' | translate }}</span>
            <select class="select" name="type" [ngModel]="form.value().typeId" (ngModelChange)="pickType($event)">
              <option value="">—</option>@for (t of config.types(); track t.id) { <option [value]="t.id">{{ config.label(t) }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
            <select class="select" name="practitioner" [ngModel]="form.value().practitionerId" (ngModelChange)="form.set('practitionerId', $event)">
              <option value="">{{ 'FD.LIST.ANY' | translate }}</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'SCHEDULE.FORM.DURATION_MINUTES' | translate }}</span>
            <input class="input" type="number" min="5" step="5" name="duration" [ngModel]="form.value().duration" (ngModelChange)="form.set('duration', +$event)" /></label>
        </div>
        <fieldset class="field"><legend class="label">{{ 'FD.LIST.WEEKDAYS' | translate }}</legend>
          <div class="flex flex-wrap gap-3">
            @for (d of days; track d) {
              <label class="flex items-center gap-1.5 text-sm"><input type="checkbox" [checked]="form.value().weekdays.has(d)" (change)="toggleDay(d, $any($event.target).checked)" /> {{ 'SET.HOURS.DAYS.' + d | translate }}</label>
            }
          </div>
          <span class="hint">{{ 'FD.LIST.WEEKDAYS_HINT' | translate }}</span></fieldset>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label">{{ 'FD.LIST.FROM_TIME' | translate }}</span><input class="input" type="time" name="from" [ngModel]="form.value().from" (ngModelChange)="form.set('from', $event)" /></label>
          <label class="field"><span class="label">{{ 'FD.LIST.TO_TIME' | translate }}</span><input class="input" type="time" name="to" [ngModel]="form.value().to" (ngModelChange)="form.set('to', $event)" /></label>
          <label class="field"><span class="label">{{ 'FD.LIST.URGENCY' | translate }}</span>
            <select class="select" name="urgency" [ngModel]="form.value().urgency" (ngModelChange)="form.set('urgency', $event)">
              @for (u of urgencies; track u) { <option [value]="u">{{ 'FD.LIST.URGENCIES.' + u | translate }}</option> }
            </select></label>
        </div>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="adding.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="wl-form" class="btn btn-primary" [disabled]="saving() || !patient()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="scheduling() !== null" [title]="'FD.LIST.SCHEDULE' | translate" (closed)="scheduling.set(null)">
      <form id="sched-form" class="grid gap-4 sm:grid-cols-2" (ngSubmit)="saveSchedule()">
        <p class="text-sm text-ink-700 sm:col-span-2"><strong>{{ scheduling()?.patientName }}</strong> · {{ scheduling()?.typeName }}</p>
        <label class="field sm:col-span-2"><span class="label label-required">{{ 'SCHEDULE.FORM.DATE_TIME' | translate }}</span>
          <input class="input" type="datetime-local" name="when" required [ngModel]="slot.value().when" (ngModelChange)="slot.set('when', $event)" /></label>
        <label class="field"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
          <select class="select" name="slotPractitioner" [ngModel]="slot.value().practitionerId" (ngModelChange)="slot.set('practitionerId', $event)">
            <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
          </select></label>
        <label class="field"><span class="label">{{ 'SCHEDULE.FORM.CHAIR' | translate }}</span>
          <select class="select" name="slotChair" [ngModel]="slot.value().chairId" (ngModelChange)="slot.set('chairId', $event)">
            <option value="">{{ 'SCHEDULE.FORM.NO_CHAIR' | translate }}</option>@for (c of config.chairs(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="scheduling.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="sched-form" class="btn btn-primary" [disabled]="saving() || !slot.value().when">{{ 'FD.LIST.SCHEDULE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class WaitingListComponent {
  private readonly api = inject(FrontDeskApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);
  protected readonly config = inject(AgendaConfigService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly days = DAYS;
  protected readonly urgencies = URGENCIES;
  protected readonly entries = loadable<WaitingEntry[]>([]);
  protected readonly adding = signal(false);
  protected readonly scheduling = signal<WaitingEntry | null>(null);
  protected readonly saving = signal(false);
  protected readonly patient = signal<PickedPatient | null>(null);
  protected readonly form = formState({ typeId: '', practitionerId: '', duration: 30, weekdays: new Set<number>(), from: '', to: '', urgency: 'NORMAL', notes: '' });
  protected readonly slot = formState({ when: '', practitionerId: '', chairId: '' });
  protected readonly canManage = computed(() => this.permissions.can('AGENDA_MANAGE'));

  constructor() {
    void this.reload();
    inject(LiveEventsService).of('waiting-list', 'appointment').pipe(takeUntilDestroyed()).subscribe(() => void this.reload());
  }

  private reload(): Promise<boolean> {
    return this.entries.load(() => this.api.waitingList());
  }

  protected pill(urgency: string): string {
    return URGENCY_PILL[urgency] ?? 'pill-idle';
  }

  protected preferences(e: WaitingEntry): string {
    const days = [...parseWeekdays(e.preferredWeekdays)].map(d => this.translate.instant('SET.HOURS.DAYS.' + d).slice(0, 3)).join(' ');
    const hours = e.preferredFrom || e.preferredTo ? `${(e.preferredFrom ?? '').slice(0, 5)}–${(e.preferredTo ?? '').slice(0, 5)}` : '';
    return [days, hours].filter(Boolean).join(' · ') || '—';
  }

  protected openAdd(): void {
    this.patient.set(null);
    this.form.reset({ typeId: '', practitionerId: '', duration: 30, weekdays: new Set(), from: '', to: '', urgency: 'NORMAL', notes: '' });
    this.adding.set(true);
  }

  protected pickType(id: string): void {
    this.form.set('typeId', id);
    const type = this.config.types().find(t => t.id === id);
    if (type) {
      this.form.set('duration', type.defaultDurationMinutes);
    }
  }

  protected toggleDay(day: number, on: boolean): void {
    const next = new Set(this.form.value().weekdays);
    if (on) {
      next.add(day);
    } else {
      next.delete(day);
    }
    this.form.set('weekdays', next);
  }

  protected async saveAdd(): Promise<void> {
    const f = this.form.value();
    const patient = this.patient();
    if (!patient) {
      return;
    }
    this.saving.set(true);
    try {
      await this.api.addToWaitingList({
        patientId: patient.id, appointmentTypeId: f.typeId || undefined, practitionerId: f.practitionerId || undefined, durationMinutes: f.duration,
        preferredWeekdays: formatWeekdays(f.weekdays), preferredFrom: f.from || undefined, preferredTo: f.to || undefined,
        urgency: f.urgency as WaitingEntry['urgency'], notes: f.notes.trim() || undefined,
      });
      this.adding.set(false);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(e: WaitingEntry): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('FD.LIST.REMOVE_CONFIRM', { name: e.patientName }), { danger: true }))) {
      return;
    }
    try {
      await this.api.removeFromWaitingList(e.id);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected openSchedule(e: WaitingEntry): void {
    this.slot.reset({ when: '', practitionerId: e.practitionerId ?? '', chairId: '' });
    this.scheduling.set(e);
  }

  protected async saveSchedule(): Promise<void> {
    const entry = this.scheduling();
    const s = this.slot.value();
    if (!entry || !s.when) {
      return;
    }
    const body = { dateTime: new Date(s.when).toISOString(), chairId: s.chairId || undefined, practitionerId: s.practitionerId || undefined };
    this.saving.set(true);
    try {
      await this.send(entry.id, body);
      this.scheduling.set(null);
      this.toast.success('✓');
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  /** A blocked slot (the doctor is on leave) is a warning the desk may overrule, not a wall. */
  private async send(id: string, body: { dateTime: string; chairId?: string; practitionerId?: string }): Promise<void> {
    try {
      await this.api.scheduleFromWaitingList(id, body);
    } catch (error) {
      const detail = (error as { status?: number; error?: { detail?: string } }).error?.detail ?? '';
      if ((error as { status?: number }).status === 409 && detail.startsWith('This slot is blocked')
        && (await this.confirm.confirm(detail, { confirmLabel: this.translate.instant('SCHEDULE.SCHEDULE_ANYWAY') }))) {
        await this.api.scheduleFromWaitingList(id, { ...body, ignoreBlocks: true });
        return;
      }
      throw error;
    }
  }
}
