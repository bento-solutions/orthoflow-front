import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Wire } from '../api/wire';
import { ConsultationService } from '../consultation/consultation.service';
import { PatientApiService } from '../services/patient-api.service';
import { PatientService } from '../services/patient.service';
import { PermissionService } from '../services/permission.service';
import { ScheduleService } from '../services/schedule.service';
import { VoiceSessionService } from '../voice/voice-session.service';
import { Tour, TourService, tourSelector, waitForElement } from './tours';

/*
 * The first-login guide ("first run"): three short chapters a doctor is walked through the first
 * time they sign in — the dashboard, a patient's file, and the voice tools. Not to be confused with
 * `/onboarding`, the wizard that sets up a new clinic.
 */

export type GuideProgress = Wire<'GuideProgress'>;
export type GuideKey = GuideProgress['key'];
type GuideStatus = GuideProgress['status'];

export interface Chapter {
  key: GuideKey;
  /** Raise it when a chapter's content changes enough to show it again to those who saw it. */
  version: number;
  /** The screen it points at. */
  where: 'dashboard' | 'dossier';
  tour: Tour;
}

export const FIRST_RUN: readonly Chapter[] = [
  {
    key: 'FIRST_RUN_DASHBOARD',
    version: 1,
    where: 'dashboard',
    tour: {
      id: 'first-run-dashboard',
      steps: [
        { target: 'dash-kpis', key: 'TOUR.FIRST_RUN.DASHBOARD.KPIS', side: 'bottom' },
        { target: 'dash-today', key: 'TOUR.FIRST_RUN.DASHBOARD.TODAY', side: 'top' },
        { target: 'dash-attention', key: 'TOUR.FIRST_RUN.DASHBOARD.ATTENTION', side: 'left' },
        { target: 'search', key: 'TOUR.FIRST_RUN.DASHBOARD.SEARCH', side: 'bottom' },
      ],
    },
  },
  {
    key: 'FIRST_RUN_DOSSIER',
    version: 1,
    where: 'dossier',
    tour: {
      id: 'first-run-dossier',
      steps: [
        { target: 'dossier-banner', key: 'TOUR.FIRST_RUN.DOSSIER.BANNER', side: 'bottom' },
        { target: 'dossier-tabs', key: 'TOUR.FIRST_RUN.DOSSIER.TABS', side: 'bottom' },
        { target: 'dossier-chart', key: 'TOUR.FIRST_RUN.DOSSIER.CHART', side: 'right' },
        { target: 'dossier-consult', key: 'TOUR.FIRST_RUN.DOSSIER.CONSULT', side: 'bottom' },
      ],
    },
  },
  {
    key: 'FIRST_RUN_VOICE',
    version: 1,
    where: 'dossier',
    tour: {
      id: 'first-run-voice',
      steps: [
        { target: 'dossier-consult', key: 'TOUR.FIRST_RUN.VOICE.MODES', side: 'bottom' },
        { key: 'TOUR.FIRST_RUN.VOICE.SPEAK' },
        { key: 'TOUR.FIRST_RUN.VOICE.PHRASES' },
        { key: 'TOUR.FIRST_RUN.VOICE.REVIEW' },
      ],
    },
  },
];

/** After this many "later"s the guide stops offering itself; it stays one click away in the help panel. */
export const MAX_SNOOZES = 2;

/** The width from which the guide offers itself: the dashboard's three columns and the patient file's side by side. */
export const WIDE_SCREEN = '(min-width: 1024px)';

/** A chapter is settled once finished or turned down, for the version of it the person saw or a later one. */
function settled(chapter: Chapter, progress: readonly GuideProgress[]): boolean {
  const row = progress.find(p => p.key === chapter.key);
  return !!row && row.status !== 'SNOOZED' && row.version >= chapter.version;
}

/** The chapters still to show, in order. */
export function pendingChapters(progress: readonly GuideProgress[]): Chapter[] {
  return FIRST_RUN.filter(chapter => !settled(chapter, progress));
}

export interface OfferContext {
  /** The path of the screen, without query. */
  path: string;
  wide: boolean;
  canWriteClinical: boolean;
  /** A dictation or a consultation is running or being reviewed. */
  busy: boolean;
}

