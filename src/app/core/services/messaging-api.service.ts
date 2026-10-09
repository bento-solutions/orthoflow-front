import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { QueryValue, toParams } from './download.service';

export type MessageLog = Wire<'LogRow'>;
export type MessageLogPage = Omit<Wire<'PageLogRow'>, 'content'> & { content: MessageLog[] };
export type InboxMessage = Wire<'InboxRow'>;
export type MessageTemplate = Wire<'TemplateRow'>;
export type TemplateInput = Req<'TemplateUpsert'>;
export type TemplatePreview = Wire<'TemplatePreview'>;
export type WhatsAppStatus = Wire<'WhatsAppStatus'>;
export type MessagingSettings = Wire<'MessagingSettings'>;

export type MessageChannel = MessageLog['channel'];
export type MessageStatus = MessageLog['status'];
export type MessagePurpose = MessageLog['purpose'];

export const MESSAGE_CHANNELS: readonly MessageChannel[] = ['WHATSAPP', 'EMAIL', 'IN_APP'];
export const MESSAGE_STATUSES: readonly MessageStatus[] = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED'];
export const MESSAGE_PURPOSES: readonly MessagePurpose[] = [
  'APPOINTMENT_REMINDER', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'INSTALMENT_REMINDER', 'RECALL', 'SURVEY_REQUEST', 'BOOKING_RECEIVED',
  'BOOKING_CONFIRMED', 'BOOKING_DECLINED', 'REGISTRATION_INVITE', 'STAFF_INVITE', 'PASSWORD_RESET', 'LAB_ORDER_RECEIVED', 'CHEQUE_REJECTED', 'TASK_ASSIGNED',
  'INTERNAL_MESSAGE', 'TEST', 'GENERIC',
];

/** What a template may contain between `{{ }}`; the server leaves anything else visible so a typo shows in the preview. */
export const TEMPLATE_PLACEHOLDERS = ['patientName', 'clinicName', 'clinicPhone', 'date', 'time', 'amount', 'currency', 'link'] as const;

/** Message logs, the WhatsApp reply inbox, templates and the reminder settings. */
@Injectable({ providedIn: 'root' })
export class MessagingApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  logs(query: { channel?: string; status?: string; patientId?: string; page?: number; size?: number }): Promise<MessageLogPage> {
    return this.get('/messaging/logs', query);
  }
  retry(id: string): Promise<MessageLog> {
    return this.post(`/messaging/logs/${id}/retry`);
  }
  cancel(id: string): Promise<MessageLog> {
    return this.post(`/messaging/logs/${id}/cancel`);
  }
  sendTest(channel: MessageChannel, recipient: string): Promise<MessageLog> {
    return this.post('/messaging/send-test', { channel, recipient });
  }

  inbox(unhandledOnly: boolean, limit = 100, landingPageOnly = false): Promise<InboxMessage[]> {
    return this.get('/messaging/inbox', { unhandledOnly, landingPageOnly, limit });
  }
  markHandled(id: string): Promise<void> {
    return this.post(`/messaging/inbox/${id}/handled`);
  }
  whatsappStatus(): Promise<WhatsAppStatus> {
    return this.get('/messaging/whatsapp/status');
  }

  templates(): Promise<MessageTemplate[]> {
    return this.get('/messaging/templates');
  }
  saveTemplate(body: TemplateInput): Promise<MessageTemplate> {
    return firstValueFrom(this.http.put<MessageTemplate>(api('/messaging/templates'), body));
  }
  resetTemplate(purpose: string, channel: string, language: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/messaging/templates/${purpose}/${channel}/${language}`)));
  }
  previewTemplate(body: { purpose: MessagePurpose; channel: MessageChannel; language: string; subject: string; body: string }): Promise<TemplatePreview> {
    return this.post('/messaging/templates/preview', body);
  }

  settings(): Promise<MessagingSettings> {
    return this.get('/settings/messaging');
  }
  saveSettings(body: MessagingSettings): Promise<MessagingSettings> {
    return firstValueFrom(this.http.put<MessagingSettings>(api('/settings/messaging'), body));
  }
}
