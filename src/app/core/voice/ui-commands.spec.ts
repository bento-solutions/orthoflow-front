import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConsultationFocusService } from '../consultation/consultation-focus.service';
import { ConsultationService } from '../consultation/consultation.service';
import { CockpitModelService } from '../consultation/cockpit-model.service';
import { emptyReview } from '../consultation/consultation-draft';
import { Dental3dViewService } from '../services/dental-3d-view.service';
import { VoiceCommandsService } from './register-voice-commands';
import { VoiceCommandRegistryService } from './voice-command-registry.service';
import { VoicePreferencesService } from './voice-preferences.service';
import { voicePipelineProviders } from './testing/consultation-replay.testing';
import { FakeAudioCapture, FakeAuth, FakeSpeechFeedback, FakeVoiceApi, FakeVoiceSession } from './testing/voice-fakes.testing';

/** The view and camera commands against a cockpit and a 3D view service. */
describe('view and camera commands', () => {
  let recording = true;
  const allergies = [{ key: 'a', label: 'ananas', detail: null, status: 'proposed', quote: null },
    { key: 'b', label: 'pénicilline', detail: null, status: 'proposed', quote: null }];
  const model = {
    allergiesOnRecord: () => [{ key: 'r', label: 'kiwi', detail: null, status: null, quote: null }], allergiesNow: () => allergies,
    historyOnRecord: () => [], historyNow: () => [], treatmentsOnRecord: () => [], treatmentsNow: () => [],
    planNow: () => [{ key: 'p', label: 'Détartrage', teeth: null, price: 300, quantity: 1, status: 'dictated', quote: null }],
    planSummary: () => ({ total: 300, complete: true }), appointment: () => null, appointmentSuggestion: () => null,
    patientFields: () => [], complaint: () => null, chartLines: () => [], noteLines: () => [],
  };
  const run = (id: string, entities: Record<string, unknown> = {}) => {
    const registry = TestBed.inject(VoiceCommandRegistryService);
    return registry.get(id)!.execute!(entities, { patientId: 'p-1' } as never);
  };

  beforeEach(() => {
    recording = true;
    TestBed.configureTestingModule({
      providers: [
        ...voicePipelineProviders({ api: new FakeVoiceApi(), feedback: new FakeSpeechFeedback(), capture: new FakeAudioCapture(), auth: new FakeAuth(), session: new FakeVoiceSession() }),
        { provide: ConsultationService, useValue: { isRecording: () => recording, cockpitEnabled: () => true, review: () => emptyReview() } },
        { provide: CockpitModelService, useValue: model },
      ],
    });
    TestBed.inject(VoiceCommandsService).registerAll();
  });

  it('puts a section on the stage and says what is in it', async () => {
    const result = await run('ui.show', { target: 'allergies' });
    expect(TestBed.inject(ConsultationFocusService).view()).toBe('allergies');
    expect(result.spokenFr).toBe('3 allergies : kiwi, ananas, pénicilline.');
    expect(result.briefFr).toBe('Allergies.');
  });

  it('says the plan in one line', async () => {
    expect((await run('ui.show', { target: 'plan' })).spokenFr).toBe('Plan : 1 acte, 300 dirhams.');
  });

  it('outside a consultation, reads what it cannot show', async () => {
    recording = false;
    const result = await run('ui.show', { target: 'allergies' });
    expect(TestBed.inject(ConsultationFocusService).view()).toBe('chart');
    expect(result.spokenFr).toBe('3 allergies : kiwi, ananas, pénicilline.');
    expect((await run('ui.show', { target: 'chart' })).spokenFr).toBe('Le schéma est à l\'écran.');
    expect((await run('ui.back')).spokenFr).toBe('Disponible pendant une consultation.');
  });

  it('goes back, pins and unpins', async () => {
    await run('ui.show', { target: 'plan' });
    expect((await run('ui.back')).ok).toBe(true);
    expect(TestBed.inject(ConsultationFocusService).view()).toBe('chart');
    await run('ui.pin');
    expect(TestBed.inject(ConsultationFocusService).pinned()).toBe(true);
    await run('ui.unpin');
    expect(TestBed.inject(ConsultationFocusService).pinned()).toBe(false);
  });

  it('shows the chart before moving its camera, and asks the camera once', async () => {
    const focus = TestBed.inject(ConsultationFocusService);
    const view = TestBed.inject(Dental3dViewService);
    focus.show('allergies');
    await run('chart.zoom', { direction: 'in', steps: 2 });
    expect(focus.view()).toBe('chart');
    const request = view.pending()!;
    expect(request).toMatchObject({ kind: 'zoom' });
    expect((request as { factor: number }).factor).toBeCloseTo(0.64);
    view.consumed(request.id);
    expect(view.pending()).toBeNull();
  });

  it('answers "zoom maximum" at the closest, and leaves a close-up at the furthest', async () => {
    const view = TestBed.inject(Dental3dViewService);
    view.atLimit.set('near');
    expect((await run('chart.zoom', { direction: 'in' })).spokenFr).toBe('Zoom maximum.');
    view.zoomedFdi.set('16');
    view.atLimit.set('far');
    expect((await run('chart.zoom', { direction: 'out' })).spokenFr).toBe('Toute la bouche.');
    expect(view.zoomedFdi()).toBeNull();
  });

  it('walks the arch tooth by tooth', async () => {
    const view = TestBed.inject(Dental3dViewService);
    view.zoomedFdi.set('11');
    await run('chart.step', { delta: 1 });
    expect(view.zoomedFdi()).toBe('21');
    await run('chart.step', { delta: -1 });
    await run('chart.step', { delta: -1 });
    expect(view.zoomedFdi()).toBe('12');
  });

  it('turns, and resets to the whole mouth', async () => {
    const view = TestBed.inject(Dental3dViewService);
    await run('chart.rotate', { direction: 'flip' });
    expect(view.pending()).toMatchObject({ kind: 'rotate', azimuth: Math.PI });
    view.zoomedFdi.set('16');
    await run('chart.reset');
    expect(view.zoomedFdi()).toBeNull();
    expect(view.pending()).toMatchObject({ kind: 'reset' });
  });

  it('sets the feedback level for this consultation, and says nothing when asked for silence', async () => {
    const prefs = TestBed.inject(VoicePreferencesService);
    const silent = await run('feedback.set', { level: 'silent' });
    expect(silent.quiet).toBe(true);
    expect(prefs.level()).toBe('silent');
    expect((await run('feedback.set', { level: 'brief' })).spokenFr).toBe('Confirmations brèves.');
  });

  it('shows the help on the stage', async () => {
    await run('help.show');
    expect(TestBed.inject(ConsultationFocusService).view()).toBe('help');
  });
});
