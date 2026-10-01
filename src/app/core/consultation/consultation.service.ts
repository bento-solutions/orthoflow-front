import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ConsultationApiService } from './consultation-api.service';
import {
  AppointmentChoice,
  emptyReview,
  fromStoredReview,
  mergeDraft,
  pendingCount,
  PatientRecord,
  ReviewState,
  toCommitRequest,
  toStoredReview,
  validateAll,
} from './consultation-draft';
import {
  buildAssistantSheetHtml,
  buildReportHtml,
  DocumentInput,
  printHtml,
} from './consultation-documents';
import { isBeginExaminationPhrase } from './consultation-phrases';
import { chartLine } from './consultation-chart';
import { CommitConsultationDto, ConsultationDto, ConsultationConfigDto } from './consultation.model';
import { VoiceApiService } from '../voice/voice-api.service';
import { VoiceOrchestratorService } from '../voice/voice-orchestrator.service';
import { VoiceSessionService } from '../voice/voice-session.service';
import { VoiceContextService } from '../voice/voice-context.service';
import { SpeechFeedbackService } from '../voice/speech-feedback.service';
import { isStopPhrase } from '../voice/voice-wake';
import { spokenLanguage, synthesisLocale } from '../voice/voice-vocabulary';
import { PatientService } from '../services/patient.service';
import { ClinicalRecordService } from '../services/clinical-record.service';
import { ScheduleService } from '../services/schedule.service';
import { CabinetService } from '../services/cabinet.service';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';
import { ToastService } from '../services/toast.service';
import { Patient } from '../models/patient.model';

/**
 * A recorded consultation, from the first word to the printed paper.
 *
 * ── The three phases ────────────────────────────────────────────────────
 *
 * **Intake.** The microphone is open and *everything* said is kept — the
 * doctor's questions and the patient's answers. Nothing is a command. Every few
 * seconds the transcript is sent to the server, which reads it and proposes
 * what matters: who the patient is, allergies, history, what they are taking.
 *
 * **Examination.** The doctor calls the consultation ("Calypso, consultation",
 * or the button). From here the wake-word commands for the dental chart work
 * exactly as in a dictated examination — they are the same commands, staged and
 * read back — while the conversation keeps being kept and read.
 *
 * **Review.** The doctor ends it ("fin de la consultation"). The microphone
 * stops and everything the system caught is put in front of them: each item is
 * validated, corrected or removed. Nothing reaches the patient's record until
 * they save, and the save is blocked while anything is still undecided.
 *
 * ── What this service does not do ───────────────────────────────────────
 *
 * It does not capture audio, transcribe, or stage chart findings — that is the
 * voice pipeline, reused unchanged. It taps every transcribed utterance
 * ({@link VoiceOrchestratorService.setTranscriptListener}) and owns the part
 * that is new: the conversation, what is read from it, and the review.
 */

export type ConsultationPhase = 'intake' | 'examination' | 'review' | 'saved';

export interface TranscriptLine {
  id: number;
  text: string;
  at: number;
  /** Typed in, not heard. */
  typed: boolean;
}

/** What a finished consultation keeps for printing and for the saved screen. */
export interface SavedConsultation {
  record: CommitConsultationDto;
  patient: Patient;
  chartLines: string[];
  date: Date;
  appointmentText: string | null;
}

/**
 * Wait this long after the doctor's last change before keeping the review on the
 * server — long enough to batch a run of ticks, short enough that a reload right
 * after loses at most a click or two.
 */
export const REVIEW_SAVE_DEBOUNCE_MS = 1_500;

/** Wait this long after the last utterance before reading the conversation again. */
export const EXTRACT_DEBOUNCE_MS = 4_000;
/** ...and never read more often than this, whatever is said: a model call costs money. */
export const EXTRACT_MIN_INTERVAL_MS = 9_000;
/** The longest wait between readings, however long the conversation or however many have failed. */
export const EXTRACT_MAX_INTERVAL_MS = 60_000;
/**
 * Each reading sends the *whole* conversation, so a long one costs more every
 * time. On a plan with a tokens-per-minute ceiling (8 000 on a free Groq key) a
 * twenty-minute consultation read every nine seconds would never get an answer.
 * The wait grows with the conversation instead: this much more per thousand
 * characters said.
 */
