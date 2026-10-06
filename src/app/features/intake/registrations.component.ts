import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { IntakeApi, PendingRegistration } from '../../core/services/intake-api.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { NavCounts } from '../../core/services/nav-counts.service';
import { ToastService } from '../../core/services/toast.service';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * Forms patients filled in themselves, waiting to become patients. Each one shows the records it
 * might duplicate (same ID number, same phone, a near-identical name): approving merges into one
 * of them or creates a new patient, and nothing enters the register until someone does.
 */
@Component({
  selector: 'app-registrations',
  standalone: true,
  imports: [DatePipe, RouterLink, TranslateModule, IconComponent],
  template: `
    <ul class="space-y-3" [attr.aria-busy]="pending.loading()">
      @for (p of pending.data(); track p.id) {
        <li class="card">
          <div class="p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <p class="text-base font-bold text-ink-900">{{ p.firstName }} {{ p.lastName }}
                @if (p.invitedPatientId) { <span class="pill pill-active pill-nodot ms-2">{{ 'INT.REG.INVITED' | translate }}</span> }</p>
              <p class="text-xs text-ink-500">{{ 'INT.BOOK.RECEIVED' | translate: { at: (p.createdAt | date: 'short') } }}</p>
            </div>
            <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
              @for (row of details(p); track row[0]) { <dt class="text-ink-500">{{ row[0] | translate }}</dt><dd class="text-ink-900">{{ row[1] }}</dd> }
            </dl>
          </div>
          @if (p.possibleDuplicates.length) {
            <div class="border-t border-caution-200 bg-caution-50 px-4 py-3">
              <p class="mb-1 text-sm font-semibold text-caution-800">{{ 'INT.REG.POSSIBLE' | translate }}</p>
              <ul class="space-y-1.5">
                @for (c of p.possibleDuplicates; track c.id) {
                  <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><a class="font-semibold text-ink-900 no-underline hover:underline" [routerLink]="['/patients', c.id]">{{ c.fullName }}</a>
                      <span class="text-xs text-ink-600"> {{ c.patientCode }}@if (c.phone) { · {{ c.phone }} } — {{ 'PAT.DUP.REASONS.' + c.reason | translate }}</span></span>
                    <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy()" (click)="approve(p, c.id)">{{ 'INT.REG.MERGE_INTO' | translate }}</button>
                  </li>
                }
              </ul>
            </div>
          }
          <div class="flex justify-end gap-2 border-t border-ink-100 px-4 py-3">
            <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="reject(p)">{{ 'INT.REG.REJECT' | translate }}</button>
            <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="approve(p)">{{ 'INT.REG.APPROVE_NEW' | translate }}</button>
          </div>
        </li>
      } @empty {
        @if (!pending.loading()) { <li class="empty"><span class="empty-icon"><app-icon name="user-plus" [size]="20" /></span><p class="empty-title">{{ 'INT.REG.EMPTY' | translate }}</p><p class="empty-text">{{ 'INT.REG.EMPTY_TEXT' | translate }}</p></li> }
      }
    </ul>
  `,
})
export class RegistrationsComponent {
  private readonly api = inject(IntakeApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly counts = inject(NavCounts);

  protected readonly pending = loadable<PendingRegistration[]>([]);
  protected readonly busy = signal(false);

  constructor() {
    void this.pending.load(() => this.api.pendingRegistrations());
    refreshOnLive(['registration'], () => void this.pending.load(() => this.api.pendingRegistrations()));
  }

  /** The filled-in fields as label/value pairs, leaving out what was not answered. */
  protected details(p: PendingRegistration): [string, string][] {
    const rows: [string, string | null | undefined][] = [
      ['PUB.DOB', p.dateOfBirth], ['PUB.PHONE', p.phone], ['COMMON.EMAIL', p.email], ['PUB.REG.GENDER', p.gender ? (p.gender.toUpperCase() === 'F' ? this.translate.instant('PUB.REG.FEMALE') : this.translate.instant('PUB.REG.MALE')) : ''],
      ['PUB.REG.CIN', p.cin], ['PUB.REG.ADDRESS', p.address], ['PUB.REG.OCCUPATION', p.occupation], ['PUB.REG.INSURANCE_PROVIDER', p.insuranceProvider],
      ['PUB.REG.INSURANCE_NUMBER', p.insuranceNumber], ['PUB.REG.GUARDIAN_NAME', p.guardianName], ['PUB.REG.GUARDIAN_PHONE', p.guardianPhone],
    ];
    return rows.filter((r): r is [string, string] => !!r[1]);
  }

  protected async approve(p: PendingRegistration, mergeInto?: string): Promise<void> {
    await this.run(async () => {
      await this.api.approveRegistration(p.id, mergeInto);
      this.toast.success(this.translate.instant(mergeInto ? 'INT.REG.MERGED' : 'INT.REG.APPROVED'));
    });
  }

  protected async reject(p: PendingRegistration): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('INT.REG.REJECT_CONFIRM', { name: `${p.firstName} ${p.lastName}` }), { danger: true }))) {
      return;
    }
    await this.run(async () => {
      await this.api.rejectRegistration(p.id);
      this.toast.success(this.translate.instant('INT.REG.REJECTED'));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await Promise.all([this.pending.load(() => this.api.pendingRegistrations()), this.counts.refreshIntake()]);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
