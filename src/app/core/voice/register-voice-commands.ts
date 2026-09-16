import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PatientService } from '../services/patient.service';
import { DentalChartService } from '../services/dental-chart.service';
import { ScheduleService } from '../services/schedule.service';
import { InvoiceService } from '../../features/billing/services/invoice.service';
import { ClinicalRecordService } from '../services/clinical-record.service';
import { MedicalHistoryCategory, NoteCategory, Severity } from '../models/clinical-record.model';
import { VoiceCommandRegistryService } from './voice-command-registry.service';
import { VoiceContextService } from './voice-context.service';
import { VoiceSessionService } from './voice-session.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { describeFdi } from './tooth-lexicon';
import { findingLabel } from './clinical-lexicon';
import { WAKE_WORD } from './voice-wake';
import {
  FindingEntity,
  VoiceCommand,
  VoiceCommandResult,
  VoiceContextSnapshot,
  entityString,
  stagedFindingCodes,
} from './voice-intent.model';

/**
 * The command set. This is the whole vocabulary of things voice can do —
 * adding a module's commands means adding entries here (or calling
 * {@link VoiceCommandRegistryService.registerMany} from that module), with no
 * change to the grammar, the pipeline, or the server.
 *
 * Risk tiers follow audit XII.4 §3 exactly:
 *   SAFE     navigation and reads — run on recognition
 *   CONFIRM  every clinical write — preview the resolved values, then confirm
 *   BLOCKED  deletions, invoice voiding, stock validation — never by voice
 *
 * Each write returns an inverse operation so the orchestrator can offer Undo
 * for a few seconds afterwards; a voice write to a clinical record without an
 * undo is a liability (§4).
 */
@Injectable({ providedIn: 'root' })
export class VoiceCommandsService {
  private registry = inject(VoiceCommandRegistryService);
  private clinical = inject(ClinicalRecordService);
  private chart = inject(DentalChartService);
  private patients = inject(PatientService);
  private schedule = inject(ScheduleService);
  private invoices = inject(InvoiceService);
  private context = inject(VoiceContextService);
  private sessions = inject(VoiceSessionService);
  private orchestrator = inject(VoiceOrchestratorService);

  /**
   * No navigation commands. Voice works inside one patient's dossier and
   * shows its results there; switching module, patient or tab by voice
   * mid-examination took the chart away from a dentist who could not touch
   * the screen to get it back.
   */
  registerAll(): void {
    this.registry.registerMany([
      ...this.sessionCommands(),
      ...this.chartCommands(),
      ...this.clinicalCommands(),
      ...this.readCommands(),
      ...this.blockedCommands(),
    ]);
    this.wireSessionHooks();
  }

  // ── Session control ─────────────────────────────────────────────────

  private wireSessionHooks(): void {
    this.orchestrator.sessionHooks = {
      start: async () => { await this.sessions.start(); },
      end: async () => { await this.sessions.end(); },
      summary: async () => { await this.sessions.refreshSummary(); },
    };
  }

