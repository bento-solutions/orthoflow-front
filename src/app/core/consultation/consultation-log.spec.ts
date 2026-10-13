import { describe, expect, it } from 'vitest';
import { buildTimeline, commandText, decisionOf } from './consultation-log';
import { ConsultationLogCommandDto, ConsultationLogDto } from './consultation.model';

const at = (hhmmss: string) => `2026-10-13T${hhmmss}Z`;

function command(over: Partial<ConsultationLogCommandDto> = {}): ConsultationLogCommandDto {
  return {
    id: 'c1', occurredAt: at('10:00:20'), transcript: null, intent: 'clinical.addFindings',
    entities: JSON.stringify({ fdi: '16', findings: [{ code: 'caries', surface: 'mesial-occlusal' }] }),
    resolver: 'grammar', confidence: 0.9, confirmationStatus: 'AUTO', outcome: 'EXECUTED', targetType: null,
    previousValue: null, newValue: 'Tooth 16 → Caries', errorMessage: null, undoneAt: null, ...over,
  };
}

function log(over: Partial<ConsultationLogDto> = {}): ConsultationLogDto {
  return {
    consultationId: 'k1', patientId: 'p1', status: 'COMPLETED', locale: 'fr-MA', patientInformedAt: at('09:59:50'),
    startedAt: at('10:00:00'), examinationStartedAt: at('10:00:15'), endedAt: at('10:05:00'), completedAt: at('10:09:00'),
    transcriptKept: true, lines: [], commands: [], reviewed: null, report: null, ...over,
  };
}

describe('consultation log timeline', () => {
  it('puts a command right after the sentence it came from', () => {
    const rows = buildTimeline(log({
      lines: [
        { seq: 0, at: at('10:00:05'), phase: 'INTAKE', typed: false, text: 'Bonjour' },
        { seq: 1, at: at('10:00:19'), phase: 'EXAMINATION', typed: false, text: 'dent 16 carie mésio-occlusale' },
      ],
      commands: [command()],
    }), 'fr', 'Dent');

    expect(rows.map(r => r.kind === 'milestone' ? r.key : r.kind === 'line' ? r.line.text : 'command:' + r.command.id)).toEqual([
      'STARTED', 'Bonjour', 'EXAMINATION', 'dent 16 carie mésio-occlusale', 'command:c1', 'ENDED', 'SAVED',
    ]);
  });

  it('words a chart finding the way it was read back to the doctor', () => {
    expect(commandText(command(), 'fr', 'Dent')).toBe('Dent 16 : Carie (mésio-occlusale)');
  });

  it('falls back to what the pipeline wrote, then the intent, for anything else', () => {
    expect(commandText(command({ intent: 'clinical.addNote', entities: null, newValue: 'Douleur à froid' }), 'fr', 'Dent'))
      .toBe('Douleur à froid');
    expect(commandText(command({ intent: 'clinical.addNote', entities: 'not json', newValue: null }), 'fr', 'Dent'))
      .toBe('clinical.addNote');
  });

  it('keeps lines that were never timed together, in order, straight after the start', () => {
    const rows = buildTimeline(log({
      lines: [
        { seq: 0, at: null, phase: null, typed: false, text: 'première' },
        { seq: 1, at: null, phase: null, typed: false, text: 'seconde' },
      ],
    }), 'fr', 'Dent');

    expect(rows.filter(r => r.kind === 'line').map(r => (r as { line: { text: string } }).line.text)).toEqual(['première', 'seconde']);
    expect(rows[0]).toMatchObject({ kind: 'milestone', key: 'STARTED' });
    expect(rows[1].kind).toBe('line');
  });

  it('shows what the doctor decided about each command', () => {
    const reviewed = {
      allergies: [], medicalHistory: [], activeTreatments: [], treatmentPlan: [], amendments: [],
      approvedAuditIds: ['c1'], rejectedAuditIds: ['c2'],
    };
    const l = log({ reviewed });
    expect(decisionOf(command({ id: 'c1' }), l)).toBe('approved');
    expect(decisionOf(command({ id: 'c2' }), l)).toBe('rejected');
    expect(decisionOf(command({ id: 'c3' }), l)).toBe('undecided');
    expect(decisionOf(command({ id: 'c1' }), log())).toBe('undecided');
  });
});
