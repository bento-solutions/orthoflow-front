import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { SpeechRecognitionService } from './speech-recognition.service';
import { AudioCaptureService } from './audio-capture.service';
import { SessionBufferService } from './session-buffer.service';
import { SpeechFeedbackService } from './speech-feedback.service';
import { VoiceContextService } from './voice-context.service';
import { VoiceCommandRegistryService } from './voice-command-registry.service';
import { VoiceApiService } from './voice-api.service';
import { VoiceSessionService } from './voice-session.service';
import { resolveWithGrammar } from './voice-grammar';
import { repairClinicalTerms } from './voice-fuzzy';
import { detectWake, isStopPhrase, FOLLOW_UP_WINDOW_MS, WAKE_WORD } from './voice-wake';
import { allFindingCodes } from './clinical-lexicon';
import { describeFdi, resolveTooth } from './tooth-lexicon';
import {
  CommandOutcome,
  ConfirmationStatus,
  VoiceClarification,
  VoiceCommand,
  VoiceContextSnapshot,
  VoiceIntent,
  VoiceResolution,
  entityString,
} from './voice-intent.model';

/**
 * The pipeline, and the place every safety rule is actually enforced:
 *
 *   capture → transcribe → wake gate → grammar → fuzzy repair
 *           → (NLU fallback) → context resolution → validation → risk gate
 *           → buffer or execute → visual + spoken feedback → audit → undo
 *
 * Nothing downstream of this service ever sees a transcript. It hands a
 * registered command a validated argument object and nothing else, which is
 * what keeps a misrecognition bounded.
 *
 * Three stages carry most of the reliability, and they were the three that
 * were missing:
 *
 * **Wake gate.** Dictation is hands-free, so the microphone is open for the
 * whole examination and hears the patient too. Only utterances addressed to
 * the system — prefixed with the wake word, or inside the window one opens —
 * are treated as commands. See `voice-wake.ts`.
 *
 * **Fuzzy repair.** The grammar is regex and therefore exact, so "recurrence
 * caries" failed where "recurrent caries" succeeded, and the command was lost
 * even though the transcription was faithful. A miss is now repaired against
 * the lexicon's own vocabulary and retried before anything else happens. See
 * `voice-fuzzy.ts`.
 *
 * **Buffering.** A clinical write is staged as a PENDING audit row and left
 * there. Nothing reaches the clinical tables until the dentist has reviewed
 * the consultation and committed it, so "undo" during dictation is just a
 * buffer edit and cannot leave a half-written record behind.
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

/** How long an Undo affordance stays offered (audit XII.4 §4). */
const UNDO_WINDOW_MS = 12_000;