export const EXTRACT_MS_PER_1000_CHARS = 1_500;

/**
 * How long to leave between readings: the minimum, more for a long conversation,
 * and doubled for each reading in a row that failed — an API that is refusing us
 * is not helped by being asked again sooner.
 */
export function extractionInterval(transcriptChars: number, consecutiveFailures: number): number {
  const grown = EXTRACT_MIN_INTERVAL_MS + (transcriptChars / 1000) * EXTRACT_MS_PER_1000_CHARS;
  const backedOff = grown * 2 ** Math.min(consecutiveFailures, 4);
  return Math.min(EXTRACT_MAX_INTERVAL_MS, Math.round(backedOff));
}

const SPOKEN = {
  fr: {
    started: 'Enregistrement démarré.',
    examination: 'Consultation commencée. Dites Calypso avant une commande.',
    ended: 'Consultation terminée. Relisez et validez à l’écran.',
    saved: 'Consultation enregistrée.',
  },
  en: {
    started: 'Recording started.',
    examination: 'Consultation started. Say Calypso before a command.',
    ended: 'Consultation ended. Please review and validate on screen.',
    saved: 'Consultation saved.',
  },
} as const;

/** Keys of the labels the printed documents are built from (`CONSULTATION.DOC.*`). */
export const DOC_LABEL_KEYS = [
  'REPORT_TITLE', 'SHEET_TITLE', 'DOCTOR', 'PATIENT', 'AGE', 'YEARS', 'GENDER', 'PHONE', 'CIN', 'INSURANCE',
  'COMPLAINT', 'ALLERGIES', 'HISTORY', 'ACTIVE_TREATMENTS', 'CHART_FINDINGS', 'REPORT', 'PLAN', 'TOOTH',
  'NEXT_APPOINTMENT', 'DOCTOR_SIGNATURE', 'TREATMENT', 'QUANTITY', 'UNIT_PRICE', 'AMOUNT', 'TOTAL',
  'TOTAL_PARTIAL', 'UNPRICED_NOTE', 'NO_PLAN', 'SEVERITY_MILD', 'SEVERITY_MODERATE', 'SEVERITY_SEVERE',
  'GENDER_M', 'GENDER_F',
] as const;

@Injectable({ providedIn: 'root' })
export class ConsultationService {
  private api = inject(ConsultationApiService);
  private voiceApi = inject(VoiceApiService);
  private voice = inject(VoiceOrchestratorService);
  private sessions = inject(VoiceSessionService);
  private context = inject(VoiceContextService);
  private feedback = inject(SpeechFeedbackService);
  private patients = inject(PatientService);
  private clinical = inject(ClinicalRecordService);
  private schedule = inject(ScheduleService);
  private cabinet = inject(CabinetService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);
  private languageService = inject(LanguageService);

  // ── State ───────────────────────────────────────────────────────────

  private configSignal = signal<ConsultationConfigDto | null>(null);
  private consultationSignal = signal<ConsultationDto | null>(null);
  private linesSignal = signal<TranscriptLine[]>([]);
  private reviewSignal = signal<ReviewState>(emptyReview());
  private startingSignal = signal(false);
  private busySignal = signal(false);
  private savingSignal = signal(false);
  private extractingSignal = signal(false);
  private noteSignal = signal<'extraction-disabled' | 'extraction-failed' | 'truncated' | 'offline' | null>(null);
  private reportSignal = signal('');
  private excludedSignal = signal<Set<string>>(new Set());
  private failuresSignal = signal<{ auditId: string; intent: string; errorMessage: string }[]>([]);
  private savedSignal = signal<SavedConsultation | null>(null);
  private savedVersionSignal = signal(0);
  private introSignal = signal(false);

  config = this.configSignal.asReadonly();
  consultation = this.consultationSignal.asReadonly();
  lines = this.linesSignal.asReadonly();
  review = this.reviewSignal.asReadonly();
  starting = this.startingSignal.asReadonly();
  /** Ending or otherwise changing phase. */
  busy = this.busySignal.asReadonly();
  saving = this.savingSignal.asReadonly();
  /** A reading of the conversation is in flight. */
  extracting = this.extractingSignal.asReadonly();
  /** Why the side panel shows less than it could, when it does. */
  note = this.noteSignal.asReadonly();
  /** The consultation report, as the doctor is editing it. */
  report = this.reportSignal.asReadonly();
  /** Chart findings the doctor unticked at review. */
  excluded = this.excludedSignal.asReadonly();
  /** Chart findings that failed to write on the last save. */
  failures = this.failuresSignal.asReadonly();
  saved = this.savedSignal.asReadonly();
  /** Bumped on every save, so the dossier knows to reload what the save changed. */
  savedVersion = this.savedVersionSignal.asReadonly();

