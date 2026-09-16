import { foldAccents, similarity } from './voice-fuzzy';
import { Dentition, resolveTooth } from './tooth-lexicon';
import { extractFindings } from './clinical-lexicon';

/**
 * The wake word, and the window it opens.
 *
 * ── Why there is a wake word at all ─────────────────────────────────────
 *
 * Dictation has to be hands-free — a dentist with both hands in a patient's
 * mouth cannot press a key between findings — which means the microphone is
 * open for the whole examination. And a consultation room microphone hears
 * the patient. "J'ai mal à la dent du fond" is a perfectly plausible finding
 * and an utterly implausible command, and nothing in the grammar can tell the
 * difference, because grammatically there isn't one. The wake word is what
 * separates speech addressed to the system from speech addressed to the
 * patient.
 *
 * ── Why "Calypso" ───────────────────────────────────────────────────────
 *
 * It has to be a word the recogniser transcribes the same way every time and
 * that nobody says by accident in a dental surgery. Those pull in opposite
 * directions: a coined brand name has no accidental uses but gets mangled
 * ("Novalis" comes back as "nos alliés"), while a common word transcribes
 * perfectly and triggers constantly.
 *
 * Calypso threads it. Three syllables with a hard plosive onset, spelled
 * identically in French and English — the app is not Morocco-only — and
 * common enough in training data (the myth, the music, Cousteau's ship) that
 * every recogniser has seen it, while being a word no one utters mid-
 * examination. Anything built on "ortho" was ruled out immediately:
 * "orthodontie" and "orthèse" are said constantly here.
 *
 * ── Why a follow-up window ──────────────────────────────────────────────
 *
 * Requiring the word on every utterance would mean "Calypso, dent 16, carie
 * récurrente. Calypso, dent 17, couronne à refaire." through a run of teeth —
 * which is exactly the friction hands-free operation exists to remove. So the
 * wake word opens a floor: for {@link FOLLOW_UP_WINDOW_MS} afterwards,
 * utterances need no prefix, and each accepted command resets the clock. A
 * run of findings flows naturally; the microphone still stops acting on the
 * room the moment the dentist stops dictating.
 */

export const WAKE_WORD = 'Calypso';

/** How long after an accepted command a bare utterance is still a command. */
export const FOLLOW_UP_WINDOW_MS = 15_000;

/**
 * How closely a first word must resemble the wake word.
 *
 * Jaro-Winkler, same measure the clinical matcher uses. The enumerated
 * variants below carry most of the recall, so this only has to catch
 * renderings nobody anticipated — which means it can afford to be strict. A
 * false positive here is not a mistyped finding; it is the system acting on
 * something the patient said.
 */
const WAKE_SIMILARITY_FLOOR = 0.90;

const WAKE_FOLDED = foldAccents(WAKE_WORD);

/**
 * Recognisers segment an unfamiliar proper noun inconsistently, and these are
 * what Gemini and the Web Speech API actually return for "Calypso" in French
 * and English audio. Matching them exactly is cheaper and more reliable than
 * relying on edit distance alone to rescue a two-token rendering.
 */
const WAKE_VARIANTS = new Set([
  'calypso', 'calipso', 'kalypso', 'kalipso', 'callypso', 'calypseau',
  'caly pso', 'cali pso', 'calypso,', 'calypsos',
]);

export interface WakeResult {
  /** True when this utterance is addressed to the system. */
  addressed: boolean;
  /** The utterance with the wake word stripped, ready for the grammar. */
  command: string;
  /** How the utterance qualified — for the HUD, and for explaining itself. */
  reason: 'wake-word' | 'follow-up' | 'not-addressed';
}

/**
 * Decides whether an utterance is a command, and strips the wake word if so.
 *
 * @param transcript      one final utterance
 * @param lastAcceptedAt  epoch ms of the last accepted command, or null
 * @param now             injectable for tests
 */
export function detectWake(
  transcript: string,
  lastAcceptedAt: number | null,
  now: number = Date.now(),
): WakeResult {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { addressed: false, command: '', reason: 'not-addressed' };
  }

  const stripped = stripWakeWord(trimmed);
  if (stripped !== null) {
    // A bare "Calypso" with nothing after it is the dentist opening the floor
    // before they have decided what to say. That is addressed to the system
    // even though it carries no command.
    return { addressed: true, command: stripped, reason: 'wake-word' };
  }

  if (lastAcceptedAt !== null && now - lastAcceptedAt <= FOLLOW_UP_WINDOW_MS) {
    return { addressed: true, command: trimmed, reason: 'follow-up' };
  }

  return { addressed: false, command: trimmed, reason: 'not-addressed' };
}

/**
 * Returns the utterance minus its leading wake word, or null if it does not
 * start with one.
 *
 * Only the leading position is considered. "Calypso" said mid-sentence is far
 * more likely to be the recogniser mishearing something than the dentist
 * addressing the system, and accepting it there would make every sentence
 * containing a similar-sounding word a potential command.
 */
