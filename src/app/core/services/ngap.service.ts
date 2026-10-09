import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

/** One act of the Moroccan NGAP (arrêté n° 177-06). A null coefficient is one the text does not give. */
export interface NgapAct {
  code: string;
  keyLetter: string;
  coefficient: number | null;
  anesthesiaCoefficient: number | null;
  label: string;
  chapter: string;
  section: string | null;
  notes: string | null;
  priorAgreement: boolean;
  assimilatedTo: string | null;
}

/** Folds case and accents so "detartrage" finds "Détartrage". */
export function plainText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "D 15": what the care form shows for an act at a coefficient. */
export function cotation(act: NgapAct, coefficient?: number | null): string | null {
  const c = coefficient ?? act.coefficient;
  return c == null ? null : `${act.keyLetter} ${c}`;
}

/** The NGAP acts, national reference data: loaded once per session (about 200 rows). */
@Injectable({ providedIn: 'root' })
export class NgapService {
  private http = inject(HttpClient);
  private readonly all$ = this.http
    .get<NgapAct[]>(`${environment.apiUrl}/api/v1/reference/ngap-acts`, { params: { limit: 300 } })
    .pipe(shareReplay(1));

  acts(): Observable<NgapAct[]> {
    return this.all$;
  }
}
