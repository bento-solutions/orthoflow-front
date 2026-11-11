import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../services/auth.service';
import { UserPreferencesService } from '../services/user-preferences.service';
import { DEFAULT_VOICE_PREFERENCES, VoicePreferencesService, readStoredVoicePreferences, sanitizeVoicePreferences } from './voice-preferences.service';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe('voice preferences in this browser', () => {
  it('starts at the full read-back, with alarms and following on', () => {
    expect(readStoredVoicePreferences(new MemoryStorage())).toEqual(DEFAULT_VOICE_PREFERENCES);
    expect(DEFAULT_VOICE_PREFERENCES.feedback).toBe('full');
  });

  it('migrates the old on/off switch once: off is silent', () => {
    const storage = new MemoryStorage();
    storage.setItem('orthoflow_voice_audio', 'off');
    expect(readStoredVoicePreferences(storage).feedback).toBe('silent');
    expect(storage.getItem('orthoflow_voice_audio')).toBeNull();
    expect(JSON.parse(storage.getItem('orthoflow_voice_prefs')!).feedback).toBe('silent');
  });

  it('migrates "on" to the full read-back', () => {
    const storage = new MemoryStorage();
    storage.setItem('orthoflow_voice_audio', 'on');
    expect(readStoredVoicePreferences(storage).feedback).toBe('full');
  });

  it('survives a reload', () => {
    const storage = new MemoryStorage();
    storage.setItem('orthoflow_voice_prefs', JSON.stringify({ feedback: 'tones', autoFollow: false, speechRate: 1.2 }));
    const read = readStoredVoicePreferences(storage);
    expect(read).toMatchObject({ feedback: 'tones', autoFollow: false, speechRate: 1.2, criticalAlerts: true });
  });

  it('refuses what it does not know and keeps the rate in range', () => {
    expect(sanitizeVoicePreferences({ feedback: 'loud', speechRate: 9 })).toMatchObject({ feedback: 'full', speechRate: 1.3 });
  });
});

describe('VoicePreferencesService — the account copy', () => {
  let saved: Record<string, unknown>;
  let token: ReturnType<typeof signal<string | null>>;

  beforeEach(() => {
    try { localStorage.removeItem('orthoflow_voice_prefs'); } catch { /* none */ }
    saved = {};
    token = signal<string | null>('t');
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token } },
        {
          provide: UserPreferencesService,
          useValue: {
            get: async () => saved,
            patch: async (partial: Record<string, unknown>) => { saved = { ...saved, ...partial }; return saved; },
          },
        },
      ],
    });
  });

  it('keeps a change on the server, and another browser adopts it at sign-in', async () => {
    const first = TestBed.inject(VoicePreferencesService);
    first.set({ feedback: 'brief' });
    await Promise.resolve();
    expect((saved['voice'] as { feedback: string }).feedback).toBe('brief');

    // Another device: nothing in its storage, the server copy is adopted.
    localStorage.removeItem('orthoflow_voice_prefs');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token: signal('t2') } },
        { provide: UserPreferencesService, useValue: { get: async () => saved, patch: async () => saved } },
      ],
    });
    const second = TestBed.inject(VoicePreferencesService);
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.level()).toBe('brief');
  });

  it('lets a level said for the consultation win, until the doctor picks one', () => {
    const prefs = TestBed.inject(VoicePreferencesService);
    prefs.setSessionLevel('silent');
    expect(prefs.level()).toBe('silent');
    expect(prefs.speaks()).toBe(false);
    prefs.set({ feedback: 'tones' });
    expect(prefs.level()).toBe('tones');
  });

  it('cycles from the control bar: full, brief, tones, silent, full', () => {
    const prefs = TestBed.inject(VoicePreferencesService);
    prefs.set({ feedback: 'full' });
    expect([prefs.cycle(), prefs.cycle(), prefs.cycle(), prefs.cycle()]).toEqual(['brief', 'tones', 'silent', 'full']);
  });
});