  private sessionCommands(): VoiceCommand[] {
    return [
      {
        id: 'voice.session.start',
        description: 'Begin a dictated examination, so findings are grouped into one consultation',
        risk: 'SAFE',
        args: {},
        examples: ['start examination', 'begin the consultation'],
        requiresPatient: true,
        preview: () => 'Start a dictated examination',
        execute: async () => {
          await this.sessions.start();
          await this.orchestrator.startExaminationMode();
          return {
            ok: true,
            message: `Examination started. Say "${WAKE_WORD}" before a command.`,
          };
        },
      },
      {
        id: 'voice.session.end',
        description: 'End the dictated examination and open the review page',
        risk: 'SAFE',
        args: {},
        examples: ['end session', 'stop', 'finish the consultation'],
        preview: () => 'End the examination and review it',
        execute: async () => {
          // Nothing has been written yet — everything dictated is staged and
          // reaches the record only when the dentist saves at review.
          await this.sessions.end();
          return {
            ok: true,
            message: 'Examination ended. Review it on screen before saving.',
          };
        },
      },
      {
        id: 'voice.session.summary',
        description: 'Read back everything recorded so far in this examination',
        risk: 'SAFE',
        args: {},
        examples: ['show me today\'s findings', 'summary'],
        preview: () => 'Show what has been recorded so far',
        execute: async () => {
          const summary = await this.sessions.refreshSummary();
          if (!summary) {
            return { ok: true, message: 'No examination is running. Say "start examination" to begin one.' };
          }
          return { ok: true, message: this.sessions.spokenSummary(summary) };
        },
      },
      {
        /**
         * "Enlève la carie sur la seize" — removing a staged finding by naming
         * it, rather than by how recently it was said.
         *
         * One-step undo is not enough during a fast run: by the time the
         * dentist notices the mistake they are two teeth further on, and their
         * hands are not free to fix it on screen. Nothing has been written to
         * the record at this point, so this edits the buffer.
         *
         * An ambiguous reference always asks. Removing the wrong finding is
         * invisible at review — what remains reads as an ordinary, correctly
         * spelled record, and there is nothing to notice about the one that
         * went missing.
         */
        id: 'voice.correction.remove',
        description: 'Remove a finding recorded earlier in this examination, by naming it',
        risk: 'SAFE',
        requiresPatient: true,
        args: { fdi: 'FDI tooth code, optional', findingCode: 'finding code, optional' },
        examples: ['remove the caries on sixteen', 'enlève la carie sur la seize'],
        preview: (entities) => {
          const fdi = entities['fdi'] ? ` on ${entities['fdi']}` : '';
          const code = entities['findingCode'] ? findingLabel(String(entities['findingCode'])) : 'that finding';
          return `Remove ${code}${fdi} from this examination`;
        },
        execute: async (entities) => {
          const fdi = entities['fdi'] ? String(entities['fdi']) : null;
          const code = entities['findingCode'] ? String(entities['findingCode']) : null;
          if (!fdi && !code) {
            return { ok: false, message: 'Say which finding to remove, and on which tooth.' };
          }

          const removed = await this.orchestrator.discardBufferedMatching(
            entry => {
              const entryFdi = entityString(entry.entities, 'fdi');
              const codes = stagedFindingCodes(entry.entities);
              if (fdi && entryFdi !== fdi) return false;
              if (code && !codes.includes(code)) return false;
              return true;
            },
            matches => {
              const teeth = [...new Set(matches.map(match => {
                return entityString(match.entities as Record<string, unknown>, 'fdi') ?? '?';
              }))];
              return `I have that on ${teeth.length} teeth: ${teeth.join(', ')}. Which one?`;
            },
          );
          return removed
            ? { ok: true, message: 'Removed from this examination.' }
            : { ok: false, message: 'Nothing removed.' };
        },
      },
      {
        id: 'voice.correction.undo',
        description: 'Undo the last thing recorded',
        risk: 'SAFE',
        args: {},
        examples: ['undo', 'cancel that'],
        preview: () => 'Undo the last entry',
        execute: async () => {
          const undo = this.orchestrator.undoAvailable();
          if (!undo) return { ok: false, message: 'There\'s nothing to undo.' };
          await undo.run();
          return { ok: true, message: 'Undone.' };
        },
      },
    ];
  }

  // ── Dental chart ────────────────────────────────────────────────────

