import { findToothMentions, resolveTooth } from './tooth-lexicon';
import { resolveWithGrammar } from './voice-grammar';
import { VoiceContextSnapshot } from './voice-intent.model';
import { isBareFindingDictation, looksLikeQuestion } from './voice-wake';

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
 * - it is a command the grammar reads — and if that command would record
 *   findings on the tooth left selected, rather than on one the dentist
 *   named, it must be a finding said by itself ({@link isBareFindingDictation}),
 *   not a sentence containing one.
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

  if (resolution.kind === 'sequence') return true;
  if (resolution.kind === 'clarification') return namesTooth;

  const { intent, entities } = resolution.intent;
  const recordsOnSelectedTooth = intent === 'chart.addToothFindings'
    || (intent === 'clinical.addNote' && entities['category'] === 'OBSERVATION' && !!entities['fdi']);
  if (recordsOnSelectedTooth && !namesTooth) return isBareFindingDictation(utterance);
  return true;
}
