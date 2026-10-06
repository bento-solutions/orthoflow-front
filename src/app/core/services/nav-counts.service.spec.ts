import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { IntakeApi } from './intake-api.service';
import { LiveChange, LiveEventsService } from './live-events.service';
import { MessagingApi } from './messaging-api.service';
import { NavCounts } from './nav-counts.service';
import { OperationsApi } from './operations-api.service';
import { PermissionService } from './permission.service';

describe('NavCounts', () => {
  let token: ReturnType<typeof signal<string | null>>;
  let granted: string[];
  let live: Subject<LiveChange>;
  let operations: Record<string, ReturnType<typeof vi.fn>>;
  let messaging: Record<string, ReturnType<typeof vi.fn>>;
  let intake: Record<string, ReturnType<typeof vi.fn>>;

  const create = () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token } },
        { provide: PermissionService, useValue: { ready: async () => undefined, can: (...needed: string[]) => needed.some(p => granted.includes(p)) } },
        { provide: LiveEventsService, useValue: { of: (...types: string[]) => ({ subscribe: (fn: () => void) => live.subscribe(c => types.includes(c.type) && fn()) }) } },
        { provide: OperationsApi, useValue: operations },
        { provide: MessagingApi, useValue: messaging },
        { provide: IntakeApi, useValue: intake },
      ],
    });
    return TestBed.inject(NavCounts);
  };
  const flush = async () => {
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve));
  };

  beforeEach(() => {
    token = signal<string | null>('jwt');
    granted = ['TASKS_MANAGE', 'MESSAGING_VIEW', 'BOOKING_REVIEW'];
    live = new Subject<LiveChange>();
    operations = { taskCount: vi.fn(async () => ({ open: 5, overdue: 2, dueToday: 1 })), unreadMessages: vi.fn(async () => ({ count: 3 })) };
    messaging = { whatsappStatus: vi.fn(async () => ({ enabled: true, unhandledReplies: 4 })) };
    intake = { bookingCount: vi.fn(async () => ({ pending: 2 })), registrationCount: vi.fn(async () => ({ pending: 1 })) };
  });

  it('reads each number from where the server puts it', async () => {
    const counts = create();
    await flush();
    expect(counts.tasks()).toEqual({ open: 5, overdue: 2, dueToday: 1 });
    expect(counts.tasksDue()).toBe(3);
    expect(counts.messages()).toBe(3);
    expect(counts.inbox()).toBe(4);
    expect(counts.bookingRequests()).toBe(2);
    expect(counts.registrations()).toBe(1);
    expect(counts.intakeTotal()).toBe(3);
  });

  it('does not ask for what the person may not see', async () => {
    granted = [];
    const counts = create();
    await flush();
    expect(operations['taskCount']).not.toHaveBeenCalled();
    expect(messaging['whatsappStatus']).not.toHaveBeenCalled();
    expect(intake['bookingCount']).not.toHaveBeenCalled();
    expect(counts.tasksDue()).toBe(0);
    expect(counts.inbox()).toBe(0);
    // staff messages are for everyone
    expect(counts.messages()).toBe(3);
  });

  it('refreshes the one number a server event is about', async () => {
    create();
    await flush();
    operations['taskCount'].mockClear();
    messaging['whatsappStatus'].mockClear();
    live.next({ type: 'task', id: null });
    await flush();
    expect(operations['taskCount']).toHaveBeenCalledTimes(1);
    expect(messaging['whatsappStatus']).not.toHaveBeenCalled();
    live.next({ type: 'whatsapp-inbox', id: null });
    await flush();
    expect(messaging['whatsappStatus']).toHaveBeenCalledTimes(1);
  });

  it('keeps the last number when a refresh fails, and clears everything on sign-out', async () => {
    const counts = create();
    await flush();
    operations['taskCount'].mockRejectedValueOnce(new Error('down'));
    await counts.refreshTasks();
    expect(counts.tasksDue()).toBe(3);

    token.set(null);
    await flush();
    expect(counts.tasksDue()).toBe(0);
    expect(counts.messages()).toBe(0);
    expect(counts.inbox()).toBe(0);
    expect(counts.intakeTotal()).toBe(0);
  });
});