  /** The "before we start" card is showing: the attestation, then the first tap. */
  intro = this.introSignal.asReadonly();

  available = computed(() => this.configSignal()?.enabled === true);
  modelExtraction = computed(() => this.configSignal()?.modelExtraction === true);
  /** Whether the transcript is kept after saving — it decides what the patient is told. */
  retainTranscript = computed(() => this.configSignal()?.retainTranscript === true);

  phase = computed<ConsultationPhase | null>(() => {
    switch (this.consultationSignal()?.status) {
      case 'INTAKE': return 'intake';
      case 'EXAMINATION': return 'examination';
      case 'REVIEW': return 'review';
      case 'COMPLETED': return 'saved';
      default: return null;
    }
  });
  /** In progress — recording or waiting to be reviewed. */
  isOpen = computed(() => ['intake', 'examination', 'review'].includes(this.phase() ?? ''));
  isRecording = computed(() => ['intake', 'examination'].includes(this.phase() ?? ''));
  /** The microphone is open for this consultation. */
  listening = computed(() => this.isRecording() && this.voice.examinationMode());

  /** The side panel is showing: the intro, a consultation in progress, or the saved screen. */
  visible = computed(() => this.introSignal() || this.phase() !== null);

  transcript = computed(() => this.linesSignal().map(line => line.text).join('\n'));

  /** The record as it stands, for deciding what a proposal would change. */
  private record = computed<PatientRecord>(() => {
    const p = this.patients.currentPatient();
    return {
      firstName: p?.firstName, lastName: p?.lastName, dateOfBirth: p?.dateOfBirth, gender: p?.gender,
      phone: p?.phone, cin: p?.cin, insuranceProvider: p?.insuranceProvider, insuranceNumber: p?.insuranceNumber,
    };
  });

  /** How many items still wait for the doctor to validate, correct or remove them. */
  pending = computed(() => pendingCount(this.reviewSignal(), this.record(), new Date()));

  /** The chart findings dictated in the examination, with the doctor's ticks applied. */
  chartEntries = computed(() => this.voice.buffered().map(entry => ({
    entry,
    included: !this.excludedSignal().has(entry.auditId),
  })));
  /** The kept chart findings, worded in the doctor's language for the report and the printouts. */
  includedChartLines = computed(() => {
    const language = spokenLanguage(this.context.locale());
    const tooth = this.translate.instant('CONSULTATION.DOC.TOOTH');
    return this.chartEntries().filter(row => row.included).map(row => chartLine(row.entry, language, tooth));
  });

  canSave = computed(() => this.phase() === 'review' && this.pending() === 0 && !this.savingSignal() && !this.busySignal());

  // ── Timers and flags ────────────────────────────────────────────────

  private nextLineId = 1;
  private extractTimer: ReturnType<typeof setTimeout> | null = null;
  private lastExtractAt = 0;
  private dirty = false;
  private inFlight = false;
  private ending = false;
  /** Readings in a row that produced nothing — the server refused, or no model answered. */
  private failedReadings = 0;
  private reviewSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Who {@link loadConfig}'s answer is for; undefined when it should be asked again. */
  private configUser: string | null | undefined = undefined;

  // ── Availability ────────────────────────────────────────────────────

  /**
   * Asks the server whether the feature is on. Safe to call again: it asks once
   * per signed-in person. The clinic PC is shared, and an assistant's 403 must
   * not hide the button from the doctor who signs in after them; a network
   * failure is not remembered at all, so the next screen asks again.
   */
  async loadConfig(): Promise<void> {
    const user = this.auth.currentUser();
    const askedFor = user?.id ?? user?.email ?? null;
    if (this.configSignal() && this.configUser === askedFor) return;
    try {
      this.configSignal.set(await firstValueFrom(this.api.config()));
      this.configUser = askedFor;
    } catch (error) {
      // Older server, wrong role, or signed out: no button rather than a broken one.
      this.configSignal.set({ enabled: false, modelExtraction: false, retainTranscript: false });
      const status = (error as HttpErrorResponse)?.status;
      this.configUser = status === 401 || status === 403 || status === 404 ? askedFor : undefined;
    }
  }

