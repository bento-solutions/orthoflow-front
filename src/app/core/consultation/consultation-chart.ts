import { entityString, stagedFindingCodes } from '../voice/voice-intent.model';
import { spokenFindingLabel, spokenSurface, SpokenLanguage } from '../voice/voice-vocabulary';

/**
 * One chart finding dictated in the examination, worded for the paper.
 *
 * The voice pipeline's own `preview` is English ("Tooth 16 (upper right first
 * molar) → Caries, mesial-occlusal") because it describes a command to the
 * developer-facing audit trail. A French doctor's printed report should read
 * "Dent 16 : carie (mésio-occlusale)" — the same words that were read back to
 * them aloud — so this words it from the resolved entities instead.
 *
 * Anything that is not a tooth finding (a note, an allergy, a history entry
 * dictated during the examination) keeps the pipeline's own text: it has no
 * tooth to put in front of it.
 */
export interface StagedChartEntry {
  intent: string;
  entities: Record<string, unknown>;
  preview: string;
}

interface StagedFinding {
  code?: unknown;
  surface?: unknown;
  severity?: unknown;
  note?: unknown;
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function chartLine(entry: StagedChartEntry, language: SpokenLanguage, toothWord: string): string {
  const fdi = entityString(entry.entities, 'fdi');
  const codes = stagedFindingCodes(entry.entities);
  if (entry.intent !== 'clinical.addFindings' || !fdi || codes.length === 0) return entry.preview;

  const detailed = Array.isArray(entry.entities['findings']) ? (entry.entities['findings'] as StagedFinding[]) : [];
  const parts = codes.map(code => {
    const finding = detailed.find(f => f?.code === code);
    const label = capitalise(spokenFindingLabel(code, language));
    const surface = typeof finding?.surface === 'string' && finding.surface ? spokenSurface(finding.surface, language) : null;
    return surface ? `${label} (${surface})` : label;
  });
  return `${toothWord} ${fdi} : ${parts.join(', ')}`;
}
