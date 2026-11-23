import '@angular/compiler';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationService, TranscriptLine } from '../../../core/consultation/consultation.service';
import { InputLanguageService } from '../../../core/voice/input-language.service';
import { VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { expectNoA11yViolations } from '../../../testing/axe';
import { ConsultationDrawerComponent } from './consultation-drawer.component';

/**
 * The drawer is the consultation's one set of controls: Start before, Pause and End during, the
 * analysis after. What each state must hold — and that nothing starts without the attestation.
 */
describe('ConsultationDrawerComponent', () => {
  let fixture: ComponentFixture<ConsultationDrawerComponent>;
  let element: HTMLElement;
  let intro: ReturnType<typeof signal<boolean>>;
  let phase: ReturnType<typeof signal<string | null>>;
  let listening: ReturnType<typeof signal<boolean>>;
  let deferred: ReturnType<typeof signal<boolean>>;
  let analysis: ReturnType<typeof signal<{ step: string; done: number; total: number } | null>>;
  let lines: ReturnType<typeof signal<TranscriptLine[]>>;
  let paused: ReturnType<typeof signal<boolean>>;
  let needsConsent: ReturnType<typeof signal<boolean>>;
  let c: Record<string, ReturnType<typeof vi.fn>>;
  let voice: Record<string, ReturnType<typeof vi.fn>>;

  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => element.querySelector(selector) as T | null;

  beforeEach(async () => {
    intro = signal(false);
    phase = signal<string | null>(null);
    listening = signal(true);
    deferred = signal(true);
    analysis = signal<{ step: string; done: number; total: number } | null>(null);
    lines = signal<TranscriptLine[]>([]);
    paused = signal(false);
    needsConsent = signal(false);
    c = {
      start: vi.fn(async () => true), closeIntro: vi.fn(() => intro.set(false)), chooseMode: vi.fn(), setIntroHidden: vi.fn(),
      end: vi.fn(), resumeRecording: vi.fn(),
    };
    voice = { setPaused: vi.fn((value: boolean) => paused.set(value)), grantMicrophoneConsent: vi.fn(), resumeMicrophone: vi.fn() };
    const isOpen = () => ['intake', 'examination', 'review'].includes(phase() ?? '');
    const isRecording = () => ['intake', 'examination'].includes(phase() ?? '');
    TestBed.configureTestingModule({
      imports: [ConsultationDrawerComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ConsultationService,
          useValue: {
            ...c, intro, isOpen, isRecording, analysis, lines, deferred,
            listening: () => isRecording() && listening(),
            starting: signal(false), busy: signal(false), chosenMode: signal('DEFERRED'),
            retainTranscript: signal(true), keepAudio: signal(true),
            consultation: () => (isRecording() ? { startedAt: new Date(Date.now() - 65_000).toISOString() } : null),
          },
        },
        {
          provide: VoiceOrchestratorService,
          useValue: {
            ...voice, paused, needsConsent, inputLevel: () => 0.4, microphoneSuspended: () => false,
            error: () => null, transcriptionIssue: () => null,
          },
        },
        { provide: InputLanguageService, useValue: { language: () => 'fr', set: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(ConsultationDrawerComponent);
    element = fixture.nativeElement;
    document.body.appendChild(element);
    await render();
  });

  afterEach(() => {
    fixture.destroy();
    document.body.innerHTML = '';
  });

  it('shows nothing until the doctor asks for a consultation', () => {
    expect(q('[data-drawer]')).toBeNull();
  });

  it('holds only the mode, the language, the attestation, Start and close before the start', async () => {
    intro.set(true);
    await render();
    expect(q('[data-drawer]')?.getAttribute('data-drawer')).toBe('ready');
    for (const part of ['[data-drawer-mode]', '[data-drawer-language]', '[data-drawer-informed]', '[data-drawer-start]', '[data-drawer-close]']) {
      expect(q(part)).not.toBeNull();
    }
    // The explanations are behind the ⓘ, not on screen.
    expect(element.textContent).not.toContain('CONSULTATION.INTRO_NOTICE');
    q('[data-drawer-info]')!.click();
    await render();
    expect(element.textContent).toContain('CONSULTATION.INTRO_NOTICE');
    expect(element.textContent).toContain('CONSULTATION.INTRO_NOTICE_AUDIO');
  });

  it('does not start before the patient is said to be informed, then starts from the tap itself', async () => {
    intro.set(true);
    needsConsent.set(true);
    await render();
    const start = q<HTMLButtonElement>('[data-drawer-start]')!;
    expect(start.disabled).toBe(true);
    start.click();
    expect(c['start']).not.toHaveBeenCalled();

    q<HTMLInputElement>('[data-drawer-informed]')!.click();
    await render();
    expect(start.disabled).toBe(false);
    start.click();
    // Synchronously, inside the click: iOS opens the microphone only in the gesture.
    expect(voice['grantMicrophoneConsent']).toHaveBeenCalled();
    expect(c['start']).toHaveBeenCalledTimes(1);
    expect(c['setIntroHidden']).not.toHaveBeenCalled();
  });

  it('remembers "don\'t ask again" only when the recording starts', async () => {
    intro.set(true);
    await render();
    q('[data-drawer-info]')!.click();
    await render();
    q<HTMLInputElement>('[data-drawer-hide]')!.click();
    expect(c['setIntroHidden']).not.toHaveBeenCalled();
    q<HTMLInputElement>('[data-drawer-informed]')!.click();
    await render();
    q('[data-drawer-start]')!.click();
    expect(c['setIntroHidden']).toHaveBeenCalledWith(true);
  });

  it('passes the mode on, and closes without starting', async () => {
    intro.set(true);
    await render();
    const select = q<HTMLSelectElement>('[data-drawer-mode]')!;
    select.value = 'LIVE';
    select.dispatchEvent(new Event('change'));
    expect(c['chooseMode']).toHaveBeenCalledWith('LIVE');
    q('[data-drawer-close]')!.click();
    await render();
    expect(c['start']).not.toHaveBeenCalled();
    expect(q('[data-drawer]')).toBeNull();
  });

  it('blanks the attestation each time it opens', async () => {
    intro.set(true);
    await render();
    q<HTMLInputElement>('[data-drawer-informed]')!.click();
    await render();
    intro.set(false);
    await render();
    intro.set(true);
    await render();
    expect(q<HTMLInputElement>('[data-drawer-informed]')!.checked).toBe(false);
    expect(q<HTMLButtonElement>('[data-drawer-start]')!.disabled).toBe(true);
  });

  it('becomes the recording bar: timer, last sentence, Pause and one End', async () => {
    phase.set('intake');
    lines.set([{ id: 1, text: 'Dent 16, carie.', at: Date.now(), typed: false, phase: 'INTAKE', verdict: null, summary: null }]);
    await render();
    expect(q('[data-drawer]')?.getAttribute('data-drawer')).toBe('recording');
    expect(q('.cd-time')?.textContent).toMatch(/^1:0\d$/);
    expect(q('[data-drawer-heard]')?.textContent).toContain('Dent 16, carie.');
    expect(element.querySelectorAll('[data-drawer-end]').length).toBe(1);
    expect(q('[data-drawer-end]')?.textContent).toContain('CONSULTATION.END_DEFERRED');

    q('[data-drawer-pause]')!.click();
    expect(voice['setPaused']).toHaveBeenCalledWith(true);
    await render();
    expect(element.textContent).toContain('COCKPIT.PAUSED');
    q('[data-drawer-pause]')!.click();
    expect(voice['setPaused']).toHaveBeenLastCalledWith(false);

    q('[data-drawer-end]')!.click();
    expect(c['end']).toHaveBeenCalledTimes(1);
  });

  it('puts a closed microphone in place of the sentence, with Resume', async () => {
    phase.set('examination');
    listening.set(false);
    await render();
    expect(element.textContent).toContain('CONSULTATION.MIC_OFF');
    expect(q<HTMLButtonElement>('[data-drawer-pause]')!.disabled).toBe(true);
    q('[data-drawer-resume]')!.click();
    expect(c['resumeRecording']).toHaveBeenCalledTimes(1);
  });

  it('shows the analysis, sentence by sentence, then leaves the screen to the review', async () => {
    phase.set('examination');
    analysis.set({ step: 'commands', done: 3, total: 12 });
    await render();
    const card = q('[data-analysis]')!;
    expect(card.getAttribute('data-step')).toBe('commands');
    expect((card.querySelector('progress') as HTMLProgressElement).value).toBe(3);
    expect(q('[data-drawer-end]')).toBeNull();

    analysis.set(null);
    phase.set('review');
    await render();
    expect(q('[data-drawer]')).toBeNull();
  });

  it('has no accessibility violations, before and during the recording', async () => {
    intro.set(true);
    await render();
    await expectNoA11yViolations(element);
    intro.set(false);
    phase.set('intake');
    await render();
    await expectNoA11yViolations(element);
  });
});
