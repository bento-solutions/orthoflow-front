import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { InsuranceFormsApi } from '../../core/services/insurance-forms-api.service';
import { PrescriptionsApi } from '../../core/services/prescriptions-api.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { NavCounts } from '../../core/services/nav-counts.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { ASSIGNEE_ROLES, MyTasks, OperationsApi, StaffPerson, TASK_PRIORITIES, Task, TaskInput } from '../../core/services/operations-api.service';
import { PermissionService } from '../../core/services/permission.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../shared/ui/patient-picker.component';

const PRIORITY_PILL: Record<Task['priority'], string> = { LOW: 'pill-idle', NORMAL: 'pill-idle', HIGH: 'pill-attention', URGENT: 'pill-critical' };

/** An assignee as the form holds it: a person (`u:<id>`) or a role (`r:ASSISTANT`), so one select covers both. */
export function assigneeValue(task: Pick<Task, 'assigneeId' | 'assigneeRole'>): string {
  return task.assigneeId ? `u:${task.assigneeId}` : task.assigneeRole ? `r:${task.assigneeRole}` : '';
}

export function assigneeFields(value: string): Pick<TaskInput, 'assigneeId' | 'assigneeRole'> {
  if (value.startsWith('u:')) {
    return { assigneeId: value.slice(2) };
  }
  if (value.startsWith('r:')) {
    return { assigneeRole: value.slice(2) as TaskInput['assigneeRole'] };
  }
  return {};
}

interface TaskForm {
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  priority: Task['priority'];
}

const blankTask = (assignee = ''): TaskForm => ({ title: '', description: '', assignee, dueDate: '', priority: 'NORMAL', });

/**
 * Things to do, for a person or for a role ("reception"), with a due date and a priority, optionally
 * about a patient. Everyone with tasks sees their own list in four parts: late, today, coming, done
 * today. Those who administer tasks can also see everybody's.
 */
