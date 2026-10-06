import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { PracticeProfileService } from '../../../core/services/practice-profile.service';
import { ToastService } from '../../../core/services/toast.service';

export interface DayForm {
  weekday: number;
  closed: boolean;
  open: string;
  close: string;
  breakStart: string;
  breakEnd: string;
}

/** What is wrong with a day's hours, as a translation key, or null when it is fine. Mirrors the server's rules. */
export function dayProblem(d: DayForm): string | null {
  if (d.closed) {
    return null;
  }
  if (!d.open || !d.close || d.open >= d.close) {
    return 'SET.HOURS.PROBLEM.ORDER';
  }
  if (d.breakStart || d.breakEnd) {
    if (!d.breakStart || !d.breakEnd || d.breakStart >= d.breakEnd) {
      return 'SET.HOURS.PROBLEM.BREAK_ORDER';
    }
    if (d.breakStart <= d.open || d.breakEnd >= d.close) {
      return 'SET.HOURS.PROBLEM.BREAK_INSIDE';
    }
  }
  return null;
}

const hhmm = (t: string | null | undefined): string => (t ?? '').slice(0, 5);

/**
 * The days and hours the clinic is open. The agenda draws its grid from this, and the
 * online booking page offers only slots inside it, so a closed day or a lunch break
 * set here is honoured in both places.
 */
@Component({
  selector: 'app-opening-hours',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <section class="card card-pad">
      <h2 class="mb-1 text-lg font-bold text-ink-900">{{ 'SET.HOURS.TITLE' | translate }}</h2>
      <p class="mb-4 text-sm text-ink-500">{{ 'SET.HOURS.HINT' | translate }}</p>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>{{ 'SET.HOURS.DAY' | translate }}</th><th>{{ 'SET.HOURS.CLOSED' | translate }}</th>
            <th>{{ 'SET.HOURS.OPENS' | translate }}</th><th>{{ 'SET.HOURS.CLOSES' | translate }}</th>
            <th>{{ 'SET.HOURS.BREAK_FROM' | translate }}</th><th>{{ 'SET.HOURS.BREAK_TO' | translate }}</th>
          </tr></thead>
          <tbody>
            @for (d of days(); track d.weekday; let i = $index) {
              <tr>
                <th scope="row" class="text-start font-semibold">{{ 'SET.HOURS.DAYS.' + d.weekday | translate }}</th>
                <td><input type="checkbox" [checked]="d.closed" (change)="patch(i, { closed: $any($event.target).checked })" [attr.aria-label]="('SET.HOURS.CLOSED' | translate) + ' — ' + ('SET.HOURS.DAYS.' + d.weekday | translate)" /></td>
                <td><input type="time" class="input" [value]="d.open" [disabled]="d.closed" (change)="patch(i, { open: $any($event.target).value })" [attr.aria-label]="('SET.HOURS.OPENS' | translate) + ' — ' + ('SET.HOURS.DAYS.' + d.weekday | translate)" /></td>
                <td><input type="time" class="input" [value]="d.close" [disabled]="d.closed" (change)="patch(i, { close: $any($event.target).value })" [attr.aria-label]="('SET.HOURS.CLOSES' | translate) + ' — ' + ('SET.HOURS.DAYS.' + d.weekday | translate)" /></td>
                <td><input type="time" class="input" [value]="d.breakStart" [disabled]="d.closed" (change)="patch(i, { breakStart: $any($event.target).value })" [attr.aria-label]="('SET.HOURS.BREAK_FROM' | translate) + ' — ' + ('SET.HOURS.DAYS.' + d.weekday | translate)" /></td>
                <td><input type="time" class="input" [value]="d.breakEnd" [disabled]="d.closed" (change)="patch(i, { breakEnd: $any($event.target).value })" [attr.aria-label]="('SET.HOURS.BREAK_TO' | translate) + ' — ' + ('SET.HOURS.DAYS.' + d.weekday | translate)" /></td>
              </tr>
              @if (problem(d); as p) {
                <tr><td colspan="6" class="error-text" role="alert">{{ 'SET.HOURS.DAYS.' + d.weekday | translate }}: {{ p | translate }}</td></tr>
              }
            }
          </tbody>
        </table>
      </div></div>
      <div class="mt-4 flex justify-end">
        <button type="button" class="btn btn-primary" [disabled]="!valid() || saving()" (click)="save()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </section>
  `,
})
export class OpeningHoursComponent {
  private readonly profile = inject(PracticeProfileService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);

  protected readonly days = signal<DayForm[]>([]);
  protected readonly saving = signal(false);
  protected readonly valid = computed(() => this.days().length === 7 && this.days().every(d => dayProblem(d) === null));
  protected readonly problem = dayProblem;

  constructor() {
    this.profile.openingHours().then(week => this.days.set(week.days.map(d => ({
      weekday: d.weekday, closed: d.closed, open: hhmm(d.openTime), close: hhmm(d.closeTime), breakStart: hhmm(d.breakStart), breakEnd: hhmm(d.breakEnd),
    })))).catch(error => this.errors.report(error));
  }

  protected patch(index: number, change: Partial<DayForm>): void {
    this.days.update(list => list.map((d, i) => (i === index ? { ...d, ...change } : d)));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.profile.saveOpeningHours({
        days: this.days().map(d => ({
          weekday: d.weekday, closed: d.closed, openTime: d.open || '08:00', closeTime: d.close || '19:00',
          breakStart: d.breakStart || undefined, breakEnd: d.breakEnd || undefined,
        })),
      });
      this.toast.success('✓');
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }
}
