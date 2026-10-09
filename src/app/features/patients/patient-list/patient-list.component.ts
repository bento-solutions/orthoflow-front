import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { PatientService } from '../../../core/services/patient.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { PermissionService } from '../../../core/services/permission.service';
import { PractitionerService } from '../../../core/services/practitioner.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { loadable } from '../../../core/utils/loadable';
import { MoneyPipe, NumPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';
import { DirectoryKpis, DirectoryPage, DirectoryQuery, DirectoryRow, Insurer, PatientDirectoryApi } from '../patient-directory-api.service';

const PAGE_SIZE = 25;
const SORTS = ['name', 'code', 'created', 'age', 'progress', 'balance', 'next', 'last'] as const;

/**
 * Patient register.
 *
 * Reads the server-side directory, so a clinic with thousands of patients is searched, filtered and
 * paged in the database rather than in the browser. A balance, a treatment progress and the next
 * appointment come with each row. The balance and the debt filter are shown only to those who may
 * see billing: an assistant at the desk who cannot read the takings does not see a patient's debt
 * list either.
 */
@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [DatePipe, RouterModule, FormsModule, TranslateModule, IconComponent, StatusPillComponent, MoneyPipe, NumPipe],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'PATIENTS.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'PATIENTS.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          @if (canMerge()) {
            <a class="btn btn-secondary" routerLink="duplicates" data-tour="patients-duplicates">
              {{ 'PAT.DUPLICATES' | translate }}
              @if (duplicateCount() > 0) { <span class="pill pill-attention pill-nodot ms-1">{{ duplicateCount() }}</span> }
            </a>
          }
          <button type="button" class="btn btn-secondary" (click)="quickOpen.set(!quickOpen())" [attr.aria-expanded]="quickOpen()" aria-controls="quick-add">
            <app-icon name="user-plus" [size]="16" />
            {{ 'PATIENTS.QUICK_ADD.BUTTON' | translate }}
          </button>
          <a class="btn btn-primary" routerLink="register" data-tour="patients-add">
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
              <input class="input" name="firstName" [(ngModel)]="quickFirst" required maxlength="255" autocomplete="off" autofocus />
            </label>
            <label>
              <span>{{ 'PATIENTS.DOSSIER.LAST_NAME' | translate }}</span>
              <input class="input" name="lastName" [(ngModel)]="quickLast" required maxlength="255" autocomplete="off" />
            </label>
          </div>
          <div class="quick-add-actions">
            <button type="submit" class="btn btn-secondary" [disabled]="!quickReady() || quickBusy()">{{ 'PATIENTS.QUICK_ADD.SUBMIT' | translate }}</button>
            @if (consultation.available()) {
              <button type="button" class="btn btn-primary" (click)="quickAdd(true)" [disabled]="!quickReady() || quickBusy()">{{ 'PATIENTS.QUICK_ADD.SUBMIT_CONSULT' | translate }}</button>
            }
          </div>
        </form>
      }

      @if (kpis(); as k) {
        <section class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4" [attr.aria-label]="'PAT.KPI.LABEL' | translate">
          <div class="tile p-4"><p class="kpi-label">{{ 'PAT.KPI.TOTAL' | translate }}</p><p class="kpi-value">{{ k.total | num: 0 }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'PAT.KPI.NEW' | translate }}</p><p class="kpi-value">{{ k.newThisMonth | num: 0 }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'PAT.KPI.AGE' | translate }}</p><p class="kpi-value">{{ k.averageAge | num: 1 }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'PAT.KPI.GENDER' | translate }}</p><p class="kpi-value">{{ k.female | num: 0 }} <span class="text-sm font-semibold text-ink-500">{{ 'PAT.F' | translate }}</span> · {{ k.male | num: 0 }} <span class="text-sm font-semibold text-ink-500">{{ 'PAT.M' | translate }}</span></p></div>
        </section>
      }

      <!-- Filters -->
      <div class="mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <label class="search" data-tour="patients-search">
          <span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span>
          <app-icon name="search" [size]="16" />
          <input class="input" type="search" [placeholder]="'PATIENTS.SEARCH_PLACEHOLDER' | translate" [ngModel]="searchInput()" (ngModelChange)="searchInput.set($event)" />
        </label>

        <div class="seg" role="group" [attr.aria-label]="'COMMON.FILTER' | translate">
          @for (f of filters; track f.value) {
            <button type="button" class="seg-item" [class.is-active]="status() === f.value" [attr.aria-pressed]="status() === f.value" (click)="setStatus(f.value)">{{ f.key | translate }}</button>
          }
        </div>

        <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event); page.set(0)" [attr.aria-label]="'COMMON.PRACTITIONER' | translate">
          <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
          @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
        </select>
        <select class="select w-auto" [ngModel]="insurerId()" (ngModelChange)="insurerId.set($event); page.set(0)" [attr.aria-label]="'PAT.INSURER' | translate">
          <option value="">{{ 'PAT.ALL_INSURERS' | translate }}</option>
          @for (i of insurers(); track i.id) { <option [value]="i.id">{{ i.name }}</option> }
        </select>
        <select class="select w-auto" [ngModel]="gender()" (ngModelChange)="gender.set($event); page.set(0)" [attr.aria-label]="'PAT.GENDER' | translate">
          <option value="">{{ 'PAT.ANY_GENDER' | translate }}</option>
          <option value="F">{{ 'PAT.FEMALE' | translate }}</option>
          <option value="M">{{ 'PAT.MALE' | translate }}</option>
        </select>
        @if (canSeeMoney()) {
          <label class="flex items-center gap-1.5 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="debtOnly()" (ngModelChange)="debtOnly.set($event); page.set(0)" /> {{ 'PAT.DEBT_ONLY' | translate }}</label>
        }
        <label class="flex items-center gap-1.5 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="landingPageOnly()" (ngModelChange)="landingPageOnly.set($event); page.set(0)" /> {{ 'PAT.LANDING_ONLY' | translate }}</label>
        <label class="flex items-center gap-2 text-sm text-ink-600 lg:ms-auto">
          {{ 'PAT.SORT' | translate }}
          <select class="select w-auto" [ngModel]="sort()" (ngModelChange)="sort.set($event); page.set(0)">
            @for (s of sorts; track s) { <option [value]="s">{{ 'PAT.SORTS.' + s | translate }}</option> }
          </select>
          <button type="button" class="btn btn-ghost btn-icon" (click)="toggleDir()" [attr.aria-label]="'PAT.DIRECTION' | translate" [title]="'PAT.DIRECTION' | translate">
            <app-icon [name]="dir() === 'asc' ? 'chevron-up' : 'chevron-down'" [size]="16" />
          </button>
        </label>
      </div>

      <!-- Table -->
      <div class="table-wrap" [attr.aria-busy]="directory.loading()">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{{ 'PATIENTS.NAME' | translate }}</th>
                <th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
                <th scope="col">{{ 'PAT.PRACTITIONER' | translate }}</th>
                <th scope="col">{{ 'PAT.PROGRESS' | translate }}</th>
                <th scope="col">{{ 'PATIENTS.NEXT_APPOINTMENT' | translate }}</th>
                <th scope="col">{{ 'PATIENTS.CONTACT' | translate }}</th>
                @if (canSeeMoney()) { <th scope="col" class="cell-num">{{ 'PAT.BALANCE' | translate }}</th> }
                <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (patient of rows(); track patient.id) {
                <!-- The row is a mouse convenience, not a control; the name link is the accessible, keyboard-reachable primary action. -->
                <tr class="row-clickable" (click)="navigateToPatient(patient.id)">
                  <td>
                    <div class="flex items-center gap-3">
                      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-petrol-50 text-2xs font-bold text-petrol-700 ring-1 ring-petrol-100" aria-hidden="true">{{ initials(patient) }}</span>
                      <span class="flex min-w-0 flex-col leading-tight">
                        <a class="truncate font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="[patient.id]" (click)="$event.stopPropagation()">{{ patient.firstName }} {{ patient.lastName }}</a>
                        <span class="mono text-2xs text-ink-500">{{ patient.patientCode }}@if (patient.age !== null) { · {{ patient.age }} {{ 'PAT.YEARS' | translate }} }</span>
                      </span>
                    </div>
                  </td>
                  <td [attr.data-label]="'COMMON.STATUS' | translate"><app-status-pill [status]="patient.status" /></td>
                  <td [attr.data-label]="'PAT.PRACTITIONER' | translate">{{ patient.primaryPractitionerName || '—' }}</td>
                  <td [attr.data-label]="'PAT.PROGRESS' | translate">
                    <span class="flex items-center gap-2" [attr.title]="patient.progress + ' %'">
                      <span class="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100"><span class="block h-full rounded-full bg-petrol-500" [style.width.%]="patient.progress"></span></span>
                      <span class="text-2xs tabular-nums text-ink-500">{{ patient.progress }}%</span>
                    </span>
                  </td>
                  <td [attr.data-label]="'PATIENTS.NEXT_APPOINTMENT' | translate">
                    @if (patient.nextAppointment) {
                      <span class="font-semibold text-ink-900">{{ patient.nextAppointment | date: 'mediumDate' }}</span>
                    } @else { <span class="text-ink-400">—</span> }
                  </td>
                  <td [attr.data-label]="'PATIENTS.CONTACT' | translate">
                    <span class="flex flex-col leading-tight">
                      <span class="text-ink-900">{{ patient.phone || '—' }}</span>
                      <span class="truncate text-2xs text-ink-500">{{ patient.email }}</span>
                    </span>
                  </td>
                  @if (canSeeMoney()) {
                    <td class="cell-num" [attr.data-label]="'PAT.BALANCE' | translate">
                      @if (patient.balanceDue > 0) { <span class="font-bold text-critical-700">{{ patient.balanceDue | money }}</span> }
                      @else if (patient.credit > 0) { <span class="text-positive-700" [attr.title]="'PAT.CREDIT' | translate">+{{ patient.credit | money }}</span> }
                      @else { <span class="text-ink-400">—</span> }
                    </td>
                  }
                  <td class="cell-actions">
                    <div class="flex justify-end gap-1">
                      <a class="btn btn-ghost btn-icon" [routerLink]="[patient.id, 'edit']" (click)="$event.stopPropagation()" [title]="'COMMON.EDIT' | translate"
                        [attr.aria-label]="('COMMON.EDIT' | translate) + ' — ' + patient.firstName + ' ' + patient.lastName">
                        <app-icon name="edit" [size]="16" />
                      </a>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="!p-0">
                    <div class="empty">
                      <span class="empty-icon"><app-icon name="users" [size]="20" /></span>
                      @if (filtered()) {
                        <p class="empty-title">{{ 'PATIENTS.NO_MATCHES' | translate }}</p>
                        <p class="empty-text">{{ 'PATIENTS.NO_MATCHES_HINT' | translate }}</p>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="clearFilters()">{{ 'COMMON.CLEAR_FILTERS' | translate }}</button>
                      } @else if (!directory.loading()) {
                        <p class="empty-title">{{ 'PATIENTS.EMPTY_TITLE' | translate }}</p>
                        <p class="empty-text">{{ 'PATIENTS.EMPTY_TEXT' | translate }}</p>
                        <a class="btn btn-primary btn-sm" routerLink="register"><app-icon name="user-plus" [size]="15" /> {{ 'PATIENTS.ADD' | translate }}</a>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      @if (pageInfo(); as p) {
        <nav class="mt-4 flex items-center justify-between text-sm text-ink-600" [attr.aria-label]="'PAT.PAGES' | translate">
          <span>{{ 'PAT.SHOWING' | translate: { from: p.from, to: p.to, total: p.total } }}</span>
          <span class="flex items-center gap-2">
            <button type="button" class="btn btn-secondary btn-sm" [disabled]="page() === 0" (click)="page.set(page() - 1)">{{ 'COMMON.PREVIOUS' | translate }}</button>
            <span class="tabular-nums">{{ page() + 1 }} / {{ p.pages }}</span>
            <button type="button" class="btn btn-secondary btn-sm" [disabled]="page() + 1 >= p.pages" (click)="page.set(page() + 1)">{{ 'COMMON.NEXT' | translate }}</button>
          </span>
        </nav>
      }
    </div>
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-2xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .quick-add {
      display: flex; flex-direction: column; gap: var(--space-3, .75rem);
      background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
      padding: var(--space-4, 1rem); margin-bottom: var(--space-4, 1rem); max-width: 40rem;
    }
    .quick-add-hint { margin: 0; font-size: .875rem; color: var(--text-muted); }
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
      .data-table tbody td { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-1) 0; border: 0; }
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
  private readonly directoryApi = inject(PatientDirectoryApi);
  private readonly permissions = inject(PermissionService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly practitioners = inject(PractitionerService);
  readonly consultation = inject(ConsultationService);

  readonly quickOpen = signal(false);
  readonly quickBusy = signal(false);
  quickFirst = '';
  quickLast = '';

  protected readonly sorts = SORTS;
  readonly filters = [
    { value: '', key: 'COMMON.ALL' },
    { value: 'ACTIVE', key: 'STATUS.ACTIVE' },
    { value: 'ON_HOLD', key: 'STATUS.ON_HOLD' },
    { value: 'COMPLETED', key: 'STATUS.COMPLETED' },
  ] as const;

  /** What is typed; the query only follows after a pause, so a fast typist does not send a request per keystroke. */
  protected readonly searchInput = signal('');
  private readonly search = signal('');
  protected readonly status = signal('');
  protected readonly gender = signal('');
  protected readonly practitionerId = signal('');
  protected readonly insurerId = signal('');
  protected readonly debtOnly = signal(false);
  protected readonly landingPageOnly = signal(false);
  protected readonly sort = signal<string>('name');
  protected readonly dir = signal<'asc' | 'desc'>('asc');
  protected readonly page = signal(0);

  protected readonly directory = loadable<DirectoryPage | null>(null);
  protected readonly kpis = signal<DirectoryKpis | null>(null);
  protected readonly insurers = signal<Insurer[]>([]);
  protected readonly duplicateCount = signal(0);

  protected readonly canMerge = computed(() => this.permissions.can('PATIENT_MERGE'));
  protected readonly canSeeMoney = computed(() => this.permissions.can('BILLING_READ'));
  protected readonly rows = computed<DirectoryRow[]>(() => this.directory.data()?.content ?? []);
  protected readonly filtered = computed(() => !!(this.search() || this.status() || this.gender() || this.practitionerId() || this.insurerId() || this.debtOnly() || this.landingPageOnly()));
  protected readonly pageInfo = computed(() => {
    const d = this.directory.data();
    if (!d || d.totalElements === 0) {
      return null;
    }
    const from = d.number * d.size + 1;
    return { from, to: from + d.content.length - 1, total: d.totalElements, pages: Math.max(d.totalPages, 1) };
  });

  private readonly query = computed<DirectoryQuery>(() => ({
    search: this.search(), status: this.status(), gender: this.gender(), practitionerId: this.practitionerId(), insurerId: this.insurerId(),
    debtOnly: this.canSeeMoney() ? this.debtOnly() : undefined, landingPageOnly: this.landingPageOnly() || undefined, sort: this.sort(), dir: this.dir(), page: this.page(), size: PAGE_SIZE,
  }));

  constructor() {
    void this.consultation.loadConfig();
    this.directoryApi.kpis().then(k => this.kpis.set(k)).catch(() => undefined);
    this.directoryApi.insurers().then(i => this.insurers.set(i)).catch(() => undefined);
    if (this.permissions.can('PATIENT_MERGE')) {
      this.directoryApi.duplicates().then(d => this.duplicateCount.set(d.length)).catch(() => undefined);
    }

    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const typed = this.searchInput();
      pause = setTimeout(() => untracked(() => {
        if (typed !== this.search()) {
          this.search.set(typed);
          this.page.set(0);
        }
      }), 300);
      onCleanup(() => clearTimeout(pause));
    });
    effect(() => {
      const query = this.query();
      untracked(() => void this.directory.load(() => this.directoryApi.list(query)));
    });
    // A patient created or changed from another screen (the front desk, an online registration) appears without a refresh.
    refreshOnLive(['patient', 'registration'], () => void this.directory.load(() => this.directoryApi.list(this.query())));
  }

  protected setStatus(value: string): void {
    this.status.set(value);
    this.page.set(0);
  }

  protected toggleDir(): void {
    this.dir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    this.page.set(0);
  }

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

  initials(p: DirectoryRow): string {
    return `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();
  }

  clearFilters(): void {
    this.searchInput.set('');
    this.search.set('');
    this.status.set('');
    this.gender.set('');
    this.practitionerId.set('');
    this.insurerId.set('');
    this.debtOnly.set(false);
    this.landingPageOnly.set(false);
    this.page.set(0);
  }

  navigateToPatient(patientId: string): void {
    // Router.navigate() resolves a relative array against the root route,
    // not the current one (unlike routerLink): without the leading segment
    // this silently missed every route and landed on the dashboard.
    this.router.navigate(['/patients', patientId]);
  }
}
