import { findToothMentions, resolveTooth } from './tooth-lexicon';
import { resolveWithGrammar } from './voice-grammar';
import { VoiceContextSnapshot } from './voice-intent.model';
import { isBareFindingDictation, looksLikeQuestion } from './voice-wake';
import { intentClass } from './intent-class';

/**
 * Is speech heard inside the follow-up window a command?
 *
 * After a command the wake word is not needed for a few seconds, so a run of
 * findings flows. But the microphone is open in a room where the patient
 * answers, an assistant speaks, and the dentist talks to both — and the last
 * tooth dictated stays selected. Everything said in that window used to be
 * treated as a command, so "oui docteur c'est douloureux" staged pain on the
 * tooth, "vous avez une infection ?" staged an infection, and anything the
 * grammar could not read was answered aloud with "Pas compris." while the
 * app's own voice deafened the microphone to the next real command.
 *
 * Without the wake word, an utterance is accepted only when it is plainly
 * addressed to the system:
 *
 * - it is not a question;
 * - it is a correction or a view command ({@link intentClass});
 * - or it is a finding said by itself ({@link isBareFindingDictation}) for the
 *   tooth in hand — "et une fracture", "carie profonde".
 *
 * Nothing else: a sentence that names a tooth has to be dictation on its own
 * merits, and an allergy, a note or a task needs the wake word in the same
 * sentence. At one point "passe-moi le composite pour la seize", said to the
 * assistant a few seconds after a command, staged a composite on 16; and
 * "vous avez une allergie à l'ananas…", told to the patient, staged an allergy.
 *
 * Everything else is ignored, silently: shown faintly on screen, never spoken,
 * never sent to a language model.
 */
export function acceptsFollowUp(utterance: string, context: VoiceContextSnapshot): boolean {
  if (looksLikeQuestion(utterance)) return false;

  const resolution = resolveWithGrammar(utterance, context);
  if (resolution.kind === 'unrecognized') return false;

  const namesTooth = findToothMentions(utterance).length > 0
    || resolveTooth(utterance, context.dentition).kind !== 'none';

  // A command is accepted for what it is, not for having been heard soon
  // after another one: corrections and views, and a finding said on its own
  // for the tooth in hand. A sentence that names a tooth must be dictation in
  // its own right — window or no window, the same sentence gives the same result.
  const accepts = (id: string) => {
    const kind = intentClass(id);
    if (kind === 'correction' || kind === 'view') return true;
    if (kind === 'chart') return !namesTooth && isBareFindingDictation(utterance);
    return false;
  };

  if (resolution.kind === 'sequence') return resolution.intents.every(intent => intentClass(intent.intent) === 'correction');
  if (resolution.kind === 'clarification') {
    const pending = resolution.clarification.pendingIntent;
    return !!pending && accepts(pending);
  }
  return accepts(resolution.intent.intent);
}

/** Filler words in front of a command: "alors, montre les allergies". */
const LEADING_FILLER = /^(?:(?:et|alors|donc|bon|ben|ok|okay|euh|hum|puis|voil[àa]|and|so|well|then|now|uh|um|right)[\s,]+)+/iu;

/** A view command is short; "montre-moi où vous avez mal" is not one. */
const UI_COMMAND_MAX_WORDS = 8;

/** How sure the grammar must be of a view command said without the wake word. */
const UI_COMMAND_MIN_CONFIDENCE = 0.9;

/**
 * "Montre les allergies", "zoom sur la 16", "toute la bouche", "plan de
 * traitement": a view or camera command said with no wake word, accepted when
 * the whole sentence is the command — at most a few words after fillers, read
 * by the grammar with confidence, and not a question. It changes only what the
 * screen shows, which one sentence ("retour") undoes.
 */
export function isSelfEvidentUiCommand(utterance: string, context: VoiceContextSnapshot): boolean {
  const text = utterance.trim().replace(LEADING_FILLER, '').trim();
  if (!text || looksLikeQuestion(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > UI_COMMAND_MAX_WORDS) return false;
  const resolution = resolveWithGrammar(text, context);
  if (resolution.kind !== 'intent') return false;
  return intentClass(resolution.intent.intent) === 'view' && resolution.intent.confidence >= UI_COMMAND_MIN_CONFIDENCE;
}

/** The command in a sentence with its leading fillers taken off. */
export function withoutFillers(utterance: string): string {
  return utterance.trim().replace(LEADING_FILLER, '').trim();
}