  private chartCommands(): VoiceCommand[] {
    return [
      {
        id: 'chart.addToothFindings',
        description: 'Record one or more clinical findings on a specific tooth',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addFindings',
        args: {
          fdi: 'two-digit FDI tooth code, e.g. 16',
          findings: 'array of {code, note?, surface?, severity?} using the finding vocabulary',
          note: 'optional free-text note for the tooth',
        },
        examples: [
          'upper right first molar: recurrent caries, crown needs replacement',
          'lower left second molar: existing filling, monitor',
          'tooth 16 cavity',
        ],
        preview: (entities) => this.previewFindings(entities),
        toServerEntities: (entities) => ({
          fdi: String(entities['fdi'] ?? ''),
          note: entities['note'] ?? undefined,
          findings: this.findingsOf(entities).map(f => ({
            code: f.code,
            surface: f.surface ?? undefined,
            severity: f.severity ?? undefined,
            note: f.note ?? undefined,
          })),
        }),
        onServerExecuted: (audit, entities, context) =>
          this.findingsRecorded(audit, entities, context),
      },
      {
        id: 'chart.replaceLastFinding',
        description: 'Correct the finding just recorded, replacing it on the same tooth',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addFindings',
        args: { findings: 'the corrected findings' },
        examples: ['no, actually crown replacement', 'change that to recurrent caries'],
        preview: (entities, context) => {
          const fdi = context.lastWrite?.fdi;
          const labels = this.findingsOf(entities).map(f => f.label).join(', ');
          return fdi
            ? `Correct tooth ${fdi} (${describeFdi(fdi)}) to: ${labels}`
            : `Correct the last entry to: ${labels}`;
        },
        // The superseded findings are withdrawn and the replacements recorded
        // in the same server transaction, so the record never passes through
        // a state where the tooth carries neither.
        toServerEntities: (entities, context) => ({
          fdi: context.lastWrite?.fdi ?? String(entities['fdi'] ?? ''),
          retractIds: (context.lastWrite?.targetId ?? '').split(',').filter(Boolean),
          findings: this.findingsOf(entities).map(f => ({
            code: f.code,
            surface: f.surface ?? undefined,
            severity: f.severity ?? undefined,
          })),
        }),
        onServerExecuted: (audit, entities, context) => {
          const result = this.findingsRecorded(audit, entities, context);
          return { ...result, message: `Corrected. ${result.message}` };
        },
      },
      {
        id: 'chart.removeFinding',
        description: 'Withdraw a finding from a tooth, when it was recorded in error',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.retractFindings',
        args: { fdi: 'FDI tooth code', findings: 'the findings to withdraw' },
        examples: ['remove the sensitivity note from that tooth'],
        preview: (entities) => {
          const fdi = String(entities['fdi'] ?? '');
          const labels = this.findingsOf(entities).map(f => f.label).join(', ');
          return `Withdraw from tooth ${fdi} (${describeFdi(fdi)}): ${labels}`;
        },
        // Sent as codes rather than ids: the server resolves them against what
        // is actually on the tooth when the command executes.
        toServerEntities: (entities) => ({
          fdi: String(entities['fdi'] ?? ''),
          codes: this.findingsOf(entities).map(f => f.code),
        }),
        onServerExecuted: (audit, entities, context) => {
          const fdi = String(entities['fdi'] ?? '');
          const labels = this.findingsOf(entities).map(f => f.label).join(', ');
          this.refreshChart(context);
          return {
            ok: true,
            message: `Removed ${labels} from tooth ${fdi}.`,
            targetType: 'tooth-finding',
            targetId: audit.targetId ?? undefined,
            highlightFdi: fdi,
          };
        },
      },
      {
        id: 'chart.selectTooth',
        description: 'Select and highlight a tooth on the chart without changing anything',
        risk: 'SAFE',
        requiresPatient: true,
        args: { fdi: 'FDI tooth code' },
        examples: ['show tooth 16', 'select the upper right first molar'],
        preview: (entities) => `Show tooth ${entities['fdi']}`,
        execute: async (entities) => {
          const fdi = String(entities['fdi']);
          this.context.selectTooth(fdi);
          return { ok: true, message: `Tooth ${fdi} — ${describeFdi(fdi)}`, highlightFdi: fdi };
        },
      },
      {
        id: 'chart.readTooth',
        description: 'Read back what is currently recorded on a tooth',
        risk: 'SAFE',
        requiresPatient: true,
        args: { fdi: 'FDI tooth code' },
        examples: ['what is on tooth 16', 'read tooth 26'],
        preview: (entities) => `Read tooth ${entities['fdi']}`,
        execute: async (entities, context) => {
          const fdi = String(entities['fdi']);
          const findings = await firstValueFrom(
            this.clinical.listToothFindings(context.patientId!, fdi),
          );
          this.context.selectTooth(fdi);
          if (findings.length === 0) {
            return { ok: true, message: `Tooth ${fdi} (${describeFdi(fdi)}) has nothing recorded.`, highlightFdi: fdi };
          }
          const labels = findings.map(f => findingLabel(f.findingCode)).join(', ');
          return { ok: true, message: `Tooth ${fdi} — ${labels}.`, highlightFdi: fdi };
        },
      },
    ];
  }

