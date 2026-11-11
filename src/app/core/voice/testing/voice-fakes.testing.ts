import { signal } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { SignOutReason } from '../../services/auth.service';
import { LastWriteRef, VoiceContextSnapshot } from '../voice-intent.model';
import { RecordVoiceCommandDto, TranscriptionDto } from '../voice-api.service';

/**
 * Stand-ins for what the voice pipeline talks to: the server, the loudspeaker,
 * the microphone, the dossier. They record instead of acting, so a spec — or
 * the session replay — can say what *would* have reached the server and what
 * would have been said aloud.
 */

/** The voice API: hands out audit ids and remembers every row staged or taken back. */
export class FakeVoiceApi {
  recorded: RecordVoiceCommandDto[] = [];
  rejected: string[] = [];
  interpreted = 0;
  /** What the NLU fallback answers; by default it understands nothing. */
  interpretAnswer: () => unknown = () =>
    ({ intent: null, entities: {}, confidence: 0, clarification: null, resolver: 'llm', provider: 'disabled', error: null });

  recordCommand(entry: RecordVoiceCommandDto) {
    this.recorded.push(entry);
    return of({ ...entry, id: `audit-${this.recorded.length}`, actorId: 'u-1', occurredAt: '', undoneAt: null });
  }

  rejectCommand(id: string) {
    this.rejected.push(id);
    return of({} as never);
  }

  /** What the next clip's transcription does. Defaults to never answering. */
  transcription: () => Observable<TranscriptionDto> = () => new Subject<TranscriptionDto>();
  transcribed = 0;

  transcribe() {
    this.transcribed++;
    return this.transcription();
  }

  interpret() {
    this.interpreted++;
    return of(this.interpretAnswer() as never);
  }

  confirmCommand() {
    return of({ outcome: 'EXECUTED' } as never);
  }
}

/** The loudspeaker: records what would have been said. */
export class FakeSpeechFeedback {
  spoken: Array<{ text: string; locale: string }> = [];
  voice: 'ok' | 'missing' | 'unknown' = 'ok';
  private enabledSignal = signal(true);
  speaking = signal(false);
  enabled = this.enabledSignal.asReadonly();
  generation = 0;
  speak(text: string, locale: string) {
    this.spoken.push({ text, locale });
    this.generation++;
  }
  holdMicrophone() { /* no microphone */ }
  voicesFor() { return []; }
  setEnabled(on: boolean) { this.enabledSignal.set(on); }
  toggle() { this.enabledSignal.update(on => !on); }
  voiceStatus() { return this.voice; }
  isAudible() { return false; }
  isSupported() { return true; }
  cancel() { /* nothing playing */ }
  unlock() { /* nothing to unlock */ }
}

/** The dossier the pipeline thinks it is in: one adult patient, one session. */
export class FakeVoiceContext {
  lastWrite: LastWriteRef | null = null;
  selected: string | null = null;
  /** The dictation locale: what the real service reads from the chosen language. */
  tag = 'fr-MA';
  utterances: string[] = [];

  snapshot(): VoiceContextSnapshot {
    return {
      patientId: 'p-1',
      patientName: 'Ahmed El Amrani',
      dentition: 'adult',
      module: 'patient-dossier',
      route: '/patients/p-1',
      selectedFdi: this.selected,
      sessionId: 's-1',
      locale: this.tag,
      recentIntents: [],
      recentUtterances: this.utterances.slice(-8),
      lastWrite: this.lastWrite,
    };
  }
  locale() { return this.tag; }
  dentition() { return 'adult' as const; }
  sessionId() { return 's-1'; }
  selectedFdi() { return this.selected; }
  selectTooth(fdi: string | null) { this.selected = fdi; }
  setSessionId() { /* one session */ }
  rememberUtterance(text: string) { this.utterances.push(text); }
  rememberIntent() { /* not needed */ }
  rememberWrite(write: LastWriteRef | null) {
    this.lastWrite = write;
    if (write?.fdi) this.selected = write.fdi;
  }
  clearConversation() { this.lastWrite = null; this.utterances = []; }
}

/** A microphone whose state the test decides. */
export class FakeAudioCapture {
  level = signal(0);
  speaking = signal(false);
  paused = signal(false);
  status = signal<'idle' | 'starting' | 'capturing' | 'suspended' | 'error'>('idle');
  startCalls = 0;
  stopCalls = 0;
  startSucceeds = true;
  handler: ((clip: Blob, meta?: { cut: boolean }) => void) | null = null;

  isActive() { return ['capturing', 'suspended', 'starting'].includes(this.status()); }
  isSupported() { return true; }
  setUtteranceHandler(handler: (clip: Blob, meta?: { cut: boolean }) => void) { this.handler = handler; }
  async start() {
    this.startCalls++;
    if (this.startSucceeds) this.status.set('capturing');
    return this.startSucceeds;
  }
  stop() { this.stopCalls++; this.status.set('idle'); }
  setPaused() { /* not needed */ }
  lastError() { return null; }
  resume() { return Promise.resolve(); }
  say(cut = false) { this.handler?.(new Blob(['x'], { type: 'audio/wav' }), { cut }); }
}

export class FakeAuth {
  expiryWarning = signal<number | null>(null);
  isAuthenticated = signal(true);
  currentUser = signal<{ id: string } | null>({ id: 'u-1' });
  private handlers = new Set<(reason: SignOutReason) => void>();
  onSignOut(handler: (reason: SignOutReason) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  signOut(reason: SignOutReason) { this.handlers.forEach(handler => handler(reason)); }
}

export class FakeVoiceSession {
  active = true;
  touched = 0;
  isActive() { return this.active; }
  touchSession() { this.touched++; }
}

export const FAKE_RECOGNITION = {
  interimTranscript: signal(''),
  status: signal('idle'),
  consented: signal(true),
  isSupported: () => true,
  setResultHandler: () => undefined,
  stop: () => undefined,
  start: () => true,
  grantConsent: () => undefined,
  revokeConsent: () => undefined,
  lastError: () => null,
};
