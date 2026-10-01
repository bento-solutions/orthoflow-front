import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PatientService } from '../../../core/services/patient.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { Appointment, Patient } from '../../../core/models/patient.model';
import { TranslateModule } from '@ngx-translate/core';
import { IconComponent } from '../../../shared/ui/icon.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';

/**
 * Patient register.
 *
 * Built entirely from the shared primitives in `styles.css` — this screen
 * previously carried ~300 lines of local CSS including its own
 * `.btn-primary`, `.btn-secondary`, `.status-badge` and `.icon-btn`, none
 * of which matched the definitions on the neighbouring screens.
 */
@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslateModule, IconComponent, StatusPillComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'PATIENTS.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'PATIENTS.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-secondary" (click)="quickOpen.set(!quickOpen())"
                  [attr.aria-expanded]="quickOpen()" aria-controls="quick-add">
            <app-icon name="user-plus" [size]="16" />
            {{ 'PATIENTS.QUICK_ADD.BUTTON' | translate }}
          </button>
          <a class="btn btn-primary" routerLink="register">
            <app-icon name="user-plus" [size]="16" />
            {{ 'PATIENTS.ADD' | translate }}
          </a>
        </div>
      </header>

      <!-- Someone is in the chair and nothing is known but their name. The rest
           is learned in the consultation, or filled in later. -->
      @if (quickOpen()) {
        <form id="quick-add" class="quick-add" (ngSubmit)="quickAdd(false)" #quickForm="ngForm">
          <p class="quick-add-hint">{{ 'PATIENTS.QUICK_ADD.HINT' | translate }}</p>
          <div class="quick-add-fields">
            <label>
              <span>{{ 'PATIENTS.DOSSIER.FIRST_NAME' | translate }}</span>
              <input class="input" name="firstName" [(ngModel)]="quickFirst" required maxlength="255"
                     autocomplete="off" autofocus />
            </label>
            <label>
              <span>{{ 'PATIENTS.DOSSIER.LAST_NAME' | translate }}</span>
              <input class="input" name="lastName" [(ngModel)]="quickLast" required maxlength="255"
                     autocomplete="off" />
            </label>
          </div>
          <div class="quick-add-actions">
            <button type="submit" class="btn btn-secondary" [disabled]="!quickReady() || quickBusy()">
              {{ 'PATIENTS.QUICK_ADD.SUBMIT' | translate }}
            </button>
            @if (consultation.available()) {
              <button type="button" class="btn btn-primary" (click)="quickAdd(true)" [disabled]="!quickReady() || quickBusy()">
                {{ 'PATIENTS.QUICK_ADD.SUBMIT_CONSULT' | translate }}
              </button>
            }
          </div>
        </form>
      }

      <!-- Filters -->
      <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label class="search">
          <span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span>
          <app-icon name="search" [size]="16" />
          <input
            class="input"
            type="search"
            [placeholder]="'PATIENTS.SEARCH_PLACEHOLDER' | translate"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </label>

        <!-- Status filter doubles as the count readout: a practice owner
             wants to know how many patients are in active treatment, and
             this is where they are already looking. -->
        <div class="seg" role="group" [attr.aria-label]="'COMMON.FILTER' | translate">
          @for (f of filters; track f.value) {
            <button
              type="button"
              class="seg-item"
              [class.is-active]="statusFilter() === f.value"
              [attr.aria-pressed]="statusFilter() === f.value"
              (click)="statusFilter.set(f.value)"
            >
              {{ f.key | translate }}
              <span class="ms-1 tabular-nums opacity-60">{{ countFor(f.value) }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Table -->
      <div class="table-wrap">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{{ 'PATIENTS.NAME' | translate }}</th>
                <th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
                <th scope="col">{{ 'PATIENTS.NEXT_APPOINTMENT' | translate }}</th>
                <th scope="col">{{ 'PATIENTS.CONTACT' | translate }}</th>
                <th scope="col" class="cell-actions">
                  <span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (patient of visible(); track patient.id) {
                <!-- The row is a mouse convenience, not a control. Giving
                     the tr itself role="button" put an interactive element
                     inside an interactive element (axe nested-interactive)
                     and hid the row's own links from screen readers. The
                     accessible, keyboard-reachable primary action is the
                     name link below; the row click just forwards to it. -->
                <tr class="row-clickable" (click)="navigateToPatient(patient.id)">
                  <td>
                    <div class="flex items-center gap-3">
                      <span
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-petrol-50 text-2xs font-bold text-petrol-700 ring-1 ring-petrol-100"
                        aria-hidden="true"
                      >{{ initials(patient) }}</span>
                      <span class="flex min-w-0 flex-col leading-tight">
                        <a
                          class="truncate font-bold text-ink-900 no-underline hover:text-petrol-700"
                          [routerLink]="[patient.id]"
                          (click)="$event.stopPropagation()"
                        >{{ patient.firstName }} {{ patient.lastName }}</a>
                        <span class="mono text-2xs text-ink-500">#{{ patient.id }}</span>
                      </span>
                    </div>
                  </td>
                  <td [attr.data-label]="'COMMON.STATUS' | translate"><app-status-pill [status]="patient.status" /></td>
                  <td [attr.data-label]="'PATIENTS.NEXT_APPOINTMENT' | translate">
                    @if (nextAppointmentFor(patient.id); as appt) {
                      <span class="flex flex-col leading-tight">
                        <span class="font-semibold text-ink-900">{{ appt.dateTime | date: 'mediumDate' }}</span>
                        <span class="text-2xs text-ink-500">{{ appt.type }}</span>
                      </span>
                    } @else {
                      <span class="text-ink-400">—</span>
                    }
                  </td>
                  <td [attr.data-label]="'PATIENTS.CONTACT' | translate">
                    <span class="flex flex-col leading-tight">
                      <span class="text-ink-900">{{ patient.phone || '—' }}</span>
                      <span class="truncate text-2xs text-ink-500">{{ patient.email }}</span>
                    </span>
                  </td>
                  <td class="cell-actions">
                    <div class="flex justify-end gap-1">
                      <a
                        class="btn btn-ghost btn-icon"
                        [routerLink]="[patient.id, 'edit']"
                        (click)="$event.stopPropagation()"
                        [title]="'COMMON.EDIT' | translate"
                        [attr.aria-label]="('COMMON.EDIT' | translate) + ' — ' + patient.firstName + ' ' + patient.lastName"
                      >
                        <app-icon name="edit" [size]="16" />
                      </a>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="!p-0">
                    <div class="empty">
                      <span class="empty-icon"><app-icon name="users" [size]="20" /></span>
                      @if (hasAnyPatients()) {
                        <p class="empty-title">{{ 'PATIENTS.NO_MATCHES' | translate }}</p>
                        <p class="empty-text">{{ 'PATIENTS.NO_MATCHES_HINT' | translate }}</p>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="clearFilters()">
                          {{ 'COMMON.CLEAR_FILTERS' | translate }}
                        </button>
                      } @else {
                        <p class="empty-title">{{ 'PATIENTS.EMPTY_TITLE' | translate }}</p>
                        <p class="empty-text">{{ 'PATIENTS.EMPTY_TEXT' | translate }}</p>
                        <a class="btn btn-primary btn-sm" routerLink="register">
                          <app-icon name="user-plus" [size]="15" />
                          {{ 'PATIENTS.ADD' | translate }}
                        </a>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .quick-add {
      display: flex; flex-direction: column; gap: var(--space-3, .75rem);
      background: #fff; border: 1px solid rgb(var(--ink-200)); border-radius: 14px;
      padding: var(--space-4, 1rem); margin-bottom: var(--space-4, 1rem); max-width: 40rem;
    }
    .quick-add-hint { margin: 0; font-size: .875rem; color: rgb(var(--ink-600)); }
    .quick-add-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .quick-add-fields label { display: flex; flex-direction: column; gap: .25rem; font-size: .8125rem; font-weight: 600; color: rgb(var(--ink-700)); }
    .quick-add-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
    @media (max-width: 520px) { .quick-add-fields { grid-template-columns: 1fr; } }
    /* Below the table breakpoint each row becomes a card. Header cells are
       hidden, so each value carries its own label via data-label. */
    @media (max-width: 767px) {
      .table-wrap { border: 0; box-shadow: none; background: transparent; }
      .data-table thead { display: none; }
      .data-table tbody tr {
        display: block;
        margin-bottom: var(--space-3);
        padding: var(--space-3);
        background: var(--surface);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .data-table tbody tr:hover { box-shadow: var(--shadow-md); }
      .data-table tbody td {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-1) 0;
        border: 0;
      }
      .data-table tbody td[data-label] { justify-content: space-between; }
      .data-table tbody td[data-label]::before {
        content: attr(data-label);
        font-size: var(--text-2xs);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .data-table tbody td:first-child { padding-bottom: var(--space-2); }
      .data-table tbody td:first-child::before { display: none; }
      .cell-actions { justify-content: flex-end; }
    }
  `],
})
export class PatientListComponent {
  readonly patientService = inject(PatientService);
  private readonly scheduleService = inject(ScheduleService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly consultation = inject(ConsultationService);

  readonly quickOpen = signal(false);
  readonly quickBusy = signal(false);
  quickFirst = '';
  quickLast = '';

  constructor() {
    void this.consultation.loadConfig();
  }

  readonly query = signal('');
  readonly statusFilter = signal<'ALL' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED'>('ALL');

  readonly filters = [
    { value: 'ALL', key: 'COMMON.ALL' },
    { value: 'ACTIVE', key: 'STATUS.ACTIVE' },
    { value: 'ON_HOLD', key: 'STATUS.ON_HOLD' },
    { value: 'COMPLETED', key: 'STATUS.COMPLETED' },
  ] as const;

  readonly hasAnyPatients = computed(() => this.patientService.patients().length > 0);

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const status = this.statusFilter();
    return this.patientService.patients().filter((p) => {
      if (status !== 'ALL' && p.status !== status) return false;
      if (!q) return true;
      return [p.firstName, p.lastName, p.email, p.phone, p.id]
        .some((v) => (v ?? '').toString().toLowerCase().includes(q));
    });
  });

  quickReady(): boolean {
    return this.quickFirst.trim().length > 0 && this.quickLast.trim().length > 0;
  }

  /**
   * Registers a patient from a first and last name alone and opens their
   * dossier, optionally straight into the consultation prompt. Everything else
   * the registration form asks for is optional on the server; the consultation
   * is where most of it is learned.
   */
  quickAdd(thenConsult: boolean): void {
    if (!this.quickReady() || this.quickBusy()) return;
    this.quickBusy.set(true);
    this.patientService
      .addPatient({ firstName: this.quickFirst.trim(), lastName: this.quickLast.trim() })
      .subscribe({
        next: (patient) => {
          this.quickBusy.set(false);
          this.quickFirst = '';
          this.quickLast = '';
          this.quickOpen.set(false);
          void this.router.navigate(['/patients', patient.id], thenConsult ? { queryParams: { consultation: 1 } } : {});
        },
        error: (err) => {
          this.quickBusy.set(false);
          this.toast.error(err?.error?.detail || err?.error?.message || 'Could not add the patient.');
        },
      });
  }

  countFor(value: string): number {
    const all = this.patientService.patients();
    return value === 'ALL' ? all.length : all.filter((p) => p.status === value).length;
  }

  initials(p: Patient): string {
    return `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();
  }

  nextAppointmentFor(patientId: string): Appointment | null {
    const now = Date.now();
    return (
      this.scheduleService
        .appointments()
        .filter(
          (a) =>
            a.patientId === patientId &&
            a.status !== 'CANCELLED' &&
            new Date(a.dateTime).getTime() >= now,
        )
        .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())[0] ?? null
    );
  }

  clearFilters(): void {
    this.query.set('');
    this.statusFilter.set('ALL');
  }

  navigateToPatient(patientId: string): void {
    // Router.navigate() resolves a relative array against the root route,
    // not the current one (unlike routerLink) — without the leading segment
    // this silently missed every route and fell through to the wildcard
    // redirect to '/', landing on the dashboard instead of the dossier.
    this.router.navigate(['/patients', patientId]);
  }
}
