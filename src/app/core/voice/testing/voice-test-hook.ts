import { Injector, isDevMode } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { ConsultationService } from '../../consultation/consultation.service';
import { ConsultationFocusService } from '../../consultation/consultation-focus.service';
import { EarconService } from '../earcon.service';
import { SpeechFeedbackService } from '../speech-feedback.service';
import { VoiceOrchestratorService } from '../voice-orchestrator.service';

/**
 * `window.orthoflowVoiceTest`, in development builds only: drives the real voice
 * pipeline without a microphone. The built-in browser pane has none, and a
 * consultation is otherwise impossible to check end to end on a development
 * machine — so each sentence goes in as if the microphone had heard it, through
 * the same gate, grammar and staging as speech does.
 *
 *     await orthoflowVoiceTest.mute(true);
 *     await orthoflowVoiceTest.hear('dent 13, carie');
 *     orthoflowVoiceTest.state().buffered;
 */
export interface VoiceTestHook {
  /** As if the microphone had heard it: conversation line, then the gated pipeline. */
  hear(text: string): Promise<void>;
  /** Lines with the pause before each, in ms, for timing checks. */
  script(lines: { text: string; afterMs?: number }[]): Promise<void>;
  /** Records what would be said or toned instead of playing it. */
  mute(on: boolean): void;
  state(): VoiceTestState;
}

export interface VoiceTestState {
  view: string | null;
  pinned: boolean;
  lastAction: unknown;
  buffered: unknown[];
  lines: { text: string; verdict: string | null }[];
  spoken: string[];
  tones: string[];
}

/** What a later work package plugs in: the stage, the tones. Optional so the hook works without them. */
export interface VoiceTestExtensions {
  view?: () => { view: string | null; pinned: boolean; lastAction: unknown };
  setToneRecorder?: (recorder: ((tone: string) => void) | null) => void;
}

declare global {
  interface Window {
    orthoflowVoiceTest?: VoiceTestHook;
  }
}

const extensions: VoiceTestExtensions = {};

/** Lets a service that exists only in a later build of the cockpit report to the hook. */
export function extendVoiceTestHook(more: VoiceTestExtensions): void {
  Object.assign(extensions, more);
}

/**
 * Installs the hook when this is a development build. Returns whether it did.
 * `production` is injectable so a spec can check the production build never has it.
 */
export function installVoiceTestHook(
  injector: Injector,
  build: { production: boolean; devMode: boolean } = { production: environment.production, devMode: isDevMode() },
): boolean {
  if (typeof window === 'undefined') return false;
  if (build.production || !build.devMode) {
    delete window.orthoflowVoiceTest;
    return false;
  }

  const spoken: string[] = [];
  const tones: string[] = [];
  const voice = () => injector.get(VoiceOrchestratorService);
  const consultation = () => injector.get(ConsultationService);
  const speech = () => injector.get(SpeechFeedbackService);
  const earcons = () => injector.get(EarconService);
  const focus = () => injector.get(ConsultationFocusService);

  const hook: VoiceTestHook = {
    hear: text => voice().simulateHeard(text),
    async script(lines) {
      for (const line of lines) {
        if (line.afterMs) await new Promise(resolve => setTimeout(resolve, line.afterMs));
        await voice().simulateHeard(line.text);
      }
    },
    mute(on) {
      speech().setRecorder(on ? text => spoken.push(text) : null);
      earcons().setRecorder(on ? tone => tones.push(tone) : null);
      extensions.setToneRecorder?.(on ? tone => tones.push(tone) : null);
    },
    state() {
      const stage = extensions.view?.() ?? { view: focus().view(), pinned: focus().pinned(), lastAction: focus().lastAction() };
      return {
        ...stage,
        buffered: voice().buffered().map(entry => ({ intent: entry.intent, entities: entry.entities, summary: (entry as { summary?: string }).summary ?? null })),
        lines: consultation().lines().map(line => ({ text: line.text, verdict: (line as { verdict?: string | null }).verdict ?? null })),
        spoken: [...spoken],
        tones: [...tones],
      };
    },
  };
  window.orthoflowVoiceTest = hook;
  return true;
}