  // ── Starting, resuming, leaving ─────────────────────────────────────

  openIntro(): void {
    if (this.available() && !this.isOpen()) this.introSignal.set(true);
  }

  closeIntro(): void {
    this.introSignal.set(false);
  }

  /**
   * Starts recording for the patient whose dossier is open.
   *
   * **The caller opens the microphone first, synchronously from the tap**
   * ({@link VoiceOrchestratorService.openMicrophone}): iOS only lets audio
   * start inside the gesture, and the round trip below outlives it.
   */
  async start(): Promise<boolean> {
    const snapshot = this.context.snapshot();
    if (!snapshot.patientId || this.startingSignal() || this.isOpen()) return false;
    // Before anything is awaited: this is still inside the tap that asked for it.
    const microphone = this.voice.openMicrophone();
    this.startingSignal.set(true);
    try {
      // The doctor attested in the dialog before this was called; the server records when.
      const dto = await firstValueFrom(this.api.start(snapshot.patientId, snapshot.locale, true));
      this.attach(dto);
      if (dto.voiceSessionId) {
        await this.sessions.adopt(await firstValueFrom(this.voiceApi.getSession(dto.voiceSessionId)));
      }
      await microphone;
      await this.voice.startExaminationMode({ announce: false });
      this.introSignal.set(false);
      this.say('started');
      return true;
    } catch (error) {
      this.voice.stopListening();
      this.detach();
      this.toast.error(this.describe(error, 'CONSULTATION.ERROR_START'));
      return false;
    } finally {
      this.startingSignal.set(false);
    }
  }

  /**
   * Picks up this patient's unfinished consultation when their dossier opens: a
   * crash, a closed tab, or a doctor who left the room.
   *
   * A consultation that was still recording needs a tap to reopen the
   * microphone — a browser will not do it unprompted — so it comes back with
   * the transcript intact and the microphone off.
   */
  async resumeOpen(patientId: string): Promise<void> {
    await this.loadConfig();
    if (!this.available()) return;
    if (this.consultationSignal()?.patientId === patientId) return;
    let dto: ConsultationDto | null;
    try {
      dto = await firstValueFrom(this.api.open(patientId));
    } catch {
      return;
    }
    if (!dto || this.patients.currentPatient()?.id !== patientId) return;

    this.attach(dto);
    const restored = await this.sessions.resumeIfAvailable(patientId);
    if (restored === null && dto.voiceSessionId) {
      try {
        await this.sessions.adopt(await firstValueFrom(this.voiceApi.getSession(dto.voiceSessionId)));
      } catch {
        // The dictated session is gone; the conversation and what it established are not.
      }
    }
    if (dto.status === 'REVIEW') {
      this.voice.setTranscriptListener(null);
      // The report the doctor was editing came back with the rest of their
      // review; writing a fresh narrative over it would lose their words.
      if (!fromStoredReview(dto.reviewState)) await this.regenerateReport();
    }
  }

  /**
   * Reopens the microphone for a consultation that came back from a crash.
   * Must be reached synchronously from a tap, for the same reason as {@link start}.
   */
  async resumeRecording(): Promise<void> {
    if (!this.isRecording()) return;
    const microphone = this.voice.openMicrophone();
    try {
      await microphone;
      this.voice.setTranscriptListener(text => this.onHeard(text));
      this.voice.setConversationOnly(this.phase() === 'intake');
      await this.voice.startExaminationMode({ announce: false });
    } catch {
      this.voice.stopListening();
    }
  }

