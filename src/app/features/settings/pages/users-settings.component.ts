import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionMatrix, ROLES, Role, UserAdminService, UserRow } from '../../../core/services/user-admin.service';
import { formState } from '../../../core/utils/form-state';
import { loadable } from '../../../core/utils/loadable';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';

interface Form {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  active: boolean;
}

const EMPTY: Form = { email: '', firstName: '', lastName: '', role: 'ASSISTANT', active: true };

/** Permissions grouped the way a person thinks about them, so the matrix reads as areas, not 29 loose switches. */
const GROUPS: ReadonlyArray<{ key: string; permissions: string[] }> = [
  { key: 'PATIENTS', permissions: ['PATIENT_READ', 'PATIENT_WRITE', 'PATIENT_DELETE', 'PATIENT_MERGE'] },
  { key: 'CLINICAL', permissions: ['CLINICAL_READ', 'CLINICAL_WRITE', 'STERILIZATION_MANAGE', 'LAB_ORDERS_MANAGE'] },
  { key: 'AGENDA', permissions: ['AGENDA_VIEW', 'AGENDA_MANAGE', 'WAITING_ROOM_MANAGE', 'BOOKING_REVIEW'] },
  { key: 'MONEY', permissions: ['BILLING_READ', 'BILLING_WRITE', 'FINANCE_VIEW', 'FINANCE_MANAGE', 'EXPENSES_MANAGE', 'RETROCESSION_VIEW', 'RETROCESSION_MANAGE'] },
  { key: 'STOCK', permissions: ['STOCK_READ', 'STOCK_WRITE'] },
  { key: 'TEAM', permissions: ['TASKS_MANAGE', 'TASKS_ADMIN', 'MESSAGING_SEND', 'MESSAGING_VIEW', 'SURVEYS_VIEW', 'ANALYTICS_VIEW'] },
  { key: 'ADMIN', permissions: ['SETTINGS_MANAGE', 'USERS_MANAGE'] },
];

/**
 * The people who can sign in, and what each role may do. Inviting hands back a
 * one-time link to set a password (shown here because the clinic may have no mail
 * transport). The permission matrix edits what a role holds; the administrator role
 * always holds everything, so it is shown but not editable.
 */
