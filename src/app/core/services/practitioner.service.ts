import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { AuthService } from './auth.service';

export type Practitioner = Wire<'PractitionerResponse'>;
export type PractitionerInput = Req<'PractitionerRequest'>;
export type UnmatchedName = Wire<'Unmatched'>;

export const SPECIALTIES = [
  'ORTHODONTICS', 'GENERAL_DENTISTRY', 'ENDODONTICS', 'PERIODONTICS', 'PEDODONTICS', 'ORAL_SURGERY', 'IMPLANTOLOGY', 'PROSTHODONTICS', 'OTHER',
] as const;

/**
 * The clinic's practitioners. A visiting doctor may have no login, so these are not
 * users; the agenda, invoices, receipts and retrocessions all refer to them.
 * {@link active} is the list every dropdown offers, kept fresh for the session.
 */
@Injectable({ providedIn: 'root' })
export class PractitionerService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** Active practitioners, in the order the clinic set. Empty until someone is signed in. */
  readonly active = signal<Practitioner[]>([]);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => (token ? void this.refresh() : this.active.set([])));
    });
  }

  async refresh(): Promise<void> {
    try {
      this.active.set(await this.list(false));
    } catch {
      /* dropdowns stay as they were */
    }
  }

  list(includeInactive: boolean): Promise<Practitioner[]> {
    return firstValueFrom(this.http.get<Practitioner[]>(api('/practitioners'), { params: { includeInactive } }));
  }

  async create(input: PractitionerInput): Promise<Practitioner> {
    const created = await firstValueFrom(this.http.post<Practitioner>(api('/practitioners'), input));
    await this.refresh();
    return created;
  }

  async update(id: string, input: PractitionerInput): Promise<Practitioner> {
    const updated = await firstValueFrom(this.http.put<Practitioner>(api(`/practitioners/${id}`), input));
    await this.refresh();
    return updated;
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await firstValueFrom(this.http.put<void>(api('/practitioners/order'), { orderedIds }));
    await this.refresh();
  }

  unmatchedNames(): Promise<UnmatchedName[]> {
    return firstValueFrom(this.http.get<UnmatchedName[]>(api('/practitioners/unmatched-names')));
  }

  resolveUnmatched(doctorName: string, practitionerId: string): Promise<{ updated: number }> {
    return firstValueFrom(this.http.post<{ updated: number }>(api('/practitioners/unmatched-names/resolve'), { doctorName, practitionerId }));
  }

  /** The name to show for an id, for tables that carry only the id. */
  nameOf(id: string | null | undefined): string {
    return this.active().find(p => p.id === id)?.displayName ?? '—';
  }
}