  private findingsOf(entities: Record<string, unknown>): FindingEntity[] {
    const raw = entities['findings'];
    return Array.isArray(raw) ? raw as FindingEntity[] : [];
  }

  /**
   * The preview is the single most important safety surface: it must state
   * the *resolved* tooth and findings, never repeat the transcript back
   * (audit XII.4 §2).
   */
  private previewFindings(entities: Record<string, unknown>): string {
    const fdi = String(entities['fdi'] ?? '');
    const findings = this.findingsOf(entities);
    const labels = findings.map(f => {
      // The grammar attaches a label; the NLU fallback returns codes only.
      const parts = [f.label ?? findingLabel(f.code)];
      if (f.severity) parts.push(f.severity.toLowerCase());
      if (f.surface) parts.push(f.surface);
      return parts.join(', ');
    });
    const note = entities['note'] ? ` · note: "${entities['note']}"` : '';
    return `Tooth ${fdi} (${describeFdi(fdi)}) → ${labels.join('; ')}${note}`;
  }

  /**
   * Shared feedback and inverse for any command that recorded findings.
   *
   * `audit.targetId` is the comma-joined ids the server actually created, so
   * Undo withdraws exactly those — never something the tooth already carried
   * before this command ran.
   */
  private findingsRecorded(
    audit: { targetId?: string | null },
    entities: Record<string, unknown>,
    context: VoiceContextSnapshot,
  ): VoiceCommandResult {
    const fdi = String(entities['fdi'] ?? context.lastWrite?.fdi ?? '');
    const labels = this.findingsOf(entities).map(f => findingLabel(f.code)).join(', ');
    const createdIds = (audit.targetId ?? '').split(',').filter(Boolean);

    this.refreshChart(context);

    return {
      ok: true,
      message: `Tooth ${fdi}, ${describeFdi(fdi)} — ${labels}.`,
      targetType: 'tooth-finding',
      targetId: audit.targetId ?? undefined,
      newValue: labels,
      highlightFdi: fdi,
      undo: createdIds.length
        ? async () => {
            for (const id of createdIds) {
              await firstValueFrom(
                this.clinical.changeFindingStatus(context.patientId!, id, 'RETRACTED'));
            }
            this.refreshChart(context);
          }
        : undefined,
    };
  }

  /**
   * The odontogram's per-tooth status is derived server-side from the tooth's
   * findings, so the chart is reloaded rather than patched locally — the
   * doctor's visual verification must reflect what was stored.
   */
  private refreshChart(context: VoiceContextSnapshot): void {
    const patient = this.patients.currentPatient();
    if (patient && patient.id === context.patientId) {
      this.chart.loadChart(patient.id, patient.dateOfBirth);
    }
  }

  // ── Notes, allergies, history ───────────────────────────────────────

