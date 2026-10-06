import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';

export type UserRow = Wire<'UserRow'>;
export type UserInvite = Wire<'UserInvite'>;
export type PermissionMatrix = Wire<'PermissionMatrix'>;
export type SessionRow = Wire<'SessionRow'>;
export type CreateUser = Req<'CreateUser'>;
export type UpdateUser = Req<'UpdateUser'>;
export type Role = 'ADMIN' | 'DOCTOR' | 'ASSISTANT';
export const ROLES: Role[] = ['ADMIN', 'DOCTOR', 'ASSISTANT'];

/** User administration, role permissions, and the signed-in person's own account and sessions. */
@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private readonly http = inject(HttpClient);

  users(): Promise<UserRow[]> {
    return firstValueFrom(this.http.get<UserRow[]>(api('/admin/users')));
  }

  invite(input: CreateUser): Promise<UserInvite> {
    return firstValueFrom(this.http.post<UserInvite>(api('/admin/users'), input));
  }

  update(id: string, input: UpdateUser): Promise<UserRow> {
    return firstValueFrom(this.http.put<UserRow>(api(`/admin/users/${id}`), input));
  }

  forceReset(id: string): Promise<UserInvite> {
    return firstValueFrom(this.http.post<UserInvite>(api(`/admin/users/${id}/reset-password`), null));
  }

  permissions(): Promise<PermissionMatrix> {
    return firstValueFrom(this.http.get<PermissionMatrix>(api('/admin/permissions')));
  }

  setPermissions(role: Role, permissions: string[]): Promise<PermissionMatrix> {
    return firstValueFrom(this.http.put<PermissionMatrix>(api(`/admin/permissions/${role}`), { permissions }));
  }

  resetPermissions(role: Role): Promise<PermissionMatrix> {
    return firstValueFrom(this.http.delete<PermissionMatrix>(api(`/admin/permissions/${role}`)));
  }

  // ── The signed-in person ──
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(api('/me/change-password'), { currentPassword, newPassword }));
  }

  sessions(): Promise<SessionRow[]> {
    return firstValueFrom(this.http.get<SessionRow[]>(api('/me/sessions')));
  }

  endSession(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/me/sessions/${id}`)));
  }

  endOtherSessions(): Promise<void> {
    return firstValueFrom(this.http.post<void>(api('/me/sessions/revoke-others'), null));
  }
}
