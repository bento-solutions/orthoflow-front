import { describe, expect, it } from 'vitest';
import {
  detectWake,
  FOLLOW_UP_WINDOW_MS,
  isSelfEvidentDictation,
  isStopPhrase,
  stripWakeWord,
  WAKE_WORD,
} from './voice-wake';

/**
 * The wake gate is what makes an always-open microphone acceptable in a room
 * containing a patient. Two failure modes matter, and they pull in opposite
 * directions: a false negative loses a dictated finding, and a false positive
 * acts on something the patient said. The tests below pin both edges.
 */
describe('voice-wake', () => {
  const NOW = 1_700_000_000_000;

  describe('stripWakeWord', () => {
    it('recognises the wake word and hands back the command', () => {
      expect(stripWakeWord(`${WAKE_WORD} dent 16, carie récurrente`))
        .toBe('dent 16, carie récurrente');
    });

    it('is case-insensitive and tolerates the comma dictation produces', () => {
      expect(stripWakeWord('calypso, dent 16')).toBe('dent 16');
      expect(stripWakeWord('CALYPSO dent 16')).toBe('dent 16');
    });

    it('rescues the spellings a recogniser actually returns', () => {
      expect(stripWakeWord('calipso dent 16')).toBe('dent 16');
      expect(stripWakeWord('kalypso dent 16')).toBe('dent 16');
    });

    it('rejoins the word when the recogniser splits it in two', () => {
      expect(stripWakeWord('caly pso dent 16')).toBe('dent 16');
    });

    it('returns null for an utterance that does not start with it', () => {
      expect(stripWakeWord('dent 16, carie récurrente')).toBeNull();
      expect(stripWakeWord("j'ai mal à la dent du fond")).toBeNull();
    });

    it('ignores the wake word mid-sentence', () => {
      // Far likelier to be a mishearing than the dentist addressing the
      // system, and accepting it would make many sentences into commands.
      expect(stripWakeWord('la dent calypso seize')).toBeNull();
    });

    it('treats a bare wake word as addressed, with an empty command', () => {
      expect(stripWakeWord(WAKE_WORD)).toBe('');
    });
  });

  describe('detectWake', () => {
    it('accepts an utterance carrying the wake word', () => {
      const result = detectWake(`${WAKE_WORD} dent 16, carie`, null, NOW);
      expect(result.addressed).toBe(true);
      expect(result.reason).toBe('wake-word');
      expect(result.command).toBe('dent 16, carie');
    });

    it('ignores patient speech when no window is open', () => {
      // The case the whole mechanism exists for: a plausible finding, said by
      // the wrong person.
      const result = detectWake("j'ai mal à la dent du fond", null, NOW);
      expect(result.addressed).toBe(false);
      expect(result.reason).toBe('not-addressed');
    });

    it('accepts a bare utterance inside the follow-up window', () => {
      const result = detectWake('dent 17, couronne à refaire', NOW - 5_000, NOW);
      expect(result.addressed).toBe(true);
      expect(result.reason).toBe('follow-up');
      expect(result.command).toBe('dent 17, couronne à refaire');
    });

    it('stops accepting bare utterances once the window has closed', () => {
      const result = detectWake('dent 17, couronne', NOW - FOLLOW_UP_WINDOW_MS - 1, NOW);
      expect(result.addressed).toBe(false);
    });

    it('accepts an utterance exactly at the window boundary', () => {
      const result = detectWake('dent 17', NOW - FOLLOW_UP_WINDOW_MS, NOW);
      expect(result.addressed).toBe(true);
    });

    it('treats an empty utterance as not addressed', () => {
      expect(detectWake('   ', NOW - 1_000, NOW).addressed).toBe(false);
    });
  });

  describe('isStopPhrase', () => {
    it('ends on a phrase naming the session, with or without the wake word', () => {
      // Deliberately asymmetric: a dentist whose wake word is being misheard
      // must still be able to stop, and stopping writes nothing.
      expect(isStopPhrase('end session')).toBe(true);
      expect(isStopPhrase(`${WAKE_WORD} end session`)).toBe(true);
    });

    it('recognises the French forms', () => {
      expect(isStopPhrase('termine la session')).toBe(true);
      expect(isStopPhrase("fin de l'examen")).toBe(true);
      expect(isStopPhrase('arrête la consultation')).toBe(true);
    });

    it('ignores a bare "stop" or "arrête" — what a patient says when it hurts', () => {
      expect(isStopPhrase('stop')).toBe(false);
      expect(isStopPhrase('arrête')).toBe(false);
      expect(isStopPhrase("c'est fini")).toBe(false);
    });

    it('does not stop on a sentence that merely contains the word', () => {
      // "Stop" inside a finding must not end the examination.
      expect(isStopPhrase('stop the bleeding on sixteen')).toBe(false);
      expect(isStopPhrase('il faut arrêter le traitement')).toBe(false);
    });
  });

  describe('isSelfEvidentDictation', () => {
    it('accepts dictation that opens with a tooth code or a finding', () => {
      expect(isSelfEvidentDictation('dent 16, carie récurrente occlusale')).toBe(true);
      expect(isSelfEvidentDictation('carie profonde sur la seize')).toBe(true);
      expect(isSelfEvidentDictation('16, couronne à remplacer')).toBe(true);
    });

    it('still needs the wake word for talk about a tooth', () => {
      expect(isSelfEvidentDictation('passe-moi le composite pour la seize')).toBe(false);
      expect(isSelfEvidentDictation("j'ai mal à la dent du fond")).toBe(false);
      expect(isSelfEvidentDictation('dent 16')).toBe(false);
    });
  });
});
