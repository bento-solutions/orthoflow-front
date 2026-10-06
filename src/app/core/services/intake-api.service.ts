import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { QueryValue, toParams } from './download.service';

export type BookingRequest = Wire<'RequestView'>;
export type BookingConfirm = Req<'Confirm'>;
export type PendingRegistration = Wire<'Pending'>;
export type SurveyReport = Wire<'Report'>;
export type SurveyRow = Wire<'SurveyRow'>;
export type Appointment = Wire<'AppointmentResponse'>;

export type PublicBookingInfo = Wire<'BookingPublicInfo'>;
export type PublicRegistrationInfo = Wire<'RegistrationPublicInfo'>;
export type PublicSurveyInfo = Wire<'SurveyPublicInfo'>;
export type BookingSubmission = Req<'Submit'>;
export type RegistrationForm = Req<'Form'>;
export type SurveyAnswer = Req<'Answer'>;

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'DECLINED', 'EXPIRED'] as const;

/**
 * What staff do with requests that came from outside (online booking, self-registration) and the
 * satisfaction answers, plus the three public forms a patient fills in with a link. The public
 * calls carry no session: the token in the address is their only authority.
 */
@Injectable({ providedIn: 'root' })
export class IntakeApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  // ── booking requests ───────────────────────────────────────────────
  bookingRequests(status: string): Promise<BookingRequest[]> {
    return this.get('/booking/requests', { status });
  }
  confirmBooking(id: string, body: BookingConfirm): Promise<Appointment> {
    return this.post(`/booking/requests/${id}/confirm`, body);
  }
  declineBooking(id: string, reason: string): Promise<void> {
    return this.post(`/booking/requests/${id}/decline`, { reason });
  }
  /** `{ pending }`: how many requests wait for a decision. */
  bookingCount(): Promise<{ pending: number }> {
    return this.get('/booking/requests/count');
  }

  // ── pending registrations ──────────────────────────────────────────
  pendingRegistrations(): Promise<PendingRegistration[]> {
    return this.get('/registrations/pending');
  }
  approveRegistration(id: string, mergeIntoPatientId?: string): Promise<Record<string, string>> {
    return this.post(`/registrations/${id}/approve`, { mergeIntoPatientId });
  }
  rejectRegistration(id: string): Promise<void> {
    return this.post(`/registrations/${id}/reject`);
  }
  registrationCount(): Promise<{ pending: number }> {
    return this.get('/registrations/count');
  }
  inviteToRegister(patientId: string): Promise<Wire<'RegistrationInvite'>> {
    return this.post(`/patients/${patientId}/registration-invite`);
  }

  // ── surveys ────────────────────────────────────────────────────────
  surveys(query: { from?: string; to?: string; maxRating?: number; callMeOnly?: boolean; unhandledOnly?: boolean }): Promise<SurveyReport> {
    return this.get('/surveys', query);
  }
  surveyHandled(id: string): Promise<void> {
    return this.post(`/surveys/${id}/handled`);
  }

  // ── public forms (no session) ──────────────────────────────────────
  publicBookingInfo(token: string): Promise<PublicBookingInfo> {
    return this.get(`/public/book/${token}`);
  }
  publicAvailability(token: string, typeId: string, practitionerId: string | undefined, from: string, days: number): Promise<Record<string, string[]>> {
    return this.get<Wire<'Availability'>>(`/public/book/${token}/availability`, { typeId, practitionerId, from, days }).then(a => a.days);
  }
  submitBooking(token: string, body: BookingSubmission): Promise<Wire<'Received'>> {
    return this.post(`/public/book/${token}/requests`, body);
  }
  publicRegistrationInfo(token: string): Promise<PublicRegistrationInfo> {
    return this.get(`/public/register/${token}`);
  }
  submitRegistration(token: string, body: RegistrationForm): Promise<Record<string, boolean>> {
    return this.post(`/public/register/${token}`, body);
  }
  publicSurveyInfo(token: string): Promise<PublicSurveyInfo> {
    return this.get(`/public/survey/${token}`);
  }
  submitSurvey(token: string, body: SurveyAnswer): Promise<Record<string, boolean>> {
    return this.post(`/public/survey/${token}`, body);
  }
}
