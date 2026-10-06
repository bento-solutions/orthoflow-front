import { Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnalyticsApi, RetroAdvance } from '../../core/services/analytics-api.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { formState } from '../../core/utils/form-state';
import { isoDate } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';

/**
 * Money advanced to a doctor against what they will be owed. An advance is deducted from the next
 * statements, oldest first, until it is used up. One that has been deducted cannot be deleted:
 * it is part of a validated statement.
 */
@Component({
  selector: 'app-retro-advances',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, MoneyPipe, IconComponent, ModalComponent, CanDirective],
  template: `
    <div class="mb-4 flex justify-end"><button *appCan="'RETROCESSION_MANAGE'" type="button" class="btn btn-primary btn-sm" (click)="openNew()"><app-icon name="plus" [size]="15" /> {{ 'RETRO.ADV.NEW' | translate }}</button></div>
    <div class="table-wrap" [attr.aria-busy]="advances.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'ACC.COL.DATE' | translate }}</th><th scope="col">{{ 'COMMON.PRACTITIONER' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'RETRO.ADV.OUTSTANDING' | translate }}</th><th scope="col">{{ 'ACC.COL.METHOD' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (a of advances.data(); track a.id) {
            <tr>
              <td>{{ a.advanceDate | date: 'mediumDate' }}</td>
              <td class="font-semibold">{{ a.practitionerName }}@if (a.notes) { <span class="block text-xs font-normal text-ink-500">{{ a.notes }}</span> }</td>
              <td class="cell-num">{{ a.amount | money }}</td>
              <td class="cell-num font-semibold" [class.text-ink-400]="a.outstanding === 0">{{ a.outstanding | money }}</td>
              <td>{{ a.method || '—' }}</td>
              <td class="cell-actions">
                @if (a.outstanding === a.amount) {
                  <button *appCan="'RETROCESSION_MANAGE'" type="button" class="btn btn-ghost btn-icon" (click)="remove(a)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + a.practitionerName"><app-icon name="trash" [size]="16" /></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-8 text-center text-ink-500">{{ 'RETRO.ADV.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="adding()" [title]="'RETRO.ADV.NEW' | translate" size="md" [dismissable]="!busy()" (closed)="adding.set(false)">
      <form id="adv-form" class="space-y-4" (ngSubmit)="save()">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field"><span class="label label-required">{{ 'COMMON.PRACTITIONER' | translate }}</span>
            <select class="select" name="doctor" required [ngModel]="form.value().practitionerId" (ngModelChange)="form.set('practitionerId', $event)">
              <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
            </select></label>
          <label class="field"><span class="label label-required">{{ 'ACC.FORM.AMOUNT' | translate }}</span><input class="input" type="number" min="0.01" step="0.01" name="amount" required [ngModel]="form.value().amount || null" (ngModelChange)="form.set('amount', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.DATE' | translate }}</span><input class="input" type="date" name="date" [ngModel]="form.value().advanceDate" (ngModelChange)="form.set('advanceDate', $event)" /></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.METHOD' | translate }}</span><input class="input" name="method" maxlength="40" [ngModel]="form.value().method" (ngModelChange)="form.set('method', $event)" /></label>
        </div>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="adding.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="adv-form" class="btn btn-primary" [disabled]="busy() || !form.value().practitionerId || form.value().amount <= 0">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class RetroAdvancesComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly errors = inject(ApiErrors);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly advances = loadable<RetroAdvance[]>([]);
  protected readonly busy = signal(false);
  protected readonly adding = signal(false);
  protected readonly form = formState({ practitionerId: '', amount: 0, advanceDate: isoDate(new Date()), method: '', notes: '' });

  constructor() {
    effect(() => {
      untracked(() => void this.advances.load(() => this.api.advances()));
    });
  }

  protected openNew(): void {
    this.form.reset({ practitionerId: '', amount: 0, advanceDate: isoDate(new Date()), method: '', notes: '' });
    this.adding.set(true);
  }

  protected async save(): Promise<void> {
    const f = this.form.value();
    if (this.busy() || !f.practitionerId || f.amount <= 0) {
      return;
    }
    await this.run(async () => {
      await this.api.createAdvance({ practitionerId: f.practitionerId, amount: f.amount, advanceDate: f.advanceDate || undefined, method: f.method.trim() || undefined, notes: f.notes.trim() || undefined });
      this.adding.set(false);
    });
  }

  protected async remove(a: RetroAdvance): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('RETRO.ADV.DELETE_CONFIRM', { name: a.practitionerName }), { danger: true }))) {
      return;
    }
    await this.run(() => this.api.deleteAdvance(a.id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.advances.load(() => this.api.advances());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
