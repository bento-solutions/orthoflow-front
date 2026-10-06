import { Component, inject, input, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { IntakeApi } from '../../core/services/intake-api.service';
import { ToastService } from '../../core/services/toast.service';
import { CanDirective } from '../../shared/directives/can.directive';
import { ModalComponent } from '../../shared/ui/modal.component';

/**
 * A personal link for this patient to fill in their own file (identity, contact, insurance and
 * consent) from their phone. Only a link is made: the clinic sends it however it likes. The link
 * works once, and what comes back is checked by the front desk before it touches the file.
 */
@Component({
  selector: 'app-registration-invite',
  standalone: true,
  imports: [TranslateModule, ModalComponent, CanDirective],
  template: `
    <button *appCan="'PATIENT_WRITE'" type="button" class="btn btn-secondary btn-compact" [disabled]="busy()" (click)="create()">
      <span class="btn-label">{{ 'PAT.INVITE.BUTTON' | translate }}</span>
    </button>
    <app-modal [open]="url() !== null" [title]="'PAT.INVITE.TITLE' | translate" size="md" (closed)="url.set(null)">
      <p class="mb-3 text-sm text-ink-700">{{ 'PAT.INVITE.HINT' | translate: { name: name() } }}</p>
      <div class="flex gap-2">
        <input class="input mono flex-1" readonly [value]="url() ?? ''" [attr.aria-label]="'PAT.INVITE.LINK' | translate" (focus)="$any($event.target).select()" />
        <button type="button" class="btn btn-primary" (click)="copy()">{{ (copied() ? 'PAT.INVITE.COPIED' : 'PAT.INVITE.COPY') | translate }}</button>
      </div>
      <p class="mt-3 text-xs text-ink-500">{{ 'PAT.INVITE.ONCE' | translate }}</p>
      <div modal-footer><button type="button" class="btn btn-secondary" (click)="url.set(null)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>
  `,
})
export class RegistrationInviteComponent {
  readonly patientId = input.required<string>();
  readonly name = input('');

  private readonly api = inject(IntakeApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly busy = signal(false);
  protected readonly url = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected async create(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      this.copied.set(false);
      this.url.set((await this.api.inviteToRegister(this.patientId())).url);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(): Promise<void> {
    const url = this.url();
    if (!url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
    } catch {
      // clipboard access can be refused: the field is selectable, so say so rather than fail silently
      this.toast.info(this.translate.instant('PAT.INVITE.COPY_MANUALLY'));
    }
  }
}
