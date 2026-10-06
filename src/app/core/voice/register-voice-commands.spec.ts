import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceService } from '../../features/billing/services/invoice.service';
import { ClinicalRecordService } from '../services/clinical-record.service';
import { DentalChartService } from '../services/dental-chart.service';
import { PatientService } from '../services/patient.service';
import { ScheduleService } from '../services/schedule.service';
import { VoiceCommandsService } from './register-voice-commands';
import { VoiceCommandRegistryService } from './voice-command-registry.service';
import { VoiceContextService } from './voice-context.service';
import { VoiceContextSnapshot } from './voice-intent.model';
import { BufferedEntry, VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoiceSessionService } from './voice-session.service';

/**
 * The read commands: what is said back, and to whom. The dentist's hands are
 * in a mouth and the patient is in the chair, so an answer has to be both
 * complete — it may not call a tooth empty because its findings are not saved
 * yet — and discreet.
 */

const snapshot = { patientId: 'p-1', patientName: 'Ahmed', dentition: 'adult', locale: 'fr-MA' } as VoiceContextSnapshot;

const staged = (fdi: string, code: string): BufferedEntry => ({
  auditId: `a-${fdi}-${code}`,
  intent: 'clinical.addFindings',
  entities: { fdi, findings: [{ code }] },
  preview: `Tooth ${fdi}`,
  transcript: '',
  corrections: [],
  at: 0,
});

describe('VoiceCommandsService — reading back', () => {
  let registry: VoiceCommandRegistryService;
  let buffered: BufferedEntry[];
  let recorded: { findingCode: string }[];
  let invoices: unknown[];
  let appointments: { patientId: string; dateTime: string; status: string }[];
  let scheduleLoading: boolean;
  let scheduleError: string | null;
  let sessionActive: boolean;

  const run = (id: string, entities: Record<string, unknown> = {}) =>
    registry.get(id)!.execute(entities, snapshot);

  beforeEach(() => {
    buffered = [];
    recorded = [];
    invoices = [];
    appointments = [];
    scheduleLoading = false;
    scheduleError = null;
    sessionActive = true;

    TestBed.configureTestingModule({
      providers: [
        { provide: ClinicalRecordService, useValue: { listToothFindings: () => of(recorded) } },
        { provide: DentalChartService, useValue: {} },
        { provide: PatientService, useValue: { currentPatient: signal(null) } },
        {
          provide: ScheduleService,
          useValue: {
            appointments: () => appointments,
            loading: () => scheduleLoading,
            error: () => scheduleError,
          },
        },
        { provide: InvoiceService, useValue: { getPatientInvoices: () => of(invoices) } },
        { provide: VoiceContextService, useValue: { selectTooth: vi.fn() } },
        {
          provide: VoiceSessionService,
          useValue: {
            isActive: () => sessionActive,
            refreshSummary: vi.fn(async () => null),
            spokenSummary: () => 'Résumé',
          },
        },
        { provide: VoiceOrchestratorService, useValue: { buffered: () => buffered, sessionHooks: null } },
      ],
    });
    registry = TestBed.inject(VoiceCommandRegistryService);
    TestBed.inject(VoiceCommandsService).registerAll();
  });

  // ── "Lis la dent 16" ────────────────────────────────────────────────

  it('reads what was just dictated on a tooth, not "nothing recorded"', async () => {
    buffered = [staged('16', 'recurrent_caries')];

    const result = await run('chart.readTooth', { fdi: '16' });

    expect(result.spokenFr).toBe('Dent 16 : à enregistrer carie récurrente.');
    expect(result.spokenFr).not.toContain("rien d'enregistré");
  });

  it('separates what is waiting to be saved from what is already on the record', async () => {
    buffered = [staged('16', 'recurrent_caries')];
    recorded = [{ findingCode: 'existing_crown' }];

    const result = await run('chart.readTooth', { fdi: '16' });

    expect(result.spokenFr).toBe('Dent 16 : à enregistrer carie récurrente ; au dossier couronne.');
  });

  it('does not say a finding twice when it is both on record and staged again', async () => {
    buffered = [staged('16', 'existing_crown')];
    recorded = [{ findingCode: 'existing_crown' }];

    const result = await run('chart.readTooth', { fdi: '16' });

    expect(result.spokenFr).toBe('Dent 16 : à enregistrer couronne.');
  });

  it('ignores what was staged on other teeth', async () => {
    buffered = [staged('26', 'fracture')];

    const result = await run('chart.readTooth', { fdi: '16' });

    expect(result.spokenFr).toBe("Dent 16 : rien d'enregistré.");
  });

  // ── "Montre les constatations" ──────────────────────────────────────

  it('reads the staged entries aloud rather than only counting them', async () => {
    buffered = [staged('16', 'recurrent_caries'), staged('26', 'fracture')];

    const result = await run('voice.session.summary');

    expect(result.spokenFr).toBe('2 entrées. Dent 16 : carie récurrente. Dent 26 : fracture.');
  });

  it('falls back to the recorded summary when nothing is staged', async () => {
    const result = await run('voice.session.summary');

    expect(result.spokenFr).toBe('Aucun examen en cours.');
  });

  // ── Money and appointments, in front of the patient ─────────────────

  it('says that a balance is due, never how much', async () => {
    invoices = [{ status: 'SENT', total: 1200, balanceDue: 850.5 }];

    const result = await run('patients.readBalance');

    expect(result.spokenFr).toBe('Un solde reste à payer. Le montant est à l\'écran.');
    expect(result.spokenText).not.toMatch(/\d/);
    // The amount is for the screen.
    expect(result.message).toContain('850.50');
  });

  it('says the account is settled when nothing is owed', async () => {
    invoices = [{ status: 'PAID', total: 400, balanceDue: 0 }];

    expect((await run('patients.readBalance')).spokenFr).toBe('Rien à payer, le compte est soldé.');
  });

  it('does not claim there is no appointment while the calendar is still loading', async () => {
    scheduleLoading = true;

    const result = await run('patients.readNextAppointment');

    expect(result.ok).toBe(false);
    expect(result.spokenFr).toBe('Le calendrier n\'est pas disponible pour l\'instant.');
  });

  it('does not claim there is no appointment after the calendar failed to load', async () => {
    scheduleError = 'Failed to load appointments.';

    expect((await run('patients.readNextAppointment')).ok).toBe(false);
  });

  it('says the window it looked in, since the calendar is bounded', async () => {
    const result = await run('patients.readNextAppointment');

    expect(result.spokenFr).toBe('Aucun rendez-vous dans les six prochains mois.');
  });

  it('reads the next future appointment of this patient only', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 9 * 86_400_000).toISOString();
    appointments = [
      { patientId: 'p-2', dateTime: new Date(Date.now() + 86_400_000).toISOString(), status: 'SCHEDULED' },
      { patientId: 'p-1', dateTime: later, status: 'SCHEDULED' },
      { patientId: 'p-1', dateTime: soon, status: 'SCHEDULED' },
      { patientId: 'p-1', dateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'CANCELLED' },
    ];

    const result = await run('patients.readNextAppointment');

    expect(result.ok).toBe(true);
    expect(result.spokenFr).toContain(new Date(soon).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));
  });
});