@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, FormsModule, RouterLink, TranslateModule, IconComponent, ModalComponent, PatientPickerComponent, CanDirective],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'TASK.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'TASK.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> {{ 'TASK.NEW' | translate }}</button>
        </div>
      </header>

      <div *appCan="'TASKS_ADMIN'" class="seg mb-4" role="group" [attr.aria-label]="'TASK.TITLE' | translate">
        <button type="button" class="seg-item" [class.is-active]="view() === 'mine'" [attr.aria-pressed]="view() === 'mine'" (click)="view.set('mine')">{{ 'TASK.MINE' | translate }}</button>
        <button type="button" class="seg-item" [class.is-active]="view() === 'all'" [attr.aria-pressed]="view() === 'all'" (click)="view.set('all')">{{ 'TASK.ALL' | translate }}</button>
      </div>

      @if (view() === 'mine') {
        @if (mine.data(); as m) {
          @for (group of groups(); track group.key) {
            @if (group.tasks.length) {
              <section class="mb-6">
                <h2 class="section-title" [class.text-critical-700]="group.key === 'overdue'">{{ 'TASK.GROUPS.' + group.key | translate }} <span class="tabular-nums">({{ group.tasks.length }})</span></h2>
                <ul class="card divide-y divide-ink-100">
                  @for (t of group.tasks; track t.id) { <li><ng-container *ngTemplateOutlet="row; context: { $implicit: t }" /></li> }
                </ul>
              </section>
            }
          }
          @if (!anyMine()) {
            <div class="empty"><span class="empty-icon"><app-icon name="check-circle" [size]="20" /></span><p class="empty-title">{{ 'TASK.EMPTY_TITLE' | translate }}</p><p class="empty-text">{{ 'TASK.EMPTY_TEXT' | translate }}</p></div>
          }
        }
      } @else {
        <div class="mb-4 flex flex-wrap items-end gap-3">
          <label class="field w-auto"><span class="label">{{ 'COMMON.STATUS' | translate }}</span>
            <select class="select w-auto" [ngModel]="status()" (ngModelChange)="status.set($event)">
              <option value="">{{ 'COMMON.ALL' | translate }}</option>
              @for (s of statuses; track s) { <option [value]="s">{{ 'TASK.STATUSES.' + s | translate }}</option> }
            </select></label>
          <label class="field w-auto"><span class="label">{{ 'TASK.ASSIGNEE' | translate }}</span>
            <select class="select w-auto" [ngModel]="assigneeFilter()" (ngModelChange)="assigneeFilter.set($event)">
              <option value="">{{ 'TASK.EVERYONE' | translate }}</option>
              @for (p of people(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
            </select></label>
        </div>
        <ul class="card divide-y divide-ink-100" [attr.aria-busy]="all.loading()">
          @for (t of all.data(); track t.id) { <li><ng-container *ngTemplateOutlet="row; context: { $implicit: t }" /></li> }
          @empty { <li class="py-8 text-center text-ink-500">{{ 'TASK.EMPTY_TITLE' | translate }}</li> }
        </ul>
      }
    </div>

    <ng-template #row let-t>
      <div class="flex items-start gap-3 px-4 py-3">
        <input type="checkbox" class="mt-1 h-4 w-4" [checked]="t.status === 'DONE'" [disabled]="t.status === 'CANCELLED'" (change)="toggle(t, $any($event.target).checked)" [attr.aria-label]="('TASK.DONE_LABEL' | translate) + ' ' + t.title" />
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-ink-900" [class.line-through]="t.status !== 'OPEN'" [class.text-ink-500]="t.status !== 'OPEN'">{{ t.title }}</p>
          @if (t.description) { <p class="whitespace-pre-line text-sm text-ink-600">{{ t.description }}</p> }
          @if (t.documentKind && t.documentId) {
            <button type="button" class="btn btn-secondary btn-sm mt-2" (click)="openDocument(t)">
              <app-icon name="file-text" [size]="14" /> {{ ('TASK.OPEN_DOC.' + t.documentKind) | translate }}
            </button>
          }
          <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <span class="pill pill-nodot" [class]="'pill pill-nodot ' + pill(t.priority)">{{ 'TASK.PRIORITIES.' + t.priority | translate }}</span>
            @if (t.dueDate) { <span [class.text-critical-700]="t.overdue" [class.font-semibold]="t.overdue">{{ t.dueDate | date: 'mediumDate' }}</span> }
            @if (t.assigneeName || t.assigneeRole) { <span>{{ t.assigneeName || ('TASK.ROLES.' + t.assigneeRole | translate) }}</span> }
            @if (t.patientId) { <a class="text-petrol-700 no-underline hover:underline" [routerLink]="['/patients', t.patientId]">{{ t.patientName }}</a> }
          </p>
        </div>
        <div class="flex shrink-0 gap-1">
          <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(t)" [title]="'COMMON.EDIT' | translate" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + t.title"><app-icon name="edit" [size]="16" /></button>
          <button type="button" class="btn btn-ghost btn-icon" (click)="remove(t)" [title]="'COMMON.DELETE' | translate" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + t.title"><app-icon name="trash" [size]="16" /></button>
        </div>
      </div>
    </ng-template>

    <app-modal [open]="editing() !== null" [title]="(editing()?.id ? 'TASK.EDIT' : 'TASK.NEW') | translate" size="md" [dismissable]="!busy()" (closed)="editing.set(null)">
      <form id="task-form" class="space-y-4" (ngSubmit)="save()">
        <label class="field"><span class="label label-required">{{ 'TASK.WHAT' | translate }}</span><input class="input" name="title" required maxlength="200" [ngModel]="form.value().title" (ngModelChange)="form.set('title', $event)" /></label>
        <label class="field"><span class="label">{{ 'TASK.DETAILS' | translate }}</span><textarea class="textarea" rows="2" name="description" [ngModel]="form.value().description" (ngModelChange)="form.set('description', $event)"></textarea></label>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field sm:col-span-1"><span class="label">{{ 'TASK.ASSIGNEE' | translate }}</span>
            <select class="select" name="assignee" [ngModel]="form.value().assignee" (ngModelChange)="form.set('assignee', $event)">
              <option value="">{{ 'TASK.ME' | translate }}</option>
              <optgroup [label]="'TASK.ROLE_GROUP' | translate">@for (r of roles; track r) { <option [value]="'r:' + r">{{ 'TASK.ROLES.' + r | translate }}</option> }</optgroup>
              <optgroup [label]="'TASK.PEOPLE_GROUP' | translate">@for (p of people(); track p.id) { <option [value]="'u:' + p.id">{{ p.name }}</option> }</optgroup>
            </select></label>
          <label class="field"><span class="label">{{ 'TASK.DUE' | translate }}</span><input class="input" type="date" name="due" [ngModel]="form.value().dueDate" (ngModelChange)="form.set('dueDate', $event)" /></label>
          <label class="field"><span class="label">{{ 'TASK.PRIORITY' | translate }}</span>
            <select class="select" name="priority" [ngModel]="form.value().priority" (ngModelChange)="form.set('priority', $event)">
              @for (p of priorities; track p) { <option [value]="p">{{ 'TASK.PRIORITIES.' + p | translate }}</option> }
            </select></label>
        </div>
        <div class="field"><span class="label">{{ 'TASK.PATIENT' | translate }}</span><app-patient-picker [value]="patient()" (valueChange)="patient.set($event)" [label]="'COMMON.PATIENT' | translate" /></div>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="task-form" class="btn btn-primary" [disabled]="busy() || !form.value().title.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`.section-title { margin-bottom: .5rem; font-size: var(--text-2xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }`],
})
export class TasksComponent {
  private readonly api = inject(OperationsApi);
  private readonly errors = inject(ApiErrors);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly counts = inject(NavCounts);
  private readonly permissions = inject(PermissionService);
  private readonly insuranceForms = inject(InsuranceFormsApi);
  private readonly prescriptions = inject(PrescriptionsApi);

