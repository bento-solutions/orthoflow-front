import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { AuthService } from './auth.service';
import { LanguageService } from './language.service';

export type AppointmentType = Wire<'TypeResponse'>;
export type AppointmentTypeInput = Req<'TypeRequest'>;
export type Chair = Wire<'ChairDetail'>;
export type ChairInput = Req<'ChairRequest'>;
export type WaitingRoom = Wire<'RoomResponse'>;
export type WaitingRoomInput = Req<'RoomRequest'>;

export const APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'LATE', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type AppointmentStatusName = (typeof APPOINTMENT_STATUSES)[number];

/** The colour each status wears when the clinic has not chosen its own. Status is never shown by colour alone: a label always goes with it. */
export const DEFAULT_STATUS_COLORS: Record<AppointmentStatusName, string> = {
  SCHEDULED: '#64748b',
  CONFIRMED: '#2563eb',
  LATE: '#d97706',
  ARRIVED: '#7c3aed',
  IN_CHAIR: '#0d9488',
  COMPLETED: '#16a34a',
  CANCELLED: '#dc2626',
  NO_SHOW: '#9f1239',
};

/** The name of an appointment type in a language, falling back to French (the one every type has). */
export function typeName(type: Pick<AppointmentType, 'nameFr' | 'nameEn' | 'nameAr'>, lang: string): string {
  const name = lang === 'en' ? type.nameEn : lang === 'ar' ? type.nameAr : type.nameFr;
  return name || type.nameFr;
}

/**
 * What the agenda is built from: appointment types (with their colour and default
 * length), chairs, waiting rooms and the clinic's status colours. Loaded once per
 * session and refreshed after an edit; the screens read the signals.
 */
@Injectable({ providedIn: 'root' })
export class AgendaConfigService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);

  readonly types = signal<AppointmentType[]>([]);
  readonly chairs = signal<Chair[]>([]);
  readonly rooms = signal<WaitingRoom[]>([]);
  readonly statusColors = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        if (token) {
          void this.refresh();
        } else {
          this.types.set([]);
          this.chairs.set([]);
          this.rooms.set([]);
        }
      });
    });
  }

  async refresh(): Promise<void> {
    const get = <T>(path: string, params?: Record<string, string | boolean>) => firstValueFrom(this.http.get<T>(api(path), { params }));
    const [types, chairs, rooms, colors] = await Promise.allSettled([
      get<AppointmentType[]>('/scheduling/appointment-types', { includeInactive: false }),
      get<Chair[]>('/scheduling/chairs/all'),
      get<WaitingRoom[]>('/scheduling/waiting-rooms', { includeInactive: false }),
      get<Record<string, string>>('/settings/practice/status-colors'),
    ]);
    if (types.status === 'fulfilled') this.types.set(types.value);
    if (chairs.status === 'fulfilled') this.chairs.set(chairs.value.filter(c => c.active));
    if (rooms.status === 'fulfilled') this.rooms.set(rooms.value);
    if (colors.status === 'fulfilled') this.statusColors.set(colors.value);
  }

  label(type: AppointmentType): string {
    return typeName(type, this.language.currentLang());
  }

  colorOf(status: string): string {
    return this.statusColors()[status] ?? DEFAULT_STATUS_COLORS[status as AppointmentStatusName] ?? '#64748b';
  }

  // ── Editing, for the agenda settings ──
  allTypes(): Promise<AppointmentType[]> {
    return firstValueFrom(this.http.get<AppointmentType[]>(api('/scheduling/appointment-types'), { params: { includeInactive: true } }));
  }

  async saveType(id: string | null, input: AppointmentTypeInput): Promise<void> {
    await firstValueFrom(id ? this.http.put(api(`/scheduling/appointment-types/${id}`), input) : this.http.post(api('/scheduling/appointment-types'), input));
    await this.refresh();
  }

  async saveChair(id: string | null, input: ChairInput): Promise<void> {
    await firstValueFrom(id ? this.http.put(api(`/scheduling/chairs/${id}`), input) : this.http.post(api('/scheduling/chairs'), input));
    await this.refresh();
  }

  allChairs(): Promise<Chair[]> {
    return firstValueFrom(this.http.get<Chair[]>(api('/scheduling/chairs/all')));
  }

  allRooms(): Promise<WaitingRoom[]> {
    return firstValueFrom(this.http.get<WaitingRoom[]>(api('/scheduling/waiting-rooms'), { params: { includeInactive: true } }));
  }

  async saveRoom(id: string | null, input: WaitingRoomInput): Promise<void> {
    await firstValueFrom(id ? this.http.put(api(`/scheduling/waiting-rooms/${id}`), input) : this.http.post(api('/scheduling/waiting-rooms'), input));
    await this.refresh();
  }

  async saveStatusColors(colors: Record<string, string>): Promise<void> {
    this.statusColors.set(await firstValueFrom(this.http.put<Record<string, string>>(api('/settings/practice/status-colors'), colors)));
  }
}
