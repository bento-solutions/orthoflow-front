import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthService, SignOutReason } from '../services/auth.service';
import { ToastService } from '../services/toast.service';
import { SpeechRecognitionService } from './speech-recognition.service';
import { AudioCaptureService } from './audio-capture.service';
import { SessionBufferService } from './session-buffer.service';
import { SpeechFeedbackService } from './speech-feedback.service';
import { VoiceContextService } from './voice-context.service';
import { VoiceCommandRegistryService } from './voice-command-registry.service';
import { TranscriptionDto, VoiceApiService } from './voice-api.service';
import { VoiceSessionService } from './voice-session.service';
import { SEVERAL_TEETH_QUESTION, resolveWithGrammar } from './voice-grammar';
import { repairClinicalTerms } from './voice-fuzzy';
import {
  detectWake,
  isPausePhrase,
  isResumePhrase,
  isSelfEvidentDictation,
  isStopPhrase,
  stripWakeWord,
  FOLLOW_UP_WINDOW_MS,
} from './voice-wake';
import { acceptsFollowUp } from './voice-followup';
import { InputLanguageService } from './input-language.service';
import { classifyLanguage } from './language-filter';
import { affirmedFindings, allFindingCodes, extractFindings, findingKind, findingLabel, spokenFindingCovers } from './clinical-lexicon';
import { describeFdi, findToothMentions, resolveTooth } from './tooth-lexicon';
import { WORD_END } from './voice-regex';
import {
  PhraseKey,
  Spoken,
  SpokenLanguage,
  dictationLanguage,
  expiryWarning,
  phrase,
  speechHints,
  spokenConfirmation,
  spokenLanguage,
  spokenFindingLabel,
  spokenQuestion,
  synthesisLocale,
} from './voice-vocabulary';
import {
  CommandOutcome,
  ConfirmationStatus,
  FindingEntity,
  VoiceClarification,
  VoiceCommand,
  VoiceContextSnapshot,
  VoiceIntent,
  VoiceResolution,
  entityString,
  stagedFindingCodes,
} from './voice-intent.model';

/**
 * The pipeline, and the place every safety rule is actually enforced:
 *
 *   capture → transcribe (verbatim + normalized) → wake gate → grammar
 *           → fuzzy repair → tooth guard → (NLU fallback) → validation
 *           → risk gate → buffer or execute → visual + spoken feedback
 *           → audit → undo
 *
 * Nothing downstream of this service ever sees a transcript. It hands a
 * registered command a validated argument object and nothing else, which is
 * what keeps a misrecognition bounded.
 *
 * **Two readings per clip.** The recogniser returns what was said and the
 * same words respelled into the command vocabulary ("dent seize, carie
 * récurente" → "dent 16, carie récurrente"). The normalized reading is parsed
 * first because it is the one the grammar can match; the verbatim reading is
 * the fallback, the audit record, and the check on the normalized one — a
 * normalized tooth number the verbatim transcript contradicts becomes a
 * question, never a finding on a different tooth.
 *
 * **Wake gate.** The microphone is open for the whole examination and hears
 * the patient too. Only speech addressed to the system is a command: prefixed
 * with the wake word, inside the window one opens, or dictation that names a
 * tooth and a finding outright. See `voice-wake.ts`.
 *
 * **Order.** Clips are transcribed concurrently but handled in the order they
 * were spoken. "Calypso" and "dent 16, carie" arriving the wrong way round
 * would otherwise have the command rejected for want of a wake word said
 * before it.
 *
 * **Buffering.** A clinical write is staged as a PENDING audit row and left
 * there. Nothing reaches the clinical tables until the dentist has reviewed
 * the consultation and committed it, so "undo" during dictation is a buffer
 * edit and cannot leave a half-written record behind.
 */

export type VoiceState =
  | 'off'
  | 'idle'
  | 'listening'
  | 'processing'
  | 'awaiting-confirmation'
  | 'awaiting-clarification'
  | 'executing'
  | 'error';

export interface PendingConfirmation {
  intent: VoiceIntent;
  command: VoiceCommand;
  preview: string;
  reason: 'risk' | 'low-confidence';
  /**
   * Set for a server-executed write: the id of the PENDING audit row already
   * recorded. Confirming asks the server to execute that row; nothing has
   * been written yet.
   */
  auditId?: string;
  /** The entities as sent to the server, for the command's own feedback. */
  serverEntities?: Record<string, unknown>;
}

/** One staged clinical write, held until the dentist commits the session. */
export interface BufferedEntry {
  auditId: string;
  intent: string;
  entities: Record<string, unknown>;
  preview: string;
  transcript: string;
  corrections: { from: string; to: string }[];
  at: number;
}

export interface VoiceOutcome {
  ok: boolean;
  message: string;
  at: number;
}

/**
 * Below this, even a SAFE command is previewed rather than run. Recognition
 * confidence and resolution confidence are multiplied, so an uncertain tooth
 * inside a clearly-heard sentence still lands below the floor.
 */
const CONFIDENCE_FLOOR = 0.7;

/**
 * How long a question the system asked stays open. Left open, a free-text
 * question (a note's wording, an allergy's name) swallows whatever is said
 * next — by anyone in the room — and a pending "confirm?" turns a passing
 * "ok" into a write. After this the question is withdrawn and the dentist is
 * told so.
 */
const QUESTION_TTL_MS = 25_000;

/** How long an Undo affordance stays offered (audit XII.4 §4). */
const UNDO_WINDOW_MS = 12_000;

/** A clip whose transcription has not come back by then is given up on. */
const TRANSCRIBE_TIMEOUT_MS = 20_000;

/**
 * A failed clip is a sentence the dentist said and nobody heard, so it is told
 * to them — but not every second: at most this often.
 */
const FAILURE_ALARM_INTERVAL_MS = 8_000;

/** A suspended microphone often resumes by itself; wait this long before saying it is gone. */
const MIC_GRACE_MS = 3_000;

/** While the microphone stays down, the dentist is told again this often. */
const MIC_ALARM_INTERVAL_MS = 25_000;

/** A microphone that was taken away is asked for again this many times. */
const MIC_RECOVERY_ATTEMPTS = 3;
const MIC_RECOVERY_DELAY_MS = 2_000;

/**
 * How long ending an examination waits for sentences still being transcribed.
 * Without it the last thing said — spoken just before pressing "end" — was
 * dropped, silently, because the session had moved on by the time it returned.
 */
const FINISH_WAIT_MS = 12_000;

/** How a spoken utterance came to be treated as addressed to the system. */
export type AddressedVia = 'wake-word' | 'dictation' | 'follow-up' | 'explicit';

const AFFIRMATIVE = new RegExp(
  `^(?:yes|yeah|yep|confirm(?:ed)?|correct|ok(?:ay)?|right|do\\s+it|go\\s+ahead|save\\s+it|oui|ouais|`
  + `confirme[rz]?|d['’]?\\s?accord|exact(?:ement)?|valide[rz]?|c['’]?\\s?est\\s+(?:bon|ça|ca)|parfait|vas[- ]y|`
  + `na['’]?am|أجل|نعم)${WORD_END}`,
  'iu',
);

/**
 * "La" is Darija for no, and also the French article in "la seize" — the
 * answer to "which tooth?". It only counts as a refusal on its own.
 */
const NEGATIVE = new RegExp(
  `^(?:(?:no|nope|cancel|wrong|stop|discard|forget\\s+it|don['’]?t|non|annule[rz]?|faux|pas\\s+(?:ça|ca)|`
  + `laisse\\s+tomber)${WORD_END}|(?:la|لا)[\\s.!]*$)`,
  'iu',
);

/** What a sequence of commands from one utterance collects as it stages. */
interface StagedBatch {
  auditIds: string[];
  previews: string[];
  spoken: Spoken[];
  /** Teeth whose command could not be recorded. */
  failedTeeth: string[];
}

/** A resolution that is something to do, not a question or a miss. */
function isCommand(resolution: VoiceResolution): boolean {
  return resolution.kind === 'intent' || resolution.kind === 'sequence';
}