  /** Opens the document a task is about: the insurance form to print, the prescription. */
  async openDocument(t: Task): Promise<void> {
    try {
      if (t.documentKind === 'INSURANCE_FORM') await this.insuranceForms.open(t.documentId);
      else if (t.documentKind === 'PRESCRIPTION') await this.prescriptions.open(t.documentId);
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected readonly priorities = TASK_PRIORITIES;
  protected readonly roles = ASSIGNEE_ROLES;
  protected readonly statuses = ['OPEN', 'DONE', 'CANCELLED'] as const;
  protected readonly pill = (p: Task['priority']) => PRIORITY_PILL[p];

  protected readonly view = signal<'mine' | 'all'>('mine');
  protected readonly status = signal('OPEN');
  protected readonly assigneeFilter = signal('');
  protected readonly mine = loadable<MyTasks | null>(null);
  protected readonly all = loadable<Task[]>([]);
  protected readonly people = signal<StaffPerson[]>([]);
  protected readonly groups = computed(() => {
    const m = this.mine.data();
    return [
      { key: 'overdue', tasks: m?.overdue ?? [] }, { key: 'today', tasks: m?.today ?? [] },
      { key: 'upcoming', tasks: m?.upcoming ?? [] }, { key: 'doneToday', tasks: m?.doneToday ?? [] },
    ];
  });
  protected readonly anyMine = computed(() => this.groups().some(g => g.tasks.length > 0));

  protected readonly busy = signal(false);
  protected readonly editing = signal<{ id: string | null } | null>(null);
  protected readonly form = formState<TaskForm>(blankTask());
  protected readonly patient = signal<PickedPatient | null>(null);

  constructor() {
    this.api.recipients().then(p => this.people.set(p)).catch(() => undefined);
    effect(() => {
      const view = this.view();
      const status = this.status();
      const assignee = this.assigneeFilter();
      untracked(() => void this.reload(view, status, assignee));
    });
    refreshOnLive(['task'], () => void this.reload(this.view(), this.status(), this.assigneeFilter()));
  }

  private async reload(view: 'mine' | 'all', status: string, assignee: string): Promise<void> {
    if (view === 'mine') {
      await this.mine.load(() => this.api.myTasks());
    } else if (this.permissions.can('TASKS_ADMIN')) {
      await this.all.load(() => this.api.allTasks({ status, assigneeId: assignee }));
    }
  }

  private refresh(): Promise<void> {
    return Promise.all([this.reload(this.view(), this.status(), this.assigneeFilter()), this.counts.refreshTasks()]).then(() => undefined);
  }

  protected openNew(): void {
    this.form.reset(blankTask());
    this.patient.set(null);
    this.editing.set({ id: null });
  }

  protected openEdit(t: Task): void {
    this.form.reset({ title: t.title, description: t.description ?? '', assignee: assigneeValue(t), dueDate: t.dueDate ?? '', priority: t.priority });
    this.patient.set(t.patientId ? { id: t.patientId, name: t.patientName } : null);
    this.editing.set({ id: t.id });
  }

  protected async save(): Promise<void> {
    const target = this.editing();
    const f = this.form.value();
    if (!target || this.busy() || !f.title.trim()) {
      return;
    }
    const body: TaskInput = {
      title: f.title.trim(), description: f.description.trim() || undefined, ...assigneeFields(f.assignee), dueDate: f.dueDate || undefined,
      priority: f.priority, patientId: this.patient()?.id,
    };
    await this.run(async () => {
      await (target.id ? this.api.updateTask(target.id, body) : this.api.createTask(body));
      this.editing.set(null);
    });
  }

  protected async toggle(t: Task, done: boolean): Promise<void> {
    await this.run(() => this.api.taskAction(t.id, done ? 'done' : 'reopen').then(() => undefined));
  }

  protected async remove(t: Task): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('TASK.DELETE_CONFIRM', { title: t.title }), { danger: true }))) {
      return;
    }
    await this.run(() => this.api.deleteTask(t.id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.refresh();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
