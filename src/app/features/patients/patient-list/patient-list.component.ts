import { PageHeaderComponent } from '../../../shared/ui/page-header.component';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';

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
  imports: [PageHeaderComponent, AppDatePipe, NgTemplateOutlet, RouterModule, FormsModule, TranslateModule, IconComponent, StatusPillComponent, MoneyPipe, NumPipe],
  template: `
    <div class="anim-rise">
      <app-page-header>
        <div page-actions class="contents">
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
      </app-page-header>

      <!-- Someone is in the chair and nothing is known but their name. The rest
           is learned in the consultation, or filled in later. -->
      @if (quickOpen()) {
        <form id="quick-add" class="quick-add" (ngSubmit)="quickAdd(false)" #quickForm="ngForm">
          <p class="quick-add-hint">{{ 'PATIENTS.QUICK_ADD.HINT' | translate }}</p>
          <div class="quick-add-fields">
            <label>
              <span>{{ 'PATIENTS.DOSSIER.FIRST_NAME' | translate }}</span>
              <input class="input" name="firstName" [(ngModel)]="quickFirst" required maxlength="255" autocomplete="off" />
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
        <label class="search patient-search" data-tour="patients-search">
          <span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span>
          <app-icon name="search" [size]="16" />
          <input class="input" type="search" [placeholder]="'PATIENTS.SEARCH_PLACEHOLDER' | translate" [ngModel]="searchInput()" (ngModelChange)="searchInput.set($event)" />
        </label>

        <div class="seg" role="group" [attr.aria-label]="'COMMON.FILTER' | translate">
          @for (f of filters; track f.value) {
            <button type="button" class="seg-item" [class.is-active]="status() === f.value" [attr.aria-pressed]="status() === f.value" (click)="setStatus(f.value)">{{ f.key | translate }}</button>
          }
        </div>

        <!-- The rest of the filters behind one button that says how many are on (P2-7). -->
        <button type="button" class="btn btn-secondary" (click)="filtersOpen.set(!filtersOpen())" [attr.aria-expanded]="filtersOpen()" aria-controls="patient-filters">
          <app-icon name="filter" [size]="16" /> {{ 'COMMON.FILTERS' | translate }}
          @if (activeFilters() > 0) { <span class="pill pill-active pill-nodot">{{ activeFilters() }}</span> }
        </button>
        <!-- The sorts without a column of their own (code, age, progress, last visit) stay here; the
             column headers sort too, and both show the same choice. The direction says what it does. -->
        <div class="flex items-center gap-2 text-sm text-ink-600 lg:ms-auto">
          <label class="flex items-center gap-2">
            {{ 'PAT.SORT' | translate }}
            <select class="select w-auto" [ngModel]="sort()" (ngModelChange)="sortBy($event, false)">
              @for (s of sorts; track s) { <option [value]="s">{{ 'PAT.SORTS.' + s | translate }}</option> }
            </select>
          </label>
          <button type="button" class="btn btn-secondary sort-dir" (click)="toggleDir()" [attr.aria-label]="('PAT.DIRECTION' | translate) + ': ' + ((dir() === 'asc' ? 'PAT.DIR_ASC' : 'PAT.DIR_DESC') | translate)"
                  [title]="'PAT.DIRECTION' | translate">
            <app-icon [name]="dir() === 'asc' ? 'chevron-up' : 'chevron-down'" [size]="16" />
            {{ (dir() === 'asc' ? 'PAT.DIR_ASC' : 'PAT.DIR_DESC') | translate }}
          </button>
        </div>
      </div>
      @if (filtersOpen()) {
      <div id="patient-filters" class="card mb-4 flex flex-wrap items-center gap-3 p-3">
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
        @if (activeFilters() > 0) {
          <button type="button" class="btn btn-ghost btn-sm ms-auto" (click)="clearFilters()">{{ 'COMMON.CLEAR_FILTERS' | translate }}</button>
        }
      </div>
      }

      <!-- Table -->
      <div class="table-wrap" [attr.aria-busy]="directory.loading()">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <ng-template #sortHead let-key let-label="label">
                  <button type="button" class="sort-button th-sort" [class.is-sorted]="sort() === key" (click)="sortBy(key, true)"
                          [title]="'PAT.SORT_BY_COLUMN' | translate: { column: (label | translate) }">
                    {{ label | translate }}
                    @if (sort() === key) {
                      <app-icon class="th-sort-icon" [name]="dir() === 'asc' ? 'chevron-up' : 'chevron-down'" [size]="14" />
                    } @else {
                      <span class="th-sort-idle" aria-hidden="true"><app-icon name="chevron-up" [size]="10" /><app-icon name="chevron-down" [size]="10" /></span>
                    }
                  </button>
                </ng-template>
                <th scope="col" [attr.aria-sort]="ariaSort('name')"><ng-container *ngTemplateOutlet="sortHead; context: { $implicit: 'name', label: 'PATIENTS.NAME' }" /></th>
                <th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
                <th scope="col">{{ 'PAT.PRACTITIONER' | translate }}</th>
                <th scope="col" [attr.aria-sort]="ariaSort('next')"><ng-container *ngTemplateOutlet="sortHead; context: { $implicit: 'next', label: 'PATIENTS.NEXT_APPOINTMENT' }" /></th>
                <th scope="col" [attr.aria-sort]="ariaSort('created')"><ng-container *ngTemplateOutlet="sortHead; context: { $implicit: 'created', label: 'PAT.DATE_ADDED' }" /></th>
                <th scope="col">{{ 'PATIENTS.CONTACT' | translate }}</th>
                @if (canSeeMoney()) {
                  <th scope="col" class="cell-num" [attr.aria-sort]="ariaSort('balance')"><ng-container *ngTemplateOutlet="sortHead; context: { $implicit: 'balance', label: 'PAT.BALANCE' }" /></th>
                }
                <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (patient of rows(); track patient.id) {
                <!-- The whole row opens the file: the name link stretches over it (P2-7). It stays the one
                     keyboard and screen-reader target; the edit link sits above it. -->
                <tr class="row-clickable row-link-host" (click)="navigateToPatient(patient.id)">
                  <td>
                    <div class="flex items-center gap-3">
                      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-petrol-50 text-2xs font-bold text-petrol-700 ring-1 ring-petrol-100" aria-hidden="true">{{ initials(patient) }}</span>
                      <span class="flex min-w-0 flex-col leading-tight">
                        <a class="row-link truncate font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="[patient.id]" (click)="$event.stopPropagation()">{{ patient.firstName }} {{ patient.lastName }}</a>
                        <span class="mono text-2xs text-ink-500"><span class="ltr-data">{{ patient.patientCode }}</span>@if (patient.age !== null) { · {{ patient.age }} {{ 'PAT.YEARS' | translate }} }</span>
                      </span>
                    </div>
                  </td>
                  <td [attr.data-label]="'COMMON.STATUS' | translate"><app-status-pill [status]="patient.status" /></td>
                  <td [attr.data-label]="'PAT.PRACTITIONER' | translate">{{ patient.primaryPractitionerName || '—' }}</td>
                  <td [attr.data-label]="'PATIENTS.NEXT_APPOINTMENT' | translate">
                    @if (patient.nextAppointment) {
                      <span class="font-semibold text-ink-900">{{ patient.nextAppointment | appDate }}</span>
                    } @else { <span class="text-ink-500">—</span> }
                  </td>
                  <td [attr.data-label]="'PAT.DATE_ADDED' | translate">
                    @if (patient.createdAt) { <span class="text-ink-700">{{ patient.createdAt | appDate }}</span> } @else { <span class="text-ink-500">—</span> }
                  </td>
                  <td [attr.data-label]="'PATIENTS.CONTACT' | translate">
                    <span class="flex flex-col leading-tight">
                      <span class="text-ink-900"><span class="ltr-data">{{ patient.phone || '—' }}</span></span>
                      <span class="truncate text-2xs text-ink-500"><span class="ltr-data">{{ patient.email }}</span></span>
                    </span>
                  </td>
                  @if (canSeeMoney()) {
                    <td class="cell-num" [attr.data-label]="'PAT.BALANCE' | translate">
                      @if (patient.balanceDue > 0) { <span class="font-bold text-critical-700">{{ patient.balanceDue | money }}</span> }
                      @else if (patient.credit > 0) { <span class="text-ink-900" [attr.title]="'PAT.CREDIT' | translate">+{{ patient.credit | money }}</span> }
                      @else { <span class="text-ink-500">—</span> }
                    </td>
                  }
                  <td class="cell-actions">
                    <div class="flex justify-end gap-1">
                      <a class="btn btn-ghost btn-icon row-above" [routerLink]="[patient.id, 'edit']" (click)="$event.stopPropagation()" [title]="'COMMON.EDIT' | translate"
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
    /* The search says all of what it searches, with its icon inside the field. */
    .patient-search { flex: 1 1 24rem; min-width: min(100%, 20rem); }
    .row-link-host { position: relative; }
    .row-link::after { content: ''; position: absolute; inset: 0; }
    .row-above { position: relative; z-index: 1; }
    /* Sortable headers: the sorted column is in the action colour with its arrow; the others show a
       faint up-down mark that firms up on hover, so it is plain which headers sort. */
    .th-sort { display: inline-flex; width: auto; padding: .125rem .25rem; margin-inline: -.25rem; border-radius: var(--radius-sm); font-weight: inherit; text-transform: inherit; letter-spacing: inherit; }
    .th-sort:hover { background: var(--surface-hover); }
    .th-sort:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
    .th-sort.is-sorted { color: var(--action-text); }
    .th-sort-idle { display: inline-flex; flex-direction: column; line-height: 0; opacity: .4; }
    .th-sort:hover .th-sort-idle { opacity: .9; }
    .sort-dir { gap: .375rem; white-space: nowrap; }
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-2xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .quick-add {
      display: flex; flex-direction: column; gap: var(--space-3, .75rem);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      padding: var(--space-4, 1rem); margin-bottom: var(--space-4, 1rem); max-width: 40rem;
    }
    .quick-add-hint { margin: 0; font-size: var(--text-base); color: var(--text-muted); }
    .quick-add-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .quick-add-fields label { display: flex; flex-direction: column; gap: .25rem; font-size: var(--text-sm); font-weight: 600; color: rgb(var(--ink-700)); }
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
  /** The filters behind the Filters button, and how many of them are on. */
  protected readonly filtersOpen = signal(false);
  protected readonly activeFilters = computed(() =>
    [this.gender(), this.practitionerId(), this.insurerId(), this.debtOnly(), this.landingPageOnly()].filter(Boolean).length);
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

  /**
   * Sorts by a column. From a header, a second click on the sorted column turns the direction round;
   * a new column starts the way a reader expects it: names A to Z, the newest patients and the
   * largest balances first, the soonest appointment first.
   */
  protected sortBy(key: string, fromHeader: boolean): void {
    if (fromHeader && this.sort() === key) {
      this.toggleDir();
      return;
    }
    this.sort.set(key);
    if (fromHeader) this.dir.set(key === 'created' || key === 'balance' ? 'desc' : 'asc');
    this.page.set(0);
  }

  protected ariaSort(key: string): 'ascending' | 'descending' | null {
    return this.sort() === key ? (this.dir() === 'asc' ? 'ascending' : 'descending') : null;
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