export const isDossierPath = (path: string): boolean => /^\/patients\/[0-9a-f-]{36}$/i.test(path);

/**
 * Whether to offer the guide on this screen, and in which words: `start` the first time,
 * `resume` when part of it is done. Only on a wide screen, to someone who writes in the clinical
 * record, never during a dictation or a consultation, and not after two "later"s. It offers
 * itself on the dashboard; the patient-file chapters also wait for the first file opened, for a
 * clinic that had no patient when the dashboard chapter ran.
 */
export function offerFor(progress: readonly GuideProgress[], ctx: OfferContext): 'start' | 'resume' | null {
  if (!ctx.wide || !ctx.canWriteClinical || ctx.busy) {
    return null;
  }
  const pending = pendingChapters(progress);
  if (pending.length === 0) {
    return null;
  }
  const snoozes = Math.max(0, ...progress.map(p => p.snoozeCount ?? 0));
  if (snoozes >= MAX_SNOOZES) {
    return null;
  }
  const started = pending.length < FIRST_RUN.length;
  if (ctx.path === '/') {
    return started ? 'resume' : 'start';
  }
  if (isDossierPath(ctx.path) && pending.every(c => c.where === 'dossier') && started) {
    return 'resume';
  }
  return null;
}

/** The progress endpoints (`/me/guides`): always the signed-in person's own. */
@Injectable({ providedIn: 'root' })
export class FirstRunApi {
  private readonly http = inject(HttpClient);

  mine(): Promise<GuideProgress[]> {
    return firstValueFrom(this.http.get<GuideProgress[]>(api('/me/guides')));
  }

  save(key: GuideKey, status: GuideStatus, version: number, lastStep: string | null): Promise<GuideProgress> {
    return firstValueFrom(this.http.put<GuideProgress>(api(`/me/guides/${key}`), { status, version, lastStep: lastStep ?? undefined }));
  }
}

/**
 * Runs the first-login guide. It never stands in the way: if anything fails (the server is down,
 * an older server without the endpoints, a screen that did not load) there is simply no guide.
 */
@Injectable({ providedIn: 'root' })
export class FirstRunService {
  private readonly api = inject(FirstRunApi);
  private readonly tours = inject(TourService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);
  private readonly voice = inject(VoiceSessionService);
  private readonly consultation = inject(ConsultationService);
  private readonly patients = inject(PatientService);
  private readonly patientApi = inject(PatientApiService);
  private readonly schedule = inject(ScheduleService);

  private progress: GuideProgress[] | null = null;
  private running = false;
  /** Asked once per visit: a "later" is not asked again on the next screen. */
  private asked = false;

  /** The welcome dialog, when it is open. */
  readonly offer = signal<'start' | 'resume' | null>(null);

