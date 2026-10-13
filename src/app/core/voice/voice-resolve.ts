import { repairClinicalTerms } from './voice-fuzzy';
import { resolveWithGrammar } from './voice-grammar';
import { VoiceContextSnapshot, VoiceResolution } from './voice-intent.model';

/**
 * Reads one utterance the way a forgiving colleague would: exactly if it can,
 * and otherwise by taking each word that was nearly a clinical term for that
 * term — "infectione" for "infection", "carriée" for "cariée", "composit" for
 * "composite".
 *
 * This used to run only when the grammar understood nothing. A sentence the
 * grammar half-understood — "tooth 17 infectione et amalgam" — was staged with
 * the amalgam and *without the infection*, silently: the one outcome worse than
 * "Pas compris", because the doctor hears a read-back that sounds complete.
 * So a repair is now also tried on a sentence that resolved, and is taken when
 * it adds findings and loses none.
 *
 * Numbers are never repaired (see `voice-fuzzy.ts`): a fuzzy tooth number is
 * the one error that survives review looking correct.
 */

export interface Correction {
  from: string;
  to: string;
}

export interface Resolved {
  resolution: VoiceResolution;
  /** What was respelled on the way, for the read-back — the doctor is entitled to know. */
  corrections: Correction[];
  /** The reading the resolution came from — repaired or not. */
  resolvedFrom: string;
}

export function isCommand(resolution: VoiceResolution): boolean {
  return resolution.kind === 'intent' || resolution.kind === 'sequence';
}

/** Every finding a resolution would record, as "tooth:code" — to tell whether a repair added any. */
export function findingKeys(resolution: VoiceResolution): Set<string> {
  const intents = resolution.kind === 'intent' ? [resolution.intent]
    : resolution.kind === 'sequence' ? resolution.intents : [];
  const keys = new Set<string>();
  for (const { entities } of intents) {
    const tooth = typeof entities['fdi'] === 'string' ? entities['fdi'] : '';
    const findings = Array.isArray(entities['findings']) ? entities['findings'] as Array<{ code?: unknown }> : [];
    for (const finding of findings) keys.add(`${tooth}:${String(finding.code)}`);
  }
  return keys;
}

/** Whether `candidate` records everything `base` does, and more. */
function addsFindings(candidate: VoiceResolution, base: Set<string>): boolean {
  if (!isCommand(candidate)) return false;
  const keys = findingKeys(candidate);
  return keys.size > base.size && [...base].every(key => keys.has(key));
}

/**
 * @param readings the recogniser's normalised reading first, then the verbatim
 *   one, without the wake word
 */
export function resolveForgiving(readings: string[], snapshot: VoiceContextSnapshot): Resolved {
  const first = readings[0] ?? '';
  let resolution: VoiceResolution = { kind: 'unrecognized', transcript: first };
  let resolvedFrom = first;

  for (const reading of readings) {
    const attempt = resolveWithGrammar(reading, snapshot);
    if (isCommand(attempt)) {
      resolution = attempt;
      resolvedFrom = reading;
      break;
    }
    if (attempt.kind === 'clarification' && resolution.kind === 'unrecognized') {
      resolution = attempt;
      resolvedFrom = reading;
    }
  }

  // Nothing understood: a near miss is repaired against the lexicon's own
  // vocabulary and retried. Only an outright command is taken from the retry.
  if (!isCommand(resolution)) {
    for (const reading of readings) {
      const repair = repairClinicalTerms(reading, candidate => isCommand(resolveWithGrammar(candidate, snapshot)));
      if (repair.corrections.length === 0) continue;
      const retried = resolveWithGrammar(repair.text, snapshot);
      if (isCommand(retried)) return { resolution: retried, corrections: repair.corrections, resolvedFrom: reading };
    }
    return { resolution, corrections: [], resolvedFrom };
  }

  // Understood — but perhaps not all of it. A word that was nearly a finding is
  // taken for that finding when doing so adds to what was recorded and loses
  // nothing of it.
  const base = findingKeys(resolution);
  if (base.size > 0) {
    for (const reading of readings) {
      const repair = repairClinicalTerms(reading, candidate => addsFindings(resolveWithGrammar(candidate, snapshot), base));
      if (repair.corrections.length === 0) continue;
      const retried = resolveWithGrammar(repair.text, snapshot);
      if (addsFindings(retried, base)) return { resolution: retried, corrections: repair.corrections, resolvedFrom: reading };
    }
  }
  return { resolution, corrections: [], resolvedFrom };
}
