import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { LiveEventsService } from '../../../core/services/live-events.service';
import { PractitionerService } from '../../../core/services/practitioner.service';
import { ToastService } from '../../../core/services/toast.service';
import { loadable } from '../../../core/utils/loadable';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { DuplicatePair, Insurer, MergePreview, PatientDirectoryApi } from '../patient-directory-api.service';

type Side = 'TARGET' | 'SOURCE';
type Person = DuplicatePair['first'];

/** True when a stored value says nothing: absent or only spaces. */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/**
 * What the merge keeps for each field that differs, before the person chooses. The kept record's
 * own value wins; where it has none, the other record's value fills the gap, which is also what
 * the server does for an empty field whatever is asked.
 */
export function defaultChoices(differences: Record<string, string[]>): Record<string, Side> {
  const choices: Record<string, Side> = {};
  for (const [field, [target]] of Object.entries(differences)) {
    choices[field] = isBlank(target) ? 'SOURCE' : 'TARGET';
  }
  return choices;
}

/** The fields to send as `preferSourceFields`: only those where the kept record has a value that the person chose to replace. */
export function preferSourceFields(choices: Record<string, Side>, differences: Record<string, string[]>): string[] {
  return Object.keys(differences).filter(field => choices[field] === 'SOURCE' && !isBlank(differences[field][0]));
}

/**
 * Pairs of records that look like one person (same ID number, same phone with a similar name, or a
 * near-identical name and birth date), and the merge of one into the other.
 *
 * A merge is permanent: the records move to the kept patient and the other leaves the list. So the
 * dialog shows what will move and which fields disagree, asks which value to keep for each, and
 * asks for an explicit confirmation before the button works.
 */