  private clinicalCommands(): VoiceCommand[] {
    return [
      {
        id: 'clinical.addNote',
        description: 'Add a clinical note to the patient record, or to a specific tooth',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addNote',
        args: {
          category: 'GENERAL | CHIEF_COMPLAINT | OBSERVATION | DIAGNOSIS | FOLLOW_UP | TREATMENT_PLAN',
          content: 'the note text',
          fdi: 'optional FDI code when the note is about one tooth',
        },
        examples: [
          'add a note: patient reports sensitivity to cold',
          'patient reports pain when chewing on the right side',
        ],
        preview: (entities) => {
          const fdi = entities['fdi'] ? ` on tooth ${entities['fdi']}` : '';
          return `Note${fdi} (${String(entities['category'] ?? 'GENERAL').toLowerCase()}): "${entities['content']}"`;
        },
        toServerEntities: (entities) => ({
          category: (entities['category'] as NoteCategory) ?? 'GENERAL',
          content: String(entities['content'] ?? '').trim(),
          fdi: entities['fdi'] ? String(entities['fdi']) : undefined,
        }),
        onServerExecuted: (audit, entities, context) => ({
          ok: true,
          message: 'Note added.',
          targetType: 'clinical-note',
          targetId: audit.targetId ?? undefined,
          newValue: String(entities['content'] ?? ''),
          highlightFdi: entities['fdi'] ? String(entities['fdi']) : undefined,
          undo: audit.targetId
            ? async () => {
                await firstValueFrom(this.clinical.deleteNote(context.patientId!, audit.targetId!));
              }
            : undefined,
        }),
      },
      {
        id: 'clinical.addAllergy',
        description: 'Record a patient allergy',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addAllergy',
        args: {
          substance: 'what the patient is allergic to',
          reaction: 'optional reaction',
          severity: 'MILD|MODERATE|SEVERE',
        },
        examples: ['add allergy: penicillin', 'patient is allergic to latex'],
        preview: (entities) => `Allergy: ${entities['substance']}`,
        toServerEntities: (entities) => ({
          substance: String(entities['substance'] ?? '').trim(),
          reaction: entities['reaction'] ? String(entities['reaction']) : undefined,
          severity: (entities['severity'] as Severity) ?? undefined,
        }),
        onServerExecuted: (audit, entities, context) => ({
          ok: true,
          message: `Allergy recorded: ${entities['substance']}.`,
          targetType: 'allergy',
          targetId: audit.targetId ?? undefined,
          newValue: String(entities['substance'] ?? ''),
          undo: audit.targetId
            ? async () => {
                await firstValueFrom(this.clinical.deleteAllergy(context.patientId!, audit.targetId!));
              }
            : undefined,
        }),
      },
      {
        id: 'clinical.addMedicalHistory',
        description: 'Add an entry to the medical or dental history',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addMedicalHistory',
        args: {
          category: 'CONDITION | MEDICATION | SURGERY | DENTAL_HISTORY | FAMILY | LIFESTYLE | OTHER',
          label: 'the condition, medication or past treatment',
          detail: 'optional detail',
        },
        examples: [
          'medical history: type 2 diabetes',
          'previous dental history: extraction of upper left wisdom tooth',
        ],
        preview: (entities) => {
          const category = String(entities['category'] ?? 'CONDITION').replace('_', ' ').toLowerCase();
          return `${category}: ${entities['label']}`;
        },
        toServerEntities: (entities) => ({
          category: (entities['category'] as MedicalHistoryCategory) ?? 'CONDITION',
          label: String(entities['label'] ?? '').trim(),
          detail: entities['detail'] ? String(entities['detail']) : undefined,
        }),
        onServerExecuted: (audit, entities, context) => {
          const dental = entities['category'] === 'DENTAL_HISTORY';
          return {
            ok: true,
            message: `Recorded in ${dental ? 'dental' : 'medical'} history: ${entities['label']}.`,
            targetType: 'medical-history',
            targetId: audit.targetId ?? undefined,
            newValue: String(entities['label'] ?? ''),
            undo: audit.targetId
              ? async () => {
                  await firstValueFrom(
                    this.clinical.deleteMedicalHistory(context.patientId!, audit.targetId!));
                }
              : undefined,
          };
        },
      },
      {
        id: 'schedule.followUp',
        description: 'Note a follow-up recommendation for this patient',
        risk: 'CONFIRM',
        requiresPatient: true,
        // Recorded as a follow-up note rather than silently booking a slot:
        // the calendar has real constraints (availability, duration, room)
        // that a spoken phrase does not carry, and inventing an appointment
        // time is exactly the kind of confident guess to avoid.
        serverIntent: 'clinical.addNote',
        args: { when: 'when the follow-up should happen, in the doctor\'s own words' },
        examples: ['schedule a follow-up in two weeks'],
        preview: (entities) => `Follow-up: "${entities['when']}"`,
        toServerEntities: (entities) => ({
          category: 'FOLLOW_UP' as NoteCategory,
          content: String(entities['when'] ?? '').trim(),
        }),
        onServerExecuted: (audit, _entities, context) => ({
          ok: true,
          message: 'Follow-up noted. Book the slot on the schedule when you\'re ready.',
          targetType: 'clinical-note',
          targetId: audit.targetId ?? undefined,
          undo: audit.targetId
            ? async () => {
                await firstValueFrom(this.clinical.deleteNote(context.patientId!, audit.targetId!));
              }
            : undefined,
        }),
      },
    ];
  }

