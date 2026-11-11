import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { hasExplicitClass, intentClass } from './intent-class';
import { VoiceCommandsService } from './register-voice-commands';
import { VoiceCommandRegistryService } from './voice-command-registry.service';
import { voicePipelineProviders } from './testing/consultation-replay.testing';
import { FakeAudioCapture, FakeAuth, FakeSpeechFeedback, FakeVoiceApi, FakeVoiceSession } from './testing/voice-fakes.testing';

/**
 * The class decides how a command may be reached — free, in the follow-up
 * window, or only after the wake word. A command added without one would fall
 * to the strictest default silently; this makes it loud.
 */
describe('intentClass', () => {
  it('gives every registered command a class of its own', () => {
    TestBed.configureTestingModule({
      providers: voicePipelineProviders({
        api: new FakeVoiceApi(), feedback: new FakeSpeechFeedback(), capture: new FakeAudioCapture(),
        auth: new FakeAuth(), session: new FakeVoiceSession(),
      }),
    });
    TestBed.inject(VoiceCommandsService).registerAll();
    const ids = [...TestBed.inject(VoiceCommandRegistryService).commands().keys()];
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter(id => !hasExplicitClass(id))).toEqual([]);
  });

  it('treats an unknown command as intake, the strictest', () => {
    expect(intentClass('something.new')).toBe('intake');
  });

  it('keeps every free-text write behind the wake word', () => {
    for (const id of ['clinical.addAllergy', 'clinical.addMedicalHistory', 'clinical.addNote', 'tasks.create', 'schedule.followUp']) {
      expect(['intake', 'task']).toContain(intentClass(id));
    }
  });
});
