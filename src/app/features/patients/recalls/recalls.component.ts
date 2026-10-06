import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { PractitionerService } from '../../../core/services/practitioner.service';
import { ToastService } from '../../../core/services/toast.service';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { ExportMenuComponent } from '../../../shared/ui/export-menu.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { PatientDirectoryApi, RECALL_KINDS, RecallKind, RecallRow } from '../patient-directory-api.service';

const SORTS = ['last', 'remaining', 'name'] as const;

export function isRecallKind(value: string | null | undefined): value is RecallKind {
  return !!value && (RECALL_KINDS as readonly string[]).includes(value);
}

/** What a reminder run did: the server says how many it queued, so the rest were skipped (no consent, no number). */
export function reminderOutcome(selected: number, queued: number): { queued: number; skipped: number } {
  return { queued, skipped: Math.max(selected - queued, 0) };
}

/**
 * Who to call back: patients who lapsed, have nothing booked, were lost in the middle of a
 * treatment, or are due a retention check. One list per reason, the same filters on each, and a
 * reminder can go to the people ticked (those who declined messages are skipped by the server).
 */
@Component({
  selector: 'app-recalls',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, IconComponent, ExportMenuComponent, CanDirective],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'REC.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'REC.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          <app-export-menu [path]="'/recalls/' + kind() + '/export'" [query]="filters()" [fallbackName]="'recalls-' + kind()" />
          <button *appCan="'MESSAGING_SEND'" type="button" class="btn btn-primary btn-sm" [disabled]="selected().size === 0 || sending()" (click)="send()" [attr.aria-describedby]="'send-hint'">
            <app-icon name="send" [size]="15" /> {{ 'REC.SEND' | translate }}@if (selected().size > 0) { ({{ selected().size }}) }
          </button>
        </div>
      </header>

      <div class="seg mb-3 flex-wrap" role="group" [attr.aria-label]="'REC.TITLE' | translate">
        @for (k of kinds; track k) {
          <button type="button" class="seg-item" [class.is-active]="kind() === k" [attr.aria-pressed]="kind() === k" (click)="setKind(k)">{{ 'REC.KINDS.' + k | translate }}</button>
        }
      </div>
      <p class="mb-4 text-sm text-ink-600">{{ 'REC.KIND_HINTS.' + kind() | translate }} <span id="send-hint" class="text-ink-500">{{ 'REC.SEND_HINT' | translate }}</span></p>

      <div class="mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
        <label class="field w-auto">
          <span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
          <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
            <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
            @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
          </select>
        </label>
        <label class="field w-24">
          <span class="label">{{ 'REC.MIN_PROGRESS' | translate }} %</span>
          <input class="input" type="number" min="0" max="100" [ngModel]="minProgress()" (ngModelChange)="minProgress.set($event)" />
        </label>
        <label class="field w-24">
          <span class="label">{{ 'REC.MAX_PROGRESS' | translate }} %</span>
          <input class="input" type="number" min="0" max="100" [ngModel]="maxProgress()" (ngModelChange)="maxProgress.set($event)" />
        </label>
        <label class="field w-auto">
          <span class="label">{{ 'REC.SORT' | translate }}</span>
          <select class="select w-auto" [ngModel]="sort()" (ngModelChange)="sort.set($event)">
            @for (s of sorts; track s) { <option [value]="s">{{ 'REC.SORTS.' + s | translate }}</option> }
          </select>
        </label>
        <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="excludeNever()" (ngModelChange)="excludeNever.set($event)" /> {{ 'REC.EXCLUDE_NEVER' | translate }}</label>
        <span class="pb-2 text-sm text-ink-500 lg:ms-auto" role="status">{{ 'REC.COUNT' | translate: { count: rows().length } }}</span>
      </div>

      <div class="table-wrap" [attr.aria-busy]="list.loading()">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" class="w-8">
                  <input type="checkbox" [checked]="allSelected()" [indeterminate]="selected().size > 0 && !allSelected()" (change)="toggleAll($any($event.target).checked)" [attr.aria-label]="'REC.SELECT_ALL' | translate" />
                </th>
                <th scope="col">{{ 'COMMON.PATIENT' | translate }}</th>
                <th scope="col">{{ 'COMMON.PRACTITIONER' | translate }}</th>
                <th scope="col">{{ 'REC.COLUMNS.LAST_VISIT' | translate }}</th>
                <th scope="col">{{ 'REC.COLUMNS.NEXT' | translate }}</th>
                <th scope="col">{{ 'REC.COLUMNS.PROGRESS' | translate }}</th>
                @if (retention()) { <th scope="col">{{ 'REC.COLUMNS.DUE' | translate }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.patientId) {
                <tr>
                  <td><input type="checkbox" [checked]="selected().has(r.patientId)" (change)="toggle(r.patientId, $any($event.target).checked)" [attr.aria-label]="'REC.SELECT_ROW' | translate: { name: fullName(r) }" /></td>
                  <td>
                    <a class="font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', r.patientId]">{{ fullName(r) }}</a>
                    <span class="block text-xs text-ink-500">
                      <span class="mono">{{ r.patientCode }}</span>
                      @if (r.phone) { · <a class="text-ink-600" [href]="'tel:' + r.phone" [attr.aria-label]="'REC.CALL' | translate: { name: fullName(r) }">{{ r.phone }}</a> }
                    </span>
                  </td>
                  <td>{{ r.primaryPractitionerName || '—' }}</td>
                  <td>@if (r.lastVisit) { {{ r.lastVisit | date: 'mediumDate' }} } @else { <span class="text-ink-500">{{ 'REC.NEVER' | translate }}</span> }</td>
                  <td>{{ r.nextAppointment ? (r.nextAppointment | date: 'mediumDate') : '—' }}</td>
                  <td>
                    <span class="flex items-center gap-2" [attr.title]="r.progress + ' %'">
                      <span class="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100"><span class="block h-full rounded-full bg-petrol-500" [style.width.%]="r.progress"></span></span>
                      <span class="text-2xs tabular-nums text-ink-500">{{ r.progress }}%</span>
                    </span>
                  </td>
                  @if (retention()) { <td>{{ r.dueSince ? (r.dueSince | date: 'mediumDate') : '—' }}</td> }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="retention() ? 7 : 6" class="!p-0">
                  @if (!list.loading()) {
                    <div class="empty">
                      <span class="empty-icon"><app-icon name="check-circle" [size]="20" /></span>
                      <p class="empty-title">{{ 'REC.EMPTY_TITLE' | translate }}</p>
                      <p class="empty-text">{{ 'REC.EMPTY_TEXT' | translate }}</p>
                    </div>
                  }
                </td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class RecallsComponent {
  private readonly api = inject(PatientDirectoryApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly kinds = RECALL_KINDS;
  protected readonly sorts = SORTS;
  protected readonly kind = signal<RecallKind>('NO_VISIT_6M');
  protected readonly practitionerId = signal('');
  protected readonly minProgress = signal<number | null>(null);
  protected readonly maxProgress = signal<number | null>(null);
  protected readonly excludeNever = signal(true);
  protected readonly sort = signal<string>('last');
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly sending = signal(false);

  protected readonly list = loadable<RecallRow[]>([]);
  protected readonly rows = computed(() => this.list.data());
  protected readonly retention = computed(() => this.kind().startsWith('RETENTION'));
  protected readonly allSelected = computed(() => this.rows().length > 0 && this.selected().size === this.rows().length);

  protected readonly filters = computed(() => ({
    practitionerId: this.practitionerId(),
    minProgress: this.minProgress(),
    maxProgress: this.maxProgress(),
    excludeNeverVisited: this.excludeNever(),
    sort: this.sort(),
  }));

  constructor() {
    const initial = inject(ActivatedRoute).snapshot.queryParamMap.get('kind');
    if (isRecallKind(initial)) {
      this.kind.set(initial);
    }
    effect(() => {
      const kind = this.kind();
      const query = this.filters();
      untracked(() => {
        this.selected.set(new Set());
        void this.list.load(() => this.api.recalls(kind, query));
      });
    });
  }

  protected setKind(kind: RecallKind): void {
    this.kind.set(kind);
    void this.router.navigate([], { queryParams: { kind }, replaceUrl: true });
  }

  protected fullName(row: RecallRow): string {
    return `${row.firstName} ${row.lastName}`.trim();
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
    this.selected.set(on ? new Set(this.rows().map(r => r.patientId)) : new Set());
  }

  protected async send(): Promise<void> {
    const ids = [...this.selected()];
    if (ids.length === 0 || this.sending()) {
      return;
    }
    this.sending.set(true);
    try {
      const result = await this.api.sendRecallReminders(ids);
      const { queued, skipped } = reminderOutcome(ids.length, result['queued'] ?? 0);
      this.toast.success(this.translate.instant('REC.SENT', { queued, skipped }));
      this.selected.set(new Set());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.sending.set(false);
    }
  }
}