  // ── Reads ───────────────────────────────────────────────────────────

  private readCommands(): VoiceCommand[] {
    return [
      {
        id: 'patients.readBalance',
        description: 'Read the patient\'s outstanding balance',
        risk: 'SAFE',
        requiresPatient: true,
        args: {},
        examples: ['what is the outstanding balance'],
        preview: () => 'Read the outstanding balance',
        execute: async (_entities, context) => {
          const invoices = await firstValueFrom(this.invoices.getPatientInvoices(context.patientId!));
          const outstanding = invoices
            .filter(invoice => invoice.status !== 'PAID' && invoice.status !== 'CANCELLED')
            .reduce((sum, invoice) => sum + (invoice.balanceDue ?? invoice.total), 0);
          return {
            ok: true,
            message: outstanding > 0
              ? `Outstanding balance: ${outstanding.toFixed(2)} dirhams.`
              : 'Nothing outstanding — the account is settled.',
          };
        },
      },
      {
        id: 'patients.readNextAppointment',
        description: 'Read when the patient\'s next appointment is',
        risk: 'SAFE',
        requiresPatient: true,
        args: {},
        examples: ['when is the next appointment'],
        preview: () => 'Read the next appointment',
        execute: async (_entities, context) => {
          const now = Date.now();
          const next = this.schedule.appointments()
            .filter(a => a.patientId === context.patientId && a.status !== 'CANCELLED')
            .filter(a => new Date(a.dateTime).getTime() >= now)
            .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())[0];
          if (!next) return { ok: true, message: 'No upcoming appointment is booked.' };
          const when = new Date(next.dateTime);
          return { ok: true, message: `Next appointment: ${when.toLocaleString()}.` };
        },
      },
    ];
  }

  // ── Never by voice ──────────────────────────────────────────────────

  /**
   * Registered rather than omitted, on purpose. A doctor who says "delete
   * this patient" should hear why it will not happen and where to do it,
   * instead of the assistant appearing not to have heard (audit XII.4 §3).
   */
  private blockedCommands(): VoiceCommand[] {
    const blocked = (id: string, description: string, examples: string[]): VoiceCommand => ({
      id,
      description,
      risk: 'BLOCKED',
      args: {},
      examples,
      preview: () => `${description} — not available by voice`,
      execute: async () => ({ ok: false, message: `${description} has to be done on screen.` }),
    });

    return [
      blocked('patients.delete', 'Deleting a patient', ['delete this patient']),
      blocked('billing.voidInvoice', 'Voiding an invoice', ['void this invoice']),
      blocked('billing.recordPayment', 'Recording a payment', ['record a payment']),
      blocked('stock.validateCount', 'Validating a stock count', ['validate the stock count']),
      blocked('clinical.prescribe', 'Prescribing medication', ['prescribe amoxicillin']),
    ];
  }
}
