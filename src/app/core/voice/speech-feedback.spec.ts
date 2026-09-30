import { describe, expect, it } from 'vitest';
import { pickVoice, VoiceLike } from './speech-feedback.service';

/**
 * A French confirmation read by an English voice is not a confirmation the
 * dentist can rely on — "seize" and "treize" are exactly what gets lost.
 */
const voice = (name: string, lang: string, isDefault = false): VoiceLike =>
  ({ name, lang, localService: true, default: isDefault });

describe('pickVoice', () => {
  const voices = [
    voice('Samantha', 'en-US', true),
    voice('Thomas', 'fr-FR'),
    voice('Google français', 'fr-FR'),
    voice('Amélie', 'fr-CA'),
    voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'),
  ];

  it('never leaves a French phrase to the default English voice', () => {
    expect(pickVoice(voices, 'fr-FR')?.lang).toBe('fr-FR');
  });

  it('prefers the natural and network voices over the robotic ones', () => {
    expect(pickVoice(voices, 'fr-FR')?.name).toContain('Natural');
    expect(pickVoice(voices.filter(v => !v.name.includes('Natural')), 'fr-FR')?.name).toBe('Google français');
  });

  it('falls back to the same language in another region', () => {
    expect(pickVoice([voice('Amélie', 'fr-CA'), voice('Samantha', 'en-US')], 'fr-FR')?.name).toBe('Amélie');
    expect(pickVoice([voice('Amélie', 'fr_CA')], 'fr-MA')?.name).toBe('Amélie');
  });

  it('returns null when there is no voice for the language, leaving it to the browser', () => {
    expect(pickVoice([voice('Samantha', 'en-US')], 'fr-FR')).toBeNull();
    expect(pickVoice([], 'fr-FR')).toBeNull();
  });
});
