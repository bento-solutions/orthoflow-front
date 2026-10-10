import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { NavCounts } from '../../core/services/nav-counts.service';
import { OperationsApi, Task } from '../../core/services/operations-api.service';
import { InsuranceFormsApi } from '../../core/services/insurance-forms-api.service';
import { PrescriptionsApi } from '../../core/services/prescriptions-api.service';
import { screenMocks } from '../../testing/screen-mocks';
import { TasksComponent, assigneeFields, assigneeValue } from './tasks.component';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Rappeler Mme Alami', description: '', assigneeId: 'u1', assigneeName: 'Salma', assigneeRole: '' as never, createdBy: 'u0', dueDate: '2026-10-06', priority: 'NORMAL',
  patientId: '', patientName: '', status: 'OPEN', doneAt: '', overdue: false, documentKind: '' as never, documentId: '', ...over,
});

describe('assignee encoding', () => {
  it('holds a person or a role in one value, and reads it back', () => {
    expect(assigneeValue({ assigneeId: 'u1', assigneeRole: '' as never })).toBe('u:u1');
    expect(assigneeValue({ assigneeId: '' as never, assigneeRole: 'ASSISTANT' })).toBe('r:ASSISTANT');
    expect(assigneeValue({ assigneeId: '' as never, assigneeRole: '' as never })).toBe('');
    expect(assigneeFields('u:abc')).toEqual({ assigneeId: 'abc' });
    expect(assigneeFields('r:DOCTOR')).toEqual({ assigneeRole: 'DOCTOR' });
    expect(assigneeFields('')).toEqual({});
  });
});

describe('TasksComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;
  let refreshTasks: ReturnType<typeof vi.fn>;
  const insuranceForms = { open: vi.fn(async () => undefined) };

  const mount = async (can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks(can);
    refreshTasks = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [TasksComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: OperationsApi, useValue: api },
        { provide: InsuranceFormsApi, useValue: insuranceForms },
        { provide: PrescriptionsApi, useValue: { open: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: NavCounts, useValue: { refreshTasks } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(TasksComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmAnswer = true;
    api = {
      myTasks: vi.fn(async () => ({ overdue: [task({ id: 'late', title: 'Commander les gants', overdue: true, dueDate: '2026-10-01' })], today: [task()], upcoming: [], doneToday: [task({ id: 'd', title: 'Déjà fait', status: 'DONE' })] })),
      allTasks: vi.fn(async () => [task({ id: 'x' })]),
      recipients: vi.fn(async () => [{ id: 'u1', name: 'Salma', role: 'ASSISTANT' }]),
      createTask: vi.fn(async () => task()),
      updateTask: vi.fn(async () => task()),
      taskAction: vi.fn(async () => task()),
      deleteTask: vi.fn(async () => undefined),
    };
  });

  it('opens the care form a task is about', async () => {
    api['myTasks'] = vi.fn(async () => ({ overdue: [], today: [task({ id: 'f', title: 'Feuille de soins CNOPS — BENNANI Yasmine',
      documentKind: 'INSURANCE_FORM', documentId: 'form-1' })], upcoming: [], doneToday: [] }));
    const fixture = await mount();
    [...document.querySelectorAll('button')].find(b => b.textContent?.includes('TASK.OPEN_DOC.INSURANCE_FORM'))!.click();
    await settleUi(fixture);
    expect(insuranceForms.open).toHaveBeenCalledWith('form-1');
  });

  it('shows my tasks in groups, the late ones first and named as late', async () => {
    await mount();
    const text = document.body.textContent!;
    expect(text.indexOf('TASK.GROUPS.overdue')).toBeLessThan(text.indexOf('TASK.GROUPS.today'));
    expect(text).toContain('Commander les gants');
    expect(text).toContain('TASK.GROUPS.doneToday');
  });

  it('ticks a task done and refreshes the lists and the counter', async () => {
    const fixture = await mount();
    const box = document.querySelector('input[type=checkbox][aria-label*="Rappeler"]') as HTMLInputElement;
    box.click();
    await settleUi(fixture);
    expect(api['taskAction']).toHaveBeenCalledWith('t1', 'done');
    expect(refreshTasks).toHaveBeenCalled();
  });

  it('reopens a task that was done', async () => {
    const fixture = await mount();
    (document.querySelector('input[type=checkbox][aria-label*="Déjà fait"]') as HTMLInputElement).click();
    await settleUi(fixture);
    expect(api['taskAction']).toHaveBeenCalledWith('d', 'reopen');
  });

  it('creates a task for a role', async () => {
    const fixture = await mount();
    [...document.querySelectorAll('button')].find(b => b.textContent?.includes('TASK.NEW'))!.click();
    await settleUi(fixture);
    const title = document.querySelector('input[name=title]') as HTMLInputElement;
    title.value = 'Appeler le laboratoire';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const select = document.querySelector('select[name=assignee]') as HTMLSelectElement;
    select.value = 'r:ASSISTANT';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settleUi(fixture);
    (document.querySelector('#task-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(api['createTask']).toHaveBeenCalledWith(expect.objectContaining({ title: 'Appeler le laboratoire', assigneeRole: 'ASSISTANT', priority: 'NORMAL' }));
  });

  it('deletes only after confirmation', async () => {
    confirmAnswer = false;
    const fixture = await mount();
    (document.querySelector('button[aria-label^="COMMON.DELETE"]') as HTMLButtonElement).click();
    await settleUi(fixture);
    expect(api['deleteTask']).not.toHaveBeenCalled();
  });

  it('offers the everybody view only to task administrators', async () => {
    await mount({ can: ['TASKS_MANAGE'] });
    expect([...document.querySelectorAll('.seg-item')].some(b => b.textContent?.includes('TASK.ALL'))).toBe(false);
  });

  it('lists everybody\'s tasks for an administrator', async () => {
    const fixture = await mount();
    [...document.querySelectorAll('.seg-item')].find(b => b.textContent?.includes('TASK.ALL'))!.dispatchEvent(new Event('click'));
    await settleUi(fixture);
    await settleUi(fixture);
    expect(api['allTasks']).toHaveBeenCalledWith({ status: 'OPEN', assigneeId: '' });
  });
});
