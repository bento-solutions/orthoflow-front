import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { OperationsApi, Appointment } from '../../core/services/operations-api.service';
import { ItemAction, SterilItem, SterilizationApi } from '../../core/services/sterilization-api.service';
import { ToastService } from '../../core/services/toast.service';
import { isoDate } from '../../core/utils/format';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../shared/ui/patient-picker.component';

/** Tone of an item's state: sterile is settled, used and waiting for cleaning need attention, in a cycle waits for its control. */
export function stateTone(state: SterilItem['state']): string {
  return { READY: 'pill-done', USED: 'pill-critical', DIRTY: 'pill-attention', PROCESSED: 'pill-active' }[state];
}

/** The appointments of a patient today that are not over: the one the item was probably used at. Arrived or in the chair first. */
export function candidateAppointments(all: readonly Pick<Appointment, 'id' | 'patientId' | 'status' | 'dateTime'>[], patientId: string): typeof all[number][] {
  const rank: Record<string, number> = { IN_CHAIR: 0, ARRIVED: 1, LATE: 2, CONFIRMED: 3, SCHEDULED: 4 };
  return all
    .filter(a => a.patientId === patientId && rank[a.status] !== undefined)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.dateTime.localeCompare(b.dateTime));
}

/**
 * What can be done to an item from where it stands (use it on a patient, send it to cleaning,
 * lubricate a handpiece), as buttons for exactly those actions, each doing one thing and telling
 * the screen the item changed. Using an item records who it was used on: that is the link that
 * lets a failed autoclave control be traced to the patients it touched.
 */
@Component({
  selector: 'app-item-actions',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, ModalComponent, PatientPickerComponent],
  template: `
    <div class="flex flex-wrap gap-2">
      @for (a of item().nextActions; track a) {
        @if (a === 'ADD_TO_CYCLE') {
          <button type="button" class="btn btn-secondary btn-sm" (click)="addToCycle.emit(item())">{{ 'STER.ACTIONS.ADD_TO_CYCLE' | translate }}</button>
        } @else {
          <button type="button" class="btn btn-sm" [class.btn-primary]="a === 'USE'" [class.btn-secondary]="a !== 'USE'" [disabled]="busy()" (click)="run(a)">{{ 'STER.ACTIONS.' + a | translate }}</button>
        }
      }
    </div>

    <app-modal [open]="using()" [title]="'STER.USE.TITLE' | translate" size="md" [dismissable]="!busy()" (closed)="using.set(false)">
      <form id="use-form" class="space-y-4" (ngSubmit)="use()">
        <p class="text-sm text-ink-700"><strong>{{ item().code }}</strong> · {{ item().name }}</p>
        <div class="field"><span class="label label-required">{{ 'COMMON.PATIENT' | translate }}</span>
          <app-patient-picker [value]="patient()" (valueChange)="pickPatient($event)" [label]="'COMMON.PATIENT' | translate" /></div>
        @if (appointments().length) {
          <label class="field"><span class="label">{{ 'STER.USE.APPOINTMENT' | translate }}</span>
            <select class="select" name="appointment" [ngModel]="appointmentId()" (ngModelChange)="appointmentId.set($event)">
              <option value="">—</option>
              @for (a of appointments(); track a.id) { <option [value]="a.id">{{ a.dateTime | date: 'shortTime' }} — {{ a.type }} ({{ 'SCHEDULE.STATUS.' + a.status | translate }})</option> }
            </select></label>
        }
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><input class="input" name="note" maxlength="500" [ngModel]="note()" (ngModelChange)="note.set($event)" /></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="using.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="use-form" class="btn btn-primary" [disabled]="busy() || !patient()">{{ 'STER.ACTIONS.USE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="lubricating()" [title]="'STER.LUB.TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="lubricating.set(false)">
      <form id="lub-form" class="space-y-3" (ngSubmit)="lubricate()">
        <p class="text-sm text-ink-700"><strong>{{ item().code }}</strong> · {{ item().name }}</p>
        <label class="field"><span class="label">{{ 'STER.LUB.PRODUCT' | translate }}</span><input class="input" name="product" maxlength="120" [ngModel]="product()" (ngModelChange)="product.set($event)" /></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="lubricating.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="lub-form" class="btn btn-primary" [disabled]="busy()">{{ 'STER.ACTIONS.LUBRICATE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class ItemActionsComponent {
  readonly item = input.required<SterilItem>();
  readonly changed = output<SterilItem>();
  readonly addToCycle = output<SterilItem>();

  private readonly api = inject(SterilizationApi);
  private readonly operations = inject(OperationsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly busy = signal(false);
  protected readonly using = signal(false);
  protected readonly patient = signal<PickedPatient | null>(null);
  protected readonly appointments = signal<Appointment[]>([]);
  protected readonly appointmentId = signal('');
  protected readonly note = signal('');
  protected readonly lubricating = signal(false);
  protected readonly product = signal('');
  protected readonly hasAdd = computed(() => this.item().nextActions.includes('ADD_TO_CYCLE'));

  protected run(action: ItemAction): void {
    if (action === 'USE') {
      this.patient.set(null);
      this.appointments.set([]);
      this.appointmentId.set('');
      this.note.set('');
      this.using.set(true);
    } else if (action === 'LUBRICATE') {
      this.product.set('');
      this.lubricating.set(true);
    } else if (action === 'CLEAN') {
      void this.act(() => this.api.cleanItem(this.item().id), 'STER.CLEANED');
    }
  }

  protected async pickPatient(patient: PickedPatient | null): Promise<void> {
    this.patient.set(patient);
    this.appointmentId.set('');
    this.appointments.set([]);
    if (!patient) {
      return;
    }
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86_400_000);
      const today = await this.operations.upcomingAppointments(start.toISOString(), end.toISOString());
      if (this.patient()?.id === patient.id) {
        const candidates = candidateAppointments(today, patient.id) as Appointment[];
        this.appointments.set(candidates);
        // The appointment that is under way is almost certainly the one.
        this.appointmentId.set(candidates[0] && ['IN_CHAIR', 'ARRIVED'].includes(candidates[0].status) ? candidates[0].id : '');
      }
    } catch {
      // the appointment is optional; the use can still be recorded without it
    }
  }

  protected async use(): Promise<void> {
    const patient = this.patient();
    if (!patient || this.busy()) {
      return;
    }
    await this.act(() => this.api.useItem(this.item().id, { patientId: patient.id, appointmentId: this.appointmentId() || undefined, note: this.note().trim() || undefined }), 'STER.USED', () => this.using.set(false));
  }

  protected async lubricate(): Promise<void> {
    await this.act(() => this.api.lubricateItem(this.item().id, this.product().trim() || undefined), 'STER.LUBRICATED', () => this.lubricating.set(false));
  }

  private async act(call: () => Promise<SterilItem>, doneKey: string, after?: () => void): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const updated = await call();
      after?.();
      this.toast.success(this.translate.instant(doneKey, { code: updated.code }));
      this.changed.emit(updated);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