const AFFIRMATIVE = /^(?:yes|yeah|yep|confirm(?:ed)?|correct|ok(?:ay)?|right|do\s+it|go\s+ahead|save\s+it|oui|confirme[rz]?|d'accord|exact|valide[rz]?|na'?am|أجل|نعم)\b/iu;
const NEGATIVE = /^(?:no|nope|cancel|wrong|stop|discard|forget\s+it|don'?t|non|annule[rz]?|faux|laisse\s+tomber|la|لا)\b/iu;

@Injectable({ providedIn: 'root' })
export class VoiceOrchestratorService {
  private speech = inject(SpeechRecognitionService);
  private capture = inject(AudioCaptureService);
  private buffer = inject(SessionBufferService);
  private feedback = inject(SpeechFeedbackService);
  private context = inject(VoiceContextService);
  private registry = inject(VoiceCommandRegistryService);
  private api = inject(VoiceApiService);
  private toast = inject(ToastService);
  private sessionService = inject(VoiceSessionService);

  private stateSignal = signal<VoiceState>('idle');
  private transcriptSignal = signal('');
  private interpretationSignal = signal<string | null>(null);
  private confirmationSignal = signal<PendingConfirmation | null>(null);
  private clarificationSignal = signal<VoiceClarification | null>(null);
  private outcomeSignal = signal<VoiceOutcome | null>(null);
  private highlightSignal = signal<string | null>(null);
  private undoSignal = signal<{ label: string; run: () => Promise<void> } | null>(null);
  private examinationModeSignal = signal(false);
  private errorSignal = signal<string | null>(null);
  private bufferedSignal = signal<BufferedEntry[]>([]);
  private awakeUntilSignal = signal<number | null>(null);
  private ignoredSignal = signal<string | null>(null);

  state = this.stateSignal.asReadonly();
  /** Final transcript of the last utterance, for the "I heard…" line. */
  transcript = this.transcriptSignal.asReadonly();
  /** Live partial text, so the doctor can see the microphone is working. */
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
  /** Findings dictated but not yet committed — what the review page will show. */
  buffered = this.bufferedSignal.asReadonly();
  /**
   * The last utterance the wake gate declined. Shown faintly in the HUD so a
   * dentist whose wake word is being misheard can see that the microphone is
   * working and the system simply did not consider itself addressed — the
   * alternative is a mute HUD that looks broken.
   */
  ignoredUtterance = this.ignoredSignal.asReadonly();
  /** True while a bare utterance would still be taken as a command. */
  awake = computed(() => {
    const until = this.awakeUntilSignal();
    return until !== null && until > Date.now();
  });

  isListening = computed(() => this.speech.status() === 'listening');
  isSupported = computed(() => this.speech.isSupported());
  recognitionIsLocal = computed(() => this.speech.recognitionIsLocal());
  /** True until the clinician has opted in to the microphone being opened. */
  needsConsent = computed(() => this.speech.status() === 'consent-required');

  grantMicrophoneConsent(): void {
    this.speech.grantConsent();
  }

  revokeMicrophoneConsent(): void {
    this.speech.revokeConsent();
    this.examinationModeSignal.set(false);
    this.stateSignal.set('idle');
  }

  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private wired = false;

  /** Set by VoiceSessionService so session commands can call back into it. */
  sessionHooks: {
    start: () => Promise<void>;
    end: () => Promise<void>;
    summary: () => Promise<void>;
  } | null = null;

  // ── Microphone control ──────────────────────────────────────────────

  private wire(): void {
    if (this.wired) return;
    this.speech.setResultHandler(result => {
      void this.handleTranscript(result.transcript, result.confidence);
    });
    this.capture.setUtteranceHandler(clip => {
      void this.transcribeAndHandle(clip);
    });
    this.wired = true;
  }

  /**
   * One recorded utterance, transcribed server-side and fed into the same
   * pipeline a typed or browser-recognised one takes.
   *
   * A transcription that fails is not an error the dentist should see: it
   * means this clip produced nothing, and the next one probably will. The
   * exception is a persistent failure, which surfaces once the fallback
   * recogniser has also had a turn.
   */
  private async transcribeAndHandle(clip: Blob): Promise<void> {
    const snapshot = this.context.snapshot();
    try {
      const response = await firstValueFrom(this.api.transcribe(
        clip,
        // ISO-639-1, which is what the server passes to the provider; the
        // context holds a BCP-47 tag.
        snapshot.locale.split('-')[0],
        this.biasPrompt(snapshot),
      ));

      if (response.error || !response.text.trim()) {
        if (response.error && response.error !== 'stt-disabled') {
          // Worth knowing about in development; not worth interrupting a
          // consultation over.
          console.warn(`Transcription unavailable (${response.error}).`);
        }
        return;
      }
      await this.handleTranscript(response.text, 1);
    } catch {
      // Network or auth failure. The utterance is lost; the session continues.
      console.warn('Transcription request failed.');
    }
  }

  /**
   * Spelling hints for the recogniser — names and terms it would otherwise
   * mangle. Used for spelling only; it never becomes part of the transcript.
   */
  private biasPrompt(snapshot: VoiceContextSnapshot): string {
    const parts = [WAKE_WORD];
    if (snapshot.patientName) parts.push(snapshot.patientName);
    if (snapshot.selectedFdi) parts.push(`dent ${snapshot.selectedFdi}`);
    return parts.join(', ');
  }

  /** One utterance, then stop. The default and the safer mode. */
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

  /**
   * Continuous dictation for the length of an examination.
   *
   * Server-side capture is the primary path: the clip goes to a recogniser
   * that can be told it is hearing French-with-Darija dental dictation, which
   * is the difference between "carie récurrente" arriving intact and arriving
   * as something plausible-sounding. The browser's own recogniser remains as
   * a fallback for when the microphone cannot be opened for recording, or the
   * server has transcription switched off — a degraded session beats none.
   *
   * Never entered implicitly. The caller is always a deliberate press of
   * Record, and the HUD shows an unmissable listening state throughout.
   */
  async startExaminationMode(): Promise<void> {
    this.wire();
    this.errorSignal.set(null);
    this.ignoredSignal.set(null);
    if (this.needsConsent()) return;

    if (await this.capture.start()) {
      this.examinationModeSignal.set(true);
      this.stateSignal.set('listening');
      this.announce(true, `Session started. Say "${WAKE_WORD}" before a command.`);
      return;
    }

    if (!this.speech.start(this.context.locale(), true)) {
      this.reportError(this.capture.lastError() ?? this.speech.lastError() ?? 'Could not start listening.');
      return;
    }
    this.examinationModeSignal.set(true);
    this.stateSignal.set('listening');
  }

  stopListening(): void {
    this.capture.stop();
    this.speech.stop();
    this.examinationModeSignal.set(false);
    this.awakeUntilSignal.set(null);
    this.ignoredSignal.set(null);
    if (this.stateSignal() === 'listening') this.stateSignal.set('idle');
  }

  /** Discards the buffer without committing — an abandoned examination. */
  resetBuffer(): void {
    this.bufferedSignal.set([]);
  }

  /** Restores a buffer recovered from IndexedDB after a crash or reload. */
  restoreBuffer(entries: BufferedEntry[]): void {
    this.bufferedSignal.set(entries);
  }

  toggleListening(): void {
    if (this.isListening()) this.stopListening();
    else this.listenOnce();
  }

  // ── The pipeline ────────────────────────────────────────────────────

  /**
   * Entry point for an utterance, whether spoken or typed. Typed input goes
   * through exactly the same path — which is what makes the whole system
   * testable without a microphone, and usable when recognition is unavailable.
   */
  async handleTranscript(transcript: string, recognitionConfidence = 1): Promise<void> {
    const text = transcript.trim();
    if (!text) return;

    this.transcriptSignal.set(text);
    this.errorSignal.set(null);

    // A pending question owns the next utterance. Answering it must not be
    // reinterpreted as a fresh command.
    if (this.confirmationSignal()) {
      await this.answerConfirmation(text);
      return;
    }
    if (this.clarificationSignal()) {
      await this.answerClarification(text, recognitionConfidence);
      return;
    }

    // Ending the session is honoured without the wake word. A dentist whose
    // wake word is being misheard in a noisy surgery must still be able to
    // stop by voice, and stopping writes nothing.
    if (this.examinationModeSignal() && isStopPhrase(text)) {
      this.awakeUntilSignal.set(null);
      await this.sessionHooks?.end();
      return;
    }

    // Only speech addressed to the system is a command. During an
    // examination the microphone hears the patient too, and "j'ai mal à la
    // dent du fond" is a plausible finding and an implausible instruction.
    if (this.examinationModeSignal()) {
      const wake = detectWake(text, this.awakeUntilSignal(), Date.now());
      if (!wake.addressed) {
        this.ignoredSignal.set(text);
        this.stateSignal.set('listening');
        return;
      }
      this.ignoredSignal.set(null);
      // A bare wake word with nothing after it opens the floor and waits.
      if (!wake.command) {
        this.touchWakeWindow();
        this.stateSignal.set('listening');
        return;
      }
      await this.resolveAndApply(wake.command, recognitionConfidence);
      return;
    }

    await this.resolveAndApply(text, recognitionConfidence);
  }

  /**
   * Grammar, then fuzzy repair, then the LLM — in that order, because each is
   * an order of magnitude more expensive than the last and catches what the
   * previous one could not.
   */
  private async resolveAndApply(text: string, recognitionConfidence: number): Promise<void> {
    this.stateSignal.set('processing');
    this.context.rememberUtterance(text);

    const snapshot = this.context.snapshot();
    let resolution = resolveWithGrammar(text, snapshot);
    let corrections: { from: string; to: string }[] = [];

    // A near miss — "recurrence caries" for "recurrent caries" — used to die
    // here, however faithful the transcription was. Repairing against the
    // lexicon's own vocabulary costs about a millisecond and rescues most of
    // them without a round trip. Numbers are never repaired: a fuzzy tooth
    // number is the one error that survives review looking correct.
    // A clarification counts as a miss here too: "sixteen recurrence caries"
    // resolves the tooth and then has to ask which finding, because the word
    // was one letter out. Repairing it turns the question into the command
    // the dentist actually gave. Only an outright intent is accepted from the
    // retry — a repair that merely produces a different question has not
    // understood anything and should not displace the original.
    if (resolution.kind === 'unrecognized' || resolution.kind === 'clarification') {
      // The grammar arbitrates between close candidates — it is the only
      // thing that knows which repaired word actually parses.
      const repair = repairClinicalTerms(
        text,
        candidate => resolveWithGrammar(candidate, snapshot).kind === 'intent',
      );
      if (repair.corrections.length > 0) {
        const retried = resolveWithGrammar(repair.text, snapshot);
        if (retried.kind === 'intent') {
          resolution = retried;
          corrections = repair.corrections;
        }
      }
    }

    // Only what neither could parse is worth the round trip, and only if a
    // provider is configured.
    if (resolution.kind === 'unrecognized') {
      resolution = await this.consultNlu(text, snapshot);
    }

    this.pendingCorrections = corrections;
    await this.applyResolution(resolution, snapshot, recognitionConfidence);
    this.pendingCorrections = [];
  }

  /** Terms repaired for the utterance currently being dispatched. */
  private pendingCorrections: { from: string; to: string }[] = [];

  /**
   * Extends the window in which a bare utterance is still a command. Called
   * on every accepted command, so a run of findings needs the wake word only
   * once.
   */
  private touchWakeWindow(): void {
    this.awakeUntilSignal.set(Date.now() + FOLLOW_UP_WINDOW_MS);
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
      // A failed interpretation must not look like "understood, did nothing".
      return {
        kind: 'clarification',
        clarification: {
          question: 'I couldn\'t interpret that just now. Could you say it again?',
          options: [],
          transcript: text,
        },
      };
    }
  }

  private async applyResolution(
    resolution: VoiceResolution,
    snapshot: VoiceContextSnapshot,
    recognitionConfidence: number,
  ): Promise<void> {
    if (resolution.kind === 'clarification') {
      this.askClarification(resolution.clarification, snapshot);
      return;
    }
    if (resolution.kind === 'unrecognized') {
      this.interpretationSignal.set(null);
      this.stateSignal.set('idle');
      this.announce(false, 'I didn\'t understand that. Say "help" to hear what I can do here.');
      await this.audit(
        { intent: 'unknown', entities: {}, confidence: 0, resolver: 'grammar', transcript: resolution.transcript },
        snapshot, 'SAFE', 'PENDING', 'CLARIFICATION', { errorMessage: 'No matching command' },
      );
      return;
    }
    await this.dispatch(resolution.intent, snapshot, recognitionConfidence);
  }

  private askClarification(clarification: VoiceClarification, snapshot: VoiceContextSnapshot): void {
    this.clarificationSignal.set(clarification);
    this.interpretationSignal.set(null);
    this.stateSignal.set('awaiting-clarification');
    this.announce(false, clarification.question);
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
  ): Promise<void> {
    const command = this.registry.get(intent.intent);

    if (!command) {
      this.stateSignal.set('idle');
      this.announce(false, 'I can\'t do that from this screen.');
      await this.audit(intent, snapshot, 'SAFE', 'REJECTED', 'REJECTED',
        { errorMessage: `Unknown or out-of-scope command: ${intent.intent}` });
      return;
    }

    // Never by voice. The assistant acknowledges and points at the screen
    // rather than pretending it did not hear (audit XII.4 §3).
    if (command.risk === 'BLOCKED') {
      this.stateSignal.set('idle');
      const message = `That one needs to be done on screen — ${command.description.toLowerCase()} `
        + 'is deliberately not available by voice.';
      this.announce(false, message);
      await this.audit(intent, snapshot, 'BLOCKED', 'REJECTED', 'REJECTED', { errorMessage: 'Blocked risk tier' });
      return;
    }

    if (command.requiresPatient && !snapshot.patientId) {
      this.stateSignal.set('idle');
      this.announce(false, 'Open a patient\'s dossier first, then say that again.');
      await this.audit(intent, snapshot, command.risk, 'REJECTED', 'REJECTED',
        { errorMessage: 'No patient in context' });
      return;
    }

    this.context.rememberIntent(intent);

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
    // left there. Nothing reaches the clinical tables during the examination:
    // the dentist reviews the whole consultation afterwards, corrects what was
    // misheard, removes what does not belong, and commits once.
    //
    // The audit row is written immediately even so. It is what survives a
    // closed tab, and it is the record of what was said regardless of what is
    // eventually saved.
    if (command.risk === 'CONFIRM' && command.serverIntent) {
      const serverEntities = command.toServerEntities
        ? command.toServerEntities(intent.entities, snapshot)
        : intent.entities;

      const auditId = await this.audit(
        { ...intent, intent: command.serverIntent, entities: serverEntities },
        snapshot, 'CONFIRM', 'PENDING', 'CLARIFICATION',
      );

      if (!auditId) {
        // Without a staged row there is nothing the commit could execute, and
        // buffering it client-side only would lose it on a crash — the exact
        // failure the audit row exists to prevent.
        this.stateSignal.set('idle');
        this.announce(false, 'I couldn\'t record that safely, so nothing was staged. Try again.');
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
      this.bufferedSignal.update(entries => [...entries, entry]);
      if (snapshot.sessionId) {
        void this.buffer.append(snapshot.sessionId, {
          auditId: entry.auditId,
          intent: entry.intent,
          entities: entry.entities,
          transcript: entry.transcript,
          preview: entry.preview,
          corrections: entry.corrections,
          at: entry.at,
        });
      }

      this.context.rememberWrite({
        commandId: command.id,
        targetType: 'BufferedCommand',
        targetId: auditId,
        fdi: fdi ?? undefined,
        description: preview,
        auditId,
      });
      this.offerUndo(`Undo: ${preview}`, () => this.discardBuffered(auditId), auditId);

      this.touchWakeWindow();
      this.stateSignal.set('listening');
      this.outcomeSignal.set({ ok: true, message: preview, at: Date.now() });
      // Spoken because the dentist is not looking at the screen. The resolved
      // values, never an echo of the words — reading back what was heard
      // proves nothing about what was understood.
      this.announce(true, this.correctionAwarePreview(preview));
      return;
    }

    // SAFE commands run locally; a shaky recognition still gets a look first.
    if (combinedConfidence < CONFIDENCE_FLOOR) {
      this.confirmationSignal.set({ intent, command, preview, reason: 'low-confidence' });
      this.stateSignal.set('awaiting-confirmation');
      this.announce(false, `${preview}. Confirm?`);
      return;
    }

    await this.run(command, intent, snapshot, 'AUTO');
  }

  private async run(
    command: VoiceCommand,
    intent: VoiceIntent,
    snapshot: VoiceContextSnapshot,
    confirmation: ConfirmationStatus,
  ): Promise<void> {
    this.stateSignal.set('executing');
    if (!command.execute) {
      this.stateSignal.set('idle');
      this.announce(false, 'That command can\'t run from here.');
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
        this.sessionService.touchSession();
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

      this.announce(result.ok, result.message);
      this.stateSignal.set('idle');
    } catch (error) {
      const message = this.describeFailure(error);
      this.outcomeSignal.set({ ok: false, message, at: Date.now() });
      this.announce(false, message);
      this.stateSignal.set('idle');
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
        this.announce(false, message);
        this.stateSignal.set('idle');
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

      this.announce(true, result.message);
      this.stateSignal.set('idle');
    } catch (error) {
      const message = this.describeFailure(error);
      this.outcomeSignal.set({ ok: false, message, at: Date.now() });
      this.announce(false, message);
      this.stateSignal.set('idle');
    }
  }

  async rejectPending(): Promise<void> {
    const pending = this.confirmationSignal();
    if (!pending) return;
    this.confirmationSignal.set(null);
    this.stateSignal.set('idle');
    this.interpretationSignal.set(null);
    this.highlightSignal.set(null);
    this.announce(false, 'Discarded. Nothing was recorded.');

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
    await this.audit(pending.intent, this.context.snapshot(), pending.command.risk, 'REJECTED', 'REJECTED');
  }

  private async answerConfirmation(text: string): Promise<void> {
    if (AFFIRMATIVE.test(text)) {
      await this.confirmPending();
      return;
    }
    if (NEGATIVE.test(text)) {
      await this.rejectPending();
      return;
    }
    // Anything else replaces the pending command rather than being read as a
    // yes — silence and unrelated speech must never confirm a clinical write.
    const pending = this.confirmationSignal();
    this.confirmationSignal.set(null);
    if (pending?.auditId) {
      try {
        await firstValueFrom(this.api.rejectCommand(pending.auditId));
      } catch {
        console.warn('Superseded voice command could not be released');
      }
    } else if (pending) {
      await this.audit(pending.intent, this.context.snapshot(), pending.command.risk, 'CANCELLED', 'REJECTED',
        { errorMessage: 'Superseded by a new utterance' });
    }
    await this.handleTranscript(text);
  }

  /** Answers a pending question and completes the command it belonged to. */
  async answerClarification(text: string, recognitionConfidence = 1): Promise<void> {
    const pending = this.clarificationSignal();
    if (!pending) return;

    if (NEGATIVE.test(text)) {
      this.dismissClarification();
      return;
    }

    const snapshot = this.context.snapshot();

    if (pending.pendingIntent && pending.awaiting) {
      const value = this.interpretClarificationAnswer(text, pending, snapshot);
      if (value !== null) {
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

    // Not an answer to the question — treat it as a new command.
    this.clarificationSignal.set(null);
    await this.handleTranscript(text, recognitionConfidence);
  }

  /** Picks an offered option, an FDI code, or a spoken tooth description. */
  private interpretClarificationAnswer(
    text: string,
    pending: VoiceClarification,
    snapshot: VoiceContextSnapshot,
  ): string | null {
    const normalized = text.trim().toLowerCase();

    const option = pending.options.find(
      o => o.value.toLowerCase() === normalized || o.label.toLowerCase().includes(normalized),
    );
    if (option) return option.value;

    if (pending.awaiting === 'fdi') {
      const tooth = resolveTooth(text, snapshot.dentition);
      if (tooth.kind === 'resolved') return tooth.fdi;
      return null;
    }
    if (pending.awaiting === 'category') {
      if (/dental/i.test(text)) return 'DENTAL_HISTORY';
      if (/medical/i.test(text)) return 'CONDITION';
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
    this.stateSignal.set('idle');
    this.interpretationSignal.set(null);
  }

  // ── Undo ────────────────────────────────────────────────────────────

  /**
   * Offers the inverse of a write for a few seconds (audit XII.4 §4). The
   * reversal is itself a normal authenticated write with its own audit trail
   * — the original row keeps its EXECUTED outcome, because erasing the fact
   * that the write happened is the opposite of what an audit trail is for.
   */
  private offerUndo(label: string, run: () => Promise<void>, auditId: string | null): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoSignal.set({
      label,
      run: async () => {
        await run();
        this.undoSignal.set(null);
        this.announce(true, 'Undone.');
      },
    });
    this.undoTimer = setTimeout(() => this.undoSignal.set(null), UNDO_WINDOW_MS);
  }

  async undoLast(): Promise<void> {
    const undo = this.undoSignal();
    if (!undo) {
      this.announce(false, 'There\'s nothing to undo.');
      return;
    }
    try {
      await undo.run();
    } catch (error) {
      this.announce(false, this.describeFailure(error));
    }
  }

  // ── Feedback and audit ──────────────────────────────────────────────

  clearHighlight(): void {
    this.highlightSignal.set(null);
  }

  /**
   * Removes one staged command from the buffer and rejects its audit row.
   *
   * Nothing was written to the clinical record, so this is not a clinical
   * undo — it is the dentist correcting the buffer mid-dictation. The audit
   * row is marked rejected rather than deleted: what the system heard, and
   * that the dentist took it back, are both part of the trail.
   */
  async discardBuffered(auditId: string, sessionId?: string | null): Promise<void> {
    this.bufferedSignal.update(entries => entries.filter(entry => entry.auditId !== auditId));
    const session = sessionId ?? this.context.sessionId();
    if (session) await this.buffer.remove(session, auditId);
    try {
      await firstValueFrom(this.api.rejectCommand(auditId));
    } catch {
      // The row stays PENDING and is simply never approved at commit. The
      // buffer is what the review page reads from, so the dentist still sees
      // the right thing.
    }
  }

  /**
   * Removes a staged finding named by what it is rather than by position —
   * "enlève la carie sur la seize".
   *
   * Ambiguity is always a question, never a guess. Deleting the wrong finding
   * is invisible at review: what remains reads as an ordinary, correctly
   * spelled record, and the dentist has no way to notice the one that went
   * missing.
   */
  async discardBufferedMatching(predicate: (entry: BufferedEntry) => boolean,
                                describe: (matches: BufferedEntry[]) => string): Promise<boolean> {
    const matches = this.bufferedSignal().filter(predicate);
    if (matches.length === 0) {
      this.announce(false, 'I don\'t have that in this session.');
      return false;
    }
    if (matches.length > 1) {
      this.announce(false, describe(matches));
      return false;
    }
    await this.discardBuffered(matches[0].auditId);
    this.announce(true, `Removed: ${matches[0].preview}`);
    return true;
  }

  /**
   * Names a repaired term in the spoken confirmation.
   *
   * If the system heard "recurrence" and acted on "recurrent", the dentist is
   * entitled to know that before they carry on — silently correcting a word
   * and confirming as though it had been said correctly is how a wrong
   * finding gets past someone who is not looking at the screen.
   */
  private correctionAwarePreview(preview: string): string {
    if (this.pendingCorrections.length === 0) return preview;
    const corrected = this.pendingCorrections.map(c => `${c.from} as ${c.to}`).join(', ');
    return `${preview}. I took ${corrected}.`;
  }

  private announce(ok: boolean, message: string): void {
    // Every outcome resolves to something the doctor can observe without
    // looking up: a toast, the HUD line, and — since their eyes are on the
    // patient — spoken confirmation.
    if (ok) this.toast.success(message);
    else this.toast.info(message);
    this.feedback.speak(message, this.context.locale());
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
      // The clinical write itself is already durable and separately audited
      // by the server. A failed voice-audit post is worth a console note, not
      // an interruption to the examination.
      console.warn('Voice audit entry could not be recorded for intent', intent.intent);
      return null;
    }
  }

  /** Used by the session summary read-back. */
  describeTooth(fdi: string): string {
    return describeFdi(fdi);
  }
}
