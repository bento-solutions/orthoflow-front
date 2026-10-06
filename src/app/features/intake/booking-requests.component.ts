import { Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AgendaConfigService } from '../../core/services/agenda-config.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { BOOKING_STATUSES, BookingRequest, IntakeApi } from '../../core/services/intake-api.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { NavCounts } from '../../core/services/nav-counts.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { ToastService } from '../../core/services/toast.service';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PatientDirectoryApi, DirectoryRow } from '../patients/patient-directory-api.service';

/** A moment as the `datetime-local` input wants it (`yyyy-MM-ddTHH:mm`, the viewer's own clock). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What to search the register by to find a patient this request might be: the phone first, since names are spelled many ways. */
export function matchTerm(request: Pick<BookingRequest, 'phone' | 'lastName'>): string[] {
  return [request.phone, request.lastName].map(t => (t ?? '').trim()).filter(t => t.length >= 3);
}

/**
 * Appointment requests that came from the public booking page. Nothing is booked until someone
 * confirms: confirming creates the appointment (and the patient, unless an existing one is
 * chosen), then tells the person; declining says why. A request whose time was taken in the
 * meantime is flagged, and confirming it picks another time.
 */
@Component({
  selector: 'app-booking-requests',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, IconComponent, ModalComponent],
  template: `
    <div class="seg mb-4" role="group" [attr.aria-label]="'COMMON.STATUS' | translate">
      @for (s of statuses; track s) {
        <button type="button" class="seg-item" [class.is-active]="status() === s" [attr.aria-pressed]="status() === s" (click)="status.set(s)">{{ 'INT.BOOK.STATUSES.' + s | translate }}</button>
      }
    </div>

    <ul class="space-y-3" [attr.aria-busy]="requests.loading()">
      @for (r of requests.data(); track r.id) {
        <li class="card">
          <div class="flex flex-wrap items-start justify-between gap-3 p-4">
            <div class="min-w-0">
              <p class="text-base font-bold text-ink-900">{{ r.firstName }} {{ r.lastName }}</p>
              <p class="text-sm text-ink-600">
                @if (r.phone) { <a class="no-underline hover:text-petrol-700" [href]="'tel:' + r.phone">{{ r.phone }}</a> }
                @if (r.email) { · {{ r.email }} }
                @if (r.dateOfBirth) { · {{ r.dateOfBirth | date: 'mediumDate' }} }
              </p>
              @if (r.note) { <p class="mt-1 text-sm text-ink-700">« {{ r.note }} »</p> }
            </div>
            <div class="text-end">
              <p class="font-semibold text-ink-900">{{ r.startsAt | date: 'EEEE d MMMM, HH:mm' }}</p>
              <p class="text-sm text-ink-600">{{ r.typeName }} · {{ r.durationMinutes }} min@if (r.practitionerName) { · {{ r.practitionerName }} }</p>
              <p class="text-xs text-ink-500">{{ 'INT.BOOK.RECEIVED' | translate: { at: (r.createdAt | date: 'short') } }}</p>
            </div>
          </div>
          @if (r.status === 'PENDING') {
            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-3">
              @if (!r.slotStillFree) { <p class="text-sm font-semibold text-caution-700" role="note">{{ 'INT.BOOK.SLOT_TAKEN' | translate }}</p> } @else { <span></span> }
              <span class="flex gap-2">
                <button type="button" class="btn btn-ghost btn-sm" (click)="openDecline(r)">{{ 'INT.BOOK.DECLINE' | translate }}</button>
                <button type="button" class="btn btn-primary btn-sm" (click)="openConfirm(r)">{{ 'INT.BOOK.CONFIRM' | translate }}</button>
              </span>
            </div>
          } @else if (r.status === 'DECLINED' && r.declineReason) {
            <p class="border-t border-ink-100 px-4 py-2 text-sm text-ink-600">{{ 'INT.BOOK.REASON' | translate }} : {{ r.declineReason }}</p>
          } @else if (r.status === 'CONFIRMED' && r.patientId) {
            <p class="border-t border-ink-100 px-4 py-2 text-sm"><a class="text-petrol-700 no-underline hover:underline" [routerLink]="['/patients', r.patientId]">{{ 'INT.BOOK.OPEN_PATIENT' | translate }}</a></p>
          }
        </li>
      } @empty {
        @if (!requests.loading()) { <li class="empty"><span class="empty-icon"><app-icon name="inbox" [size]="20" /></span><p class="empty-title">{{ 'INT.BOOK.EMPTY' | translate }}</p></li> }
      }
    </ul>

    <app-modal [open]="confirming() !== null" [title]="'INT.BOOK.CONFIRM_TITLE' | translate" size="md" [dismissable]="!busy()" (closed)="confirming.set(null)">
      @if (confirming(); as r) {
        <form id="confirm-form" class="space-y-4" (ngSubmit)="confirm()">
          <p class="text-sm text-ink-700"><strong>{{ r.firstName }} {{ r.lastName }}</strong> · {{ r.typeName }}</p>
          <fieldset class="field">
            <legend class="label">{{ 'INT.BOOK.WHO' | translate }}</legend>
            <label class="flex items-center gap-2 text-sm"><input type="radio" name="who" [checked]="patientChoice() === ''" (change)="patientChoice.set('')" /> {{ 'INT.BOOK.NEW_PATIENT' | translate }}</label>
            @for (m of matches(); track m.id) {
              <label class="flex items-center gap-2 text-sm"><input type="radio" name="who" [checked]="patientChoice() === m.id" (change)="patientChoice.set(m.id)" />
                <span>{{ m.firstName }} {{ m.lastName }} <span class="text-xs text-ink-500">{{ m.patientCode }} · {{ m.phone }}</span></span></label>
            }
          </fieldset>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="field"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
              <select class="select" name="doctor" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
                <option value="">{{ 'INT.BOOK.ANY_FREE' | translate }}</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
              </select></label>
            <label class="field"><span class="label">{{ 'SCHEDULE.FORM.CHAIR' | translate }}</span>
              <select class="select" name="chair" [ngModel]="chairId()" (ngModelChange)="chairId.set($event)">
                <option value="">{{ 'SCHEDULE.FORM.NO_CHAIR' | translate }}</option>@for (c of config.chairs(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
              </select></label>
          </div>
          <label class="field"><span class="label">{{ 'SCHEDULE.FORM.DATE_TIME' | translate }}</span>
            <input class="input" type="datetime-local" name="when" required [ngModel]="startsAt()" (ngModelChange)="startsAt.set($event)" /></label>
          <label class="flex items-start gap-2 text-sm text-ink-700"><input type="checkbox" class="mt-0.5" name="ignore" [ngModel]="ignoreBlocks()" (ngModelChange)="ignoreBlocks.set($event)" /><span>{{ 'INT.BOOK.IGNORE_BLOCKS' | translate }}</span></label>
        </form>
      }
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="confirming.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="confirm-form" class="btn btn-primary" [disabled]="busy() || !startsAt()">{{ 'INT.BOOK.CONFIRM' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="declining() !== null" [title]="'INT.BOOK.DECLINE_TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="declining.set(null)">
      <form id="decline-form" class="space-y-3" (ngSubmit)="decline()">
        <p class="text-sm text-ink-600">{{ 'INT.BOOK.DECLINE_HINT' | translate }}</p>
        <label class="field"><span class="label">{{ 'INT.BOOK.REASON' | translate }}</span><textarea class="textarea" rows="3" name="reason" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="declining.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="decline-form" class="btn btn-danger" [disabled]="busy()">{{ 'INT.BOOK.DECLINE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class BookingRequestsComponent {
  private readonly api = inject(IntakeApi);
  private readonly directory = inject(PatientDirectoryApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly counts = inject(NavCounts);
  protected readonly practitioners = inject(PractitionerService);
  protected readonly config = inject(AgendaConfigService);

  protected readonly statuses = BOOKING_STATUSES;
  protected readonly status = signal<string>('PENDING');
  protected readonly requests = loadable<BookingRequest[]>([]);
  protected readonly busy = signal(false);

  protected readonly confirming = signal<BookingRequest | null>(null);
  protected readonly matches = signal<DirectoryRow[]>([]);
  protected readonly patientChoice = signal('');
  protected readonly practitionerId = signal('');
  protected readonly chairId = signal('');
  protected readonly startsAt = signal('');
  protected readonly ignoreBlocks = signal(false);

  protected readonly declining = signal<BookingRequest | null>(null);
  protected readonly reason = signal('');

  constructor() {
    effect(() => {
      const status = this.status();
      untracked(() => void this.requests.load(() => this.api.bookingRequests(status)));
    });
    refreshOnLive(['booking-request'], () => void this.requests.load(() => this.api.bookingRequests(this.status())));
  }

  protected async openConfirm(r: BookingRequest): Promise<void> {
    this.patientChoice.set('');
    this.practitionerId.set(r.practitionerId ?? '');
    this.chairId.set('');
    this.startsAt.set(toLocalInput(r.startsAt));
    this.ignoreBlocks.set(false);
    this.matches.set([]);
    this.confirming.set(r);
    // Someone with this phone number or surname may already be a patient: offer them, never assume.
    try {
      const found = new Map<string, DirectoryRow>();
      for (const term of matchTerm(r)) {
        for (const row of (await this.directory.list({ search: term, size: 5 })).content) {
          found.set(row.id, row);
        }
      }
      if (this.confirming()?.id === r.id) {
        this.matches.set([...found.values()].slice(0, 5));
      }
    } catch {
      /* the choice stays "new patient" */
    }
  }

  protected async confirm(): Promise<void> {
    const r = this.confirming();
    if (!r || this.busy() || !this.startsAt()) {
      return;
    }
    await this.run(async () => {
      await this.api.confirmBooking(r.id, {
        patientId: this.patientChoice() || undefined,
        practitionerId: this.practitionerId() || undefined,
        chairId: this.chairId() || undefined,
        startsAt: new Date(this.startsAt()).toISOString(),
        ignoreBlocks: this.ignoreBlocks(),
      });
      this.confirming.set(null);
      this.toast.success(this.translate.instant('INT.BOOK.CONFIRMED'));
    });
  }

  protected openDecline(r: BookingRequest): void {
    this.reason.set('');
    this.declining.set(r);
  }

  protected async decline(): Promise<void> {
    const r = this.declining();
    if (!r || this.busy()) {
      return;
    }
    await this.run(async () => {
      await this.api.declineBooking(r.id, this.reason().trim());
      this.declining.set(null);
      this.toast.success(this.translate.instant('INT.BOOK.DECLINED'));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await Promise.all([this.requests.load(() => this.api.bookingRequests(this.status())), this.counts.refreshIntake()]);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