@Component({
  selector: 'app-users-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, DatePipe, ModalComponent, IconComponent],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'SET.USERS.TITLE' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'SET.USERS.HINT' | translate }}</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" (click)="openNew()"><app-icon name="user-plus" [size]="15" /> {{ 'SET.USERS.INVITE' | translate }}</button>
      </div>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>{{ 'COMMON.NAME' | translate }}</th><th>Email</th><th>{{ 'SET.USERS.ROLE' | translate }}</th>
            <th>{{ 'SET.USERS.LAST_LOGIN' | translate }}</th><th>{{ 'COMMON.STATUS' | translate }}</th><th class="cell-actions">{{ 'COMMON.ACTIONS' | translate }}</th>
          </tr></thead>
          <tbody>
            @for (u of users.data(); track u.id) {
              <tr>
                <td class="font-semibold">{{ u.firstName }} {{ u.lastName }}</td>
                <td>{{ u.email }}</td>
                <td>{{ 'SET.USERS.ROLES.' + u.role | translate }}</td>
                <td>{{ u.lastLoginAt ? (u.lastLoginAt | date: 'short') : '—' }}</td>
                <td>
                  <span class="pill" [class.pill-done]="u.active" [class.pill-idle]="!u.active">{{ (u.active ? 'COMMON.ACTIVE' : 'COMMON.INACTIVE') | translate }}</span>
                  @if (u.mustChangePassword) { <span class="pill pill-attention ms-1">{{ 'SET.USERS.MUST_CHANGE' | translate }}</span> }
                </td>
                <td class="cell-actions">
                  <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(u)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + u.email"><app-icon name="edit" [size]="16" /></button>
                  <button type="button" class="btn btn-ghost btn-icon" (click)="forceReset(u)" [attr.aria-label]="('SET.USERS.RESET' | translate) + ' ' + u.email" [title]="'SET.USERS.RESET' | translate"><app-icon name="lock" [size]="16" /></button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div></div>
    </section>

    <section class="card mt-6">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'SET.PERMISSIONS.TITLE' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'SET.PERMISSIONS.HINT' | translate }}</p>
        </div>
      </div>
      @if (matrix(); as m) {
        <div class="table-wrap"><div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ 'SET.PERMISSIONS.PERMISSION' | translate }}</th>
                @for (role of roles; track role) {
                  <th class="text-center">
                    {{ 'SET.USERS.ROLES.' + role | translate }}
                    @if (m.customised.includes(role)) { <span class="pill pill-active pill-nodot ms-1">{{ 'SET.PERMISSIONS.CUSTOM' | translate }}</span> }
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (group of groups; track group.key) {
                <tr><th [attr.colspan]="roles.length + 1" class="bg-ink-50 text-start text-xs font-bold uppercase tracking-wide text-ink-600">{{ 'SET.PERMISSIONS.GROUP.' + group.key | translate }}</th></tr>
                @for (p of group.permissions; track p) {
                  <tr>
                    <td>{{ 'SET.PERMISSIONS.NAMES.' + p | translate }} <span class="mono text-2xs text-ink-400">{{ p }}</span></td>
                    @for (role of roles; track role) {
                      <td class="text-center">
                        <input type="checkbox" [checked]="draft()[role]?.has(p)" [disabled]="role === 'ADMIN' || !canManage()" (change)="toggle(role, p, $any($event.target).checked)"
                          [attr.aria-label]="('SET.PERMISSIONS.NAMES.' + p | translate) + ' — ' + ('SET.USERS.ROLES.' + role | translate)" />
                      </td>
                    }
                  </tr>
                }
              }
            </tbody>
          </table>
        </div></div>
        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3">
          @for (role of editableRoles; track role) {
            @if (m.customised.includes(role)) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="resetRole(role)">{{ 'SET.PERMISSIONS.RESET_ROLE' | translate: { role: ('SET.USERS.ROLES.' + role | translate) } }}</button>
            }
          }
          <button type="button" class="btn btn-primary btn-sm" [disabled]="!dirty() || saving()" (click)="savePermissions()">{{ 'SET.PERMISSIONS.SAVE' | translate }}</button>
        </div>
      }
    </section>

    <app-modal [open]="editing() !== null" [title]="(editing() === 'new' ? 'SET.USERS.INVITE' : 'SET.USERS.EDIT') | translate" (closed)="editing.set(null)">
      <form id="user-form" class="grid gap-4 sm:grid-cols-2" (ngSubmit)="save()">
        <label class="field"><span class="label label-required">{{ 'SET.USERS.FIRST_NAME' | translate }}</span>
          <input class="input" name="firstName" required [ngModel]="form.value().firstName" (ngModelChange)="form.set('firstName', $event)" /></label>
        <label class="field"><span class="label label-required">{{ 'SET.USERS.LAST_NAME' | translate }}</span>
          <input class="input" name="lastName" required [ngModel]="form.value().lastName" (ngModelChange)="form.set('lastName', $event)" /></label>
        @if (editing() === 'new') {
          <label class="field sm:col-span-2"><span class="label label-required">Email</span>
            <input class="input" type="email" name="email" required [ngModel]="form.value().email" (ngModelChange)="form.set('email', $event)" /></label>
        }
        <label class="field"><span class="label">{{ 'SET.USERS.ROLE' | translate }}</span>
          <select class="select" name="role" [ngModel]="form.value().role" (ngModelChange)="form.set('role', $event)">
            @for (r of roles; track r) { <option [value]="r">{{ 'SET.USERS.ROLES.' + r | translate }}</option> }
          </select></label>
        @if (editing() !== 'new') {
          <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="active" [ngModel]="form.value().active" (ngModelChange)="form.set('active', $event)" /> {{ 'COMMON.ACTIVE' | translate }}</label>
        }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="user-form" class="btn btn-primary" [disabled]="saving()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="invite() !== null" [title]="'SET.USERS.LINK_TITLE' | translate" [dismissable]="false">
      <p class="text-sm text-ink-700">{{ 'SET.USERS.LINK_HINT' | translate }}</p>
      <div class="mt-3 flex gap-2">
        <input class="input mono flex-1" readonly [value]="invite()?.inviteUrl ?? ''" aria-label="URL" (focus)="$any($event.target).select()" />
        <button type="button" class="btn btn-secondary" (click)="copyLink()"><app-icon name="copy" [size]="15" /> {{ 'SET.USERS.COPY' | translate }}</button>
      </div>
      <div modal-footer><button type="button" class="btn btn-primary" (click)="invite.set(null)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>
  `,
})
export class UsersSettingsComponent {
  private readonly admin = inject(UserAdminService);
  private readonly permissions = inject(PermissionService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);

  protected readonly roles = ROLES;
  protected readonly editableRoles = ROLES.filter(r => r !== 'ADMIN');
  protected readonly groups = GROUPS;
  protected readonly users = loadable<UserRow[]>([]);
  protected readonly matrix = signal<PermissionMatrix | null>(null);
  /** Edits not yet saved, per role. */
  protected readonly draft = signal<Record<string, Set<string>>>({});
  protected readonly editing = signal<'new' | UserRow | null>(null);
  protected readonly invite = signal<{ inviteUrl: string } | null>(null);
  protected readonly saving = signal(false);
  protected readonly form = formState<Form>({ ...EMPTY });
  protected readonly canManage = computed(() => this.permissions.can('USERS_MANAGE'));
  protected readonly dirty = computed(() => {
    const m = this.matrix();
    if (!m) {
      return false;
    }
    return this.editableRoles.some(role => {
      const saved = new Set<string>((m.byRole[role] as string[] | undefined) ?? []);
      const now = this.draft()[role] ?? saved;
      return saved.size !== now.size || [...saved].some(p => !now.has(p));
    });
  });

  constructor() {
    void this.users.load(() => this.admin.users());
    void this.loadMatrix();
  }

  private async loadMatrix(): Promise<void> {
    try {
      this.setMatrix(await this.admin.permissions());
    } catch (error) {
      this.errors.report(error);
    }
  }

  private setMatrix(m: PermissionMatrix): void {
    this.matrix.set(m);
    this.draft.set(Object.fromEntries(ROLES.map(role => [role, new Set<string>((m.byRole[role] as string[] | undefined) ?? [])])));
  }

  protected toggle(role: Role, permission: string, on: boolean): void {
    this.draft.update(d => {
      const next = new Set(d[role] ?? []);
      if (on) {
        next.add(permission);
      } else {
        next.delete(permission);
      }
      return { ...d, [role]: next };
    });
  }

  protected async savePermissions(): Promise<void> {
    const m = this.matrix();
    if (!m) {
      return;
    }
    this.saving.set(true);
    try {
      let latest = m;
      for (const role of this.editableRoles) {
        const saved = new Set<string>((m.byRole[role] as string[] | undefined) ?? []);
        const now = this.draft()[role] ?? saved;
        if (saved.size !== now.size || [...saved].some(p => !now.has(p))) {
          latest = await this.admin.setPermissions(role, [...now]);
        }
      }
      this.setMatrix(latest);
      await this.permissions.load();
      this.toast.success('✓');
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async resetRole(role: Role): Promise<void> {
    try {
      this.setMatrix(await this.admin.resetPermissions(role));
      await this.permissions.load();
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected openNew(): void {
    this.form.reset({ ...EMPTY });
    this.editing.set('new');
  }

  protected openEdit(u: UserRow): void {
    this.form.reset({ email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role as Role, active: u.active });
    this.editing.set(u);
  }

  protected async save(): Promise<void> {
    const f = this.form.value();
    const target = this.editing();
    if (!target) {
      return;
    }
    this.saving.set(true);
    try {
      if (target === 'new') {
        const result = await this.admin.invite({ email: f.email.trim(), firstName: f.firstName.trim(), lastName: f.lastName.trim(), role: f.role });
        this.invite.set({ inviteUrl: result.inviteUrl });
      } else {
        await this.admin.update(target.id, { firstName: f.firstName.trim(), lastName: f.lastName.trim(), role: f.role, active: f.active });
      }
      this.editing.set(null);
      await this.users.load(() => this.admin.users());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async forceReset(u: UserRow): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('SET.USERS.RESET_CONFIRM', { name: `${u.firstName} ${u.lastName}` }), { danger: true }))) {
      return;
    }
    try {
      const result = await this.admin.forceReset(u.id);
      this.invite.set({ inviteUrl: result.inviteUrl });
      await this.users.load(() => this.admin.users());
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async copyLink(): Promise<void> {
    const url = this.invite()?.inviteUrl;
    if (url) {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      this.toast.success('✓');
    }
  }
}
