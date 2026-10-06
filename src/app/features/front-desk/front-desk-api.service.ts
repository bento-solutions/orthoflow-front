import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/url';
import type { Req, Wire } from '../../core/api/wire';

export type FrontDesk = Wire<'FrontDesk'>;
export type WaitingCard = Wire<'WaitingCard'>;
export type ChairBoard = Wire<'ChairBoard'>;
export type Appointment = Wire<'AppointmentResponse'>;
export type WalkIn = Req<'WalkIn'>;
export type WaitingEntry = Wire<'WaitingEntryResponse'>;
export type WaitingEntryInput = Req<'WaitingEntryRequest'>;
export type ScheduleFromWaiting = Req<'ScheduleFromWaiting'>;
export type Absence = Wire<'AbsenceResponse'>;
export type AbsenceInput = Req<'AbsenceRequest'>;
export type ClinicEvent = Wire<'EventResponse'>;
export type ClinicEventInput = Req<'EventRequest'>;

export const URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const ABSENCE_REASONS = ['LEAVE', 'SICK', 'TRAINING', 'CONFERENCE', 'OTHER'] as const;

/** Everything the reception desk does during the day: the waiting room, chairs, the waiting list, absences and closures. */
@Injectable({ providedIn: 'root' })
export class FrontDeskApi {
  private readonly http = inject(HttpClient);

  board(): Promise<FrontDesk> {
    return firstValueFrom(this.http.get<FrontDesk>(api('/front-desk')));
  }

  /** Today's visits, to find who is expected. */
  appointmentsBetween(from: Date, to: Date): Promise<Appointment[]> {
    return firstValueFrom(this.http.get<Appointment[]>(api('/appointments'), { params: { from: from.toISOString(), to: to.toISOString() } }));
  }

  checkIn(id: string, waitingRoomId?: string): Promise<Appointment> {
    return firstValueFrom(this.http.post<Appointment>(api(`/front-desk/${id}/check-in`), { waitingRoomId: waitingRoomId ?? null }));
  }

  seat(id: string, chairId: string): Promise<Appointment> {
    return firstValueFrom(this.http.post<Appointment>(api(`/front-desk/${id}/seat`), { chairId }));
  }

  finish(id: string): Promise<Appointment> {
    return firstValueFrom(this.http.post<Appointment>(api(`/front-desk/${id}/finish`), null));
  }

  backToWaiting(id: string): Promise<Appointment> {
    return firstValueFrom(this.http.post<Appointment>(api(`/front-desk/${id}/back-to-waiting`), null));
  }

  walkIn(input: WalkIn): Promise<Appointment> {
    return firstValueFrom(this.http.post<Appointment>(api('/front-desk/walk-in'), input));
  }

  reorder(orderedIds: string[]): Promise<void> {
    return firstValueFrom(this.http.put<void>(api('/front-desk/order'), { orderedIds }));
  }

  // ── Waiting list ──
  waitingList(): Promise<WaitingEntry[]> {
    return firstValueFrom(this.http.get<WaitingEntry[]>(api('/scheduling/waiting-list')));
  }

  addToWaitingList(input: WaitingEntryInput): Promise<WaitingEntry> {
    return firstValueFrom(this.http.post<WaitingEntry>(api('/scheduling/waiting-list'), input));
  }

  removeFromWaitingList(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/scheduling/waiting-list/${id}`)));
  }

  scheduleFromWaitingList(id: string, input: ScheduleFromWaiting): Promise<Appointment> {
    return firstValueFrom(this.http.post<Appointment>(api(`/scheduling/waiting-list/${id}/schedule`), input));
  }

  // ── Absences and closures ──
  absences(from: Date, to: Date): Promise<Absence[]> {
    return firstValueFrom(this.http.get<Absence[]>(api('/scheduling/absences'), { params: { from: from.toISOString(), to: to.toISOString() } }));
  }

  addAbsence(input: AbsenceInput): Promise<Absence> {
    return firstValueFrom(this.http.post<Absence>(api('/scheduling/absences'), input));
  }

  removeAbsence(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/scheduling/absences/${id}`)));
  }

  events(from: Date, to: Date): Promise<ClinicEvent[]> {
    return firstValueFrom(this.http.get<ClinicEvent[]>(api('/scheduling/events'), { params: { from: from.toISOString(), to: to.toISOString() } }));
  }

  addEvent(input: ClinicEventInput): Promise<ClinicEvent> {
    return firstValueFrom(this.http.post<ClinicEvent>(api('/scheduling/events'), input));
  }

  removeEvent(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/scheduling/events/${id}`)));
  }
}
