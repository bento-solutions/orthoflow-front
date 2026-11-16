import {
  affirmedFindings,
  extractEveryFinding,
  ExtractedFinding,
  FindingKind,
} from '../voice/clinical-lexicon';
import { Dentition, findToothMentions } from '../voice/tooth-lexicon';
import { repairSttConfusions } from '../voice/stt-confusions';
import { repairClinicalTerms } from '../voice/voice-fuzzy';
import { spokenFindingLabel, spokenSurface } from '../voice/voice-vocabulary';

/**
 * What a sentence the analysis could not settle most likely meant: a state of a tooth or a
 * treatment it needs, read from its words with the chart's own vocabulary. Shown "to be confirmed"
 * instead of "not understood" — the doctor decides, nothing is recorded from it by itself.
 */
export interface SentenceSuggestion {
  /** The findings named, in the order they were said, each once. */
  findings: SuggestedFinding[];
  /** The teeth named (FDI), in the order they were said, each once. */
  teeth: string[];
  /** A word was close to a clinical term rather than the term itself ("carré" for "carie"). */
  approximate: boolean;
}

export interface SuggestedFinding {
  code: string;
  /** A treatment the tooth needs, or a state it is in. */
  type: 'treatment' | 'state';
  surface: string | null;
  /** Said with a doubt ("suspicion de carie"). */
  suspected: boolean;
}

function typeOf(kind: FindingKind): SuggestedFinding['type'] {
  return kind === 'TREATMENT_REQUIRED' ? 'treatment' : 'state';
}

function distinctFindings(found: readonly ExtractedFinding[]): SuggestedFinding[] {
  const out: SuggestedFinding[] = [];
  for (const finding of found) {
    if (out.some(existing => existing.code === finding.code)) continue;
    out.push({
      code: finding.code,
      type: typeOf(finding.kind),
      surface: finding.surface,
      suspected: finding.certainty === 'SUSPECTED',
    });
  }
  return out;
}

/**
 * The most likely state or treatment in a sentence, or null when its words name none.
 *
 * Reads as the voice pipeline reads — the recogniser's usual confusions put back first ("dans 16
 * carré" → "dent 16 carie"), then the clinical lexicon — and, when that finds nothing, once more
 * after the near-miss repair ("obturassion" → "obturation"). Negated findings are left out: "pas de
 * carie" suggests nothing.
 */
export function suggestFromSentence(text: string, dentition: Dentition = 'adult'): SentenceSuggestion | null {
  const said = (text ?? '').trim();
  if (!said) return null;
  const repaired = repairSttConfusions(said, dentition).text;
  let reading = repaired;
  let found = affirmedFindings(extractEveryFinding(repaired));
  let approximate = repaired !== said;
  if (found.length === 0) {
    const fuzzy = repairClinicalTerms(repaired);
    if (fuzzy.corrections.length > 0) {
      reading = fuzzy.text;
      found = affirmedFindings(extractEveryFinding(fuzzy.text));
      approximate = true;
    }
  }
  if (found.length === 0) return null;
  found = [...found].sort((a, b) => a.at - b.at);
  const teeth: string[] = [];
  for (const mention of findToothMentions(reading)) {
    if (mention.valid && !teeth.includes(mention.fdi)) teeth.push(mention.fdi);
  }
  return { findings: distinctFindings(found), teeth, approximate };
}

/**
 * The words the chart's grammar reads back as this finding, in French — what a recovered finding
 * is staged from ({@link VoiceOrchestratorService.stageRecovered}).
 */
export function suggestionGrammarText(finding: SuggestedFinding): string {
  const label = spokenFindingLabel(finding.code, 'fr');
  return finding.surface ? `${label} ${spokenSurface(finding.surface, 'fr')}` : label;
}

/**
 * Whether the suggestion can go on the chart as it stands: a tooth and a finding, both said, and
 * no doubt about which goes with which — several teeth with several findings ("16 carie, 17
 * couronne") are left for the doctor to place by hand.
 */
export function canChart(suggestion: SentenceSuggestion | null): suggestion is SentenceSuggestion {
  if (!suggestion || suggestion.teeth.length === 0 || suggestion.findings.length === 0) return false;
  return suggestion.teeth.length === 1 || suggestion.findings.length === 1;
}
