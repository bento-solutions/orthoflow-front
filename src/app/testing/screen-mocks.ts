import { Provider, signal } from '@angular/core';
import { Subject, filter } from 'rxjs';
import { vi } from 'vitest';
import { Permission } from '../core/models/permission';
import { ApiErrors } from '../core/services/api-error.service';
import { LiveChange, LiveEventsService } from '../core/services/live-events.service';
import { PermissionService } from '../core/services/permission.service';
import { PractitionerService } from '../core/services/practitioner.service';
import { ToastService } from '../core/services/toast.service';

/**
 * The services every screen reaches for, replaced by things a test can watch: what was toasted,
 * which errors were reported, and a `live` subject to push a server event through. `can` is the
 * permission set of the person looking at the screen: `true` for everything, or a list.
 */
export function screenMocks(options: { can?: true | Permission[]; practitioners?: { id: string; displayName: string }[] } = {}) {
  const live = new Subject<LiveChange>();
  const toasts: { kind: string; message: string }[] = [];
  const errors: unknown[] = [];
  const granted = options.can ?? true;

  const providers: Provider[] = [
    { provide: LiveEventsService, useValue: { of: (...types: string[]) => live.pipe(filter(c => types.includes(c.type))), changes$: live.asObservable(), connected: signal(true) } },
    { provide: PermissionService, useValue: { can: (...needed: Permission[]) => granted === true || needed.length === 0 || needed.some(p => granted.includes(p)), isAdmin: signal(false), practitionerId: signal(null), me: signal(null) } },
    { provide: PractitionerService, useValue: { active: signal(options.practitioners ?? []), refresh: vi.fn() } },
    { provide: ApiErrors, useValue: { report: (e: unknown) => errors.push(e), message: () => 'error' } },
    {
      provide: ToastService,
      useValue: {
        success: (message: string) => toasts.push({ kind: 'success', message }),
        error: (message: string) => toasts.push({ kind: 'error', message }),
        info: (message: string) => toasts.push({ kind: 'info', message }),
      },
    },
  ];
  return { providers, live, toasts, errors };
}
