import { ConsultationLineDto, ConsultationLogCommandDto, ConsultationLogDto } from './consultation.model';
import { chartLine } from './consultation-chart';
import { SpokenLanguage } from '../voice/voice-vocabulary';

/**
 * One row of the consultation log: what was said, a command the examination
 * understood, or a moment in the consultation's life. Merged into one
 * timeline so the doctor reads a command beside the sentence it came from.
 */
export type TimelineRow =
  | { kind: 'milestone'; key: 'STARTED' | 'EXAMINATION' | 'ENDED' | 'SAVED'; at: number }
  | { kind: 'line'; at: number | null; line: ConsultationLineDto }
  | { kind: 'command'; at: number; command: ConsultationLogCommandDto; text: string; decision: CommandDecision };

/** What the doctor decided about a command at review. */
export type CommandDecision = 'approved' | 'rejected' | 'undecided';

/** Ranks within the same instant: a moment, then what was said, then what it caused. */
const RANK = { milestone: 0, line: 1, command: 2 } as const;

/**
 * The command in the doctor's words: "Dent 16 : carie (mésio-occlusale)" for a
 * chart finding, otherwise the pipeline's own text, otherwise the intent.
 */
export function commandText(command: ConsultationLogCommandDto, language: SpokenLanguage, toothWord: string): string {
  let entities: Record<string, unknown> = {};
  if (command.entities) {
    try {
      const parsed: unknown = JSON.parse(command.entities);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entities = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: show what the pipeline wrote rather than nothing.
    }
  }
  return chartLine({ intent: command.intent, entities, preview: command.newValue || command.intent }, language, toothWord);
}

export function decisionOf(command: ConsultationLogCommandDto, log: ConsultationLogDto): CommandDecision {
  if (log.reviewed?.approvedAuditIds?.includes(command.id)) return 'approved';
  if (log.reviewed?.rejectedAuditIds?.includes(command.id)) return 'rejected';
  return 'undecided';
}

/**
 * Everything the log knows, oldest first. A line from a consultation recorded
 * before lines were timed has no time: those keep their order, straight after
 * the start, and are shown without one.
 */
export function buildTimeline(log: ConsultationLogDto, language: SpokenLanguage, toothWord: string): TimelineRow[] {
  const started = Date.parse(log.startedAt);
  const entries: { row: TimelineRow; at: number; rank: number; index: number }[] = [];
  let index = 0;
  const add = (row: TimelineRow, at: number, rank: number) => entries.push({ row, at, rank, index: index++ });

  add({ kind: 'milestone', key: 'STARTED', at: started }, started, RANK.milestone);
  if (log.examinationStartedAt) {
    const at = Date.parse(log.examinationStartedAt);
    add({ kind: 'milestone', key: 'EXAMINATION', at }, at, RANK.milestone);
  }
  if (log.endedAt) {
    const at = Date.parse(log.endedAt);
    add({ kind: 'milestone', key: 'ENDED', at }, at, RANK.milestone);
  }
  if (log.completedAt) {
    const at = Date.parse(log.completedAt);
    add({ kind: 'milestone', key: 'SAVED', at }, at, RANK.milestone);
  }
  for (const line of log.lines) {
    const at = line.at ? Date.parse(line.at) : null;
    add({ kind: 'line', at, line }, at ?? started, RANK.line);
  }
  for (const command of log.commands) {
    const at = Date.parse(command.occurredAt);
    add({ kind: 'command', at, command, text: commandText(command, language, toothWord), decision: decisionOf(command, log) },
      at, RANK.command);
  }
  // Untimed lines sit at the start but after the START milestone, in their own order.
  return entries
    .sort((a, b) => a.at - b.at || a.rank - b.rank || a.index - b.index)
    .map(entry => entry.row);
}
