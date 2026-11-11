import { foldAccents, repairClinicalTerms, similarity } from './voice-fuzzy';
import { Dentition, findToothMentions, normalizeUtterance, resolveTooth } from './tooth-lexicon';
import { SYMPTOM_CODES, extractFindings } from './clinical-lexicon';

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

  const stripped = stripWakeWord(trimmed) ?? stripWakeWord(wakeSentence(trimmed) ?? '');
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
 * The clip from the first sentence after the first one that opens with the wake
 * word, or null. A recogniser hands back a clip, not a sentence: "On peut
 * commencer le Calypso schéma dentaire. Calypso schéma dentaire." is the doctor
 * trying once mid-sentence and then saying it properly, and the second sentence
 * is addressed to the system. A wake word in the middle of a sentence still
 * does not count.
 */
export function wakeSentence(transcript: string): string | null {
  const sentences = transcript.trim().split(/(?<=[.!?])\s+/u);
  for (let index = 1; index < sentences.length; index++) {
    if (stripWakeWord(sentences[index]) !== null) return sentences.slice(index).join(' ');
  }
  return null;
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
const FILLER = '(?:(?:et|alors|donc|bon|ben|ok|okay|euh|hum|puis|voil[àa]|and|so|well|then|now|uh|um|right)[\\s,]+)*';

/**
 * Matched on {@link normalizeUtterance}'s output (apostrophes and punctuation
 * gone). "Stop, fin de consultation", "on termine la consultation", "c'est
 * fini, fin de la séance": a few words in front are allowed, the phrase itself
 * still has to name what ends.
 */
const STOP_PHRASES = [
  new RegExp(`^${FILLER}(?:(?:stop|ok|bon|allez|merci|termin[ée]|c\\s+est\\s+(?:fini|bon|tout))[\\s,.;:!]+)*`
    + '(?:on\\s+)?(?:termine[rz]?|terminons|arr[êe]te[rz]?|arr[êe]tons|finis(?:sons)?|fin|cl[ôo]ture[rz]?)\\s+'
    + '(?:de\\s+)?(?:la\\s+|le\\s+|l\\s+|cette\\s+)?(?:session|consultation|examen|dict[ée]e|s[ée]ance)(?![\\p{L}\\p{N}])', 'iu'),
  /^(?:(?:stop|ok|right|thanks|done)[\s,.;:!]+)*(?:let\s+s\s+)?(?:end|stop|finish|close)\s+(?:the\s+)?(?:session|examination|exam|consultation|dictation)(?![\p{L}\p{N}])/iu,
];

/**
 * "Calypso, stop" — said to the system, a bare word that would end the
 * consultation. It is asked back ("Terminer la consultation ?") rather than
 * obeyed: ending cannot be undone without a tap, and "stop" is what a patient says.
 */
const BARE_STOP = /^(?:stop|termin[ée]|c\s+est\s+fini|on\s+arr[êe]te|arr[êe]te|fin|end|finish|done)$/iu;

export function isBareStop(command: string): boolean {
  return BARE_STOP.test(normalizeUtterance(command));
}

/**
 * Pausing and resuming by voice, both said after the wake word.
 *
 * Whole-phrase matches on purpose: a pause the dentist did not ask for
 * silences the dictation, and "la pause" or "continue à lui parler" is not a
 * request. Nothing here is a clinical word, so they cannot collide with a
 * dictated finding; and neither is "stop", which ends the examination.
 */
const PAUSE_PHRASES = [
  /^(?:(?:mets|mettez)[\s-]+(?:toi[\s-]+|vous[\s-]+)?en\s+)?pause(?:\s+(?:l['’]\s*)?(?:[ée]coute|dict[ée]e))?$/iu,
  /^(?:suspends|suspendez)\s+(?:l['’]\s*)?(?:[ée]coute|dict[ée]e)$/iu,
  /^(?:arr[êe]te|arr[êe]tez)\s+d['’]\s*[ée]couter$/iu,
  /^(?:pause|suspend|stop)\s+(?:listening|dictation)$/iu,
  /^(?:pause|hold\s+on)$/iu,
];

const RESUME_PHRASES = [
  /^(?:reprends|reprenez|reprenons|reprise|on\s+reprend|r[ée]veille[\s-]+toi|continue|continuez|continuons)(?:\s+(?:l['’]\s*)?(?:[ée]coute|dict[ée]e))?$/iu,
  /^(?:resume|continue|wake\s+up|go\s+on)(?:\s+(?:listening|dictation))?$/iu,
];

function matchesWhole(patterns: RegExp[], transcript: string): boolean {
  const text = transcript.trim().replace(/[\s,.;:!?]+$/u, '').replace(/^[\s,.;:!?]+/u, '');
  return patterns.some(pattern => pattern.test(text));
}

/** "Pause" — said to the system, after the wake word. */
export function isPausePhrase(transcript: string): boolean {
  return matchesWhole(PAUSE_PHRASES, transcript);
}

/** "Reprends" — the only thing a paused system listens for. */
export function isResumePhrase(transcript: string): boolean {
  return matchesWhole(RESUME_PHRASES, transcript);
}

/** A dictated finding is a short sentence; a conversation is not. */
const DICTATION_MAX_WORDS = 30;

/** In a sentence that long, the tooth and the finding still have to be close. */
const DICTATION_REACH_WORDS = 12;

/**
 * How a doctor opens a sentence that reports what they see before naming the
 * tooth: "sur la 16 je vois…", "je vois une carie sur la 16", "il y a…",
 * "I see caries on tooth 16", "there is…". Filler words in front of it
 * ("alors", "bon", "euh", "so") do not count against it.
 *
 * It is a whitelist on purpose. What it keeps out is what a patient or an
 * assistant says — "j'ai mal à la 16", "passe-moi le composite pour la seize",
 * "est-ce que ça fait mal sur la 16" — none of which opens like a finding being
 * reported.
 */
const REPORTING_LEAD = new RegExp(
  '^(?:(?:et|alors|donc|bon|ben|ok|okay|euh|hum|puis|voil[àa]|and|so|well|then|now|uh|um|right)[\\s,]+)*'
  + '(?:'
  + 'sur|pour|[àa]|au\\s+niveau\\s+d[eu]|concernant|pr[ée]sence\\s+d[eu]|on|at|for|regarding'
  + '|je\\s+(?:vois|note|constate|remarque|retrouve|observe|relève)'
  + '|on\\s+(?:voit|a|constate|note|retrouve|observe)|nous\\s+(?:voyons|avons|constatons)'
  + '|il\\s+y\\s+a|il\\s+existe|il\\s+(?:faut|faudra|faudrait)|j[\'’]\\s*observe'
  + '|i\\s+(?:see|note|can\\s+see|found|find|notice[ds]?|observe)|i[\'’]ve\\s+(?:found|noticed)'
  + '|we\\s+(?:see|have|found|got|need)|there\\s+(?:is|are|[\'’]s)'
  + ')(?![\\p{L}\\p{N}])',
  'iu',
);

/**
 * The doctor telling the patient what is in their mouth: "vous avez une carie
 * sur la 16", "il présente une fracture". Through these, only a finding the
 * doctor sees counts — never a symptom, which is what the patient says they
 * feel ("vous avez mal à la 16" stays conversation).
 */
const TELLING_LEAD = new RegExp(
  `^${FILLER}(?:vous\\s+avez|vous\\s+pr[ée]sentez|il\\s+a|elle\\s+a|il\\s+pr[ée]sente|elle\\s+pr[ée]sente|on\\s+retrouve`
  + '|you\\s+have|you[\'’]ve\\s+got|he\\s+has|she\\s+has)(?![\\p{L}\\p{N}])',
  'iu',
);

/** "Vous avez…" opens a question as often as a statement; on its own it is not one. */
const BARE_STATEMENT = /^(?:vous\s+avez|tu\s+as|you\s+have)(?![\p{L}\p{N}])/iu;

/** Words that may sit between a tooth and its finding in "dent 11 c'est une carie". */
const CORE_CONNECTOR = /^(?:c['’\s]?est|est|avec|une?|des)\s+/iu;

/** Words that make a sentence the patient's own: "la dent 16 me fait mal". */
const FIRST_PERSON = /(?:^|[\s,])(?:me|m['’]|j['’]|je|moi|mon|ma|mes|i|my|me)(?=[\s,]|$)/iu;

function wordIndex(text: string, offset: number): number {
  return text.slice(0, offset).split(/\s+/).filter(Boolean).length;
}

/**
 * "…dent 11 caries occlusales": a tooth word and its number followed at once
 * by a finding the doctor sees. That is dictation however the sentence opens —
 * "C'est le schéma dentaire, dent 11 caries occlusales" included.
 */
function hasDictationCore(text: string): boolean {
  for (const mention of findToothMentions(text)) {
    if (!mention.valid) continue;
    if (!/^(?:dents?|tooth|teeth)(?![\p{L}\p{N}])/iu.test(text.slice(mention.start))) continue;
    const rest = text.slice(mention.end).replace(/^[\s,:;.\-–—]*/u, '').replace(CORE_CONNECTOR, '');
    const [first] = extractFindings(rest);
    if (first && !first.negated && first.at <= 1 && !SYMPTOM_CODES.has(first.code)) return true;
  }
  return false;
}

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
 * Two ways in:
 *
 * - it **opens** with the tooth, or with the finding straight after it;
 * - it opens with a **reporting lead** ({@link REPORTING_LEAD}) — "sur la 16 je
 *   vois des caries", "je vois une carie sur la 16", "il y a une infection sur
 *   la 17" — and holds a tooth and a finding. Someone telling the patient what
 *   is in their mouth is telling the chart too.
 *
 * Neither lets in talk *about* a tooth: "passe-moi le composite pour la seize"
 * contains a finding word and a tooth, but opens with neither, and still needs
 * the wake word.
 */
export function isSelfEvidentDictation(transcript: string, dentition: Dentition = 'adult'): boolean {
  let text = transcript.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > DICTATION_MAX_WORDS) return false;
  // A question is never dictation. "Vous avez une carie sur la 16" opens like
  // one and is not: it is the doctor telling the patient, and the chart.
  if (/\?\s*$/u.test(text)) return false;
  if (opensWithQuestion(text) && !BARE_STATEMENT.test(text)) return false;
  if (resolveTooth(text, dentition).kind !== 'resolved' && !findToothMentions(text).some(mention => mention.valid)) return false;

  let findings = extractFindings(text);
  if (findings.length === 0) {
    // A tooth and a word that was nearly a finding — "la 16 carriée", "dent 17
    // infectione" — is still dictation: the recogniser misspelled it, the
    // doctor did not stop making it.
    const repaired = repairClinicalTerms(text);
    if (repaired.corrections.length === 0) return false;
    text = repaired.text;
    findings = extractFindings(text);
    if (findings.length === 0) return false;
  }

  // The tooth and the first finding are close: in a 30-word sentence a tooth
  // at one end and a finding word at the other are two different things.
  const mentions = findToothMentions(text).filter(mention => mention.valid);
  const findingAt = wordIndex(text, findings[0].at);
  if (mentions.length > 0
    && mentions.every(mention => Math.abs(wordIndex(text, mention.start) - findingAt) > DICTATION_REACH_WORDS)) {
    return false;
  }

  const seen = findings.filter(finding => !SYMPTOM_CODES.has(finding.code));
  // Only symptoms, in the patient's own words — "la dent 16 me fait mal" — is
  // the patient talking, however it opens.
  if (seen.length === 0 && FIRST_PERSON.test(text)) return false;

  if (resolveTooth(words.slice(0, 4).join(' '), dentition).kind === 'resolved') return true;
  const firstFinding = text.toLowerCase().indexOf(findings[0].matchedText.toLowerCase());
  if (firstFinding >= 0 && firstFinding <= 1) return true;

  if (REPORTING_LEAD.test(text)) return true;
  if (TELLING_LEAD.test(text) && seen.length > 0) return true;
  return hasDictationCore(text);
}

export function isStopPhrase(transcript: string): boolean {
  // The wake word is optional on a stop, so try both forms.
  const bare = transcript.trim();
  const stripped = stripWakeWord(bare) ?? stripWakeWord(wakeSentence(bare) ?? '');
  const candidates = stripped === null ? [bare] : [bare, stripped];
  return candidates.some(text => STOP_PHRASES.some(pattern => pattern.test(normalizeUtterance(text))));
}

// ── Speech heard during the follow-up window ────────────────────────────

/** How a question opens, in French and English — before any question mark a recogniser may or may not add. */
const QUESTION_LEAD = new RegExp(
  '^(?:est[- ]ce|qu[\'’]?(?:est|y|il|elle|on)|qui|quoi|pourquoi|comment|combien|quand|où'
  + '|avez[- ]vous|as[- ]tu|tu\\s+as|vous\\s+avez|pouvez[- ]vous'
  + '|do\\s+you|does|did|is\\s+(?:it|there)|are\\s+(?:you|there)|have\\s+you|can\\s+you'
  + '|what|why|how|when|where|who)(?![\\p{L}\\p{N}])',
  'iu',
);

/** Whether the sentence opens the way a question does — "does the 16 hurt", "vous avez mal ?". */
export function opensWithQuestion(utterance: string): boolean {
  return QUESTION_LEAD.test(utterance.trim());
}

/**
 * Whether an utterance is a question — to the patient or to the room — rather
 * than something to record. "Vous avez une infection ?" contains a finding word
 * and would otherwise stage one on the tooth last dictated.
 */
export function looksLikeQuestion(utterance: string): boolean {
  const text = utterance.trim();
  return /\?\s*$/u.test(text) || QUESTION_LEAD.test(text);
}

/** Words that may lead a further finding: "et une fracture", "plus, mobilité". */
const CONTINUATION_LEAD =
  /^(?:(?:et|puis|plus|aussi|and|also|then)[\s,]+(?:(?:une?|la|le|the|a|an)\s+)?)?/iu;

/** A finding statement, not a sentence that mentions one, is short. */
const FOLLOW_UP_MAX_WORDS = 8;

/**
 * A finding said by itself — "carie profonde", "et une fracture" — as opposed
 * to a sentence that happens to contain one. It has to open with the finding
 * (or "et …" / "plus …" leading into it), be short, be affirmed, and not be a
 * question.
 *
 * "Oui docteur c'est douloureux", "c'est sensible au froid" and "il faudra une
 * couronne" all name a finding, and all are somebody talking. What separates
 * them from dictation is that dictation begins with the finding.
 */
export function isBareFindingDictation(utterance: string): boolean {
  const text = utterance.trim();
  if (!text || looksLikeQuestion(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > FOLLOW_UP_MAX_WORDS) return false;

  const body = text.replace(CONTINUATION_LEAD, '');
  const [first] = extractFindings(body);
  return !!first && !first.negated && first.at <= 1;
}