  /**
   * Lets go of the consultation in this tab without ending it — the doctor left
   * the dossier. The server keeps it, and offers it back when they return.
   */
  detach(): void {
    this.flushReviewSave();
    this.clearExtractTimer();
    this.voice.setTranscriptListener(null);
    this.voice.setConversationOnly(false);
    this.sessions.setRouting(null);
    this.consultationSignal.set(null);
    this.linesSignal.set([]);
    this.reviewSignal.set(emptyReview());
    this.reportSignal.set('');
    this.excludedSignal.set(new Set());
    this.failuresSignal.set([]);
    this.noteSignal.set(null);
    this.savedSignal.set(null);
    this.introSignal.set(false);
    this.dirty = false;
    this.inFlight = false;
    this.ending = false;
    this.extractingSignal.set(false);
  }

  /** Closes the saved screen. */
  dismiss(): void {
    this.detach();
  }

  private attach(dto: ConsultationDto): void {
    this.consultationSignal.set(dto);
    this.linesSignal.set(this.linesOf(dto.transcript));
    // What the doctor had decided, when there is any: the server's draft is
    // already folded into it, and rebuilding from the draft alone would undo
    // every validation, correction and removal. The next reading merges as usual.
    const stored = fromStoredReview(dto.reviewState);
    this.reviewSignal.set(stored ? stored.review : dto.draft ? mergeDraft(emptyReview(), dto.draft) : emptyReview());
    this.reportSignal.set(stored?.report ?? '');
    this.excludedSignal.set(new Set(stored?.excluded ?? []));
    this.failuresSignal.set([]);
    this.noteSignal.set(null);
    this.savedSignal.set(null);
    this.dirty = false;
    this.ending = false;
    this.failedReadings = 0;
    this.lastExtractAt = 0;

    // Everything that ends a session — the dock, the header, the spoken "fin de
    // la consultation", the inactivity timeout — now ends the consultation.
    this.sessions.setRouting({
      end: options => this.end(options),
      abandon: () => this.abandon(),
    });
    if (dto.status === 'INTAKE' || dto.status === 'EXAMINATION') {
      this.voice.setTranscriptListener(text => this.onHeard(text));
      this.voice.setConversationOnly(dto.status === 'INTAKE');
    }
  }

  private linesOf(transcript: string | null): TranscriptLine[] {
    return (transcript ?? '').split('\n').map(text => text.trim()).filter(Boolean)
      .map(text => ({ id: this.nextLineId++, text, at: 0, typed: false }));
  }

  // ── The conversation ────────────────────────────────────────────────

  /** A line the doctor typed instead of said — the same conversation, for when speaking is not an option. */
  addTyped(text: string): void {
    this.onHeard(text, true);
  }

  private onHeard(text: string, typed = false): void {
    const clean = text.trim();
    if (!clean || !this.isRecording()) return;
    this.linesSignal.update(lines => [...lines, { id: this.nextLineId++, text: clean, at: Date.now(), typed }]);
    this.sessions.touchSession();
    this.scheduleExtraction();

    // In the intake nothing else is listening for orders, so this is the place.
    // In the examination the voice pipeline owns "fin de la consultation".
    if (this.phase() === 'intake') {
      if (isStopPhrase(clean)) {
        void this.end({ waitForClips: false });
      } else if (isBeginExaminationPhrase(clean)) {
        void this.beginExamination();
      }
    }
  }

  // ── Reading the conversation ────────────────────────────────────────

  private scheduleExtraction(immediate = false): void {
    if (!this.consultationSignal()) return;
    this.dirty = true;
    if (this.inFlight) return; // runs again when this one finishes
    this.clearExtractTimer();
    const sinceLast = Date.now() - this.lastExtractAt;
    const interval = extractionInterval(this.transcript().length, this.failedReadings);
    const wait = immediate ? 0 : Math.max(EXTRACT_DEBOUNCE_MS, interval - sinceLast);
    this.extractTimer = setTimeout(() => void this.extractNow(), wait);
  }

  private clearExtractTimer(): void {
    if (this.extractTimer !== null) clearTimeout(this.extractTimer);
    this.extractTimer = null;
  }