export function stripWakeWord(transcript: string): string | null {
  const tokens = transcript.trim().split(/\s+/);
  if (tokens.length === 0) return null;

  const first = foldAccents(tokens[0]).replace(/[^a-z]/g, '');
  if (!first) return null;

  const isWake = WAKE_VARIANTS.has(first)
    || first === WAKE_FOLDED
    || (isPlausibleLength(first) && similarity(first, WAKE_FOLDED) >= WAKE_SIMILARITY_FLOOR);

  if (!isWake) {
    // "Caly pso" — two tokens where the recogniser split the word.
    if (tokens.length >= 2) {
      const joined = foldAccents(tokens[0] + tokens[1]).replace(/[^a-z]/g, '');
      if (WAKE_VARIANTS.has(joined)
          || (isPlausibleLength(joined) && similarity(joined, WAKE_FOLDED) >= WAKE_SIMILARITY_FLOOR)) {
        return stripLeadingPunctuation(tokens.slice(2).join(' '));
      }
    }
    return null;
  }

  return stripLeadingPunctuation(tokens.slice(1).join(' '));
}

/**
 * Guards the similarity check against the Winkler prefix bonus.
 *
 * Jaro-Winkler rewards a shared prefix, so "caly" — the first half of a
 * recogniser's split rendering — scores high against "calypso" on its own.
 * Accepting it would strip only "caly" and hand "pso dent 16" to the grammar,
 * turning a valid command into gibberish. Requiring a comparable length forces
 * that case down to the two-token path, which rejoins the halves properly.
 */
function isPlausibleLength(candidate: string): boolean {
  return Math.abs(candidate.length - WAKE_FOLDED.length) <= 2;
}

/** "Calypso, dent 16" leaves a comma the grammar would rather not see. */
function stripLeadingPunctuation(text: string): string {
  return text.replace(/^[\s,.;:—–-]+/u, '').trim();
}

/**
 * Phrases that end the session, recognised without the wake word.
 *
 * The asymmetry is deliberate. Requiring "Calypso, fin de l'examen" means a
 * dentist whose wake word is being misheard — a noisy room, a cold — cannot
 * stop by voice at all, and their hands are occupied. Ending a session writes
 * nothing: everything dictated is already in the buffer and the audit trail.
 *
 * What is *not* here any more is a bare "stop", "arrête" or "fini". Those are
 * exactly what a patient in the chair says when something hurts, and a
 * session that ended on the patient's word dropped the dentist into review
 * mid-examination. The phrase has to name what is ending.
 */
const STOP_PHRASES = [
  /^(?:end|stop|finish|close)\s+(?:the\s+)?(?:session|examination|exam|consultation|dictation)\b/iu,
  /^(?:termine[rz]?|arr[êe]te[rz]?|finis|fin)\s+(?:de\s+)?(?:la\s+|le\s+|l['’]\s*|l\s+)?(?:session|consultation|examen|dict[ée]e)(?![\p{L}\p{N}])/iu,
];

/** A dictated finding is a short sentence; a conversation is not. */
const DICTATION_MAX_WORDS = 16;

/**
 * Dictation that is unmistakably dictation, accepted without the wake word.
 *
 * "Dent 16, carie récurrente occlusale" names a tooth by its code and a
 * finding from the lexicon, and opens with one of them. Patients do not speak
 * in FDI numbers, and requiring "Calypso" in front of every one of these was
 * the main reason commands were missed: the wake word is the first thing a
 * recogniser clips. Every such command is still read back aloud, staged
 * rather than written, and reviewed before it reaches the record.
 *
 * The opening requirement is what keeps it from firing on talk *about* a
 * tooth: "passe-moi le composite pour la seize" contains a finding word and a
 * tooth, but opens with neither, and still needs the wake word.
 */
export function isSelfEvidentDictation(transcript: string, dentition: Dentition = 'adult'): boolean {
  const text = transcript.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > DICTATION_MAX_WORDS) return false;
  if (resolveTooth(text, dentition).kind !== 'resolved') return false;

  const findings = extractFindings(text);
  if (findings.length === 0) return false;

  if (resolveTooth(words.slice(0, 4).join(' '), dentition).kind === 'resolved') return true;
  const firstFinding = text.toLowerCase().indexOf(findings[0].matchedText.toLowerCase());
  return firstFinding >= 0 && firstFinding <= 1;
}

export function isStopPhrase(transcript: string): boolean {
  // The wake word is optional on a stop, so try both forms.
  const bare = transcript.trim();
  const stripped = stripWakeWord(bare);
  const candidates = stripped === null ? [bare] : [bare, stripped];
  return candidates.some(text => STOP_PHRASES.some(pattern => pattern.test(text.trim())));
}
