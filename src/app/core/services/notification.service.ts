import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Wire } from '../api/wire';
import { AuthService } from './auth.service';
import { LiveEventsService } from './live-events.service';

export type Notification = Wire<'NotificationRow'>;

/** Where a notification leads, from what it is about. Null when there is nowhere sensible to go. */
export function notificationLink(relatedType: string | null | undefined, relatedId: string | null | undefined): string | null {
  switch (relatedType) {
    case 'TASK':
      return '/tasks';
    case 'LAB_ORDER':
      return '/lab-orders';
    case 'STERILIZATION_CYCLE':
      return relatedId ? `/sterilization/cycles?open=${relatedId}` : '/sterilization';
    case 'BOOKING_REQUEST':
    case 'PENDING_PATIENT':
      return '/booking';
    case 'CHEQUE':
      return '/finance/cheques';
    case 'STAFF_THREAD':
    case 'STAFF_MESSAGE':
      return '/messages';
    case 'APPOINTMENT':
      return '/schedule';
    default:
      return null;
  }
}

/**
 * The bell: what the system has to tell this person (a lab job arrived, a booking
 * request is waiting, a sterilization control failed). Refreshed when the server
 * says a notification was created, so nobody polls.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly live = inject(LiveEventsService);

  readonly unread = signal(0);
  readonly items = signal<Notification[]>([]);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        if (token) {
          void this.refreshCount();
        } else {
          this.unread.set(0);
          this.items.set([]);
        }
      });
    });
    this.live.of('notification').subscribe(() => {
      void this.refreshCount();
    });
  }

  async refreshCount(): Promise<void> {
    try {
      this.unread.set((await firstValueFrom(this.http.get<{ count: number }>(api('/notifications/unread-count')))).count);
    } catch {
      /* the bell keeps its last number; the next change refreshes it */
    }
  }

  async load(): Promise<void> {
    try {
      this.items.set(await firstValueFrom(this.http.get<Notification[]>(api('/notifications'), { params: { limit: 30 } })));
      await this.refreshCount();
    } catch {
      /* keep what is shown */
    }
  }

  async markRead(id: string): Promise<void> {
    await firstValueFrom(this.http.post<void>(api(`/notifications/${id}/read`), null));
    this.items.update(list => list.map(n => (n.id === id ? { ...n, read: true } : n)));
    await this.refreshCount();
  }

  async markAllRead(): Promise<void> {
    await firstValueFrom(this.http.post<void>(api('/notifications/read-all'), null));
    this.items.update(list => list.map(n => ({ ...n, read: true })));
    this.unread.set(0);
  }
}