  /**
   * Reads the whole conversation and folds what it finds into the side panel,
   * never over a decision the doctor made ({@link mergeDraft}).
   */
  async extractNow(): Promise<void> {
    const consultation = this.consultationSignal();
    if (!consultation || this.inFlight || !this.dirty) return;
    if (!this.transcript().trim()) {
      this.dirty = false;
      return;
    }
    this.clearExtractTimer();
    this.dirty = false;
    this.inFlight = true;
    this.extractingSignal.set(true);
    try {
      const response = await firstValueFrom(this.api.extract(consultation.id, this.transcript()));
      // A reading of only the end of a long conversation cannot drop what was
      // said at its start: it corrects and adds, nothing more.
      this.reviewSignal.update(state => mergeDraft(state, response.draft, { partial: response.truncated }));
      this.scheduleReviewSave();
      // "Failed" here is the model not answering (a rate limit, a timeout): the
      // rules' reading arrived instead, and the next try should wait longer.
      this.failedReadings = response.error === 'extraction-failed' ? this.failedReadings + 1 : 0;
      this.noteSignal.set(response.truncated ? 'truncated'
        : response.error === 'extraction-disabled' || response.error === 'extraction-failed' ? response.error : null);
    } catch (error) {
      // A rate limit is the server asking for patience; the next reading carries everything.
      this.failedReadings++;
      this.dirty = true;
      this.noteSignal.set((error as HttpErrorResponse)?.status === 429 ? null : 'offline');
    } finally {
      this.inFlight = false;
      this.extractingSignal.set(false);
      this.lastExtractAt = Date.now();
      if (this.dirty && this.isOpen()) this.scheduleExtraction();
    }
  }

  // ── Phases ──────────────────────────────────────────────────────────

  /** The doctor called the consultation: the chart commands start to work. */
  async beginExamination(): Promise<void> {
    const consultation = this.consultationSignal();
    if (!consultation || this.phase() !== 'intake' || this.busySignal()) return;
    this.busySignal.set(true);
    try {
      this.consultationSignal.set(await firstValueFrom(this.api.beginExamination(consultation.id)));
      this.voice.setConversationOnly(false);
      this.say('examination');
    } catch (error) {
      this.toast.error(this.describe(error, 'CONSULTATION.ERROR_PHASE'));
    } finally {
      this.busySignal.set(false);
    }
  }

  /**
   * Stops recording and puts everything in front of the doctor.
   *
   * By default the last sentences are waited for — what was said just before
   * "fin" is still being transcribed. A spoken stop passes
   * `waitForClips: false`: it is being handled by the very queue a wait would
   * wait on.
   */
  async end(options: { waitForClips?: boolean } = {}): Promise<void> {
    const consultation = this.consultationSignal();
    if (!consultation || !this.isRecording() || this.ending) return;
    this.ending = true;
    this.busySignal.set(true);
    this.clearExtractTimer();
    try {
      await this.sessions.end({ waitForClips: options.waitForClips, direct: true });
      this.voice.setTranscriptListener(null);
      this.voice.setConversationOnly(false);

      this.consultationSignal.set(await firstValueFrom(this.api.end(consultation.id, this.transcript())));
      // One last, complete reading of the finished conversation.
      this.dirty = true;
      await this.extractNow();
      await this.regenerateReport();
      this.say('ended');
    } catch (error) {
      this.toast.error(this.describe(error, 'CONSULTATION.ERROR_END'));
    } finally {
      this.ending = false;
      this.busySignal.set(false);
    }
  }

  /** Throws the consultation away, transcript included. */
  async abandon(): Promise<void> {
    const consultation = this.consultationSignal();
    if (!consultation) return;
    this.busySignal.set(true);
    this.cancelReviewSave();
    try {
      this.voice.stopListening();
      await firstValueFrom(this.api.abandon(consultation.id));
    } catch (error) {
      // Still unfinished on the server; it will be offered again rather than lost.
      // A 409 is a save that already wrote chart findings: only saving finishes it.
      this.toast.error((error as HttpErrorResponse)?.status === 409
        ? this.translate.instant('CONSULTATION.ERROR_DISCARD_PARTLY_SAVED')
        : this.describe(error, 'CONSULTATION.ERROR_DISCARD'));
      return;
    } finally {
      this.busySignal.set(false);
    }
    await this.sessions.abandon({ direct: true });
    this.detach();
  }

  // ── Review ──────────────────────────────────────────────────────────

  /** Applies a change to the review. Every decision the doctor makes goes through here. */
  changeReview(change: (state: ReviewState) => ReviewState): void {
    this.reviewSignal.update(change);
    this.scheduleReviewSave();
  }

