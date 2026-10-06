import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { MessagingApi } from './messaging-api.service';
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
  private readonly messaging = inject(MessagingApi);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionService);
  private readonly live = inject(LiveEventsService);

  readonly tasks = signal<TaskCount>(NO_TASKS);
  readonly messages = signal(0);
  /** WhatsApp replies from patients that nobody has dealt with yet. */
  readonly inbox = signal(0);

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
          this.inbox.set(0);
        }
      });
    });
    this.live.of('task').subscribe(() => void this.refreshTasks());
    this.live.of('staff-message').subscribe(() => void this.refreshMessages());
    this.live.of('whatsapp-inbox').subscribe(() => void this.refreshInbox());
  }

  async refreshAll(): Promise<void> {
    await this.permissions.ready();
    await Promise.all([this.refreshTasks(), this.refreshMessages(), this.refreshInbox()]);
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

  async refreshInbox(): Promise<void> {
    if (!this.auth.token() || !this.permissions.can('MESSAGING_VIEW')) {
      return;
    }
    try {
      this.inbox.set(Number((await this.messaging.whatsappStatus()).unhandledReplies ?? 0));
    } catch {
      /* keep the last number */
    }
  }
}
