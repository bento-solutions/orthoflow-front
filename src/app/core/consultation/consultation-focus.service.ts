import { Injectable, inject, signal } from '@angular/core';
import { VoicePreferencesService } from '../voice/voice-preferences.service';

/**
 * What the consultation cockpit's stage shows, and what was last touched.
 *
 * The owner asked for "direct focus on the last thing that was modified" and
 * for no "we move to the treatment plan" — the screen follows the doctor. So:
 *
 * - every action that changes something calls {@link touch}: the last-action
 *   card always updates and, unless the view is pinned, the stage goes to the
 *   section concerned and highlights the changed row for a few seconds;
 * - a burst (a reading that adds three allergies and a history entry) is one
 *   action: the stage goes to the first section, the card lists the rest, the
 *   rail marks the others as new;
 * - the stage does not switch on its own more than once every 2.5 s, so a run
 *   of changes does not make it flicker; a spoken or tapped change is immediate;
 * - "garde cette vue" pins, "suis-moi" unpins; pinned, the stage never moves on
 *   its own, but the card and the rail still update;
 * - "retour" goes back (a stack of eight).
 */
export type StageView = 'chart' | 'allergies' | 'patient' | 'history' | 'treatments' | 'plan'
  | 'appointment' | 'findings' | 'transcript' | 'summary' | 'help';

export const STAGE_VIEWS: readonly StageView[] = [
  'chart', 'allergies', 'history', 'treatments', 'plan', 'appointment', 'patient', 'summary', 'findings', 'transcript', 'help',
];

export interface LastAction {
  id: number;
  at: number;
  kind: 'chart' | 'intake' | 'view' | 'control' | 'unsure';
  /** "Dent 45 : amalgame" */
  title: string;
  /** "à la place de couronne" · "+ 1 antécédent" */
  detail: string | null;
  status: 'noted' | 'proposed' | 'to-confirm' | 'removed' | 'not-understood' | null;
  /** The words it came from. */
  heard: string | null;
  target: { view: StageView; itemKey?: string; fdi?: string } | null;
  undoable: boolean;
  source: 'voice' | 'reader' | 'touch';
}

export type ActionInput = Omit<LastAction, 'id' | 'at'> & {
  /** The other sections a burst touched, for the rail's dots and the card's "+ 1 antécédent". */
  also?: StageView[];
};

/** How long a changed row stays highlighted. */
export const HIGHLIGHT_MS = 4_000;
/** The stage does not switch on its own more often than this. */
export const AUTO_SWITCH_MIN_MS = 2_500;
const BACK_STACK = 8;

@Injectable({ providedIn: 'root' })
export class ConsultationFocusService {
  private readonly prefs = inject(VoicePreferencesService);

  private readonly viewSignal = signal<StageView>('chart');
  private readonly pinnedSignal = signal(false);
  private readonly highlightSignal = signal<{ view: StageView; itemKey?: string; fdi?: string; until: number } | null>(null);
  private readonly lastSignal = signal<LastAction | null>(null);
  private readonly unseenSignal = signal<Partial<Record<StageView, number>>>({});

  readonly view = this.viewSignal.asReadonly();
  readonly pinned = this.pinnedSignal.asReadonly();
  /** The row to outline, until its time runs out. */
  readonly highlight = this.highlightSignal.asReadonly();
  readonly lastAction = this.lastSignal.asReadonly();
  /** Sections with something new the doctor has not looked at yet. */
  readonly unseen = this.unseenSignal.asReadonly();

  private history: StageView[] = [];
  private nextId = 1;
  private lastAutoSwitchAt = 0;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** Something changed. The card updates; the stage follows unless pinned. */
  touch(action: ActionInput): LastAction {
    const { also, ...rest } = action;
    const last: LastAction = { ...rest, id: this.nextId++, at: Date.now() };
    this.lastSignal.set(last);

    const target = last.target;
    const marked = [...(target ? [target.view] : []), ...(also ?? [])];
    const following = !!target && !this.pinnedSignal() && this.prefs.autoFollow();
    const now = Date.now();
    const canSwitch = now - this.lastAutoSwitchAt >= AUTO_SWITCH_MIN_MS;

    if (target && following && canSwitch && target.view !== this.viewSignal()) {
      this.go(target.view);
      this.lastAutoSwitchAt = now;
    }
    // A section the stage did not go to has something new in it.
    const showing = this.viewSignal();
    this.unseenSignal.update(unseen => {
      const next = { ...unseen };
      for (const view of marked) if (view !== showing) next[view] = (next[view] ?? 0) + 1;
      return next;
    });
    if (target && target.view === this.viewSignal()) this.mark(target);
    return last;
  }

  /** "Montre les allergies", a tap on the rail: immediate, whatever the pin. */
  show(view: StageView): void {
    if (view !== this.viewSignal()) this.go(view);
  }

  /** "Retour": the view before this one. False when there is none. */
  back(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.viewSignal.set(previous);
    this.clearUnseen(previous);
    return true;
  }

  pin(): void {
    this.pinnedSignal.set(true);
  }

  unpin(): void {
    this.pinnedSignal.set(false);
  }

  /** A consultation attached or let go: back to the chart, nothing pinned or pending. */
  reset(): void {
    this.viewSignal.set('chart');
    this.pinnedSignal.set(false);
    this.lastSignal.set(null);
    this.unseenSignal.set({});
    this.history = [];
    this.lastAutoSwitchAt = 0;
    this.setHighlight(null);
  }

  private go(view: StageView): void {
    this.history = [...this.history, this.viewSignal()].slice(-BACK_STACK);
    this.viewSignal.set(view);
    this.clearUnseen(view);
  }

  private clearUnseen(view: StageView): void {
    this.unseenSignal.update(unseen => {
      if (!unseen[view]) return unseen;
      const next = { ...unseen };
      delete next[view];
      return next;
    });
  }

  private mark(target: NonNullable<LastAction['target']>): void {
    this.setHighlight({ ...target, until: Date.now() + HIGHLIGHT_MS });
  }

  private setHighlight(value: { view: StageView; itemKey?: string; fdi?: string; until: number } | null): void {
    if (this.highlightTimer !== null) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    this.highlightSignal.set(value);
    if (value) this.highlightTimer = setTimeout(() => this.highlightSignal.set(null), HIGHLIGHT_MS);
  }
}
