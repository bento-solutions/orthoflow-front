import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { InputLanguageService } from './input-language.service';
import { PatientService } from '../services/patient.service';
import { DentalChartService } from '../services/dental-chart.service';
import { Dentition } from './tooth-lexicon';
import { LastWriteRef, VoiceContextSnapshot, VoiceIntent } from './voice-intent.model';

/**
 * What the assistant knows about where it is and what was just said.
 *
 * Two jobs. The first is application context (§10 of the requirements): a
 * doctor already inside Ahmed's dossier who says "upper right first molar
 * needs a crown replacement" should not be asked which patient. The second is
 * conversational context (§11): "that tooth", "the last finding", "no,
 * actually…" only mean anything relative to what came before.
 *
 * History is capped and lives only in memory — it is a conversational buffer,
 * not a record. The durable trail is the server-side audit.
 */

const MAX_HISTORY = 8;

@Injectable({ providedIn: 'root' })
export class VoiceContextService {
  private router = inject(Router);
  private inputLanguage = inject(InputLanguageService);
  private patients = inject(PatientService);
  private chart = inject(DentalChartService);

  private routeSignal = signal<string>(this.router.url);
  private selectedFdiSignal = signal<string | null>(null);
  private sessionIdSignal = signal<string | null>(null);
  private recentIntentsSignal = signal<VoiceIntent[]>([]);
  private recentUtterancesSignal = signal<string[]>([]);
  private lastWriteSignal = signal<LastWriteRef | null>(null);

  route = this.routeSignal.asReadonly();
  selectedFdi = this.selectedFdiSignal.asReadonly();
  sessionId = this.sessionIdSignal.asReadonly();
  lastWrite = this.lastWriteSignal.asReadonly();
  recentIntents = this.recentIntentsSignal.asReadonly();

  /**
   * Which part of the app is active. Commands declare the module they belong
   * to, and only matching ones are offered — both to the grammar and, more
   * importantly, to the NLU, which cannot propose a command it was never
   * shown (audit XII.4 §7).
   */
  module = computed<string>(() => {
    const url = this.routeSignal();
    if (url.startsWith('/patients/') && !url.includes('/register')) return 'patient-dossier';
    if (url.startsWith('/patients')) return 'patients';
    if (url.startsWith('/schedule')) return 'schedule';
    if (url.startsWith('/billing')) return 'billing';
    if (url.startsWith('/stock')) return 'stock';
    if (url.startsWith('/treatments')) return 'treatments';
    if (url.startsWith('/settings')) return 'settings';
    return 'dashboard';
  });

  /** What the doctor dictates in: the app's language unless they chose another at the start of the session. */
  locale = computed<string>(() => this.inputLanguage.locale());

  dentition = computed<Dentition>(() => this.chart.currentChart()?.chartType ?? 'adult');

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.routeSignal.set(event.urlAfterRedirects);
        // A tooth selected on one patient's chart must never carry over to
        // the next screen — "that tooth" would silently mean the wrong one.
        this.selectedFdiSignal.set(null);
      });
  }

  snapshot(): VoiceContextSnapshot {
    const patient = this.patients.currentPatient();
    return {
      patientId: patient?.id ?? null,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
      dentition: this.dentition(),
      module: this.module(),
      route: this.routeSignal(),
      selectedFdi: this.selectedFdiSignal(),
      sessionId: this.sessionIdSignal(),
      locale: this.locale(),
      recentIntents: this.recentIntentsSignal(),
      recentUtterances: this.recentUtterancesSignal(),
      lastWrite: this.lastWriteSignal(),
    };
  }

  selectTooth(fdi: string | null): void {
    this.selectedFdiSignal.set(fdi);
  }

  setSessionId(sessionId: string | null): void {
    this.sessionIdSignal.set(sessionId);
  }

  rememberUtterance(transcript: string): void {
    this.recentUtterancesSignal.update(list => [...list, transcript].slice(-MAX_HISTORY));
  }

  rememberIntent(intent: VoiceIntent): void {
    this.recentIntentsSignal.update(list => [intent, ...list].slice(0, MAX_HISTORY));
  }

  /**
   * The anchor for "undo that", "no, actually…" and "remove that note".
   * Recording a write also selects its tooth, so a run of findings on the
   * same tooth needs it named only once.
   */
  rememberWrite(write: LastWriteRef | null): void {
    this.lastWriteSignal.set(write);
    if (write?.fdi) this.selectedFdiSignal.set(write.fdi);
  }

  /** Called when a session ends, so nothing leaks into the next consultation. */
  clearConversation(): void {
    this.recentIntentsSignal.set([]);
    this.recentUtterancesSignal.set([]);
    this.lastWriteSignal.set(null);
  }
}
