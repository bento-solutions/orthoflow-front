import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePreferencesService } from '../voice/voice-preferences.service';
import { ActionInput, AUTO_SWITCH_MIN_MS, ConsultationFocusService, HIGHLIGHT_MS } from './consultation-focus.service';

const action = (over: Partial<ActionInput> = {}): ActionInput => ({
  kind: 'intake', title: 'Allergie : ananas', detail: null, status: 'noted', heard: null,
  target: { view: 'allergies', itemKey: 'allergy:ananas' }, undoable: false, source: 'voice', ...over,
});

describe('ConsultationFocusService', () => {
  let focus: ConsultationFocusService;
  let autoFollow = true;

  beforeEach(() => {
    vi.useFakeTimers();
    autoFollow = true;
    TestBed.configureTestingModule({
      providers: [{ provide: VoicePreferencesService, useValue: { autoFollow: () => autoFollow } }],
    });
    focus = TestBed.inject(ConsultationFocusService);
  });
  afterEach(() => vi.useRealTimers());

  it('starts on the chart', () => {
    expect(focus.view()).toBe('chart');
    expect(focus.pinned()).toBe(false);
  });

  it('follows the last change and highlights its row for a few seconds', () => {
    focus.touch(action());
    expect(focus.view()).toBe('allergies');
    expect(focus.highlight()).toMatchObject({ view: 'allergies', itemKey: 'allergy:ananas' });
    vi.advanceTimersByTime(HIGHLIGHT_MS + 10);
    expect(focus.highlight()).toBeNull();
  });

  it('always updates the card, even pinned, and never moves the stage when pinned', () => {
    focus.pin();
    const last = focus.touch(action());
    expect(focus.view()).toBe('chart');
    expect(focus.lastAction()).toEqual(last);
    expect(focus.unseen()['allergies']).toBe(1);
  });

  it('does not follow when the doctor turned following off', () => {
    autoFollow = false;
    focus.touch(action());
    expect(focus.view()).toBe('chart');
    expect(focus.unseen()['allergies']).toBe(1);
  });

  it('takes a burst as one action: the first section, dots on the rest', () => {
    focus.touch(action({ also: ['history'], detail: '+ 1 antécédent', source: 'reader' }));
    expect(focus.view()).toBe('allergies');
    expect(focus.unseen()).toEqual({ history: 1 });
    expect(focus.lastAction()?.detail).toBe('+ 1 antécédent');
  });

  it('does not switch on its own more than once every 2.5 s', () => {
    focus.touch(action());
    focus.touch(action({ target: { view: 'history' } }));
    expect(focus.view()).toBe('allergies');
    expect(focus.unseen()['history']).toBe(1);
    vi.advanceTimersByTime(AUTO_SWITCH_MIN_MS);
    focus.touch(action({ target: { view: 'plan' } }));
    expect(focus.view()).toBe('plan');
  });

  it('switches at once when asked, whatever the pin or the timer', () => {
    focus.touch(action());
    focus.pin();
    focus.show('plan');
    expect(focus.view()).toBe('plan');
  });

  it('clears a section\'s dot when it is shown', () => {
    focus.pin();
    focus.touch(action());
    focus.show('allergies');
    expect(focus.unseen()['allergies']).toBeUndefined();
  });

  it('goes back through the last eight views', () => {
    for (const view of ['allergies', 'history', 'plan'] as const) focus.show(view);
    expect(focus.back()).toBe(true);
    expect(focus.view()).toBe('history');
    expect(focus.back()).toBe(true);
    expect(focus.back()).toBe(true);
    expect(focus.view()).toBe('chart');
    expect(focus.back()).toBe(false);

    for (let i = 0; i < 12; i++) focus.show(i % 2 ? 'plan' : 'allergies');
    let steps = 0;
    while (focus.back()) steps++;
    expect(steps).toBe(8);
  });

  it('forgets everything when a consultation is let go', () => {
    focus.pin();
    focus.touch(action());
    focus.reset();
    expect([focus.view(), focus.pinned(), focus.lastAction(), focus.unseen()]).toEqual(['chart', false, null, {}]);
  });
});
