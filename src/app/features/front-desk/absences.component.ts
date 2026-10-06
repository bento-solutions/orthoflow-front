import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { ABSENCE_REASONS, Absence, ClinicEvent, FrontDeskApi } from './front-desk-api.service';

/** The next three months from the start of last month, which is the window both lists show. */
export function absenceWindow(today: Date = new Date()): { from: Date; to: Date } {
  return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth() + 3, 1) };
}

/**
 * When a practitioner is away, and when the whole clinic is closed. A slot inside either is
 * blocked in the agenda and on the online booking page; the desk can still overrule it for a
 * single appointment, with a warning.
 */
@Component({
  selector: 'app-absences',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent, ModalComponent],
  template: `
    <section class="card">
      <div class="card-head">
        <div><h2 class="text-lg font-bold text-ink-900">{{ 'FD.ABS.TITLE' | translate }}</h2><p class="text-sm text-ink-500">{{ 'FD.ABS.HINT' | translate }}</p></div>
        <button type="button" class="btn btn-primary btn-sm" (click)="openAbsence()"><app-icon name="plus" [size]="15" /> {{ 'FD.ABS.ADD' | translate }}</button>
      </div>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>{{ 'COMMON.PRACTITIONER' | translate }}</th><th>{{ 'COMMON.FROM' | translate }}</th><th>{{ 'COMMON.TO' | translate }}</th><th>{{ 'COMMON.REASON' | translate }}</th><th class="cell-actions"></th></tr></thead>
          <tbody>
            @for (a of absences.data(); track a.id) {
              <tr>
                <td class="font-semibold">{{ a.practitionerName }}</td><td>{{ a.startsAt | date: 'short' }}</td><td>{{ a.endsAt | date: 'short' }}</td>
                <td>{{ 'FD.ABS.REASONS.' + a.reason | translate }}@if (a.notes) { <span class="block text-xs text-ink-500">{{ a.notes }}</span> }</td>
                <td class="cell-actions"><button type="button" class="btn btn-ghost btn-icon" (click)="removeAbsence(a)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + a.practitionerName"><app-icon name="trash" [size]="16" /></button></td>
              </tr>
            } @empty { <tr><td colspan="5" class="py-6 text-center text-ink-500">{{ 'FD.ABS.EMPTY' | translate }}</td></tr> }
          </tbody>
        </table>
      </div></div>
    </section>

    <section class="card mt-6">
      <div class="card-head">
        <div><h2 class="text-lg font-bold text-ink-900">{{ 'FD.EVENTS.TITLE' | translate }}</h2><p class="text-sm text-ink-500">{{ 'FD.EVENTS.HINT' | translate }}</p></div>
        <button type="button" class="btn btn-primary btn-sm" (click)="openEvent()"><app-icon name="plus" [size]="15" /> {{ 'FD.EVENTS.ADD' | translate }}</button>
      </div>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>{{ 'FD.EVENTS.NAME' | translate }}</th><th>{{ 'COMMON.FROM' | translate }}</th><th>{{ 'COMMON.TO' | translate }}</th><th class="cell-actions"></th></tr></thead>
          <tbody>
            @for (e of events.data(); track e.id) {
              <tr>
                <td class="font-semibold"><span class="me-2 inline-block h-2.5 w-2.5 rounded-full" [style.background]="e.color || '#64748b'" aria-hidden="true"></span>{{ e.title }}</td>
                <td>{{ e.startsAt | date: 'short' }}</td><td>{{ e.endsAt | date: 'short' }}</td>
                <td class="cell-actions"><button type="button" class="btn btn-ghost btn-icon" (click)="removeEvent(e)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + e.title"><app-icon name="trash" [size]="16" /></button></td>
              </tr>
            } @empty { <tr><td colspan="4" class="py-6 text-center text-ink-500">{{ 'FD.EVENTS.EMPTY' | translate }}</td></tr> }
          </tbody>
        </table>
      </div></div>
    </section>

    <app-modal [open]="absenceOpen()" [title]="'FD.ABS.ADD' | translate" (closed)="absenceOpen.set(false)">
      <form id="abs-form" class="grid gap-4 sm:grid-cols-2" (ngSubmit)="saveAbsence()">
        <label class="field sm:col-span-2"><span class="label label-required">{{ 'COMMON.PRACTITIONER' | translate }}</span>
          <select class="select" name="practitioner" required [ngModel]="abs.value().practitionerId" (ngModelChange)="abs.set('practitionerId', $event)">
            <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
          </select></label>
        <label class="field"><span class="label label-required">{{ 'COMMON.FROM' | translate }}</span><input class="input" type="datetime-local" name="from" required [ngModel]="abs.value().from" (ngModelChange)="abs.set('from', $event)" /></label>
        <label class="field"><span class="label label-required">{{ 'COMMON.TO' | translate }}</span><input class="input" type="datetime-local" name="to" required [ngModel]="abs.value().to" (ngModelChange)="abs.set('to', $event)" /></label>
        <label class="field sm:col-span-2"><span class="label">{{ 'COMMON.REASON' | translate }}</span>
          <select class="select" name="reason" [ngModel]="abs.value().reason" (ngModelChange)="abs.set('reason', $event)">
            @for (r of reasons; track r) { <option [value]="r">{{ 'FD.ABS.REASONS.' + r | translate }}</option> }
          </select></label>
        <label class="field sm:col-span-2"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="abs.value().notes" (ngModelChange)="abs.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="absenceOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="abs-form" class="btn btn-primary" [disabled]="saving() || !abs.value().practitionerId || !abs.value().from || !abs.value().to">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="eventOpen()" [title]="'FD.EVENTS.ADD' | translate" (closed)="eventOpen.set(false)">
      <form id="evt-form" class="grid gap-4 sm:grid-cols-2" (ngSubmit)="saveEvent()">
        <label class="field sm:col-span-2"><span class="label label-required">{{ 'FD.EVENTS.NAME' | translate }}</span><input class="input" name="title" required maxlength="200" [ngModel]="evt.value().title" (ngModelChange)="evt.set('title', $event)" /></label>
        <label class="field"><span class="label label-required">{{ 'COMMON.FROM' | translate }}</span><input class="input" type="datetime-local" name="efrom" required [ngModel]="evt.value().from" (ngModelChange)="evt.set('from', $event)" /></label>
        <label class="field"><span class="label label-required">{{ 'COMMON.TO' | translate }}</span><input class="input" type="datetime-local" name="eto" required [ngModel]="evt.value().to" (ngModelChange)="evt.set('to', $event)" /></label>
        <label class="field"><span class="label">{{ 'SET.TEAM.COLOR' | translate }}</span><input class="input h-10 p-1" type="color" name="ecolor" [ngModel]="evt.value().color" (ngModelChange)="evt.set('color', $event)" /></label>
        <label class="field sm:col-span-2"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="enotes" [ngModel]="evt.value().notes" (ngModelChange)="evt.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="eventOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="evt-form" class="btn btn-primary" [disabled]="saving() || !evt.value().title.trim() || !evt.value().from || !evt.value().to">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class AbsencesComponent {
  private readonly api = inject(FrontDeskApi);
  private readonly errors = inject(ApiErrors);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly reasons = ABSENCE_REASONS;
  protected readonly absences = loadable<Absence[]>([]);
  protected readonly events = loadable<ClinicEvent[]>([]);
  protected readonly absenceOpen = signal(false);
  protected readonly eventOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly abs = formState({ practitionerId: '', from: '', to: '', reason: 'LEAVE', notes: '' });
  protected readonly evt = formState({ title: '', from: '', to: '', color: '#64748b', notes: '' });

  constructor() {
    void this.reload();
  }

  private async reload(): Promise<void> {
    const { from, to } = absenceWindow();
    await Promise.all([this.absences.load(() => this.api.absences(from, to)), this.events.load(() => this.api.events(from, to))]);
  }

  protected openAbsence(): void {
    this.abs.reset({ practitionerId: '', from: '', to: '', reason: 'LEAVE', notes: '' });
    this.absenceOpen.set(true);
  }

  protected openEvent(): void {
    this.evt.reset({ title: '', from: '', to: '', color: '#64748b', notes: '' });
    this.eventOpen.set(true);
  }

  protected async saveAbsence(): Promise<void> {
    const f = this.abs.value();
    await this.run(async () => {
      await this.api.addAbsence({
        practitionerId: f.practitionerId, startsAt: new Date(f.from).toISOString(), endsAt: new Date(f.to).toISOString(),
        reason: f.reason as Absence['reason'], notes: f.notes.trim() || undefined,
      });
      this.absenceOpen.set(false);
    });
  }

  protected async saveEvent(): Promise<void> {
    const f = this.evt.value();
    await this.run(async () => {
      await this.api.addEvent({ title: f.title.trim(), startsAt: new Date(f.from).toISOString(), endsAt: new Date(f.to).toISOString(), color: f.color, notes: f.notes.trim() || undefined });
      this.eventOpen.set(false);
    });
  }

  protected async removeAbsence(a: Absence): Promise<void> {
    if (await this.confirm.confirm(this.translate.instant('COMMON.DELETE_CONFIRM'), { danger: true })) {
      await this.run(() => this.api.removeAbsence(a.id));
    }
  }

  protected async removeEvent(e: ClinicEvent): Promise<void> {
    if (await this.confirm.confirm(this.translate.instant('COMMON.DELETE_CONFIRM'), { danger: true })) {
      await this.run(() => this.api.removeEvent(e.id));
    }
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.saving.set(true);
    try {
      await action();
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }
}
