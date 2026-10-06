import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { PermissionService } from '../../../core/services/permission.service';
import { Practitioner, PractitionerInput, PractitionerService, SPECIALTIES, UnmatchedName } from '../../../core/services/practitioner.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserAdminService, UserRow } from '../../../core/services/user-admin.service';
import { formState } from '../../../core/utils/form-state';
import { loadable } from '../../../core/utils/loadable';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';

interface Form {
  displayName: string;
  specialty: string;
  color: string;
  inpe: string;
  userId: string;
  active: boolean;
}

const EMPTY: Form = { displayName: '', specialty: 'ORTHODONTICS', color: '#2563eb', inpe: '', userId: '', active: true };

/**
 * The people who treat patients. A practitioner may have no login (a visiting
 * orthodontist), so this is its own list, linked to a user only when there is one.
 * Order matters: it is the order of the agenda's columns and every dropdown.
 */
@Component({
  selector: 'app-team-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, ModalComponent, IconComponent],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'SET.TEAM.TITLE' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'SET.TEAM.HINT' | translate }}</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" (click)="openNew()">
          <app-icon name="plus" [size]="15" /> {{ 'SET.TEAM.ADD' | translate }}
        </button>
      </div>
      <div class="table-wrap">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="w-10"></th>
                <th>{{ 'COMMON.NAME' | translate }}</th>
                <th>{{ 'SET.TEAM.SPECIALTY' | translate }}</th>
                <th>INPE</th>
                <th>{{ 'SET.TEAM.LOGIN' | translate }}</th>
                <th>{{ 'COMMON.STATUS' | translate }}</th>
                <th class="cell-actions">{{ 'COMMON.ACTIONS' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (p of team.data(); track p.id; let i = $index; let last = $last) {
                <tr>
                  <td><span class="inline-block h-3 w-3 rounded-full" [style.background]="p.color" aria-hidden="true"></span></td>
                  <td class="font-semibold">{{ p.displayName }}</td>
                  <td>{{ 'SET.TEAM.SPEC.' + p.specialty | translate }}</td>
                  <td class="mono">{{ p.inpe || '—' }}</td>
                  <td>{{ loginOf(p) }}</td>
                  <td><span class="pill" [class.pill-done]="p.active" [class.pill-idle]="!p.active">{{ (p.active ? 'COMMON.ACTIVE' : 'COMMON.INACTIVE') | translate }}</span></td>
                  <td class="cell-actions">
                    <button type="button" class="btn btn-ghost btn-icon" [disabled]="i === 0" (click)="move(i, -1)" [attr.aria-label]="('SET.TEAM.MOVE_UP' | translate) + ' ' + p.displayName">
                      <app-icon name="chevron-up" [size]="16" />
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon" [disabled]="last" (click)="move(i, 1)" [attr.aria-label]="('SET.TEAM.MOVE_DOWN' | translate) + ' ' + p.displayName">
                      <app-icon name="chevron-down" [size]="16" />
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(p)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + p.displayName">
                      <app-icon name="edit" [size]="16" />
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ 'SET.TEAM.EMPTY' | translate }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>

    @if (unmatched().length > 0) {
      <section class="card mt-6">
        <div class="card-head">
          <div>
            <h2 class="text-lg font-bold text-ink-900">{{ 'SET.TEAM.UNMATCHED_TITLE' | translate }}</h2>
            <p class="text-sm text-ink-500">{{ 'SET.TEAM.UNMATCHED_HINT' | translate }}</p>
          </div>
        </div>
        <div class="table-wrap">
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>{{ 'SET.TEAM.UNMATCHED_NAME' | translate }}</th><th class="cell-num">{{ 'SET.TEAM.UNMATCHED_ROWS' | translate }}</th><th>{{ 'COMMON.PRACTITIONER' | translate }}</th><th></th></tr></thead>
              <tbody>
                @for (u of unmatched(); track u.doctorName) {
                  <tr>
                    <td class="font-semibold">{{ u.doctorName }}</td>
                    <td class="cell-num">{{ u.rowCount }}</td>
                    <td>
                      <select class="select" [ngModel]="choice()[u.doctorName] ?? ''" (ngModelChange)="choose(u.doctorName, $event)" [attr.aria-label]="'COMMON.PRACTITIONER' | translate">
                        <option value="">—</option>
                        @for (p of team.data(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
                      </select>
                    </td>
                    <td class="cell-actions">
                      <button type="button" class="btn btn-secondary btn-sm" [disabled]="!choice()[u.doctorName]" (click)="resolve(u)">{{ 'SET.TEAM.ASSIGN' | translate }}</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    }

    <app-modal [open]="editing() !== null" [title]="(editing() === 'new' ? 'SET.TEAM.ADD' : 'SET.TEAM.EDIT') | translate" (closed)="editing.set(null)">
      <form id="practitioner-form" class="grid gap-4 sm:grid-cols-2" (ngSubmit)="save()">
        <label class="field sm:col-span-2">
          <span class="label label-required">{{ 'COMMON.NAME' | translate }}</span>
          <input class="input" name="displayName" required maxlength="150" [ngModel]="form.value().displayName" (ngModelChange)="form.set('displayName', $event)" />
        </label>
        <label class="field">
          <span class="label">{{ 'SET.TEAM.SPECIALTY' | translate }}</span>
          <select class="select" name="specialty" [ngModel]="form.value().specialty" (ngModelChange)="form.set('specialty', $event)">
            @for (s of specialties; track s) { <option [value]="s">{{ 'SET.TEAM.SPEC.' + s | translate }}</option> }
          </select>
        </label>
        <label class="field">
          <span class="label">{{ 'SET.TEAM.COLOR' | translate }}</span>
          <input class="input h-10 p-1" type="color" name="color" [ngModel]="form.value().color" (ngModelChange)="form.set('color', $event)" />
          <span class="hint">{{ 'SET.TEAM.COLOR_HINT' | translate }}</span>
        </label>
        <label class="field">
          <span class="label">INPE</span>
          <input class="input mono" name="inpe" maxlength="20" [ngModel]="form.value().inpe" (ngModelChange)="form.set('inpe', $event)" />
        </label>
        @if (canLinkUsers()) {
          <label class="field">
            <span class="label">{{ 'SET.TEAM.LOGIN' | translate }}</span>
            <select class="select" name="userId" [ngModel]="form.value().userId" (ngModelChange)="form.set('userId', $event)">
              <option value="">{{ 'SET.TEAM.NO_LOGIN' | translate }}</option>
              @for (u of users(); track u.id) { <option [value]="u.id">{{ u.firstName }} {{ u.lastName }} ({{ u.email }})</option> }
            </select>
            <span class="hint">{{ 'SET.TEAM.LOGIN_HINT' | translate }}</span>
          </label>
        }
        @if (editing() !== 'new') {
          <label class="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="active" [ngModel]="form.value().active" (ngModelChange)="form.set('active', $event)" />
            {{ 'COMMON.ACTIVE' | translate }}
            <span class="hint">{{ 'SET.TEAM.ACTIVE_HINT' | translate }}</span>
          </label>
        }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="practitioner-form" class="btn btn-primary" [disabled]="saving() || !form.value().displayName.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class TeamSettingsComponent {
  private readonly practitioners = inject(PractitionerService);
  private readonly admin = inject(UserAdminService);
  private readonly permissions = inject(PermissionService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);

  protected readonly specialties = SPECIALTIES;
  protected readonly team = loadable<Practitioner[]>([]);
  protected readonly users = signal<UserRow[]>([]);
  protected readonly unmatched = signal<UnmatchedName[]>([]);
  protected readonly choice = signal<Record<string, string>>({});
  protected readonly editing = signal<'new' | Practitioner | null>(null);
  protected readonly saving = signal(false);
  protected readonly form = formState<Form>({ ...EMPTY });
  protected readonly canLinkUsers = computed(() => this.permissions.can('USERS_MANAGE'));

  constructor() {
    void this.reload();
    if (this.permissions.can('USERS_MANAGE')) {
      this.admin.users().then(u => this.users.set(u)).catch(() => undefined);
    }
  }

  protected loginOf(p: Practitioner): string {
    const user = this.users().find(u => u.id === p.userId);
    return p.userId ? (user ? `${user.firstName} ${user.lastName}` : '✓') : '—';
  }

  private async reload(): Promise<void> {
    await this.team.load(() => this.practitioners.list(true));
    this.practitioners.unmatchedNames().then(u => this.unmatched.set(u)).catch(() => undefined);
  }

  protected openNew(): void {
    this.form.reset({ ...EMPTY });
    this.editing.set('new');
  }

  protected openEdit(p: Practitioner): void {
    this.form.reset({ displayName: p.displayName, specialty: p.specialty, color: p.color, inpe: p.inpe ?? '', userId: p.userId ?? '', active: p.active });
    this.editing.set(p);
  }

  protected async save(): Promise<void> {
    const f = this.form.value();
    const target = this.editing();
    if (!target || !f.displayName.trim()) {
      return;
    }
    const input: PractitionerInput = {
      displayName: f.displayName.trim(),
      specialty: f.specialty as PractitionerInput['specialty'],
      color: f.color,
      inpe: f.inpe.trim() || undefined,
      userId: f.userId || undefined,
      active: target === 'new' ? true : f.active,
    };
    this.saving.set(true);
    try {
      if (target === 'new') {
        await this.practitioners.create(input);
      } else {
        await this.practitioners.update(target.id, input);
      }
      this.editing.set(null);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async move(index: number, by: -1 | 1): Promise<void> {
    const ids = this.team.data().map(p => p.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) {
      return;
    }
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await this.practitioners.reorder(ids);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected choose(name: string, practitionerId: string): void {
    this.choice.update(c => ({ ...c, [name]: practitionerId }));
  }

  protected async resolve(u: UnmatchedName): Promise<void> {
    try {
      const { updated } = await this.practitioners.resolveUnmatched(u.doctorName, this.choice()[u.doctorName]);
      this.toast.success(`${updated}`);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    }
  }
}