  validateEverything(): void {
    this.reviewSignal.update(validateAll);
    this.scheduleReviewSave();
  }

  setAppointment(choice: AppointmentChoice | null): void {
    this.reviewSignal.update(state => ({ ...state, appointment: choice }));
    this.scheduleReviewSave();
  }

  setReport(text: string): void {
    this.reportSignal.set(text);
    this.scheduleReviewSave();
  }

  /**
   * Asks for the examination narrative again — written from the chart findings
   * the doctor has kept — and puts it in the report. Replaces what they typed.
   *
   * The report is the doctor's own text: remarks and a conclusion, with the
   * narrative of what was found on the chart as a starting point when there is
   * one. It is not a list of everything else on the panel — the allergies,
   * history, plan and appointment are saved and printed in their own sections,
   * and repeating them here printed each of them twice.
   */
  async regenerateReport(): Promise<void> {
    const sessionId = this.consultationSignal()?.voiceSessionId;
    const kept = this.chartEntries().filter(row => row.included).map(row => row.entry.auditId);
    if (!sessionId || kept.length === 0) {
      this.reportSignal.set('');
      return;
    }
    await this.sessions.generateNarrative(sessionId, kept);
    this.reportSignal.set(this.sessions.narrative() ?? '');
    this.scheduleReviewSave();
  }

  toggleChartEntry(auditId: string): void {
    this.excludedSignal.update(set => {
      const next = new Set(set);
      if (next.has(auditId)) next.delete(auditId);
      else next.add(auditId);
      return next;
    });
    this.scheduleReviewSave();
  }

  // ── Keeping the review across a reload ──────────────────────────────

  private scheduleReviewSave(): void {
    if (!this.consultationSignal() || !this.isOpen()) return;
    this.cancelReviewSave();
    this.reviewSaveTimer = setTimeout(() => this.saveReviewNow(), REVIEW_SAVE_DEBOUNCE_MS);
  }

  private cancelReviewSave(): void {
    if (this.reviewSaveTimer !== null) clearTimeout(this.reviewSaveTimer);
    this.reviewSaveTimer = null;
  }

  /** Sends a pending save now — the doctor is leaving the dossier. */
  private flushReviewSave(): void {
    if (this.reviewSaveTimer === null) return;
    this.cancelReviewSave();
    this.saveReviewNow();
  }

  private saveReviewNow(): void {
    this.reviewSaveTimer = null;
    const consultation = this.consultationSignal();
    if (!consultation || !this.isOpen()) return;
    const state = toStoredReview(this.reviewSignal(), this.reportSignal(), this.excludedSignal());
    // Best effort: a lost save costs the decisions since the last one, never
    // the consultation, and the next change sends everything again.
    this.api.saveReviewState(consultation.id, state).subscribe({ error: () => undefined });
  }

  // ── Saving ──────────────────────────────────────────────────────────

  /**
   * Saves what the doctor validated. Blocked while anything is undecided.
   * Returns true when it is saved.
   */
  async commit(): Promise<boolean> {
    const consultation = this.consultationSignal();
    const patient = this.patients.currentPatient();
    if (!consultation || !patient || !this.canSave()) return false;

    const review = this.reviewSignal();
    const body = toCommitRequest(review, this.record(), new Date(), {
      report: this.reportSignal(),
      appointment: review.appointment
        ? { dateTime: toOffsetIso(review.appointment.date, review.appointment.time) }
        : null,
    });
    body.approvedAuditIds = this.chartEntries().filter(row => row.included).map(row => row.entry.auditId);
    body.rejectedAuditIds = this.chartEntries().filter(row => !row.included).map(row => row.entry.auditId);

    this.savingSignal.set(true);
    this.failuresSignal.set([]);
    // A save erases the stored review; one landing after it would be refused.
    this.cancelReviewSave();
    try {
      const result = await firstValueFrom(this.api.commit(consultation.id, body));
      if (!result.saved) {
        this.scheduleReviewSave();
        // Nothing else was written either: the consultation is still in review.
        this.failuresSignal.set(result.failed);
        this.toast.error(this.translate.instant('CONSULTATION.ERROR_CHART_SAVE', { count: result.failed.length }));
        return false;
      }
      const chartLines = this.includedChartLines();
      this.consultationSignal.set(result.consultation);
      await this.sessions.finishExternally();
      this.voice.setTranscriptListener(null);
      this.sessions.setRouting(null);

      // Reload what the save changed, then keep the patient as saved for the printouts.
      const fresh = await firstValueFrom(this.patients.reload(patient.id)).catch(() => patient);
      this.clinical.refresh(patient.id);
      this.schedule.refreshAppointments();
      this.savedSignal.set({
        record: body,
        patient: fresh,
        chartLines,
        date: new Date(),
        appointmentText: this.appointmentText(review.appointment),
      });
      this.savedVersionSignal.update(v => v + 1);
      this.say('saved');
      this.toast.success(this.translate.instant('CONSULTATION.SAVED'));
      return true;
    } catch (error) {
      this.toast.error(this.describe(error, 'CONSULTATION.ERROR_SAVE'));
      this.scheduleReviewSave();
      return false;
    } finally {
      this.savingSignal.set(false);
    }
  }