function distinct(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * What the dentist is told when a clip produced nothing. The server has
 * already tried every configured recogniser by the time one of these
 * arrives, so the message names the last failure in plain words.
 */
/** What came back for one clip, and how it failed when it did. */
interface ClipOutcome {
  result: TranscriptionDto | null;
  inSession: boolean;
  /** The HTTP status when the request itself failed; 0 for no connection. */
  transportStatus?: number;
}

function describeTranscriptionError(error: string): string {
  if (error === 'stt-http-429' || error === 'stt-rate-limited') {
    return 'Every speech service is at its usage limit right now — check the API plans. Repeat, or type the command.';
  }
  if (/^stt-http-5\d\d$/.test(error) || error === 'stt-timeout' || error === 'stt-unavailable') {
    return 'The speech services are overloaded right now. Repeat, or type the command.';
  }
  if (error === 'stt-http-402') {
    return 'The speech service account has run out of credit — the server configuration needs checking.';
  }
  if (/^stt-http-4(00|01|03|04|13|15)$/.test(error) || error === 'stt-unsupported-format') {
    return `The speech service refused the request (${error}) — the server configuration needs checking.`;
  }
  if (error === 'stt-non-transcript-response') return 'That clip could not be transcribed. Repeat it.';
  return `Speech recognition failed (${error}). Repeat, or type the command.`;
}

@Injectable({ providedIn: 'root' })
export class VoiceOrchestratorService {
  private speech = inject(SpeechRecognitionService);
  private capture = inject(AudioCaptureService);
  private buffer = inject(SessionBufferService);
  private feedback = inject(SpeechFeedbackService);
  private context = inject(VoiceContextService);
  private inputLanguage = inject(InputLanguageService);
  private registry = inject(VoiceCommandRegistryService);
  private api = inject(VoiceApiService);
  private toast = inject(ToastService);
  private injector = inject(Injector);

  private get sessionService(): VoiceSessionService {
    return this.injector.get(VoiceSessionService);
  }

  private stateSignal = signal<VoiceState>('idle');
  private transcriptSignal = signal('');
  private normalizedSignal = signal<string | null>(null);
  private interpretationSignal = signal<string | null>(null);
  private confirmationSignal = signal<PendingConfirmation | null>(null);
  private clarificationSignal = signal<VoiceClarification | null>(null);
  private outcomeSignal = signal<VoiceOutcome | null>(null);
  private highlightSignal = signal<string | null>(null);
  private undoSignal = signal<{ label: string; run: () => Promise<void> } | null>(null);
  private examinationModeSignal = signal(false);
  private errorSignal = signal<string | null>(null);
  private bufferedSignal = signal<BufferedEntry[]>([]);
  private lastAcceptedAtSignal = signal<number | null>(null);
  private ignoredSignal = signal<string | null>(null);
  /** How many things heard this session were dropped for being in another language than the one chosen. */
  private languageNoiseSignal = signal(0);
  private pendingClipsSignal = signal(0);
  private transcriptionIssueSignal = signal<string | null>(null);
  private speechPausedSignal = signal(false);
  /**
   * Paused by "Calypso, pause". The microphone stays open, because the only
   * way back is the dentist saying so: everything is ignored except the wake
   * word followed by a resume phrase, or ending the examination.
   */
  private voicePausedSignal = signal(false);
  private audioWarningSignal = signal<'no-voice' | null>(null);
  /**
   * The language the dentist is actually dictating in, from the recogniser.
   * Confirmations follow it rather than the interface language: a dentist
   * with the app in English who dictates in French hears French back.
   */
  private dictationLanguageSignal = signal<SpokenLanguage | null>(null);

  state = this.stateSignal.asReadonly();
  /** Verbatim transcript of the last utterance, for the "heard" line. */
  transcript = this.transcriptSignal.asReadonly();
  /** The vocabulary-normalized reading, when it differs from what was heard. */
  normalizedTranscript = this.normalizedSignal.asReadonly();
  /** Live partial text from the browser recogniser fallback. */
  interimTranscript = this.speech.interimTranscript;
  /** The resolved reading, in application terms — never an echo of the words. */
  interpretation = this.interpretationSignal.asReadonly();
  confirmation = this.confirmationSignal.asReadonly();
  clarification = this.clarificationSignal.asReadonly();
  outcome = this.outcomeSignal.asReadonly();
  /** Tooth the chart should highlight so the doctor can verify hands-free. */
  highlightedFdi = this.highlightSignal.asReadonly();
  undoAvailable = this.undoSignal.asReadonly();
  examinationMode = this.examinationModeSignal.asReadonly();
  error = this.errorSignal.asReadonly();
  /** Findings dictated but not yet committed — what review will show. */
  buffered = this.bufferedSignal.asReadonly();
  /**
   * The last utterance the wake gate declined. Shown faintly so a dentist
   * whose wake word is being misheard can see the microphone is working and
   * the system simply did not consider itself addressed.
   */
  ignoredUtterance = this.ignoredSignal.asReadonly();
  languageNoiseCount = this.languageNoiseSignal.asReadonly();
  /** Clips recorded and still being transcribed. */
  pendingTranscriptions = this.pendingClipsSignal.asReadonly();
  /** Why recent clips produced nothing, when they failed rather than were silent. */
  transcriptionIssue = this.transcriptionIssueSignal.asReadonly();

  /** When the follow-up window closes, or null while it is shut. */
  awakeUntil = computed(() => {
    const at = this.lastAcceptedAtSignal();
    return at === null ? null : at + FOLLOW_UP_WINDOW_MS;
  });

  isListening = computed(() => this.capture.isActive() || this.speech.status() === 'listening');
  /** 0–1 microphone level. */
  inputLevel = this.capture.level;
  /** True while the capture service is recording an utterance. */
  userSpeaking = this.capture.speaking;
  /** Listening is paused; the microphone stays open. */
  paused = computed(() => this.capture.paused() || this.speechPausedSignal() || this.voicePausedSignal());
  /** Paused by voice, so the screen can say how to come back. */
  pausedByVoice = this.voicePausedSignal.asReadonly();
  /** The machine cannot read French aloud, or another reason spoken confirmations cannot be trusted. */
  audioWarning = this.audioWarningSignal.asReadonly();
  /** The OS suspended audio (a call, the screen locking) — a tap brings it back. */
  microphoneSuspended = computed(() => this.capture.status() === 'suspended');
  isSupported = computed(() => this.capture.isSupported() || this.speech.isSupported());

  /** Whether this browser can record audio for server transcription at all. */
  captureSupported(): boolean {
    return this.capture.isSupported();
  }
  /** True until the clinician has opted in to the microphone being opened. */
  needsConsent = computed(() => !this.speech.consented());

  grantMicrophoneConsent(): void {
    this.speech.grantConsent();
  }

  revokeMicrophoneConsent(): void {
    this.stopListening();
    this.speech.revokeConsent();
    this.stateSignal.set('idle');
  }

  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private wired = false;

  private auth = inject(AuthService);

  constructor() {
    // The microphone dying under a dentist who cannot look at the screen is
    // the failure that costs the most words: nothing says so until review.
    effect(() => {
      const status = this.capture.status();
      const listening = this.examinationModeSignal();
      untracked(() => this.watchMicrophone(status, listening));
    });

    // The session can no longer be renewed and is about to end.
    effect(() => {
      const minutes = this.auth.expiryWarning();
      if (minutes !== null) untracked(() => this.warnOfExpiry(minutes));
    });

    // A question nobody answers is withdrawn, not left to catch the next thing said.
    effect(onCleanup => {
      const open = this.confirmationSignal() ?? this.clarificationSignal();
      if (!open) return;
      const timer = setTimeout(() => untracked(() => void this.expireQuestion()), QUESTION_TTL_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // Signing out, or the server refusing the token, mid-examination: close
    // the microphone and say why, before the router leaves the chart.
    this.auth.onSignOut(reason => this.handleSignOut(reason));
  }

  // ── Things the dentist must be told without looking ──────────────────

  /** Says something the dentist needs to know, aloud and on screen. */
  notify(key: PhraseKey): void {
    const spoken = this.say(key);
    this.announce(false, spoken.text, spoken);
  }

  /** Withdraws the open question, and whatever it was holding, and says so. */
  private async expireQuestion(): Promise<void> {
    if (this.confirmationSignal()) {
      await this.rejectPending(true);
    } else if (this.clarificationSignal()) {
      this.dismissClarification();
    } else {
      return;
    }
    this.notify('questionExpired');
  }

  private warnOfExpiry(minutes: number): void {
    if (!this.examinationModeSignal()) return;
    const spoken = expiryWarning(minutes, this.language());
    this.announce(false, spoken.text, spoken);
  }

  private handleSignOut(reason: SignOutReason): void {
    if (!this.examinationModeSignal()) return;
    this.stopListening();
    if (reason === 'expired') this.notify('sessionExpired');
  }

  private micProblem: 'lost' | 'suspended' | null = null;
  private micAlarmSpoken = false;
  private micGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private micAlarmTimer: ReturnType<typeof setInterval> | null = null;
  private micRecoveryAttempts = 0;

  /**
   * Watches the microphone for as long as an examination is being dictated.
   *
   * It stopped hearing the dentist — unplugged, taken by another app, put to
   * sleep by the OS — and until now the only sign was a banner on a screen
   * they were not looking at, while everything they said went nowhere. So it
   * is said aloud, again every few seconds while it lasts, and a lost
   * microphone is asked for again. Hearing "micro rétabli" is what tells them
   * they can carry on.
   */
  private watchMicrophone(status: string, listening: boolean): void {
    if (status === 'starting') return;

    const problem: 'lost' | 'suspended' | null =
      listening && status === 'error' ? 'lost' : listening && status === 'suspended' ? 'suspended' : null;

    if (problem === null) {
      const recovered = this.micProblem !== null && this.micAlarmSpoken && listening && status === 'capturing';
      this.clearMicAlarm();
      if (recovered) this.notify('micBack');
      return;
    }
    if (this.micProblem === problem) return;

    this.clearMicAlarm();
    this.micProblem = problem;
    this.micGraceTimer = setTimeout(() => {
      this.micGraceTimer = null;
      this.micAlarmSpoken = true;
      this.notify(problem === 'lost' ? 'micLost' : 'micSuspended');
      this.micAlarmTimer = setInterval(
        () => this.notify(problem === 'lost' ? 'micLost' : 'micSuspended'), MIC_ALARM_INTERVAL_MS);
    }, MIC_GRACE_MS);
    if (problem === 'lost') void this.recoverMicrophone();
  }

  private clearMicAlarm(): void {
    if (this.micGraceTimer !== null) clearTimeout(this.micGraceTimer);
    if (this.micAlarmTimer !== null) clearInterval(this.micAlarmTimer);
    this.micGraceTimer = null;
    this.micAlarmTimer = null;
    this.micProblem = null;
    this.micAlarmSpoken = false;
    this.micRecoveryAttempts = 0;
  }

  /** Asks for the microphone back, a few times, without anyone touching anything. */
  private async recoverMicrophone(): Promise<void> {
    while (this.micProblem === 'lost' && this.micRecoveryAttempts < MIC_RECOVERY_ATTEMPTS) {
      this.micRecoveryAttempts++;
      await new Promise(resolve => setTimeout(resolve, MIC_RECOVERY_DELAY_MS));
      if (this.micProblem !== 'lost' || !this.examinationModeSignal()) return;
      if (await this.capture.start()) {
        this.capture.setPaused(false);
        return;
      }
    }
  }

  /** Set by VoiceCommandsService so session commands can call back into it. */
  sessionHooks: {
    start: () => Promise<void>;
    end: () => Promise<void>;
    summary: () => Promise<void>;
  } | null = null;

  // ── Consultation recording ──────────────────────────────────────────
  //
  // A recorded consultation keeps the whole conversation, where dictation keeps
  // only what is addressed to the system. The listener below is told every
  // transcribed utterance *before* the wake gate decides whether it is a
  // command; `conversationOnly` is the intake phase, where nothing is.

  private transcriptListener: ((text: string) => void) | null = null;
  private conversationOnlySignal = signal(false);

  /** True while everything heard is kept as conversation and none of it is a command. */
  conversationOnly = this.conversationOnlySignal.asReadonly();

  /** Receives every transcribed utterance, spoken or recognised, in order. Null to stop. */
  setTranscriptListener(listener: ((text: string) => void) | null): void {
    this.transcriptListener = listener;
  }

  /**
   * In conversation-only mode utterances are heard, kept, and never run as
   * commands — the intake of a consultation, where the patient is talking.
   */
  setConversationOnly(on: boolean): void {
    this.conversationOnlySignal.set(on);
  }

  // ── Microphone control ──────────────────────────────────────────────

  private wire(): void {
    if (this.wired) return;
    this.speech.setResultHandler(result => {
      this.transcriptListener?.(result.transcript.trim());
      if (this.conversationOnlySignal()) return;
      void this.handleTranscript(result.transcript, result.confidence);
    });
    this.capture.setUtteranceHandler(clip => this.transcribeClip(clip));
    this.wired = true;
  }

  /**
   * Opens the microphone, paused, for a session about to start.
   *
   * **Call synchronously from the tap that starts the session**, before
   * awaiting the server — iOS only lets audio start inside the gesture, and
   * the gesture does not survive the round trip that creates the session.
   */
  openMicrophone(): Promise<boolean> {
    this.wire();
    this.errorSignal.set(null);
    if (this.needsConsent() || !this.capture.isSupported()) return Promise.resolve(false);
    return this.capture.start({ paused: true });
  }

  /**
   * Continuous dictation for the length of an examination.
   *
   * Server-side capture is the primary path: the clip goes to a recogniser
   * told it is hearing French/English dental dictation and which command
   * words to prefer. The browser's own recogniser is only used where audio
   * cannot be captured at all, or the server has transcription switched off.
   */
  async startExaminationMode(options: { announce?: boolean } = {}): Promise<void> {
    this.wire();
    this.errorSignal.set(null);
    this.ignoredSignal.set(null);
    this.languageNoiseSignal.set(0);
    this.transcriptionIssueSignal.set(null);
    this.transcriptionFailures = 0;
    if (this.needsConsent()) {
      this.reportError('Enable the microphone first.');
      return;
    }

    // Capture is tried whenever the browser has no recogniser of its own,
    // too, because it is the path that explains *why* the microphone will not
    // open (an http:// address, a blocked permission).
    if (this.capture.isSupported() || !this.speech.isSupported()) {
      if (!(await this.capture.start())) {
        this.reportError(this.capture.lastError() ?? 'Could not open the microphone.');
        return;
      }
      this.capture.setPaused(false);
    } else if (!this.speech.start(this.context.locale(), true)) {
      this.reportError(this.speech.lastError() ?? 'Could not start listening.');
      return;
    }

    this.speechPausedSignal.set(false);
    this.voicePausedSignal.set(false);
    this.checkSpokenVoice();
    this.examinationModeSignal.set(true);
    this.stateSignal.set('listening');
    // A consultation opens the microphone for a conversation with a patient in
    // the chair; "say Calypso before a command" would be addressed to no one.
    if (options.announce !== false) {
      this.announce(true, 'Session started — say "Calypso" before a command.', this.say('sessionStarted'));
    }
  }

  /**
   * A dentist who cannot look at the screen is told nothing by a
   * confirmation read in the wrong language. Said once, at the start, on
   * screen: there is no voice to say it with.
   */
  private checkSpokenVoice(): void {
    const locale = synthesisLocale(this.language());
    const missing = this.feedback.enabled() && this.feedback.voiceStatus(locale) === 'missing';
    this.audioWarningSignal.set(missing ? 'no-voice' : null);
    if (missing) {
      console.warn(`[Voice] No ${locale} voice is installed; spoken confirmations will use another language's voice.`);
    }
  }

  /** Stops acting on speech without releasing the microphone. */
  setPaused(paused: boolean): void {
    // The pause button and a spoken pause are one state: pressing it resumes both.
    if (!paused) this.voicePausedSignal.set(false);
    if (this.capture.isActive()) {
      this.capture.setPaused(paused);
    } else if (this.examinationModeSignal()) {
      if (paused) this.speech.stop();
      else this.speech.start(this.context.locale(), true);
      this.speechPausedSignal.set(paused);
    }
    if (paused) this.lastAcceptedAtSignal.set(null);
    this.settle();
  }

  /** Brings back audio the OS suspended. Must be called from a tap. */
  resumeMicrophone(): void {
    void this.capture.resume();
  }

  /**
   * Closes the microphone and waits for what was already said to be
   * transcribed and handled, so the last sentence before "end" is not lost.
   *
   * The tail of an utterance still open is flushed as the microphone closes,
   * and that clip — like any already on its way — was being dropped, because
   * by the time its transcript returned the session had left ACTIVE. This
   * keeps the examination open, and the follow-up window with it, until they
   * are through, or {@link FINISH_WAIT_MS} has passed.
   *
   * Never call this from inside a spoken command: the command is being handled
   * by the very queue this waits on.
   */
  async finishListening(timeoutMs: number = FINISH_WAIT_MS): Promise<void> {
    this.capture.stop();
    this.speech.stop();
    const settled = await this.waitForClips(timeoutMs);
    this.stopListening();
    if (!settled) this.notify('lastClipLost');
  }

  private idleWaiters: Array<() => void> = [];

  private waitForClips(timeoutMs: number): Promise<boolean> {
    if (this.pendingClipsSignal() === 0 && !this.draining) return Promise.resolve(true);
    return new Promise(resolve => {
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter(candidate => candidate !== waiter);
        resolve(false);
      }, timeoutMs);
      this.idleWaiters.push(waiter);
    });
  }

  stopListening(): void {
    this.capture.stop();
    this.speech.stop();
    this.examinationModeSignal.set(false);
    this.speechPausedSignal.set(false);
    this.voicePausedSignal.set(false);
    this.lastAcceptedAtSignal.set(null);
    this.ignoredSignal.set(null);
    if (this.stateSignal() === 'listening') this.stateSignal.set('idle');
  }

  /** One utterance through the browser recogniser, then stop (⌘⇧V). */
  listenOnce(): void {
    this.wire();
    this.errorSignal.set(null);
    if (this.needsConsent()) return;
    if (!this.speech.start(this.context.locale(), false)) {
      this.reportError(this.speech.lastError() ?? 'Could not start listening.');
      return;
    }
    this.stateSignal.set('listening');
  }

  toggleListening(): void {
    if (this.isListening()) this.stopListening();
    else this.listenOnce();
  }

  /** Discards the buffer without committing — an abandoned examination. */
  resetBuffer(): void {
    this.bufferedSignal.set([]);
  }

  /** Restores a buffer recovered from IndexedDB after a crash or reload. */
  restoreBuffer(entries: BufferedEntry[]): void {
    this.bufferedSignal.set(entries);
  }

  // ── Transcription ───────────────────────────────────────────────────

  private clipSequence = 0;
  private nextClipToHandle = 0;
  private transcribed = new Map<number, ClipOutcome>();
  private draining = false;
  private transcriptionFailures = 0;
  private lastFailureSpokenAt = 0;

  private transcribeClip(clip: Blob): void {
    const sequence = this.clipSequence++;
    // Read when the clip was recorded, not when its transcript returns: the
    // last clip of a session is flushed as the session ends.
    const inSession = this.examinationModeSignal();
    const snapshot = this.context.snapshot();
    this.pendingClipsSignal.update(count => count + 1);

    firstValueFrom(
      this.api.transcribe(clip, snapshot.locale.split('-')[0], speechHints(snapshot))
        .pipe(timeout(TRANSCRIBE_TIMEOUT_MS)),
    )
      .then(
        (result): ClipOutcome => ({ result, inSession }),
        (error: unknown): ClipOutcome => ({
          result: null,
          inSession,
          transportStatus: (error as { status?: number } | null)?.status,
        }),
      )
      .then(outcome => {
        this.transcribed.set(sequence, outcome);
        void this.drainTranscriptions();
      });
  }

  private async drainTranscriptions(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.transcribed.has(this.nextClipToHandle)) {
        const outcome = this.transcribed.get(this.nextClipToHandle)!;
        this.transcribed.delete(this.nextClipToHandle);
        this.nextClipToHandle++;
        this.pendingClipsSignal.update(count => Math.max(0, count - 1));
        await this.acceptTranscription(outcome);
      }
    } finally {
      this.draining = false;
      if (this.pendingClipsSignal() === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        waiters.forEach(waiter => waiter());
      }
    }
  }

  /**
   * A failed clip is not silent any more. It used to be a console warning,
   * which on a phone meant a microphone that looked dead: every clip failed
   * and nothing on screen said so.
   */
  private async acceptTranscription({ result, inSession, transportStatus }: ClipOutcome): Promise<void> {
    // The session ended while this clip was in flight; it must not be staged
    // into a consultation that is already in review. Not silently, though: if
    // it was dictation, the dentist is told what was not added.
    if (inSession && !this.sessionService.isActive()) {
      const text = result?.text?.trim();
      if (text && this.wasAddressed(text)) {
        this.toast.info(`Not added — the examination had already ended: “${text}”`);
      }
      return;
    }

    if (!result) {
      // A 401 is the session ending; signing out says so, and saying
      // "the speech service did not answer" on top of it would be wrong.
      if (transportStatus === 401) return;
      // The server is rationing this account's transcription, not broken: a
      // pause is the fix, and "check the connection" would send the dentist
      // the wrong way.
      if (transportStatus === 429) {
        this.noteTranscriptionFailure('Too many recordings in a short time — wait a moment, then speak again.', 'sttBusy');
        return;
      }
      if (transportStatus === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        this.noteTranscriptionFailure('No connection — the last thing said was not heard. Repeat it once the connection is back.', 'sttOffline');
      } else {
        this.noteTranscriptionFailure('The speech service did not answer — check the connection. Repeat, or type the command.');
      }
      return;
    }
    if (result.error) {
      if (result.error === 'stt-disabled' || result.error === 'stt-not-configured') {
        this.fallBackToBrowserRecognition();
        return;
      }
      this.noteTranscriptionFailure(describeTranscriptionError(result.error));
      return;
    }

    this.transcriptionFailures = 0;
    this.transcriptionIssueSignal.set(null);
    if (!result.text.trim()) return;
    const detected = dictationLanguage(result.language);
    if (detected) this.dictationLanguageSignal.set(detected);
    // Kept before the wake gate: a recorded consultation wants the whole
    // conversation, not only the part addressed to the system.
    this.transcriptListener?.(result.text.trim());
    if (this.conversationOnlySignal()) return;
    await this.handleTranscript(result.text, 1, result.normalized ?? null, inSession);
  }

  /** Whether words were plainly meant as a command: the wake word, or dictation naming a tooth and a finding. */
  private wasAddressed(text: string): boolean {
    return detectWake(text, null).reason === 'wake-word' || isSelfEvidentDictation(text, this.context.dentition());
  }

  /**
   * A clip that produced nothing is a sentence the dentist said and nobody
   * heard. It used to be spoken once, on the second failure, and never again —
   * while the service stayed down and every later sentence was lost the same
   * way. Now each is told to them, at most every few seconds.
   */
  private noteTranscriptionFailure(message: string, phraseKey: PhraseKey = 'sttDown'): void {
    this.transcriptionFailures++;
    this.transcriptionIssueSignal.set(message);
    console.warn(`Voice: ${message}`);
    const now = Date.now();
    if (now - this.lastFailureSpokenAt >= FAILURE_ALARM_INTERVAL_MS) {
      this.lastFailureSpokenAt = now;
      this.feedback.speak(this.say(phraseKey).text, this.say(phraseKey).locale);
    }
  }

  private fallBackToBrowserRecognition(): void {
    if (!this.examinationModeSignal()) return;
    this.capture.stop();
    if (this.speech.isSupported() && this.speech.start(this.context.locale(), true)) {
      this.transcriptionIssueSignal.set(
        'Server transcription is switched off — using the browser\'s own recogniser, which is less accurate on dental terms.');
      this.notify('sttFallback');
      return;
    }
    this.reportError('Server transcription is switched off and this browser has no recogniser of its own. Type commands instead.');
  }

  // ── The pipeline ────────────────────────────────────────────────────

  /**
   * Entry point for an utterance, whether spoken or typed. Typed input goes
   * through exactly the same path — which is what makes the whole system
   * testable without a microphone, and usable when recognition is unavailable.
   *
   * @param normalized the recogniser's vocabulary-normalized reading, if any
   * @param gated whether the wake gate applies; true for everything heard
   *   during a session, false for typed commands and one-shot listening
   */
  async handleTranscript(
    transcript: string,
    recognitionConfidence = 1,
    normalized: string | null = null,
    gated = this.examinationModeSignal(),
  ): Promise<void> {
    const heard = transcript.trim();
    const cleaned = normalized?.trim() || null;
    const said = heard || cleaned;
    if (!said) return;
    const readings = distinct([cleaned, said]);

    // Speech in a language other than the one chosen for dictation is noise: a
    // patient answering in Arabic, a conversation in the corridor. Typed
    // commands (not heard, not gated) are the user's own words and pass.
    const heardAloud = gated || recognitionConfidence !== 1;
    if (heardAloud && readings.every(reading => classifyLanguage(reading, this.inputLanguage.language()) === 'noise')) {
      this.languageNoiseSignal.update(count => count + 1);
      this.ignoredSignal.set(said);
      this.settle();
      return;
    }

    this.transcriptSignal.set(said);
    this.normalizedSignal.set(cleaned && cleaned !== said ? cleaned : null);
    this.errorSignal.set(null);

    // A pending question owns the next utterance. Answering it must not be
    // reinterpreted as a fresh command.
    if (this.confirmationSignal()) {
      await this.answerConfirmation(said, readings, gated);
      return;
    }
    if (this.clarificationSignal()) {
      await this.answerClarification(said, recognitionConfidence, cleaned, gated);
      return;
    }

    // Ending the session is honoured without the wake word. A dentist whose
    // wake word is being misheard must still be able to stop by voice.
    if (gated && readings.some(reading => isStopPhrase(reading))) {
      this.lastAcceptedAtSignal.set(null);
      await this.sessionHooks?.end();
      return;
    }

    if (gated) {
      const addressed = this.addressedCommand(readings);

      // Paused by voice: the only thing heard is the way back.
      if (this.voicePausedSignal()) {
        if (addressed?.via === 'wake-word' && addressed.primary && isResumePhrase(addressed.primary)) {
          this.resumeByVoice();
        } else {
          this.ignoredSignal.set(said);
          this.settle();
        }
        return;
      }

      if (!addressed) {
        this.ignoredSignal.set(said);
        this.settle();
        return;
      }
      this.ignoredSignal.set(null);
      if (addressed.via === 'wake-word' && addressed.primary && isPausePhrase(addressed.primary)) {
        this.pauseByVoice();
        return;
      }
      // A bare wake word opens the floor and waits. It is also the answer to
      // "say Calypso to carry on", so it keeps the examination open.
      if (!addressed.primary) {
        this.touchWakeWindow();
        this.sessionService.touchSession();
        this.settle();
        return;
      }
      await this.resolveAndApply(addressed.primary, addressed.alternate, recognitionConfidence, said, addressed.via);
      return;
    }

    await this.resolveAndApply(readings[0], readings[1] ?? null, recognitionConfidence, said);
  }

  private pauseByVoice(): void {
    this.voicePausedSignal.set(true);
    this.lastAcceptedAtSignal.set(null);
    // A pause is something the dentist did: the examination is not idle.
    this.sessionService.touchSession();
    this.settle();
    const spoken = this.say('pausedByVoice');
    this.announce(true, spoken.text, spoken);
  }

  private resumeByVoice(): void {
    this.voicePausedSignal.set(false);
    this.ignoredSignal.set(null);
    this.touchWakeWindow();
    this.sessionService.touchSession();
    this.settle();
    const spoken = this.say('resumedByVoice');
    this.announce(true, spoken.text, spoken);
  }

  /**
   * The command in an utterance addressed to the system, in both readings,
   * or null when the utterance was not addressed to it — and how it came to
   * be: the wake word, dictation that names a tooth and a finding outright, or
   * only the follow-up window.
   *
   * The follow-up window is the weakest of the three. It exists so a run of
   * findings needs the wake word once, but it also stays open while the
   * patient answers and the dentist talks, so speech that reaches the system
   * only by that route has to look like a command ({@link acceptsFollowUp}).
   */
  private addressedCommand(
    readings: string[],
  ): { primary: string; alternate: string | null; via: AddressedVia } | null {
    const now = Date.now();
    const wakes = readings.map(reading => detectWake(reading, this.lastAcceptedAtSignal(), now));

    // Either reading being a bare wake word makes the utterance one: the
    // other reading is the recogniser's guess at the same single word.
    if (wakes.some(wake => wake.reason === 'wake-word' && !wake.command)) {
      return { primary: '', alternate: null, via: 'wake-word' };
    }

    const dentition = this.context.dentition();
    const spokenWake = wakes.some(wake => wake.reason === 'wake-word');
    const dictation = readings.some(reading => isSelfEvidentDictation(reading, dentition));
    if (!(wakes.some(wake => wake.addressed) || dictation)) return null;

    const commands = distinct(readings.map((reading, index) =>
      wakes[index].reason === 'wake-word' ? wakes[index].command : (stripWakeWord(reading) ?? reading)));
    const via: AddressedVia = spokenWake ? 'wake-word' : dictation ? 'dictation' : 'follow-up';

    if (via === 'follow-up') {
      const snapshot = this.context.snapshot();
      if (!commands.some(command => acceptsFollowUp(command, snapshot))) return null;
    }
    return { primary: commands[0] ?? '', alternate: commands[1] ?? null, via };
  }

  /**
   * Grammar, then fuzzy repair, then the LLM — in that order, because each is
   * an order of magnitude more expensive than the last and catches what the
   * previous one could not. Each stage tries the normalized reading first.
   */
  private async resolveAndApply(
    primary: string,
    alternate: string | null,
    recognitionConfidence: number,
    heard: string,
    via: AddressedVia = 'explicit',
  ): Promise<void> {
    this.stateSignal.set('processing');
    this.context.rememberUtterance(heard);
    this.sessionService.touchSession();

    const snapshot = this.context.snapshot();
    const readings = distinct([primary, alternate]);
    let resolution: VoiceResolution = { kind: 'unrecognized', transcript: primary };
    let corrections: { from: string; to: string }[] = [];
    let resolvedFrom = primary;

    for (const reading of readings) {
      const attempt = resolveWithGrammar(reading, snapshot);
      if (attempt.kind === 'intent' || attempt.kind === 'sequence') {
        resolution = attempt;
        resolvedFrom = reading;
        break;
      }
      if (attempt.kind === 'clarification' && resolution.kind === 'unrecognized') {
        resolution = attempt;
        resolvedFrom = reading;
      }
    }

    // A near miss — "recurrence caries" for "recurrent caries" — is repaired
    // against the lexicon's own vocabulary and retried. Numbers are never
    // repaired: a fuzzy tooth number is the one error that survives review
    // looking correct. Only an outright intent is accepted from the retry.
    if (resolution.kind !== 'intent' && resolution.kind !== 'sequence') {
      for (const reading of readings) {
        const repair = repairClinicalTerms(reading, candidate => isCommand(resolveWithGrammar(candidate, snapshot)));
        if (repair.corrections.length === 0) continue;
        const retried = resolveWithGrammar(repair.text, snapshot);
        if (retried.kind === 'intent' || retried.kind === 'sequence') {
          resolution = retried;
          corrections = repair.corrections;
          resolvedFrom = reading;
          break;
        }
      }
    }

    if (resolvedFrom !== heard) {
      if (resolution.kind === 'intent') resolution = this.guardTooth(resolution, heard, snapshot);
      else if (resolution.kind === 'sequence') resolution = this.guardTeeth(resolution, heard);
    }

    // Only what neither could parse is worth the round trip.
    if (resolution.kind === 'unrecognized') {
      resolution = await this.consultNlu(primary, snapshot);
    }

    // What the dentist said is what the audit trail and the review page keep.
    if (resolution.kind === 'intent') resolution.intent.transcript = heard;
    if (resolution.kind === 'sequence') resolution.intents.forEach(intent => { intent.transcript = heard; });
    if (resolution.kind === 'clarification') resolution.clarification.transcript = heard;

    this.pendingCorrections = corrections;
    await this.applyResolution(resolution, snapshot, recognitionConfidence, via);
    this.pendingCorrections = [];
  }

  /**
   * The normalized reading may respell words; it may not move a finding.
   * When the verbatim transcript names a tooth, the resolved command has to
   * be about the same tooth, or the dentist is asked which one they meant.
   */
  private guardTooth(
    resolution: Extract<VoiceResolution, { kind: 'intent' }>,
    heard: string,
    snapshot: VoiceContextSnapshot,
  ): VoiceResolution {
    const fdi = entityString(resolution.intent.entities, 'fdi');
    if (!fdi) return resolution;
    const spoken = resolveTooth(stripWakeWord(heard) ?? heard, snapshot.dentition);
    if (spoken.kind !== 'resolved' || spoken.fdi === fdi) return resolution;

    return {
      kind: 'clarification',
      clarification: {
        question: `Tooth ${spoken.fdi} or tooth ${fdi}?`,
        options: [spoken.fdi, fdi].map(code => ({ value: code, label: `${code} — ${describeFdi(code)}` })),
        transcript: heard,
        pendingIntent: resolution.intent.intent,
        pendingEntities: resolution.intent.entities,
        awaiting: 'fdi',
      },
    };
  }

  /**
   * The same check for an utterance that named several teeth: every tooth the
   * normalized reading acted on has to be one the verbatim transcript also
   * names. Otherwise it is asked, one tooth at a time, rather than staged.
   */
  private guardTeeth(
    resolution: Extract<VoiceResolution, { kind: 'sequence' }>,
    heard: string,
  ): VoiceResolution {
    const spoken = new Set(findToothMentions(heard).map(mention => mention.fdi));
    if (spoken.size === 0) return resolution;

    const unsupported = resolution.intents.some(intent => {
      const fdi = entityString(intent.entities, 'fdi');
      return !!fdi && !spoken.has(fdi);
    });
    if (!unsupported) return resolution;
    return {
      kind: 'clarification',
      clarification: { question: SEVERAL_TEETH_QUESTION, options: [], transcript: heard },
    };
  }

  /** Terms repaired for the utterance currently being dispatched. */
  private pendingCorrections: { from: string; to: string }[] = [];

  /**
   * Extends the window in which a bare utterance is still a command. Called
   * on every accepted command, so a run of findings needs the wake word only
   * once.
   */
  private touchWakeWindow(): void {
    this.lastAcceptedAtSignal.set(Date.now());
  }

  /** Back to listening during a session, idle otherwise. */
  private settle(): void {
    if (this.stateSignal() === 'error') return;
    this.stateSignal.set(this.examinationModeSignal() && !this.paused() ? 'listening' : 'idle');
  }

  private async consultNlu(text: string, snapshot: VoiceContextSnapshot): Promise<VoiceResolution> {
    try {
      const response = await firstValueFrom(this.api.interpret({
        transcript: text,
        locale: snapshot.locale,
        module: snapshot.module,
        selectedFdi: snapshot.selectedFdi,
        patientContext: !!snapshot.patientId,
        chartType: snapshot.dentition,
        recentUtterances: snapshot.recentUtterances,
        availableIntents: this.registry.describeFor(snapshot),
        findingCodes: allFindingCodes(),
        sessionId: snapshot.sessionId,
      }));

      if (response.intent) {
        return {
          kind: 'intent',
          intent: {
            intent: response.intent,
            entities: response.entities ?? {},
            confidence: response.confidence,
            resolver: 'llm',
            transcript: text,
          },
        };
      }
      if (response.clarification) {
        return { kind: 'clarification', clarification: { question: response.clarification, options: [], transcript: text } };
      }
      return { kind: 'unrecognized', transcript: text };
    } catch {
      return { kind: 'unrecognized', transcript: text };
    }
  }

  private async applyResolution(
    resolution: VoiceResolution,
    snapshot: VoiceContextSnapshot,
    recognitionConfidence: number,
    via: AddressedVia = 'explicit',
  ): Promise<void> {
    if (resolution.kind === 'clarification') {
      this.askClarification(resolution.clarification, snapshot);
      return;
    }
    if (resolution.kind === 'unrecognized') {
      this.interpretationSignal.set(null);
      this.settle();
      // "Pas compris." is an answer to someone who asked. After the wake word,
      // or a typed command, it is one; for dictation that merely looked like a
      // command it is noise — and the app's own voice deafens the microphone
      // to whatever the dentist says next.
      const asked = via === 'wake-word' || via === 'explicit';
      this.announce(false, `No command recognised in “${resolution.transcript}”.`,
        asked ? this.say('notUnderstood') : { text: '', locale: '' });
      await this.audit(
        { intent: 'unknown', entities: {}, confidence: 0, resolver: 'grammar', transcript: resolution.transcript },
        snapshot, 'SAFE', 'PENDING', 'CLARIFICATION', { errorMessage: 'No matching command' },
      );
      return;
    }
    if (resolution.kind === 'sequence') {
      await this.applySequence(resolution.intents, snapshot, recognitionConfidence);
      return;
    }
    await this.dispatch(resolution.intent, snapshot, recognitionConfidence);
  }

  /**
   * Several commands from one utterance, staged in order and answered once.
   *
   * Read back together because a spoken confirmation interrupts the one
   * before it: said one after another, only the last tooth would ever be
   * heard. Undone together for the same reason it was said together.
   */
  private async applySequence(
    intents: VoiceIntent[],
    snapshot: VoiceContextSnapshot,
    recognitionConfidence: number,
  ): Promise<void> {
    const batch: StagedBatch = { auditIds: [], previews: [], spoken: [], failedTeeth: [] };
    for (const intent of intents) {
      await this.dispatch(intent, snapshot, recognitionConfidence, batch);
    }
    // Nothing staged: dispatch has already said why.
    if (batch.auditIds.length === 0) return;

    const language = this.language();
    const fr = language === 'fr';
    const heard = batch.spoken.map(part => part.text);
    if (batch.failedTeeth.length > 0) {
      const teeth = batch.failedTeeth.join(fr ? ' et ' : ' and ');
      heard.push(fr ? `Dent ${teeth} non enregistrée. Répétez.` : `Tooth ${teeth} was not recorded. Say it again.`);
    }
    const ids = [...batch.auditIds];
    this.offerUndo(`Undo: ${batch.previews.join(' · ')}`, async () => {
      for (const id of ids) await this.discardBuffered(id);
    }, ids[ids.length - 1]);

    this.settle();
    this.announce(batch.failedTeeth.length === 0, batch.previews.join(' · '),
      this.withCorrections({ text: heard.join(' '), locale: batch.spoken[0].locale }, language));
  }

  private askClarification(clarification: VoiceClarification, snapshot: VoiceContextSnapshot): void {
    this.clarificationSignal.set(clarification);
    this.interpretationSignal.set(null);
    this.stateSignal.set('awaiting-clarification');
    // A question opens the floor: the answer needs no wake word.
    this.touchWakeWindow();
    this.announce(false, clarification.question,
      spokenQuestion(clarification.question, this.language()));
    void this.audit(
      {
        intent: clarification.pendingIntent ?? 'clarification',
        entities: clarification.pendingEntities ?? {},
        confidence: 0,
        resolver: 'grammar',
        transcript: clarification.transcript,
      },
      snapshot, 'SAFE', 'PENDING', 'CLARIFICATION', { errorMessage: clarification.question },
    );
  }

  /** Validates, gates by risk and confidence, then previews or runs. */
  private async dispatch(
    intent: VoiceIntent,
    snapshot: VoiceContextSnapshot,
    recognitionConfidence: number,
    batch?: StagedBatch,
    humanConfirmed = false,
  ): Promise<void> {
    const command = this.registry.get(intent.intent);

    if (!command) {
      this.settle();
      this.announce(false, 'That can\'t be done by voice from here.', this.say('notByVoiceHere'));
      await this.audit(intent, snapshot, 'SAFE', 'REJECTED', 'REJECTED',
        { errorMessage: `Unknown or out-of-scope command: ${intent.intent}` });
      return;
    }

    // Never by voice. The assistant acknowledges and points at the screen
    // rather than pretending it did not hear (audit XII.4 §3).
    if (command.risk === 'BLOCKED') {
      this.settle();
      const message = `That one needs to be done on screen — ${command.description.toLowerCase()} `
        + 'is deliberately not available by voice.';
      this.announce(false, message, this.say('onScreenOnly'));
      await this.audit(intent, snapshot, 'BLOCKED', 'REJECTED', 'REJECTED', { errorMessage: 'Blocked risk tier' });
      return;
    }

    if (command.requiresPatient && !snapshot.patientId) {
      this.settle();
      this.announce(false, 'Open a patient\'s dossier first, then say that again.', this.say('openPatientFirst'));
      await this.audit(intent, snapshot, command.risk, 'REJECTED', 'REJECTED',
        { errorMessage: 'No patient in context' });
      return;
    }

    // "Enlève la carie sur la seize" during a session nearly always means the
    // caries dictated a moment ago, not one already on the record.
    if (command.id === 'chart.removeFinding' && await this.removeFromBuffer(intent)) {
      return;
    }

    // "Pas une carie, c'est une inflammation" and "oublie la 16, c'est la 17"
    // correct what was just dictated. Against a staged entry they become the
    // same replacement "non, en fait…" makes; against the record, a reclassify
    // is staged as it is and the server swaps the findings on the tooth.
    if (command.id === 'chart.reclassifyFinding' || command.id === 'chart.moveFindings') {
      const rewritten = this.rewriteCorrection(intent, snapshot);
      if (!rewritten) {
        this.settle();
        this.announce(false, 'There is no entry to correct.', this.say('nothingToCorrect'));
        return;
      }
      if (rewritten !== intent) {
        await this.dispatch(rewritten, snapshot, recognitionConfidence, batch, humanConfirmed);
        return;
      }
    }

    // "Non, en fait…" corrects the entry just staged. In the buffered flow
    // nothing is on the record yet, so the correction replaces that entry; it
    // cannot retract anything. Found before anything is staged, so a
    // correction with nothing to correct changes nothing.
    let replaced: BufferedEntry | null = null;
    if (command.id === 'chart.replaceLastFinding') {
      replaced = this.stagedToReplace(snapshot, intent);
      if (!replaced) {
        this.settle();
        this.announce(false, 'There is no entry to correct.', this.say('nothingToCorrect'));
        return;
      }
    }

    // Said aloud and answered "yes" a moment ago: already remembered once.
    if (!humanConfirmed) this.context.rememberIntent(intent);

    let preview: string;
    try {
      preview = command.preview(intent.entities, snapshot);
    } catch {
      preview = command.description;
    }
    this.interpretationSignal.set(preview);

    // Highlight before the write, not after — the doctor's confirmation is
    // only meaningful if they can see which tooth it applies to first.
    const fdi = entityString(intent.entities, 'fdi');
    if (fdi) this.highlightSignal.set(fdi);

    const combinedConfidence = intent.confidence * recognitionConfidence;

    // A clinical write is staged on the server as a PENDING audit row and
    // left there until the dentist reviews and commits the consultation.
    if (command.risk === 'CONFIRM' && command.serverIntent) {
      const serverEntities = command.toServerEntities
        ? command.toServerEntities(intent.entities, snapshot)
        : intent.entities;

      // A reading the system is unsure of — a model's guess, a shaky
      // recognition — is read back and waits for a yes before it is staged.
      // The read-back alone is not enough: staging is what puts it on the
      // review list and in the summary.
      if (!batch && !humanConfirmed && combinedConfidence < CONFIDENCE_FLOOR) {
        this.confirmationSignal.set({ intent, command, preview, reason: 'low-confidence', serverEntities });
        this.stateSignal.set('awaiting-confirmation');
        this.touchWakeWindow();
        const language = this.language();
        const readback = spokenConfirmation(command.serverIntent, serverEntities, language)
          ?? { text: preview, locale: 'en-US' };
        const unsure = this.say('confirmUnsure');
        this.announce(false, `${preview}. Confirm?`, { text: `${readback.text} ${unsure.text}`, locale: unsure.locale });
        return;
      }

      const auditId = await this.audit(
        { ...intent, intent: command.serverIntent, entities: serverEntities },
        snapshot, 'CONFIRM', 'PENDING', 'CLARIFICATION',
      );

      if (!auditId) {
        // Without a staged row there is nothing the commit could execute, and
        // buffering it client-side only would lose it on a crash.
        if (batch) {
          batch.failedTeeth.push(fdi ?? '?');
          return;
        }
        this.settle();
        this.announce(false, 'That couldn\'t be recorded safely, so nothing was staged. Say it again.', this.say('notStaged'));
        return;
      }

      const entry: BufferedEntry = {
        auditId,
        intent: command.serverIntent,
        entities: serverEntities,
        preview,
        transcript: intent.transcript,
        corrections: this.pendingCorrections,
        at: Date.now(),
      };
      this.stage(entry, snapshot.sessionId);
      // The correction is in place; only now is the entry it replaces taken
      // out, so a failure above leaves the original standing.
      if (replaced) await this.discardBuffered(replaced.auditId);

      this.context.rememberWrite({
        commandId: command.id,
        targetType: 'BufferedCommand',
        targetId: auditId,
        fdi: fdi ?? undefined,
        description: preview,
        auditId,
      });

      // Spoken because the dentist is not looking at the screen. The resolved
      // values, never an echo of the words.
      const language = this.language();
      let spoken = spokenConfirmation(command.serverIntent, serverEntities, language)
        ?? { text: preview, locale: 'en-US' };
      if (replaced) spoken = { ...spoken, text: `${this.say('corrected').text} ${spoken.text}` };

      if (batch) {
        batch.auditIds.push(auditId);
        batch.previews.push(preview);
        batch.spoken.push(spoken);
        this.touchWakeWindow();
        return;
      }

      this.offerUndo(`Undo: ${preview}`, () => this.discardBuffered(auditId), auditId);
      this.touchWakeWindow();
      this.settle();
      this.announce(true, preview, this.withCorrections(spoken, language));
      return;
    }

    // SAFE commands run locally; a shaky recognition still gets a look first.
    if (combinedConfidence < CONFIDENCE_FLOOR) {
      this.confirmationSignal.set({ intent, command, preview, reason: 'low-confidence' });
      this.stateSignal.set('awaiting-confirmation');
      this.touchWakeWindow();
      this.announce(false, `${preview}. Confirm?`,
        this.language() === 'fr' ? this.say('confirmUnsure') : { text: `${preview}. Confirm?`, locale: 'en-US' });
      return;
    }

    await this.run(command, intent, snapshot, 'AUTO');
  }

  /**
   * The staged entry "no, actually…" refers to: the last thing staged, if it
   * is still in the buffer and is a set of findings. Null when there is
   * nothing to correct — it was undone, or the last thing said was a note.
   */
  private stagedToReplace(snapshot: VoiceContextSnapshot, intent?: VoiceIntent): BufferedEntry | null {
    // A correction that already found its entry ("not caries, it's…") names it.
    const named = intent ? entityString(intent.entities, 'replaceAuditId') : null;
    if (named) {
      const entry = this.bufferedSignal().find(candidate => candidate.auditId === named);
      return entry && entry.intent === 'clinical.addFindings' ? entry : null;
    }
    const last = snapshot.lastWrite;
    if (!last || last.targetType !== 'BufferedCommand') return null;
    const entry = this.bufferedSignal().find(candidate => candidate.auditId === last.targetId);
    return entry && entry.intent === 'clinical.addFindings' ? entry : null;
  }

  /**
   * Turns "not X, it's Y" and "forget tooth A, this is B" into a replacement
   * of the staged entry they are about, keeping whatever else that entry says:
   * a correction changes one thing, not the whole dictation.
   *
   * Returns the same intent when it must be staged as it is (a reclassify of a
   * finding already on the record — the server resolves it by code), and null
   * when there is nothing to correct.
   */
  private rewriteCorrection(intent: VoiceIntent, snapshot: VoiceContextSnapshot): VoiceIntent | null {
    const staged = this.bufferedSignal().filter(entry => entry.intent === 'clinical.addFindings');
    const stagedFindings = (entry: BufferedEntry) =>
      (Array.isArray(entry.entities['findings']) ? entry.entities['findings'] as Array<Record<string, unknown>> : []);
    const asEntity = (f: Record<string, unknown>): FindingEntity => ({
      code: String(f['code']),
      label: findingLabel(String(f['code'])),
      kind: findingKind(String(f['code'])) ?? 'CONDITION',
      surface: (f['surface'] as string | null | undefined) ?? null,
      severity: (f['severity'] as FindingEntity['severity'] | undefined) ?? null,
      ...(f['note'] ? { note: String(f['note']) } : {}),
    });
    const replacing = (entry: BufferedEntry, fdi: string, findings: FindingEntity[]): VoiceIntent => ({
      ...intent,
      intent: 'chart.replaceLastFinding',
      entities: { fdi, findings, replaceAuditId: entry.auditId },
    });

    if (intent.intent === 'chart.reclassifyFinding') {
      const fdi = entityString(intent.entities, 'fdi');
      const wrong = stagedFindingCodes({ findings: intent.entities['from'] });
      const right = Array.isArray(intent.entities['findings']) ? intent.entities['findings'] as FindingEntity[] : [];
      if (!fdi || wrong.length === 0 || right.length === 0) return null;
      const covers = (code: string) => wrong.some(spoken => spokenFindingCovers(spoken, code));
      const entry = [...staged].reverse().find(candidate =>
        entityString(candidate.entities, 'fdi') === fdi
        && stagedFindings(candidate).some(f => covers(String(f['code']))));
      // Not dictated in this session: it is on the record, and the server
      // swaps it there when the session is committed.
      if (!entry) return intent;
      const kept = stagedFindings(entry).filter(f => !covers(String(f['code']))).map(asEntity);
      return replacing(entry, fdi, [...kept, ...right]);
    }

    // chart.moveFindings: the entry on the wrong tooth, the last one said first.
    const from = entityString(intent.entities, 'fromFdi');
    const to = entityString(intent.entities, 'fdi');
    if (!from || !to) return null;
    const lastId = snapshot.lastWrite?.targetType === 'BufferedCommand' ? snapshot.lastWrite.targetId : null;
    const onWrongTooth = staged.filter(entry => entityString(entry.entities, 'fdi') === from);
    const entry = onWrongTooth.find(candidate => candidate.auditId === lastId) ?? onWrongTooth[onWrongTooth.length - 1];
    if (!entry) return null;
    const redone = Array.isArray(intent.entities['findings']) ? intent.entities['findings'] as FindingEntity[] : [];
    return replacing(entry, to, redone.length ? redone : stagedFindings(entry).map(asEntity));
  }

  private stage(entry: BufferedEntry, sessionId: string | null): void {
    this.bufferedSignal.update(entries => [...entries, entry]);
    if (sessionId) {
      void this.buffer.append(sessionId, { ...entry });
    }
  }

  private async run(
    command: VoiceCommand,
    intent: VoiceIntent,
    snapshot: VoiceContextSnapshot,
    confirmation: ConfirmationStatus,
  ): Promise<void> {
    this.stateSignal.set('executing');
    if (!command.execute) {
      this.settle();
      this.announce(false, 'That command can\'t run from here.', this.say('cannotRunHere'));
      return;
    }
    try {
      const result = await command.execute(intent.entities, snapshot);

      this.outcomeSignal.set({ ok: result.ok, message: result.message, at: Date.now() });
      this.interpretationSignal.set(result.message);
      if (result.highlightFdi) this.highlightSignal.set(result.highlightFdi);

      const auditEntry = await this.audit(
        intent, snapshot, command.risk, confirmation, result.ok ? 'EXECUTED' : 'FAILED',
        {
          targetType: result.targetType,
          targetId: result.targetId,
          previousValue: result.previousValue,
          newValue: result.newValue,
          errorMessage: result.ok ? undefined : result.message,
        },
      );

      if (result.ok) {
        this.touchWakeWindow();
        this.context.rememberWrite({
          commandId: command.id,
          targetType: result.targetType ?? 'unknown',
          targetId: result.targetId ?? '',
          fdi: result.highlightFdi,
          description: result.message,
          auditId: auditEntry ?? undefined,
          undo: result.undo,
        });
        if (result.undo) this.offerUndo(result.message, result.undo, auditEntry);
      }

      this.settle();
      this.announce(result.ok, result.message, this.spokenResult(result));
    } catch (error) {
      const message = this.describeFailure(error);
      this.outcomeSignal.set({ ok: false, message, at: Date.now() });
      this.settle();
      this.announce(false, message, this.spokenFailure(error));
      await this.audit(intent, snapshot, command.risk, confirmation, 'FAILED', { errorMessage: message });
    }
  }

  // ── Answering the assistant ─────────────────────────────────────────

  async confirmPending(): Promise<void> {
    const pending = this.confirmationSignal();
    if (!pending) return;
    this.confirmationSignal.set(null);

    if (pending.auditId) {
      await this.runServerConfirmed(pending);
      return;
    }
    if (pending.command.risk === 'CONFIRM' && pending.command.serverIntent) {
      // A write held for a yes because it was uncertain: it is staged now, like
      // any other, with the dentist's answer standing in for the confidence.
      await this.dispatch(pending.intent, this.context.snapshot(), 1, undefined, true);
      return;
    }
    await this.run(pending.command, pending.intent, this.context.snapshot(), 'CONFIRMED');
  }

  /**
   * Asks the server to execute the row it staged. No payload is sent — the
   * server replays exactly what it recorded and the doctor was shown.
   */
  private async runServerConfirmed(pending: PendingConfirmation): Promise<void> {
    this.stateSignal.set('executing');
    const snapshot = this.context.snapshot();
    try {
      const audit = await firstValueFrom(this.api.confirmCommand(pending.auditId!));

      if (audit.outcome !== 'EXECUTED') {
        const message = audit.errorMessage || 'That didn\'t save. Nothing was recorded.';
        this.outcomeSignal.set({ ok: false, message, at: Date.now() });
        this.settle();
        this.announce(false, message, this.say('saveFailed'));
        return;
      }

      const result = pending.command.onServerExecuted
        ? pending.command.onServerExecuted(audit, pending.intent.entities, snapshot)
        : { ok: true, message: pending.preview };

      this.outcomeSignal.set({ ok: true, message: result.message, at: Date.now() });
      this.interpretationSignal.set(result.message);
      if (result.highlightFdi) this.highlightSignal.set(result.highlightFdi);

      this.context.rememberWrite({
        commandId: pending.command.id,
        targetType: audit.targetType ?? result.targetType ?? 'unknown',
        targetId: audit.targetId ?? result.targetId ?? '',
        fdi: result.highlightFdi,
        description: result.message,
        auditId: pending.auditId,
        undo: result.undo,
      });
      if (result.undo) this.offerUndo(result.message, result.undo, pending.auditId!);

      this.settle();
      this.announce(true, result.message, this.spokenResult(result));
    } catch (error) {
      const message = this.describeFailure(error);
      this.outcomeSignal.set({ ok: false, message, at: Date.now() });
      this.settle();
      this.announce(false, message, this.spokenFailure(error));
    }
  }

  /** @param silent withdrawn because it went unanswered, which says so itself */
  async rejectPending(silent = false): Promise<void> {
    const pending = this.confirmationSignal();
    if (!pending) return;
    this.confirmationSignal.set(null);
    this.interpretationSignal.set(null);
    this.highlightSignal.set(null);
    this.settle();
    if (!silent) this.announce(false, 'Discarded. Nothing was recorded.', this.say('discarded'));

    if (pending.auditId) {
      try {
        await firstValueFrom(this.api.rejectCommand(pending.auditId));
      } catch {
        // The staged row never executed, so the clinical record is correct
        // either way; only its disposition is left unrecorded.
        console.warn('Voice command rejection could not be recorded');
      }
      return;
    }
    await this.auditUnstaged(pending, 'REJECTED', undefined);
  }

  /**
   * The trail entry for a command that was never staged and never ran: the
   * dentist said no, or something else came first. Logged as a question that
   * was asked, not as the write it would have been — the server treats a write
   * as CONFIRM-tier and only ever records it as PENDING, which this was not.
   */
  private async auditUnstaged(
    pending: PendingConfirmation,
    status: ConfirmationStatus,
    errorMessage: string | undefined,
  ): Promise<void> {
    const isWrite = pending.command.risk === 'CONFIRM';
    const intent: VoiceIntent = isWrite
      ? { ...pending.intent, intent: 'clarification', entities: { pendingIntent: pending.intent.intent, ...pending.intent.entities } }
      : pending.intent;
    await this.audit(intent, this.context.snapshot(), isWrite ? 'SAFE' : pending.command.risk, status, 'REJECTED',
      errorMessage ? { errorMessage } : {});
  }

  private async answerConfirmation(said: string, readings: string[], gated: boolean): Promise<void> {
    if (readings.some(reading => AFFIRMATIVE.test(stripWakeWord(reading) ?? reading))) {
      await this.confirmPending();
      return;
    }
    if (readings.some(reading => NEGATIVE.test(stripWakeWord(reading) ?? reading))) {
      await this.rejectPending();
      return;
    }
    // Room conversation must neither confirm nor cancel a pending write.
    if (gated && !this.addressedCommand(readings)) {
      this.ignoredSignal.set(said);
      return;
    }
    // A new command replaces the pending one rather than being read as a yes.
    const pending = this.confirmationSignal();
    this.confirmationSignal.set(null);
    if (pending?.auditId) {
      try {
        await firstValueFrom(this.api.rejectCommand(pending.auditId));
      } catch {
        console.warn('Superseded voice command could not be released');
      }
    } else if (pending) {
      await this.auditUnstaged(pending, 'CANCELLED', 'Superseded by a new utterance');
    }
    const normalized = readings[0] !== said ? readings[0] : null;
    await this.handleTranscript(said, 1, normalized, gated);
  }

  /** Answers a pending question and completes the command it belonged to. */
  async answerClarification(
    text: string,
    recognitionConfidence = 1,
    normalized: string | null = null,
    gated = false,
  ): Promise<void> {
    const pending = this.clarificationSignal();
    if (!pending) return;

    const readings = distinct([normalized, text]).map(reading => stripWakeWord(reading) ?? reading);
    if (readings.some(reading => NEGATIVE.test(reading))) {
      this.dismissClarification();
      return;
    }

    const snapshot = this.context.snapshot();

    if (pending.pendingIntent && pending.awaiting) {
      for (const reading of readings) {
        const value = this.interpretClarificationAnswer(reading, pending, snapshot);
        if (value === null) continue;
        this.clarificationSignal.set(null);
        await this.dispatch(
          {
            intent: pending.pendingIntent,
            entities: { ...(pending.pendingEntities ?? {}), [pending.awaiting]: value },
            confidence: 0.9,
            resolver: 'grammar',
            transcript: `${pending.transcript} → ${text}`,
          },
          snapshot,
          recognitionConfidence,
        );
        return;
      }
    }

    // Not an answer. Conversation in the room leaves the question standing;
    // a new command addressed to the system replaces it.
    if (gated && !this.addressedCommand(distinct([normalized, text]))) {
      this.ignoredSignal.set(text);
      return;
    }
    this.clarificationSignal.set(null);
    await this.handleTranscript(text, recognitionConfidence, normalized, gated);
  }

  /** Picks an offered option, an FDI code, findings, or a spoken tooth description. */
  private interpretClarificationAnswer(
    text: string,
    pending: VoiceClarification,
    snapshot: VoiceContextSnapshot,
  ): unknown | null {
    const normalized = text.trim().toLowerCase();

    const option = pending.options.find(
      o => o.value.toLowerCase() === normalized || o.label.toLowerCase().includes(normalized),
    );
    if (option) return option.value;

    if (pending.awaiting === 'fdi') {
      const tooth = resolveTooth(text, snapshot.dentition);
      if (tooth.kind === 'resolved') return tooth.fdi;
      // "Seize" or "16" on its own, which the resolver rightly declines
      // without a tooth word, is an answer here.
      const code = normalized.match(/^(?:la\s+|le\s+)?([1-8][1-8])$/);
      if (code && pending.options.every(o => o.value !== code[1]) && resolveTooth(`dent ${code[1]}`, snapshot.dentition).kind === 'resolved') {
        return code[1];
      }
      const worded = resolveTooth(`dent ${normalized}`, snapshot.dentition);
      return worded.kind === 'resolved' ? worded.fdi : null;
    }
    if (pending.awaiting === 'findings') {
      const findings = affirmedFindings(extractFindings(text));
      return findings.length
        ? findings.map(f => ({ code: f.code, label: f.label, kind: f.kind, surface: f.surface, severity: f.severity }))
        : null;
    }
    if (pending.awaiting === 'category') {
      if (/dental|dentaire/i.test(text)) return 'DENTAL_HISTORY';
      if (/medical|m[ée]dical/i.test(text)) return 'CONDITION';
      if (/note/i.test(text)) return 'OBSERVATION';
      return null;
    }
    // Free-text answers (a note's content, an allergy's substance).
    return text.trim() || null;
  }

  answerClarificationOption(value: string): void {
    void this.answerClarification(value);
  }

  dismissClarification(): void {
    this.clarificationSignal.set(null);
    this.interpretationSignal.set(null);
    this.settle();
  }

  // ── Undo ────────────────────────────────────────────────────────────

  /**
   * Offers the inverse of a write for a few seconds (audit XII.4 §4). The
   * reversal is itself a normal authenticated write with its own audit trail.
   */
  private offerUndo(label: string, run: () => Promise<void>, _auditId: string | null): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoSignal.set({
      label,
      run: async () => {
        await run();
        this.undoSignal.set(null);
        this.announce(true, 'Undone.', this.say('undone'));
      },
    });
    this.undoTimer = setTimeout(() => this.undoSignal.set(null), UNDO_WINDOW_MS);
  }

  async undoLast(): Promise<void> {
    const undo = this.undoSignal();
    if (!undo) {
      this.announce(false, 'There\'s nothing to undo.', this.say('nothingToUndo'));
      return;
    }
    try {
      await undo.run();
    } catch (error) {
      this.announce(false, this.describeFailure(error), this.spokenFailure(error));
    }
  }

  // ── The buffer ──────────────────────────────────────────────────────

  clearHighlight(): void {
    this.highlightSignal.set(null);
  }

  /**
   * Removes one staged command from the buffer and rejects its audit row.
   *
   * Nothing was written to the clinical record, so this is the dentist
   * correcting the buffer mid-dictation. The audit row is marked rejected
   * rather than deleted: what the system heard, and that the dentist took it
   * back, are both part of the trail.
   */
  async discardBuffered(auditId: string, sessionId?: string | null): Promise<void> {
    this.bufferedSignal.update(entries => entries.filter(entry => entry.auditId !== auditId));
    const session = sessionId ?? this.context.sessionId();
    if (session) await this.buffer.remove(session, auditId);
    try {
      await firstValueFrom(this.api.rejectCommand(auditId));
    } catch {
      // The row stays PENDING and is simply never approved at commit.
    }
  }

  /**
   * Removes a staged finding named by what it is rather than by position.
   * Ambiguity is always a question, never a guess.
   */
  async discardBufferedMatching(predicate: (entry: BufferedEntry) => boolean,
                                describe: (matches: BufferedEntry[]) => string): Promise<boolean> {
    const matches = this.bufferedSignal().filter(predicate);
    if (matches.length === 0) {
      this.announce(false, 'That isn\'t in this session.', this.say('notInSession'));
      return false;
    }
    if (matches.length > 1) {
      const teeth = [...new Set(matches.map(match => entityString(match.entities, 'fdi')).filter(Boolean))];
      this.announce(false, describe(matches), this.language() === 'fr'
        ? { text: `Sur quelle dent : ${teeth.join(' ou ')} ?`, locale: 'fr-FR' }
        : undefined);
      return false;
    }
    await this.discardBuffered(matches[0].auditId);
    this.announce(true, `Removed: ${matches[0].preview}`, this.say('removed'));
    return true;
  }

  /**
   * Handles "remove caries on 16" against this session's staged findings.
   * Returns false when nothing staged matches, so the command falls through
   * to withdrawing a finding already on the record.
   */
  private async removeFromBuffer(intent: VoiceIntent): Promise<boolean> {
    const fdi = entityString(intent.entities, 'fdi');
    const codes = stagedFindingCodes(intent.entities);
    if (!fdi || codes.length === 0) return false;

    // A general term covers the specific finding it names: "la carie" takes
    // back the "carie récurrente" dictated a moment ago.
    const covered = (entry: BufferedEntry) =>
      stagedFindingCodes(entry.entities).filter(staged => codes.some(spoken => spokenFindingCovers(spoken, staged)));
    const matches = this.bufferedSignal().filter(entry =>
      entry.intent === 'clinical.addFindings'
      && entityString(entry.entities, 'fdi') === fdi
      && covered(entry).length > 0);
    if (matches.length === 0) return false;

    // Several entries naming the same finding on the same tooth are the same
    // dictation repeated; the latest is the one being taken back.
    const entry = matches[matches.length - 1];
    const removedCodes = covered(entry);
    const removed = await this.removeStagedFindings(entry, removedCodes);
    this.highlightSignal.set(fdi);
    this.touchWakeWindow();
    this.settle();
    if (removed) {
      const labels = removedCodes.map(code => findingLabel(code)).join(', ');
      // Read back what was taken off, not just that something was.
      const fr = this.language() === 'fr';
      const spokenLabels = removedCodes.map(code => spokenFindingLabel(code, fr ? 'fr' : 'en')).join(', ');
      this.announce(true, `Removed from tooth ${fdi}: ${labels}`, {
        text: fr ? `Retiré de la dent ${fdi} : ${spokenLabels}.` : `Removed from tooth ${fdi}: ${spokenLabels}.`,
        locale: synthesisLocale(fr ? 'fr' : 'en'),
      });
    } else {
      this.announce(false, 'That couldn\'t be removed. Say it again.', this.say('notStaged'));
    }
    return true;
  }

  /**
   * Drops some findings from a staged entry. An entry left with other
   * findings is re-staged as a new audit row carrying only those — the old
   * row is rejected, never edited, so the trail shows what was said and what
   * was taken back.
   */
  private async removeStagedFindings(entry: BufferedEntry, codes: string[]): Promise<boolean> {
    const findings = Array.isArray(entry.entities['findings'])
      ? (entry.entities['findings'] as Array<{ code?: string }>)
      : [];
    const remaining = findings.filter(finding => !codes.includes(String(finding.code)));
    if (remaining.length === 0) {
      await this.discardBuffered(entry.auditId);
      return true;
    }

    const snapshot = this.context.snapshot();
    const entities = { ...entry.entities, findings: remaining };
    const auditId = await this.audit(
      { intent: entry.intent, entities, confidence: 1, resolver: 'grammar', transcript: entry.transcript },
      snapshot, 'CONFIRM', 'PENDING', 'CLARIFICATION',
    );
    if (!auditId) return false;

    const fdi = entityString(entities, 'fdi') ?? '';
    const labels = remaining.map(finding => findingLabel(String(finding.code))).join('; ');
    const replacement: BufferedEntry = {
      ...entry,
      auditId,
      entities,
      preview: `Tooth ${fdi} (${describeFdi(fdi)}) → ${labels}`,
    };
    await this.discardBuffered(entry.auditId);
    this.stage(replacement, snapshot.sessionId);
    return true;
  }

  // ── Feedback and audit ──────────────────────────────────────────────

  private withCorrections(spoken: Spoken, language: 'fr' | 'en'): Spoken {
    if (this.pendingCorrections.length === 0) return spoken;
    // If the system heard "recurrence" and acted on "recurrent", the dentist
    // is entitled to know before they carry on.
    const taken = this.pendingCorrections
      .map(c => language === 'fr' ? `« ${c.from} » compris « ${c.to} »` : `took "${c.from}" as "${c.to}"`)
      .join(', ');
    return { ...spoken, text: `${spoken.text} (${taken})` };
  }

  /** The dictation language if the recogniser reported one, else the interface language. */
  private language(): SpokenLanguage {
    return this.dictationLanguageSignal() ?? spokenLanguage(this.context.locale());
  }

  private say(key: PhraseKey): Spoken {
    return phrase(key, this.language());
  }

  /** A command's result, read in the dentist's language when it has a French reading. */
  private spokenResult(result: { message: string; spokenFr?: string; spokenText?: string }): Spoken {
    if (this.language() === 'fr' && result.spokenFr) {
      return { text: result.spokenFr, locale: synthesisLocale('fr') };
    }
    if (result.spokenText) return { text: result.spokenText, locale: 'en-US' };
    return { text: result.message, locale: 'en-US' };
  }

  private spokenFailure(error: unknown): Spoken {
    const status = (error as { status?: number })?.status;
    if (status === 403) return this.say('noPermission');
    if (status === 404) return this.say('recordGone');
    if (status === 400) return this.say('notAccepted');
    if (status === 0 || status === undefined) return this.say('noConnection');
    return this.say('saveFailed');
  }

  private announce(ok: boolean, message: string, spoken?: Spoken): void {
    this.outcomeSignal.set({ ok, message, at: Date.now() });
    // A running session shows every outcome in its own panel, and a toast on
    // top of that covers the chart on a phone.
    if (!this.examinationModeSignal() && !this.sessionService.isActive()) {
      if (ok) this.toast.success(message);
      else this.toast.info(message);
    }
    const utterance = spoken ?? { text: message, locale: 'en-US' };
    // Nothing to say is a choice — the outcome is on screen only.
    if (utterance.text.trim()) this.feedback.speak(utterance.text, utterance.locale);
  }

  private reportError(message: string): void {
    this.errorSignal.set(message);
    this.stateSignal.set('error');
    this.toast.error(message);
  }

  private describeFailure(error: unknown): string {
    const status = (error as { status?: number })?.status;
    if (status === 403) return 'You don\'t have permission to record that.';
    if (status === 404) return 'That record no longer exists.';
    if (status === 400) return 'That wasn\'t accepted — the details didn\'t validate.';
    if (status === 0 || status === undefined) return 'That didn\'t save — check the connection and try again.';
    return 'That didn\'t save. Nothing was recorded.';
  }

  /** Returns the audit row id so an undo can annotate it later. */
  private async audit(
    intent: VoiceIntent,
    snapshot: VoiceContextSnapshot,
    riskTier: 'SAFE' | 'CONFIRM' | 'BLOCKED',
    confirmationStatus: ConfirmationStatus,
    outcome: CommandOutcome,
    extra: {
      targetType?: string; targetId?: string;
      previousValue?: string; newValue?: string; errorMessage?: string;
    } = {},
  ): Promise<string | null> {
    try {
      const entry = await firstValueFrom(this.api.recordCommand({
        patientId: snapshot.patientId,
        sessionId: snapshot.sessionId,
        transcript: intent.transcript,
        locale: snapshot.locale,
        intent: intent.intent,
        entities: JSON.stringify(intent.entities ?? {}),
        resolver: intent.resolver,
        confidence: intent.confidence,
        module: snapshot.module,
        riskTier,
        confirmationStatus,
        outcome,
        targetType: extra.targetType ?? null,
        targetId: extra.targetId ?? null,
        previousValue: extra.previousValue ?? null,
        newValue: extra.newValue ?? null,
        errorMessage: extra.errorMessage ?? null,
      }));
      return entry.id;
    } catch {
      console.warn('Voice audit entry could not be recorded for intent', intent.intent);
      return null;
    }
  }

  /** Used by the session summary read-back. */
  describeTooth(fdi: string): string {
    return describeFdi(fdi);
  }
}
