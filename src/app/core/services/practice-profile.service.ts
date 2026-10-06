import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { AuthService } from './auth.service';

export type PracticeProfile = Wire<'Profile'>;
export type PracticeProfileInput = Req<'Profile'>;
export type OpeningWeek = Wire<'Week'>;
export type OpeningDay = Wire<'OpeningDay'>;

const DEFAULT_CURRENCY = 'MAD';

/**
 * The clinic's identity as the server holds it: legal name, ICE, IF, RIB, address,
 * currency, logo. It used to live in each browser's localStorage, so a document
 * printed from another PC lost its legal details; now every station and every
 * printed document reads the same record.
 */
@Injectable({ providedIn: 'root' })
export class PracticeProfileService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly profileSignal = signal<PracticeProfile | null>(null);
  private readonly logoUrlSignal = signal<string | null>(null);

  readonly profile = this.profileSignal.asReadonly();
  /** An object URL for the logo, fetched with the bearer token because an `<img>` cannot send one. */
  readonly logoUrl = this.logoUrlSignal.asReadonly();
  readonly currency = computed(() => this.profileSignal()?.currency || DEFAULT_CURRENCY);
  readonly name = computed(() => this.profileSignal()?.name ?? '');

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        if (token) {
          void this.refresh();
        } else {
          this.profileSignal.set(null);
          this.setLogo(null);
        }
      });
    });
  }

  async refresh(): Promise<void> {
    try {
      const profile = await firstValueFrom(this.http.get<PracticeProfile>(api('/settings/practice/profile')));
      this.profileSignal.set(profile);
      await this.loadLogo(profile);
    } catch {
      /* the screens fall back to defaults (MAD, no logo); nothing here should block sign-in */
    }
  }

  async save(input: PracticeProfileInput): Promise<PracticeProfile> {
    const saved = await firstValueFrom(this.http.put<PracticeProfile>(api('/settings/practice/profile'), input));
    this.profileSignal.set(saved);
    return saved;
  }

  async uploadLogo(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await firstValueFrom(this.http.post(api('/settings/practice/logo'), form));
    await this.refresh();
  }

  openingHours(): Promise<OpeningWeek> {
    return firstValueFrom(this.http.get<OpeningWeek>(api('/settings/practice/opening-hours')));
  }

  saveOpeningHours(week: Req<'Week'>): Promise<OpeningWeek> {
    return firstValueFrom(this.http.put<OpeningWeek>(api('/settings/practice/opening-hours'), week));
  }

  private async loadLogo(profile: PracticeProfile): Promise<void> {
    if (!profile.logoFileId) {
      this.setLogo(null);
      return;
    }
    try {
      const blob = await firstValueFrom(this.http.get(api('/settings/practice/logo'), { responseType: 'blob' }));
      this.setLogo(URL.createObjectURL(blob));
    } catch {
      this.setLogo(null);
    }
  }

  private setLogo(url: string | null): void {
    const previous = this.logoUrlSignal();
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    this.logoUrlSignal.set(url);
  }
}