@Component({
  selector: 'app-patient-duplicates',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, IconComponent, ModalComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <a routerLink="/patients" class="back-link"><app-icon name="chevron-left" [size]="14" /> {{ 'PAT.DUP.BACK' | translate }}</a>
          <h1 class="page-title">{{ 'PAT.DUP.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'PAT.DUP.SUBTITLE' | translate }}</p>
        </div>
      </header>

      <div class="space-y-4" [attr.aria-busy]="pairs.loading()">
        @for (pair of pairs.data(); track pair.first.id + pair.second.id) {
          <section class="card">
            <div class="card-head">
              <div class="flex flex-wrap items-center gap-2">
                <span class="pill pill-attention pill-nodot">{{ 'PAT.DUP.REASONS.' + pair.reason | translate }}</span>
                @if (pair.reason !== 'CIN') {
                  <span class="text-xs text-ink-500">{{ 'PAT.DUP.SIMILARITY' | translate: { value: percent(pair.score) } }}</span>
                }
              </div>
            </div>
            <div class="grid gap-px bg-ink-100 md:grid-cols-2">
              @for (person of [pair.first, pair.second]; track person.id) {
                <article class="bg-surface p-4">
                  <h2 class="text-base font-bold text-ink-900">
                    <a class="no-underline hover:text-petrol-700" [routerLink]="['/patients', person.id]" [attr.aria-label]="'PAT.DUP.OPEN' | translate: { name: name(person) }">{{ name(person) }}</a>
                  </h2>
                  <p class="mono text-2xs text-ink-500">{{ person.patientCode }}</p>
                  <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt class="text-ink-500">{{ 'PAT.DUP.BORN' | translate }}</dt><dd>{{ person.dateOfBirth ? (person.dateOfBirth | date: 'mediumDate') : '—' }}</dd>
                    <dt class="text-ink-500">{{ 'PAT.DUP.PHONE' | translate }}</dt><dd>{{ person.phone || '—' }}</dd>
                    <dt class="text-ink-500">{{ 'PAT.DUP.CIN' | translate }}</dt><dd>{{ person.cin || '—' }}</dd>
                    <dt class="text-ink-500">{{ 'COMMON.EMAIL' | translate }}</dt><dd class="truncate">{{ person.email || '—' }}</dd>
                    <dt class="text-ink-500">{{ 'PAT.DUP.CREATED' | translate }}</dt><dd>{{ person.createdAt | date: 'mediumDate' }}</dd>
                  </dl>
                  <button type="button" class="btn btn-secondary btn-sm mt-4" (click)="start(person, other(pair, person))"
                    [attr.aria-label]="'PAT.DUP.KEEP_THIS_FOR' | translate: { name: name(person) }">
                    {{ 'PAT.DUP.KEEP_THIS' | translate }}
                  </button>
                </article>
              }
            </div>
          </section>
        } @empty {
          @if (!pairs.loading()) {
            <div class="empty">
              <span class="empty-icon"><app-icon name="users" [size]="20" /></span>
              <p class="empty-title">{{ 'PAT.DUP.EMPTY_TITLE' | translate }}</p>
              <p class="empty-text">{{ 'PAT.DUP.EMPTY_TEXT' | translate }}</p>
            </div>
          }
        }
      </div>
    </div>

    <app-modal [open]="pending() !== null" [title]="'PAT.DUP.MERGE.TITLE' | translate" size="lg" [dismissable]="!busy()" (closed)="close()">
      @if (pending(); as p) {
        <p class="mb-4 text-sm text-ink-700">{{ 'PAT.DUP.MERGE.INTRO' | translate: { source: name(p.source), target: name(p.target) } }}</p>
        @if (preview(); as pv) {
          <section class="mb-5">
            <h3 class="section-title">{{ 'PAT.DUP.MERGE.MOVES' | translate }}</h3>
            @if (moves().length) {
              <ul class="flex flex-wrap gap-2">
                @for (m of moves(); track m.table) {
                  <li class="pill pill-idle pill-nodot">{{ tableLabel(m.table) }} <strong class="ms-1 tabular-nums">{{ m.count }}</strong></li>
                }
              </ul>
            } @else {
              <p class="text-sm text-ink-500">{{ 'PAT.DUP.MERGE.MOVES_NONE' | translate }}</p>
            }
          </section>

          <section class="mb-5">
            <h3 class="section-title">{{ 'PAT.DUP.MERGE.DIFFERENCES' | translate }}</h3>
            @if (fields().length) {
              <p class="mb-2 text-sm text-ink-500">{{ 'PAT.DUP.MERGE.DIFFERENCES_HINT' | translate }}</p>
              <div class="table-wrap"><div class="table-scroll">
                <table class="data-table">
                  <thead><tr>
                    <th scope="col">{{ 'PAT.DUP.MERGE.FIELD' | translate }}</th>
                    <th scope="col">{{ 'PAT.DUP.MERGE.KEPT_RECORD' | translate }}</th>
                    <th scope="col">{{ 'PAT.DUP.MERGE.MERGED_RECORD' | translate }}</th>
                  </tr></thead>
                  <tbody>
                    @for (f of fields(); track f.field) {
                      <tr>
                        <th scope="row" class="font-semibold">{{ 'PAT.DUP.MERGE.FIELDS.' + f.field | translate }}</th>
                        <td>
                          <label class="flex items-center gap-2" [class.opacity-60]="f.targetBlank">
                            <input type="radio" [name]="'pick-' + f.field" [checked]="choices()[f.field] === 'TARGET'" [disabled]="f.targetBlank" (change)="pick(f.field, 'TARGET')" />
                            <span>{{ valueLabel(f.field, f.target) }}</span>
                          </label>
                        </td>
                        <td>
                          <label class="flex items-center gap-2">
                            <input type="radio" [name]="'pick-' + f.field" [checked]="choices()[f.field] === 'SOURCE'" (change)="pick(f.field, 'SOURCE')" />
                            <span>{{ valueLabel(f.field, f.source) }}</span>
                          </label>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div></div>
            } @else {
              <p class="text-sm text-ink-500">{{ 'PAT.DUP.MERGE.NO_DIFFERENCES' | translate }}</p>
            }
          </section>

          @if (pv.bothHaveDentalCharts) {
            <fieldset class="mb-5 rounded-lg border border-caution-200 bg-caution-50 p-3">
              <legend class="section-title !mb-1 px-1">{{ 'PAT.DUP.MERGE.CHARTS' | translate }}</legend>
              <p class="mb-2 text-sm text-ink-700">{{ 'PAT.DUP.MERGE.CHARTS_HINT' | translate }}</p>
              <label class="me-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="chart" [checked]="chart() === 'TARGET'" (change)="chart.set('TARGET')" /> {{ 'PAT.DUP.MERGE.CHART_TARGET' | translate: { name: name(p.target) } }}</label>
              <label class="inline-flex items-center gap-2 text-sm"><input type="radio" name="chart" [checked]="chart() === 'SOURCE'" (change)="chart.set('SOURCE')" /> {{ 'PAT.DUP.MERGE.CHART_TARGET' | translate: { name: name(p.source) } }}</label>
            </fieldset>
          }

          <label class="flex items-start gap-2 text-sm font-semibold text-ink-800">
            <input type="checkbox" class="mt-0.5" [ngModel]="confirmed()" (ngModelChange)="confirmed.set($event)" />
            {{ 'PAT.DUP.MERGE.IRREVERSIBLE' | translate }}
          </label>
        } @else {
          <p class="py-6 text-center text-ink-500" role="status">{{ 'COMMON.LOADING' | translate }}</p>
        }
      }
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="close()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="button" class="btn btn-danger" [disabled]="!preview() || !confirmed() || busy()" (click)="submit()">{{ 'PAT.DUP.MERGE.SUBMIT' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`
    .back-link { display: inline-flex; align-items: center; gap: .25rem; font-size: var(--text-sm); color: var(--text-muted); text-decoration: none; }
    .back-link:hover { color: var(--text); }
    .section-title { margin-bottom: .5rem; font-size: var(--text-2xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }
  `],
})
export class PatientDuplicatesComponent {
  private readonly api = inject(PatientDirectoryApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly practitioners = inject(PractitionerService);

  protected readonly pairs = loadable<DuplicatePair[]>([]);
  protected readonly pending = signal<{ target: Person; source: Person } | null>(null);
  protected readonly preview = signal<MergePreview | null>(null);
  protected readonly choices = signal<Record<string, Side>>({});
  protected readonly chart = signal<Side>('TARGET');
  protected readonly confirmed = signal(false);
  protected readonly busy = signal(false);
  private readonly insurers = signal<Insurer[]>([]);

  protected readonly moves = computed(() => Object.entries(this.preview()?.recordsToMove ?? {}).map(([table, count]) => ({ table, count })));
  protected readonly fields = computed(() =>
    Object.entries(this.preview()?.fieldDifferences ?? {}).map(([field, [target, source]]) => ({ field, target, source, targetBlank: isBlank(target) })),
  );

  constructor() {
    void this.reload();
    this.api.insurers().then(i => this.insurers.set(i)).catch(() => undefined);
    // Someone else merged or registered a patient: the list is no longer what was loaded.
    inject(LiveEventsService).of('patient').subscribe(() => {
      if (!this.pending()) {
        void this.reload();
      }
    });
  }

  private reload(): Promise<boolean> {
    return this.pairs.load(() => this.api.duplicates());
  }

  protected name(person: Person): string {
    return `${person.firstName} ${person.lastName}`.trim();
  }

  protected percent(score: number): number {
    return Math.round(score * 100);
  }

  protected other(pair: DuplicatePair, person: Person): Person {
    return pair.first.id === person.id ? pair.second : pair.first;
  }

  protected tableLabel(table: string): string {
    const key = `PAT.DUP.MERGE.TABLES.${table}`;
    const text = this.translate.instant(key);
    // A table added to the schema after this screen was written still shows, under its own name.
    return text === key ? table.replace(/_/g, ' ') : text;
  }

  protected valueLabel(field: string, value: string | null): string {
    if (isBlank(value)) {
      return '—';
    }
    switch (field) {
      case 'insurerId':
        return this.insurers().find(i => i.id === value)?.name ?? '—';
      case 'primaryPractitionerId':
        return this.practitioners.active().find(p => p.id === value)?.displayName ?? '—';
      case 'photoFileId':
        return this.translate.instant('PAT.DUP.MERGE.PHOTO_SET');
      case 'gender':
        return value === 'F' ? this.translate.instant('PAT.F') : value === 'M' ? this.translate.instant('PAT.M') : (value as string);
      default:
        return value as string;
    }
  }

  protected async start(target: Person, source: Person): Promise<void> {
    this.pending.set({ target, source });
    this.preview.set(null);
    this.confirmed.set(false);
    this.chart.set('TARGET');
    try {
      const preview = await this.api.mergePreview(target.id, source.id);
      // A different pair may have been opened while this one was loading.
      if (this.pending()?.target.id === target.id) {
        this.preview.set(preview);
        this.choices.set(defaultChoices(preview.fieldDifferences));
      }
    } catch (error) {
      this.errors.report(error);
      this.pending.set(null);
    }
  }

  protected pick(field: string, side: Side): void {
    this.choices.update(c => ({ ...c, [field]: side }));
  }

  protected close(): void {
    if (!this.busy()) {
      this.pending.set(null);
      this.preview.set(null);
    }
  }

  protected async submit(): Promise<void> {
    const pending = this.pending();
    const preview = this.preview();
    if (!pending || !preview || !this.confirmed() || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.merge(pending.target.id, {
        sourceId: pending.source.id,
        dentalChartFrom: preview.bothHaveDentalCharts ? (this.chart() === 'SOURCE' ? 'SOURCE' : 'TARGET') : undefined,
        preferSourceFields: preferSourceFields(this.choices(), preview.fieldDifferences),
      });
      this.toast.success(this.translate.instant('PAT.DUP.MERGE.DONE'));
      this.busy.set(false);
      this.pending.set(null);
      this.preview.set(null);
      await this.reload();
    } catch (error) {
      this.busy.set(false);
      this.errors.report(error);
    }
  }
}
