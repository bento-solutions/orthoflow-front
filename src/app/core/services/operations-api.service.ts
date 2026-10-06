import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { QueryValue, toParams } from './download.service';

export type LabOrder = Wire<'LabOrderView'>;
export type LabOrderInput = Req<'LabOrderRequest'>;
export type Lab = Wire<'Lab'>;
export type LabStatus = LabOrder['status'];
export type LabItemType = LabOrder['itemType'];
export type Task = Wire<'TaskView'>;
export type TaskInput = Req<'TaskRequest'>;
export type MyTasks = Wire<'Mine'>;
export type TaskCount = Wire<'Count'>;
export type StaffPerson = Wire<'StaffPerson'>;
export type ThreadRow = Wire<'ThreadRow'>;
export type ThreadDetail = Wire<'ThreadDetail'>;
export type Appointment = Wire<'AppointmentResponse'>;

export const LAB_STATUSES: readonly LabStatus[] = ['SENT', 'IN_PROGRESS', 'RECEIVED', 'FITTED', 'REMAKE'];
export const LAB_ITEM_TYPES: readonly LabItemType[] = ['ALIGNER', 'RETAINER', 'EXPANDER', 'MODEL', 'CROWN', 'BRIDGE', 'DENTURE', 'NIGHTGUARD', 'OTHER'];
export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const ASSIGNEE_ROLES = ['ADMIN', 'DOCTOR', 'ASSISTANT'] as const;

export interface LabOrderQuery {
  status?: readonly string[];
  dueFrom?: string;
  dueTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  urgentOnly?: boolean;
  overdueOnly?: boolean;
  labId?: string;
  patientId?: string;
  search?: string;
}

/** Lab orders, tasks and staff-to-staff messages: the daily running of the clinic. */
@Injectable({ providedIn: 'root' })
export class OperationsApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  // ── lab orders ─────────────────────────────────────────────────────
  labOrders(query: LabOrderQuery): Promise<LabOrder[]> {
    return this.get('/lab-orders', { ...query, status: query.status?.length ? [...query.status] : undefined });
  }
  labs(): Promise<Lab[]> {
    return this.get('/lab-orders/labs');
  }
  createLab(name: string, phone?: string): Promise<unknown> {
    return this.post('/stock/suppliers', { name, phone, kind: 'LAB', active: true });
  }
  createLabOrder(body: LabOrderInput): Promise<LabOrder> {
    return this.post('/lab-orders', body);
  }
  updateLabOrder(id: string, body: LabOrderInput): Promise<LabOrder> {
    return firstValueFrom(this.http.put<LabOrder>(api(`/lab-orders/${id}`), body));
  }
  transitionLabOrder(id: string, status: LabStatus, date?: string): Promise<LabOrder> {
    return this.post(`/lab-orders/${id}/status`, { status, date });
  }
  upcomingAppointments(from: string, to: string): Promise<Appointment[]> {
    return this.get('/appointments', { from, to });
  }

  // ── tasks ──────────────────────────────────────────────────────────
  myTasks(): Promise<MyTasks> {
    return this.get('/tasks/mine');
  }
  allTasks(query: { status?: string; assigneeId?: string; patientId?: string }): Promise<Task[]> {
    return this.get('/tasks', query);
  }
  taskCount(): Promise<TaskCount> {
    return this.get('/tasks/count');
  }
  createTask(body: TaskInput): Promise<Task> {
    return this.post('/tasks', body);
  }
  updateTask(id: string, body: TaskInput): Promise<Task> {
    return firstValueFrom(this.http.put<Task>(api(`/tasks/${id}`), body));
  }
  taskAction(id: string, action: 'done' | 'reopen'): Promise<Task> {
    return this.post(`/tasks/${id}/${action}`);
  }
  deleteTask(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/tasks/${id}`)));
  }

  // ── staff messages ─────────────────────────────────────────────────
  recipients(): Promise<StaffPerson[]> {
    return this.get('/staff-messages/recipients');
  }
  threads(): Promise<ThreadRow[]> {
    return this.get('/staff-messages/threads');
  }
  thread(id: string): Promise<ThreadDetail> {
    return this.get(`/staff-messages/threads/${id}`);
  }
  newThread(body: { subject: string; recipientIds: string[]; body: string }): Promise<ThreadDetail> {
    return this.post('/staff-messages/threads', body);
  }
  reply(threadId: string, body: string): Promise<ThreadDetail> {
    return this.post(`/staff-messages/threads/${threadId}/messages`, { body });
  }
  unreadMessages(): Promise<Record<string, number>> {
    return this.get('/staff-messages/unread-count');
  }
}