  /** Called after each navigation: offers the guide when this screen is where it starts. */
  async consider(url: string): Promise<void> {
    if (this.asked || this.running || this.offer()) {
      return;
    }
    const path = url.split(/[?#]/)[0].replace(/(.)\/$/, '$1');
    if (path !== '/' && !isDossierPath(path)) {
      return;
    }
    try {
      await this.permissions.ready();
      this.progress ??= await this.api.mine();
    } catch {
      this.asked = true; // no endpoint, no network: no guide this visit
      return;
    }
    const offer = offerFor(this.progress, {
      path,
      wide: window.matchMedia?.(WIDE_SCREEN).matches ?? false,
      canWriteClinical: this.permissions.can('CLINICAL_WRITE'),
      busy: this.busy(),
    });
    if (offer && this.currentPath() === path) {
      this.asked = true;
      this.offer.set(offer);
    }
  }

  /** "Start" (or "Continue"): runs the chapters still to do. */
  async accept(): Promise<void> {
    this.offer.set(null);
    await this.run(pendingChapters(this.progress ?? []), false);
  }

  /** "Later": asked again at the next sign-in, at most {@link MAX_SNOOZES} times. */
  async later(): Promise<void> {
    this.offer.set(null);
    await this.saveAll('SNOOZED');
  }

  /** "Don't show again": the guide stays in the help panel and on the account page. */
  async never(): Promise<void> {
    this.offer.set(null);
    await this.saveAll('DISMISSED');
  }

  /** The whole guide again, from the help panel or the account page, whatever was done before. */
  async replay(): Promise<void> {
    this.offer.set(null);
    await this.run([...FIRST_RUN], true);
  }

  private async saveAll(status: GuideStatus): Promise<void> {
    await Promise.all(pendingChapters(this.progress ?? []).map(c => this.save(c, status, null)));
  }

  private async save(chapter: Chapter, status: GuideStatus, lastStep: string | null): Promise<void> {
    try {
      const row = await this.api.save(chapter.key, status, chapter.version, lastStep);
      this.progress = [...(this.progress ?? []).filter(p => p.key !== chapter.key), row];
    } catch {
      // not saved: at worst the chapter is offered again next time
    }
  }

  private async run(chapters: readonly Chapter[], replay: boolean): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      for (const chapter of chapters) {
        if (this.busy() || !(await this.open(chapter))) {
          return;
        }
        const outcome = await this.tours.run(chapter.tour, chapter.key === 'FIRST_RUN_VOICE' ? { finalAction: this.tryNow() } : {});
        if (outcome.shown === 0) {
          return;
        }
        if (outcome.completed) {
          await this.save(chapter, 'COMPLETED', outcome.lastStep);
          continue;
        }
        // Closed early. On the first run that is a "later"; a replay leaves what was saved alone.
        if (!replay) {
          await this.save(chapter, 'SNOOZED', outcome.lastStep);
        }
        return;
      }
    } finally {
      this.running = false;
    }
  }

  /** Brings up the screen a chapter points at and waits for it. False when it cannot be shown now. */
  private async open(chapter: Chapter): Promise<boolean> {
    const first = chapter.tour.steps.find(s => s.target)!.target!;
    if (chapter.where === 'dashboard') {
      if (this.currentPath() !== '/') {
        await this.router.navigateByUrl('/');
      }
    } else if (!isDossierPath(this.currentPath())) {
      const patientId = await this.patientToShow();
      if (!patientId) {
        return false; // no patient yet: these chapters wait for the first file opened
      }
      await this.router.navigate(['/patients', patientId]);
    }
    if (!(await waitForElement(tourSelector(first)))) {
      return false;
    }
    // The 3D chart arrives after the banner; give it a moment rather than skip it.
    if (chapter.key === 'FIRST_RUN_DOSSIER') {
      await waitForElement(tourSelector('dossier-chart'), 3000);
    }
    return true;
  }

  /** The first patient of today's agenda, else the most recently updated file: opened to look, nothing is changed. */
  private async patientToShow(): Promise<string | null> {
    const today = new Date().toDateString();
    const next = this.schedule.appointments()
      .filter(a => a.status !== 'CANCELLED' && new Date(a.dateTime).toDateString() === today)
      .sort((a, b) => +new Date(a.dateTime) - +new Date(b.dateTime))[0];
    if (next?.patientId) {
      return next.patientId;
    }
    let patients = this.patients.patients();
    if (patients.length === 0) {
      // The shared list may have been asked for before sign-in; ask again rather than conclude there is no patient.
      patients = await firstValueFrom(this.patientApi.getPatients()).catch(() => []);
    }
    const recent = [...patients].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
    return recent?.id ?? null;
  }

  /**
   * "Try it now" on the voice chapter's last step: opens the Consultation menu, so the doctor picks
   * dictation or consultation themselves. The guide never starts the microphone.
   */
  private tryNow(): { label: string; run: () => void } {
    return {
      label: this.translate.instant('TOUR.FIRST_RUN.TRY_NOW'),
      // After the click that ended the tour has finished bubbling: the menu closes on an outside click.
      run: () => setTimeout(() => document.querySelector<HTMLButtonElement>(`${tourSelector('dossier-consult')} button`)?.click()),
    };
  }

  private busy(): boolean {
    return this.voice.isActive() || this.voice.reviewing() || this.consultation.visible() || this.consultation.intro();
  }

  private currentPath(): string {
    return this.router.url.split(/[?#]/)[0];
  }
}
