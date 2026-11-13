import { StagedFinding } from '../clinical/tooth-paint';
import { entityString } from './voice-intent.model';

/** What a staged voice command looks like here: only what the chart needs of it. */
interface StagedEntry {
  readonly intent: string;
  readonly entities: Record<string, unknown>;
}

/**
 * The findings dictated and not saved yet, tooth by tooth, for drawing on the chart.
 * A staged command keeps its findings as `findings: [{ code, surface, certainty, note }]`; the NLU and older
 * rows carry bare codes, which are kept without a surface.
 */
export function stagedToothFindings(buffered: readonly StagedEntry[]): StagedFinding[] {
  const out: StagedFinding[] = [];
  for (const entry of buffered) {
    const fdi = entityString(entry.entities, 'fdi');
    if (!fdi || entry.intent !== 'clinical.addFindings') continue;
    const findings = entry.entities['findings'];
    if (Array.isArray(findings)) {
      for (const finding of findings as { code?: unknown; surface?: unknown; certainty?: unknown; note?: unknown }[]) {
        if (typeof finding?.code !== 'string') continue;
        out.push({
          fdi,
          code: finding.code,
          surface: typeof finding.surface === 'string' ? finding.surface : null,
          // Said with a doubt, it is drawn as a suspicion; said with a measure, the gum shows it.
          ...(finding.certainty === 'SUSPECTED' ? { certainty: 'SUSPECTED' as const } : {}),
          ...(typeof finding.note === 'string' && finding.note ? { note: finding.note } : {}),
        });
      }
    }
    const codes = entry.entities['findingCodes'];
    if (Array.isArray(codes)) out.push(...codes.map((code) => ({ fdi, code: String(code), surface: null })));
    if (typeof entry.entities['findingCode'] === 'string') out.push({ fdi, code: entry.entities['findingCode'], surface: null });
  }
  return out;
}
