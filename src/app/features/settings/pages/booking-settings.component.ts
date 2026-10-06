import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { api } from '../../../core/api/url';
import type { Req, Wire } from '../../../core/api/wire';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { IconComponent } from '../../../shared/ui/icon.component';

type Settings = Wire<'BookingSettings'>;
type Purpose = 'BOOKING' | 'REGISTRATION' | 'SURVEY';
const PURPOSES: Purpose[] = ['BOOKING', 'REGISTRATION'];

/**
 * Online booking and self-registration: whether patients may book from a public page,
 * how far ahead, and the links to share. Off until the clinic turns it on. A link can
 * be replaced (rotated) if it leaked; the old one stops working at once.
 */
@Component({
  selector: 'app-booking-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent],
  template: `
    <form class="card card-pad space-y-4" (ngSubmit)="save()">
      <div>
        <h2 class="text-lg font-bold text-ink-900">{{ 'SET.BOOKING.TITLE' | translate }}</h2>
        <p class="text-sm text-ink-500">{{ 'SET.BOOKING.HINT' | translate }}</p>
      </div>
      <label class="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="enabled" [ngModel]="f.value().enabled" (ngModelChange)="f.set('enabled', $event)" /> {{ 'SET.BOOKING.ENABLED' | translate }}
      </label>
      <div class="grid gap-4 sm:grid-cols-3" [class.opacity-50]="!f.value().enabled">
        <label class="field"><span class="label">{{ 'SET.BOOKING.LEAD' | translate }}</span>
          <input class="input" type="number" min="0" name="leadTimeHours" [disabled]="!f.value().enabled" [ngModel]="f.value().leadTimeHours" (ngModelChange)="f.set('leadTimeHours', +$event)" />
          <span class="hint">{{ 'SET.BOOKING.LEAD_HINT' | translate }}</span></label>
        <label class="field"><span class="label">{{ 'SET.BOOKING.AHEAD' | translate }}</span>
          <input class="input" type="number" min="1" max="365" name="maxDaysAhead" [disabled]="!f.value().enabled" [ngModel]="f.value().maxDaysAhead" (ngModelChange)="f.set('maxDaysAhead', +$event)" /></label>
        <label class="field"><span class="label">{{ 'SET.BOOKING.STEP' | translate }}</span>
          <select class="select" name="slotStepMinutes" [disabled]="!f.value().enabled" [ngModel]="f.value().slotStepMinutes" (ngModelChange)="f.set('slotStepMinutes', +$event)">
            @for (m of steps; track m) { <option [ngValue]="m">{{ m }} min</option> }
          </select></label>
      </div>
      <label class="flex items-start gap-2 text-sm" [class.opacity-50]="!f.value().enabled">
        <input type="checkbox" class="mt-1" name="autoConfirm" [disabled]="!f.value().enabled" [ngModel]="f.value().autoConfirm" (ngModelChange)="f.set('autoConfirm', $event)" />
        <span>{{ 'SET.BOOKING.AUTO' | translate }}<span class="hint block">{{ 'SET.BOOKING.AUTO_HINT' | translate }}</span></span>
      </label>
      <div class="flex justify-end"><button type="submit" class="btn btn-primary" [disabled]="saving()">{{ 'COMMON.SAVE' | translate }}</button></div>
    </form>

    <section class="card mt-6">
      <div class="card-head"><div>
        <h2 class="text-lg font-bold text-ink-900">{{ 'SET.BOOKING.LINKS' | translate }}</h2>
        <p class="text-sm text-ink-500">{{ 'SET.BOOKING.LINKS_HINT' | translate }}</p>
      </div></div>
      <ul class="divide-y divide-ink-100">
        @for (p of purposes; track p) {
          <li class="flex flex-wrap items-center gap-3 px-5 py-3">
            <span class="w-40 text-sm font-semibold text-ink-800">{{ 'SET.BOOKING.PURPOSE.' + p | translate }}</span>
            <input class="input mono min-w-0 flex-1" readonly [value]="links()[p] ?? ''" [attr.aria-label]="'SET.BOOKING.PURPOSE.' + p | translate" (focus)="$any($event.target).select()" />
            <button type="button" class="btn btn-secondary btn-sm" [disabled]="!links()[p]" (click)="copy(p)"><app-icon name="copy" [size]="14" /> {{ 'SET.USERS.COPY' | translate }}</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="rotate(p)"><app-icon name="refresh" [size]="14" /> {{ 'SET.BOOKING.ROTATE' | translate }}</button>
          </li>
        }
      </ul>
    </section>
  `,
})
export class BookingSettingsComponent {
  private readonly http = inject(HttpClient);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);

  protected readonly steps = [5, 10, 15, 20, 30, 45, 60];
  protected readonly purposes = PURPOSES;
  protected readonly f = formState<Settings>({ enabled: false, leadTimeHours: 0, maxDaysAhead: 60, slotStepMinutes: 30, autoConfirm: false });
  protected readonly links = signal<Partial<Record<Purpose, string>>>({});
  protected readonly saving = signal(false);

  constructor() {
    firstValueFrom(this.http.get<Settings>(api('/booking/settings'))).then(s => this.f.reset(s)).catch(e => this.errors.report(e));
    for (const p of PURPOSES) {
      firstValueFrom(this.http.get<{ url: string }>(api(`/public-links/shared/${p}`))).then(r => this.links.update(l => ({ ...l, [p]: r.url }))).catch(() => undefined);
    }
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      const body: Req<'BookingSettings'> = this.f.value();
      this.f.reset(await firstValueFrom(this.http.put<Settings>(api('/booking/settings'), body)));
      this.toast.success('✓');
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async copy(p: Purpose): Promise<void> {
    await navigator.clipboard?.writeText(this.links()[p] ?? '').catch(() => undefined);
    this.toast.success('✓');
  }

  protected async rotate(p: Purpose): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('SET.BOOKING.ROTATE_CONFIRM'), { danger: true }))) {
      return;
    }
    try {
      const r = await firstValueFrom(this.http.post<{ url: string }>(api(`/public-links/shared/${p}/rotate`), null));
      this.links.update(l => ({ ...l, [p]: r.url }));
    } catch (error) {
      this.errors.report(error);
    }
  }
}
