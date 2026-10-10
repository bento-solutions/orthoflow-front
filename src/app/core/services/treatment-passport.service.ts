import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { api } from '../api/url';
import { TreatmentPassport } from '../api/contract';
import { DownloadService } from './download.service';

export type PassportLanguage = 'fr' | 'en' | 'ar';

/**
 * The patient's treatment passport: the screen's preview of it, and the two
 * copies a doctor can hand over (a printed PDF in the language of the next
 * practitioner, and a structured JSON file). Handing a copy over is recorded
 * server-side; previewing is not.
 */
@Injectable({ providedIn: 'root' })
export class TreatmentPassportService {
  private readonly http = inject(HttpClient);
  private readonly downloads = inject(DownloadService);

  private readonly passportSignal = signal<TreatmentPassport | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly failedSignal = signal(false);

  readonly passport = this.passportSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly failed = this.failedSignal.asReadonly();

  load(patientId: string): void {
    this.loadingSignal.set(true);
    this.failedSignal.set(false);
    this.http.get<TreatmentPassport>(api(`/patients/${patientId}/clinical-record/passport`))
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe({
        next: (passport) => this.passportSignal.set(passport),
        error: (err) => {
          console.error('Failed to load the treatment passport', err);
          this.failedSignal.set(true);
        },
      });
  }

  downloadPdf(patientId: string, lang: PassportLanguage): Promise<void> {
    return this.downloads.download(`/patients/${patientId}/clinical-record/passport/download.pdf`, { lang }, 'treatment-passport.pdf');
  }

  downloadJson(patientId: string): Promise<void> {
    return this.downloads.download(`/patients/${patientId}/clinical-record/passport/download.json`, {}, 'treatment-passport.json');
  }
}
