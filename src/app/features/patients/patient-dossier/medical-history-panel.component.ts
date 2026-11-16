import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MedicalHistoryCategory, Severity } from '../../../core/models/clinical-record.model';
import { ClinicalRecordService, NOTHING_TO_REPORT_CATEGORY } from '../../../core/services/clinical-record.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { EmptyStateComponent } from '../../../shared/ui/empty-state.component';

/**
 * The medical history, edited rarely and read always: allergies, conditions, medications and the
 * rest, in one side panel opened from the alert strip and from the summary. Allergies sit with the
 * rest of the history here; before, they were on another tab (P0-2). Every deletion asks first.
 */
@Component({
  selector: 'app-medical-history-panel',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent, ModalComponent, EmptyStateComponent, AppDatePipe],
  template: `
    <app-modal [open]="open()" placement="side" size="md" [title]="'PATIENTS.DOSSIER.MEDICAL_HISTORY' | translate" (closed)="closed.emit()">
      <div class="space-y-6">
        <!-- Allergies -->
        <section aria-labelledby="mh-allergies">
          <header class="mb-2 flex items-center justify-between gap-2">
            <h3 id="mh-allergies" class="text-md font-bold">{{ 'ALERTS.ALLERGIES' | translate }}</h3>
            @if (canWrite() && !allergyForm()) {
              <button type="button" class="btn btn-secondary btn-sm" (click)="allergyForm.set(true)">
                <app-icon name="plus" [size]="14" /> {{ 'ALERTS.ADD_ALLERGY' | translate }}
              </button>
            }
          </header>
          @if (allergyForm()) {
            <form class="mb-3 space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3" (ngSubmit)="addAllergy()">
              <label class="field">
                <span class="label label-required">{{ 'ALERTS.SUBSTANCE' | translate }}</span>
                <input class="input" name="substance" required [(ngModel)]="allergy.substance" autocomplete="off" />
              </label>
              <label class="field">
                <span class="label">{{ 'ALERTS.REACTION' | translate }}</span>
                <input class="input" name="reaction" [(ngModel)]="allergy.reaction" autocomplete="off" />
              </label>
              <label class="field">
                <span class="label">{{ 'PATIENTS.DOSSIER.UI.SEVERITY' | translate }}</span>
                <select class="select" name="severity" [(ngModel)]="allergy.severity">
                  <option value="">{{ 'PATIENTS.DOSSIER.UI.NO_SEVERITY' | translate }}</option>
                  <option value="MILD">{{ 'PATIENTS.DOSSIER.UI.MILD' | translate }}</option>
                  <option value="MODERATE">{{ 'PATIENTS.DOSSIER.UI.MODERATE' | translate }}</option>
                  <option value="SEVERE">{{ 'PATIENTS.DOSSIER.UI.SEVERE' | translate }}</option>
                </select>
              </label>
              <div class="flex justify-end gap-2">
                <button type="button" class="btn btn-ghost btn-sm" (click)="allergyForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="!allergy.substance.trim() || busy()">{{ 'COMMON.SAVE' | translate }}</button>
              </div>
            </form>
          }
          @if (records.allergies().length) {
            <ul class="space-y-2">
              @for (a of records.allergies(); track a.id) {
                <li class="flex items-start justify-between gap-3 rounded-lg border border-critical-200 bg-critical-50 px-3 py-2">
                  <div class="min-w-0">
                    <p class="font-semibold text-critical-800">{{ a.substance }}
                      @if (a.severity) { <span class="pill pill-critical ms-1">{{ 'PATIENTS.DOSSIER.UI.' + a.severity | translate }}</span> }
                    </p>
                    @if (a.reaction) { <p class="text-sm text-ink-700">{{ a.reaction }}</p> }
                  </div>
                  @if (canWrite()) {
                    <button type="button" class="btn btn-ghost btn-icon" (click)="removeAllergy(a.id!, a.substance ?? '')"
                            [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + a.substance">
                      <app-icon name="trash" [size]="16" />
                    </button>
                  }
                </li>
              }
            </ul>
          } @else if (!allergyForm()) {
            <p class="text-sm text-ink-500">{{ 'ALERTS.NO_ALLERGIES' | translate }}</p>
          }
        </section>

        <!-- Conditions, medications and the rest -->
        <section aria-labelledby="mh-history">
          <header class="mb-2 flex items-center justify-between gap-2">
            <h3 id="mh-history" class="text-md font-bold">{{ 'ALERTS.HISTORY' | translate }}</h3>
            @if (canWrite() && !historyForm()) {
              <button type="button" class="btn btn-secondary btn-sm" (click)="historyForm.set(true)">
                <app-icon name="plus" [size]="14" /> {{ 'ALERTS.ADD_ENTRY' | translate }}
              </button>
            }
          </header>
          @if (historyForm()) {
            <form class="mb-3 space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3" (ngSubmit)="addHistory()">
              <label class="field">
                <span class="label">{{ 'PATIENTS.DOSSIER.UI.CATEGORY' | translate }}</span>
                <select class="select" name="category" [(ngModel)]="entry.category">
                  @for (cat of categories; track cat) { <option [value]="cat">{{ 'CONSULTATION.CAT_' + cat | translate }}</option> }
                </select>
              </label>
              <label class="field">
                <span class="label label-required">{{ 'PATIENTS.DOSSIER.UI.HISTORY_LABEL' | translate }}</span>
                <input class="input" name="label" required [(ngModel)]="entry.label" autocomplete="off" />
              </label>
              <label class="field">
                <span class="label">{{ 'PATIENTS.DOSSIER.UI.DETAIL_OPTIONAL' | translate }}</span>
                <textarea class="textarea" name="detail" rows="2" [(ngModel)]="entry.detail"></textarea>
              </label>
              <div class="flex justify-end gap-2">
                <button type="button" class="btn btn-ghost btn-sm" (click)="historyForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="!entry.label.trim() || busy()">{{ 'COMMON.SAVE' | translate }}</button>
              </div>
            </form>
          }
          @if (records.medicalHistory().length) {
            <ul class="space-y-2">
              @for (h of records.medicalHistory(); track h.id) {
                <li class="flex items-start justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2"
                    [class.border-caution-300]="h.category === 'CONDITION' || h.category === 'MEDICATION'"
                    [class.bg-caution-50]="h.category === 'CONDITION' || h.category === 'MEDICATION'">
                  <div class="min-w-0">
                    <p class="text-xs font-bold uppercase tracking-wide text-ink-500">{{ 'CONSULTATION.CAT_' + h.category | translate }}</p>
                    <p class="font-semibold text-ink-900">{{ h.label }}</p>
                    @if (h.detail) { <p class="whitespace-pre-line text-sm text-ink-700">{{ h.detail }}</p> }
                  </div>
                  @if (canWrite()) {
                    <button type="button" class="btn btn-ghost btn-icon" (click)="removeHistory(h.id!, h.label ?? '')"
                            [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + h.label">
                      <app-icon name="trash" [size]="16" />
                    </button>
                  }
                </li>
              }
            </ul>
          } @else if (!historyForm()) {
            <p class="text-sm text-ink-500">{{ 'PATIENTS.DOSSIER.NO_MEDICAL_HISTORY' | translate }}</p>
          }
        </section>

        <!-- Asked, and nothing to report: said once, so the strip can say so instead of "not asked". -->
        @if (canWrite()) {
          <section class="rounded-lg border border-dashed border-ink-300 p-3">
            @if (reviewedOn(); as date) {
              <p class="text-sm text-ink-600">{{ 'ALERTS.REVIEWED_ON' | translate: { date: (date | appDate) } }}</p>
            }
            @if (records.alertsState() !== 'alerts') {
              <button type="button" class="btn btn-secondary btn-sm mt-1" [disabled]="busy()" (click)="nothingToReport()">
                <app-icon name="check" [size]="14" /> {{ 'ALERTS.NOTHING_TO_REPORT' | translate }}
              </button>
              <p class="hint mt-1">{{ 'ALERTS.NOTHING_TO_REPORT_HINT' | translate }}</p>
            }
          </section>
        }
      </div>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">{{ 'COMMON.CLOSE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class MedicalHistoryPanelComponent {
  readonly open = input(false);
  readonly patientId = input.required<string>();
  readonly closed = output<void>();

  protected readonly records = inject(ClinicalRecordService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  protected readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));
  protected readonly busy = signal(false);
  protected readonly allergyForm = signal(false);
  protected readonly historyForm = signal(false);
  protected readonly categories: MedicalHistoryCategory[] = ['CONDITION', 'MEDICATION', 'SURGERY', 'DENTAL_HISTORY', 'FAMILY', 'LIFESTYLE', 'OTHER'];

  protected allergy: { substance: string; reaction: string; severity: Severity | '' } = { substance: '', reaction: '', severity: '' };
  protected entry: { category: MedicalHistoryCategory; label: string; detail: string } = { category: 'CONDITION', label: '', detail: '' };

  /** When the patient last said there was nothing to report. */
  protected readonly reviewedOn = computed(() => {
    const notes = this.records.notes().filter(n => n.category === NOTHING_TO_REPORT_CATEGORY && !n.sessionId);
    return notes.map(n => n.createdAt ?? '').sort().pop() || null;
  });

  protected addAllergy(): void {
    if (!this.allergy.substance.trim() || this.busy()) return;
    this.busy.set(true);
    this.records.addAllergy(this.patientId(), {
      substance: this.allergy.substance.trim(),
      reaction: this.allergy.reaction.trim() || undefined,
      severity: this.allergy.severity || undefined,
      source: 'manual',
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.allergy = { substance: '', reaction: '', severity: '' };
        this.allergyForm.set(false);
        this.toast.success(this.translate.instant('ALERTS.ALLERGY_ADDED'));
      },
      error: (err) => this.fail(err),
    });
  }

  protected addHistory(): void {
    if (!this.entry.label.trim() || this.busy()) return;
    this.busy.set(true);
    this.records.addMedicalHistory(this.patientId(), {
      category: this.entry.category,
      label: this.entry.label.trim(),
      detail: this.entry.detail.trim() || undefined,
      source: 'manual',
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.entry = { category: 'CONDITION', label: '', detail: '' };
        this.historyForm.set(false);
        this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.HISTORY_ADDED'));
      },
      error: (err) => this.fail(err),
    });
  }

  protected async removeAllergy(id: string, substance: string): Promise<void> {
    const ok = await this.confirmDialog.confirm(
      this.translate.instant('ALERTS.ALLERGY_DELETE_CONFIRM', { label: substance }),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') });
    if (!ok) return;
    this.records.deleteAllergy(this.patientId(), id).subscribe({
      next: () => this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.ENTRY_REMOVED')),
      error: (err) => this.fail(err),
    });
  }

  protected async removeHistory(id: string, label: string): Promise<void> {
    const ok = await this.confirmDialog.confirm(
      this.translate.instant('PATIENTS.DOSSIER.UI.HISTORY_DELETE_CONFIRM', { label }),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') });
    if (!ok) return;
    this.records.deleteMedicalHistory(this.patientId(), id).subscribe({
      next: () => this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.ENTRY_REMOVED')),
      error: (err) => this.fail(err),
    });
  }

  protected nothingToReport(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.records.addNote(this.patientId(), {
      category: NOTHING_TO_REPORT_CATEGORY,
      content: this.translate.instant('ALERTS.NOTHING_TO_REPORT_NOTE'),
      source: 'manual',
    }).subscribe({
      next: () => this.busy.set(false),
      error: (err) => this.fail(err),
    });
  }

  private fail(err: { error?: { detail?: string; message?: string } }): void {
    this.busy.set(false);
    this.toast.error(err?.error?.detail || err?.error?.message || this.translate.instant('COMMON.SAVE_FAILED'));
  }
}