  // ── Printing ────────────────────────────────────────────────────────

  printReport(): boolean {
    const input = this.documentInput();
    return input ? printHtml(buildReportHtml(input)) : false;
  }

  printAssistantSheet(): boolean {
    const input = this.documentInput();
    return input ? printHtml(buildAssistantSheetHtml(input)) : false;
  }

  /** What the printed documents are built from, or null when nothing has been saved. */
  documentInput(): DocumentInput | null {
    const saved = this.savedSignal();
    if (!saved) return null;
    const user = this.auth.currentUser();
    const clinic = this.cabinet.cabinetInfo();
    const labels = this.docLabels();
    const lang = this.langTag();
    const p = saved.patient;
    return {
      clinic: { name: clinic?.name ?? '', address: clinic?.address ?? null, phone: clinic?.tel ?? null },
      patient: {
        fullName: `${p.firstName} ${p.lastName}`.trim(),
        age: p.dateOfBirth ? ageFrom(p.dateOfBirth) : null,
        gender: p.gender ? labels[`GENDER_${p.gender}`] ?? p.gender : null,
        phone: p.phone ?? null,
        cin: p.cin ?? null,
        insurance: [p.insuranceProvider, p.insuranceNumber].filter(Boolean).join(' · ') || null,
      },
      record: saved.record,
      chartLines: saved.chartLines,
      doctorName: user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null : null,
      date: saved.date,
      appointmentText: saved.appointmentText,
      labels,
      dir: this.language === 'ar' ? 'rtl' : 'ltr',
      lang,
      currency: 'MAD',
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private get language(): string {
    return this.languageService.currentLang();
  }

  private langTag(): string {
    return this.language === 'ar' ? 'ar-MA' : this.language === 'en' ? 'en-GB' : 'fr-FR';
  }

  private docLabels(): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const key of DOC_LABEL_KEYS) labels[key] = this.translate.instant(`CONSULTATION.DOC.${key}`);
    return labels;
  }

  private appointmentText(choice: AppointmentChoice | null): string | null {
    if (!choice) return null;
    const when = new Date(`${choice.date}T${choice.time}:00`);
    if (Number.isNaN(when.getTime())) return null;
    try {
      return new Intl.DateTimeFormat(this.langTag(), { dateStyle: 'full', timeStyle: 'short' }).format(when);
    } catch {
      return `${choice.date} ${choice.time}`;
    }
  }

  private say(key: keyof typeof SPOKEN['fr']): void {
    const language = spokenLanguage(this.context.locale());
    this.feedback.speak(SPOKEN[language][key], synthesisLocale(language));
  }

  private describe(error: unknown, fallbackKey: string): string {
    const http = error as HttpErrorResponse | null;
    const detail = http?.error?.detail ?? http?.error?.message;
    if (typeof detail === 'string' && detail && http?.status && http.status < 500) return detail;
    return this.translate.instant(fallbackKey);
  }
}

/** `YYYY-MM-DD` and `HH:mm` in the browser's zone, as an ISO instant with its offset. */
export function toOffsetIso(date: string, time: string): string {
  const local = new Date(`${date}T${time}:00`);
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${date}T${time}:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

function ageFrom(dateOfBirth: string): number | null {
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const passed = now.getMonth() > born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() >= born.getDate());
  if (!passed) years--;
  return years;
}