describe('VoiceCommandsService — a task for the team', () => {
  let registry: VoiceCommandRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ClinicalRecordService, useValue: {} },
        { provide: DentalChartService, useValue: {} },
        { provide: PatientService, useValue: { currentPatient: signal(null) } },
        { provide: ScheduleService, useValue: {} },
        { provide: InvoiceService, useValue: {} },
        { provide: VoiceContextService, useValue: {} },
        { provide: VoiceSessionService, useValue: {} },
        { provide: VoiceOrchestratorService, useValue: { buffered: () => [], sessionHooks: null } },
      ],
    });
    registry = TestBed.inject(VoiceCommandRegistryService);
    TestBed.inject(VoiceCommandsService).registerAll();
  });

  it('is a staged write that the server makes, never one the browser performs', () => {
    const command = registry.get('tasks.create')!;
    expect(command.risk).toBe('CONFIRM');
    expect(command.serverIntent).toBe('tasks.create');
    expect(command.execute).toBeUndefined();
  });

  it('shows who, when and what before it is staged', () => {
    const command = registry.get('tasks.create')!;
    expect(command.preview({ title: 'Order gloves', assigneeRole: 'ASSISTANT', dueDay: 'tomorrow', priority: 'URGENT' }, snapshot))
      .toBe('Task for reception, due tomorrow, urgent: "Order gloves"');
    expect(command.preview({ title: 'Relire le devis' }, snapshot)).toBe('Task: "Relire le devis"');
  });

  it('sends the server a calendar day, not the word for it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 6, 23, 50));
    try {
      const sent = registry.get('tasks.create')!.toServerEntities!(
        { title: ' Order gloves ', assigneeRole: 'ASSISTANT', dueDay: 'tomorrow', linkPatient: true }, snapshot);
      expect(sent).toMatchObject({ title: 'Order gloves', assigneeRole: 'ASSISTANT', dueDate: '2026-10-07', linkPatient: true });
      const own = registry.get('tasks.create')!.toServerEntities!({ title: 'x' }, snapshot);
      expect(own['dueDate']).toBeUndefined();
      expect(own['assigneeRole']).toBeUndefined();
      expect(own['linkPatient']).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
