import { foldAccents } from '../voice/voice-fuzzy';
import { stripWakeWord } from '../voice/voice-wake';

/**
 * The words that move a consultation from the conversation to the examination.
 *
 * ── Why this is stricter than it looks ──────────────────────────────────
 *
 * During the conversation the microphone is open to *everything* said in the
 * room, and "consultation" is a word a doctor and a patient say all the time
 * ("après la consultation…", "la dernière consultation"). Acting on the word
 * would start the examination — and with it the chart commands — at a random
 * moment. So the phrase has to be a whole utterance that is plainly an order to
 * begin, or the bare word *after the wake word*, which is the one place it
 * cannot be small talk.
 *
 * Ending is not here: {@code isStopPhrase} already covers "fin de la
 * consultation" in French and English, with or without the wake word.
 */

/** Said on its own — an order to begin, in French and English. */
const BEGIN_PHRASES: RegExp[] = [
  /^(?:on\s+)?(?:commence|commencons|commencez|demarre|demarrons|demarrez|lance|lancons|ouvre|ouvrons)\s+(?:la\s+|l\s*['’]\s*|cette\s+)?(?:consultation|examen)$/u,
  /^debut\s+(?:de\s+)?(?:la\s+|l\s*['’]\s*)?(?:consultation|examen)$/u,
  /^(?:passons|on\s+passe|passe|passez)\s+a\s+(?:la\s+|l\s*['’]\s*)?(?:consultation|examen)$/u,
  /^(?:la\s+)?consultation\s+(?:commence|demarre|debute)$/u,
  /^(?:let\s*['’]?s\s+)?(?:start|begin)\s+(?:the\s+)?(?:consultation|examination|exam)$/u,
  /^(?:the\s+)?(?:consultation|examination|exam)\s+(?:starts|begins)$/u,
  // Darija / Arabic: "let's start the examination / consultation".
  /^(?:نبدا|نبداو|نبدأ|نبدأو|ابدا|ابدأ|بدا|لنبدأ)\s+(?:ب)?(?:ال)?(?:فحص|كونسلطاسيون|استشارة|معاينة)$/u,
];

/** Said after the wake word, where the bare word cannot be small talk. */
const BARE_AFTER_WAKE: RegExp[] = [
  /^(?:la\s+)?(?:consultation|examen)$/u,
  /^(?:the\s+)?(?:consultation|examination|exam)$/u,
  /^(?:فحص|الفحص|استشارة|الاستشارة|كونسلطاسيون)$/u,
];

/** Lower case, accents folded, punctuation and surrounding space gone. */
function plain(utterance: string): string {
  return foldAccents(utterance)
    .replace(/[,.;:!?¿¡"«»()]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Whether the doctor has called the consultation — the order to start the examination. */
export function isBeginExaminationPhrase(utterance: string): boolean {
  const raw = utterance.trim();
  if (!raw) return false;

  const afterWake = stripWakeWord(raw);
  const body = plain(afterWake ?? raw);
  if (!body) return false;

  if (BEGIN_PHRASES.some(pattern => pattern.test(body))) return true;
  return afterWake !== null && BARE_AFTER_WAKE.some(pattern => pattern.test(body));
}
