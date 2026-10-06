import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { OperationsApi, TaskCount } from './operations-api.service';
import { AuthService } from './auth.service';
import { LiveEventsService } from './live-events.service';
import { PermissionService } from './permission.service';

const NO_TASKS: TaskCount = { open: 0, overdue: 0, dueToday: 0 };

/**
 * The small numbers beside navigation: tasks that are late or due today, unread staff messages.
 * Each is fetched only for someone allowed to see it, refreshed when the server announces a
 * change, and cleared when the session ends, so nobody polls and a signed-out screen shows nothing.
 */
@Injectable({ providedIn: 'root' })
export class NavCounts {
  private readonly api = inject(OperationsApi);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionService);
  private readonly live = inject(LiveEventsService);

  readonly tasks = signal<TaskCount>(NO_TASKS);
  readonly messages = signal(0);

  /** What needs attention among the tasks: the late ones and those due today. */
  readonly tasksDue = computed(() => this.tasks().overdue + this.tasks().dueToday);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        if (token) {
          void this.refreshAll();
        } else {
          this.tasks.set(NO_TASKS);
          this.messages.set(0);
        }
      });
    });
    this.live.of('task').subscribe(() => void this.refreshTasks());
    this.live.of('staff-message').subscribe(() => void this.refreshMessages());
  }

  async refreshAll(): Promise<void> {
    await this.permissions.ready();
    await Promise.all([this.refreshTasks(), this.refreshMessages()]);
  }

  async refreshTasks(): Promise<void> {
    if (!this.auth.token() || !this.permissions.can('TASKS_MANAGE')) {
      return;
    }
    try {
      this.tasks.set(await this.api.taskCount());
    } catch {
      /* keep the last number */
    }
  }

  async refreshMessages(): Promise<void> {
    if (!this.auth.token()) {
      return;
    }
    try {
      this.messages.set((await this.api.unreadMessages())['count'] ?? 0);
    } catch {
      /* keep the last number */
    }
  }
}
