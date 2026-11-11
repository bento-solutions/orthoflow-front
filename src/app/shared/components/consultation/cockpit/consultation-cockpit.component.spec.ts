import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CockpitModelService } from '../../../../core/consultation/cockpit-model.service';
import { ConsultationFocusService } from '../../../../core/consultation/consultation-focus.service';
import { ConsultationService, TranscriptLine } from '../../../../core/consultation/consultation.service';
import { InputLanguageService } from '../../../../core/voice/input-language.service';
import { VoiceOrchestratorService } from '../../../../core/voice/voice-orchestrator.service';
import { VoicePreferencesService } from '../../../../core/voice/voice-preferences.service';
import { ConsultationCockpitComponent } from './consultation-cockpit.component';

/**
 * The cockpit's own rules. The layout itself — nothing scrolls, the stage, the
 * newest line and the last action are all in view — is measured in a browser
 * (docs/VOICE-COCKPIT-PLAN.md part V §4); this checks what the DOM must hold.
 */
describe('ConsultationCockpitComponent', () => {
  let fixture: ComponentFixture<ConsultationCockpitComponent>;
  let element: HTMLElement;
  let lines: ReturnType<typeof signal<TranscriptLine[]>>;
  let speaking: ReturnType<typeof signal<boolean>>;
  let pending: ReturnType<typeof signal<number>>;
  let undo: ReturnType<typeof signal<{ label: string } | null>>;
  let counts: ReturnType<typeof signal<Record<string, number>>>;
  let ended = 0;

  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    lines = signal<TranscriptLine[]>([]);
    speaking = signal(false);
    pending = signal(0);
    undo = signal<{ label: string } | null>(null);
    counts = signal<Record<string, number>>({ chart: 2, allergies: 3 });
    ended = 0;
    TestBed.configureTestingModule({
      imports: [ConsultationCockpitComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ConsultationService,
          useValue: {
            lines, listening: () => true, busy: () => false, consultation: () => ({ startedAt: new Date().toISOString() }),
            end: () => { ended++; }, resumeRecording: () => undefined, addTyped: () => 1,
          },
        },
        {
          provide: CockpitModelService,
          useValue: {
            patient: () => ({ firstName: 'Karim', lastName: 'Tazi' }),
            allergyBadges: () => [{ label: 'pénicilline', fromRecord: true }],
            counts: computed(() => counts()),
          },
        },
        {
          provide: VoiceOrchestratorService,
          useValue: {
            paused: () => false, inputLevel: () => 0.3, microphoneSuspended: () => false, error: () => null,
            transcriptionIssue: () => null, userSpeaking: speaking, pendingTranscriptions: pending,
            undoAvailable: undo, undoLast: () => undefined, handleTranscript: async () => undefined, resumeMicrophone: () => undefined,
            highlightedFdi: () => null,
          },
        },
        { provide: VoicePreferencesService, useValue: { level: () => 'full', cycle: () => 'brief', autoFollow: () => true } },
        { provide: InputLanguageService, useValue: { language: () => 'fr', set: () => undefined } },
      ],
    });
    fixture = TestBed.createComponent(ConsultationCockpitComponent);
    element = fixture.nativeElement;
    await render();
  });

  afterEach(() => fixture.destroy());

  it('has exactly one End control, and it ends the consultation', () => {
    const ends = element.querySelectorAll('[data-cockpit-end]');
    expect(ends.length).toBe(1);
    (ends[0] as HTMLButtonElement).click();
    expect(ended).toBe(1);
  });

  it('carries nothing that deletes, edits or prints', () => {
    const icons = [...element.querySelectorAll('.material-icons')].map(icon => icon.textContent?.trim());
    for (const forbidden of ['delete', 'edit', 'print']) expect(icons).not.toContain(forbidden);
    expect(element.textContent).not.toMatch(/COMMON\.DELETE|COMMON\.PRINT|COMMON\.EDIT/u);
  });

  it('shows each section with its count, and a dot on what is new', async () => {
    const chip = (view: string) => element.querySelector(`[data-view="${view}"]`)!;
    expect(chip('allergies').querySelector('.ck-count')?.textContent?.trim()).toBe('3');
    expect(chip('allergies').querySelector('.ck-new')).toBeNull();

    const focus = TestBed.inject(ConsultationFocusService);
    focus.pin();
    focus.touch({ kind: 'intake', title: 'Allergie : kiwi', detail: null, status: 'noted', heard: 'allergie au kiwi',
      target: { view: 'allergies' }, undoable: false, source: 'voice' });
    await render();
    expect(chip('allergies').querySelector('.ck-new')).not.toBeNull();
  });

  it('puts the last action on its card, with the words it came from and how to undo it', async () => {
    const focus = TestBed.inject(ConsultationFocusService);
    focus.touch({ kind: 'chart', title: 'Corrigé. Dent 45 : amalgame.', detail: null, status: 'noted',
      heard: 'Non, donc 45, c\'est pas couronne, amalgame.', target: { view: 'chart', fdi: '45' }, undoable: true, source: 'voice' });
    undo.set({ label: 'Undo' });
    await render();
    const card = element.querySelector('app-cockpit-last-action .ck-last')!;
    expect(card.getAttribute('role')).toBe('status');
    expect(card.textContent).toContain('Corrigé. Dent 45 : amalgame.');
    expect(card.textContent).toContain('Non, donc 45');
    expect(card.textContent).toContain('COCKPIT.SAY_UNDO');
  });

  it('shows a sentence that was not understood as such', async () => {
    TestBed.inject(ConsultationFocusService).touch({ kind: 'unsure', title: 'On dit zuite, carie occlusale.', detail: null,
      status: 'not-understood', heard: null, target: null, undoable: false, source: 'voice' });
    await render();
    expect(element.querySelector('app-cockpit-last-action .ck-last')?.getAttribute('data-kind')).toBe('unsure');
  });

  it('gives each line of the conversation its verdict, and says when it is listening', async () => {
    lines.set([
      { id: 1, text: 'Dent 13, carie.', at: Date.now(), typed: false, phase: 'EXAMINATION', verdict: 'acted', summary: 'Dent 13 : carie.' },
      { id: 2, text: 'Oui docteur.', at: Date.now(), typed: false, phase: 'EXAMINATION', verdict: 'heard', summary: null },
      { id: 3, text: 'dans 16', at: Date.now(), typed: false, phase: 'EXAMINATION', verdict: null, summary: null },
    ]);
    speaking.set(true);
    await render();
    const conversation = element.querySelector('app-cockpit-conversation')!;
    expect(conversation.querySelector('[data-line="1"] .ck-verdict')?.getAttribute('data-verdict')).toBe('acted');
    expect(conversation.querySelector('[data-line="1"]')?.textContent).toContain('Dent 13 : carie.');
    expect(conversation.querySelector('[data-line="2"] .ck-verdict')).toBeNull();
    expect(conversation.querySelector('[data-line="3"] .ck-verdict')?.getAttribute('data-verdict')).toBe('pending');
    expect(conversation.querySelector('[data-live="hearing"]')).not.toBeNull();
    speaking.set(false);
    pending.set(1);
    await render();
    expect(conversation.querySelector('[data-live="transcribing"]')).not.toBeNull();
  });

  it('keeps to the newest line, and offers "nouveau" once the doctor scrolled up', async () => {
    const scroller = element.querySelector('app-cockpit-conversation .ck-lines') as HTMLElement;
    let top = 0;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });

    lines.set([{ id: 1, text: 'un', at: Date.now(), typed: false, phase: 'EXAMINATION', verdict: 'heard', summary: null }]);
    await render();
    expect(top).toBe(1000);

    top = 100;
    scroller.dispatchEvent(new Event('scroll'));
    lines.update(all => [...all, { id: 2, text: 'deux', at: Date.now(), typed: false, phase: 'EXAMINATION', verdict: 'heard', summary: null }]);
    await render();
    expect(top).toBe(100);
    const pill = element.querySelector('app-cockpit-conversation .ck-newer') as HTMLButtonElement;
    expect(pill).not.toBeNull();
    pill.click();
    await render();
    expect(top).toBe(1000);
    expect(element.querySelector('app-cockpit-conversation .ck-newer')).toBeNull();
  });

  it('takes the page out of scrolling while it is up, and gives it back after', () => {
    expect(document.documentElement.classList.contains('cockpit-mode')).toBe(true);
    fixture.destroy();
    expect(document.documentElement.classList.contains('cockpit-mode')).toBe(false);
  });
});
