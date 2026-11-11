import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { UserPreferencesService } from '../services/user-preferences.service';

/**
 * How much the app says back while the doctor dictates, kept with their account.
 *
 * - **full** — the resolved read-back, "Dent 16 : carie occlusale." (the default:
 *   the owner asked for feedback "to validate each action");
 * - **brief** — "Dent 16, noté.";
 * - **tones** — a short sound, no words; what was understood is on screen;
 * - **silent** — the screen only.
 *
 * Alarms (the microphone lost, the speech service down, the session about to
 * expire) are a separate switch, on by default, because missing one costs the
 * doctor every sentence that follows.
 *
 * Remembered in localStorage, so the next page load is right before anything is
 * fetched, and in the person's server-side preferences, so it follows them to
 * another device — adopted at sign-in, as the theme is.
 */
export type FeedbackLevel = 'full' | 'brief' | 'tones' | 'silent';
export const FEEDBACK_LEVELS: readonly FeedbackLevel[] = ['full', 'brief', 'tones', 'silent'];

export interface VoicePreferences {
  feedback: FeedbackLevel;
  criticalAlerts: boolean;
  autoFollow: boolean;
  /** 0.9 – 1.3 */
  speechRate: number;
  /** A `SpeechSynthesisVoice.voiceURI`, or null for the best available. */
  voiceUri: string | null;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  feedback: 'full',
  criticalAlerts: true,
  autoFollow: true,
  speechRate: 1.05,
  voiceUri: null,
};

const STORAGE_KEY = 'orthoflow_voice_prefs';
/** The single on/off switch this replaces: "off" meant nothing spoken. */
const LEGACY_AUDIO_KEY = 'orthoflow_voice_audio';

export function sanitizeVoicePreferences(value: unknown): VoicePreferences {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof VoicePreferences, unknown>>;
  const rate = typeof raw.speechRate === 'number' && Number.isFinite(raw.speechRate) ? raw.speechRate : DEFAULT_VOICE_PREFERENCES.speechRate;
  return {
    feedback: FEEDBACK_LEVELS.includes(raw.feedback as FeedbackLevel) ? raw.feedback as FeedbackLevel : DEFAULT_VOICE_PREFERENCES.feedback,
    criticalAlerts: typeof raw.criticalAlerts === 'boolean' ? raw.criticalAlerts : DEFAULT_VOICE_PREFERENCES.criticalAlerts,
    autoFollow: typeof raw.autoFollow === 'boolean' ? raw.autoFollow : DEFAULT_VOICE_PREFERENCES.autoFollow,
    speechRate: Math.min(1.3, Math.max(0.9, rate)),
    voiceUri: typeof raw.voiceUri === 'string' && raw.voiceUri ? raw.voiceUri : null,
  };
}

/** What this browser remembers, migrating the old on/off switch once. */
export function readStoredVoicePreferences(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): VoicePreferences {
  if (!storage) return { ...DEFAULT_VOICE_PREFERENCES };
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved) return sanitizeVoicePreferences(JSON.parse(saved));
    const legacy = storage.getItem(LEGACY_AUDIO_KEY);
    const migrated: VoicePreferences = { ...DEFAULT_VOICE_PREFERENCES, feedback: legacy === 'off' ? 'silent' : 'full' };
    if (legacy !== null) {
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      storage.removeItem(LEGACY_AUDIO_KEY);
    }
    return migrated;
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class VoicePreferencesService {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService, { optional: true });

  private readonly prefsSignal = signal<VoicePreferences>(readStoredVoicePreferences(localStore()));
  /** "Calypso, silence": for this consultation only, never saved. */
  private readonly sessionLevelSignal = signal<FeedbackLevel | null>(null);

  readonly preferences = this.prefsSignal.asReadonly();
  /** The level in force now: the one said for this consultation, else the doctor's own. */
  readonly level = computed<FeedbackLevel>(() => this.sessionLevelSignal() ?? this.prefsSignal().feedback);
  /** Whether confirmations are spoken at all at this level. */
  readonly speaks = computed(() => this.level() === 'full' || this.level() === 'brief');
  readonly criticalAlerts = computed(() => this.prefsSignal().criticalAlerts);
  readonly autoFollow = computed(() => this.prefsSignal().autoFollow);

  constructor() {
    effect(() => {
      const token = typeof this.auth?.token === 'function' ? this.auth.token() : null;
      if (token) untracked(() => void this.adoptServerChoice());
    });
  }

  /** Changes the doctor's own settings, here and on the server. */
  set(partial: Partial<VoicePreferences>): void {
    const next = sanitizeVoicePreferences({ ...this.prefsSignal(), ...partial });
    this.prefsSignal.set(next);
    // A level chosen in the settings replaces one said for the consultation.
    if (partial.feedback) this.sessionLevelSignal.set(null);
    try {
      localStore()?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the choice lasts for this page load */
    }
    if (typeof this.auth?.token === 'function' && this.auth.token()) {
      this.injector.get(UserPreferencesService).patch({ voice: next }).catch(() => undefined);
    }
  }

  /** For this consultation: "Calypso, silence", "sons seulement", "parle". */
  setSessionLevel(level: FeedbackLevel | null): void {
    this.sessionLevelSignal.set(level);
  }

  /** The control bar's button: full → brief → tones → silent → full. */
  cycle(): FeedbackLevel {
    const order = FEEDBACK_LEVELS;
    const next = order[(order.indexOf(this.level()) + 1) % order.length];
    this.set({ feedback: next });
    return next;
  }

  private async adoptServerChoice(): Promise<void> {
    try {
      const saved = (await this.injector.get(UserPreferencesService).get())['voice'];
      if (!saved || typeof saved !== 'object') return;
      const adopted = sanitizeVoicePreferences(saved);
      this.prefsSignal.set(adopted);
      try {
        localStore()?.setItem(STORAGE_KEY, JSON.stringify(adopted));
      } catch {
        /* ignore */
      }
    } catch {
      /* the server copy is a convenience; this browser's stands */
    }
  }
}
