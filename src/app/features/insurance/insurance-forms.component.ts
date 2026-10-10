import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import {
  INSURANCE_FORM_STATUSES, InsuranceForm, InsuranceFormStatus, InsuranceFormsApi,
} from '../../core/services/insurance-forms-api.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { PermissionService } from '../../core/services/permission.service';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';

type FormAction = 'printed' | 'handed-over' | 'refresh' | 'void';

/**
 * The front desk's pile of care forms: what the sessions filled for each patient's insurer,
 * waiting to be printed, stamped by the doctor and handed over. Opening a form gives the
 * insurer's own sheet filled in; for a numbered paper form the patient brings, the overlay
 * prints only the text, onto that sheet.
 */
@Component({
  selector: 'app-insurance-forms',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, TranslateModule, IconComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'INSURANCE.PAGE_TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'INSURANCE.PAGE_SUB' | translate }}</p>
        </div>
      </header>

      <div class="seg mb-4" role="group" [attr.aria-label]="'INSURANCE.STATUS_FILTER' | translate">
        @for (s of statuses; track s) {
          <button type="button" class="seg-item" [class.is-active]="status() === s" [attr.aria-pressed]="status() === s" (click)="status.set(s)">
            {{ ('INSURANCE.STATUS.' + s) | translate }}
          </button>
        }
      </div>

      @if (rows.data().length === 0 && !rows.loading()) {
        <p class="card p-6 text-center text-ink-500">{{ ('INSURANCE.EMPTY.' + status()) | translate }}</p>
      } @else {
        <ul class="card divide-y divide-ink-100">
          @for (f of rows.data(); track f.id) {
            <li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div class="min-w-[14rem] flex-1">
                <p class="font-semibold text-ink-900">
                  <a class="text-petrol-700 no-underline hover:underline" [routerLink]="['/patients', f.patientId]">{{ f.patientName }}</a>
                  · {{ ('INSURANCE.PURPOSE.' + f.purpose) | translate }} · {{ f.number }}
                </p>
                <p class="text-sm text-ink-600">
                  {{ f.careDate | date: 'dd/MM/yyyy' }} · {{ f.insurerName || ('INSURANCE.NO_INSURER' | translate) }} · {{ f.formName }}
                  @if (f.total > 0) { · {{ f.total | number: '1.2-2' }} MAD }
                  @if (f.singleUse) { <span class="pill pill-attention ms-1">{{ 'INSURANCE.SINGLE_USE' | translate }}</span> }
                </p>
                @if (f.missing.length && f.status === 'TO_PRINT') {
                  <p class="text-xs text-attention-800">{{ 'INSURANCE.MISSING_TITLE' | translate }}
                    @for (m of f.missing; track m) { {{ ('INSURANCE.MISSING.' + m) | translate }}{{ $last ? '' : ',' }} }
                  </p>
                }
              </div>
              <div class="flex flex-wrap gap-1">
                <button type="button" class="btn btn-secondary btn-sm" (click)="open(f)"><app-icon name="print" [size]="14" /> {{ 'INSURANCE.OPEN' | translate }}</button>
                @if (f.formCode !== 'generic') {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="open(f, true)" [title]="'INSURANCE.OVERLAY_HINT' | translate">{{ 'INSURANCE.OVERLAY' | translate }}</button>
                }
                @if (canWrite()) {
                  @if (f.status === 'TO_PRINT') {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'refresh')" [title]="'INSURANCE.REFRESH_HINT' | translate"><app-icon name="refresh" [size]="14" /> {{ 'INSURANCE.REFRESH' | translate }}</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'printed')">{{ 'INSURANCE.MARK_PRINTED' | translate }}</button>
                  }
                  @if (f.status === 'TO_PRINT' || f.status === 'PRINTED') {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'handed-over')"><app-icon name="check" [size]="14" /> {{ 'INSURANCE.MARK_HANDED' | translate }}</button>
                  }
                  @if (f.status !== 'VOID') {
                    <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="act(f, 'void')">{{ 'INSURANCE.VOID' | translate }}</button>
                  }
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class InsuranceFormsComponent {
  private readonly api = inject(InsuranceFormsApi);
  private readonly errors = inject(ApiErrors);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  protected readonly statuses = INSURANCE_FORM_STATUSES;
  protected readonly status = signal<InsuranceFormStatus>('TO_PRINT');
  protected readonly rows = loadable<InsuranceForm[]>([]);
  protected readonly canWrite = computed(() => this.permissions.can('BILLING_WRITE'));

  constructor() {
    effect(() => {
      const status = this.status();
      void this.rows.load(() => this.api.list({ status }));
    });
    // A session saved in the next room lands here without a reload.
    refreshOnLive(['task'], () => void this.rows.load(() => this.api.list({ status: this.status() })));
  }

  protected async open(f: InsuranceForm, overlay = false): Promise<void> {
    try {
      await this.api.open(f.id, overlay);
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async act(f: InsuranceForm, action: FormAction): Promise<void> {
    if (action === 'void' && !(await this.confirm.confirm(this.translate.instant('INSURANCE.VOID_CONFIRM', { number: f.number }),
      { title: this.translate.instant('INSURANCE.VOID_TITLE'), danger: true }))) {
      return;
    }
    try {
      const updated = await this.api.action(f.id, action);
      // A form that changed status leaves this list; a refreshed one stays, with its new content.
      this.rows.data.update(list => updated.status === this.status()
        ? list.map(x => (x.id === updated.id ? updated : x))
        : list.filter(x => x.id !== updated.id));
    } catch (e) {
      this.errors.report(e);
    }
  }
}
