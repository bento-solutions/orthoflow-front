import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PatientService } from '../services/patient.service';
import { DentalChartService } from '../services/dental-chart.service';
import { DENTITION_VIEWS, Dental3dViewService, DentitionView } from '../services/dental-3d-view.service';
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
import { spokenFindingLabel, spokenStagedList } from './voice-vocabulary';
import { WAKE_WORD } from './voice-wake';
import { isoDate } from '../utils/format';
import { ConsultationService } from '../consultation/consultation.service';
import { ConsultationFocusService, StageView } from '../consultation/consultation-focus.service';
import { CockpitModelService } from '../consultation/cockpit-model.service';
import { sectionReading, sectionSummary } from '../consultation/cockpit-speech';
import { FeedbackLevel, VoicePreferencesService } from './voice-preferences.service';
import { VoiceFeedbackService } from './voice-feedback.service';
import { spokenLanguage } from './voice-vocabulary';
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
const VIEW_WORDS: Readonly<Record<DentitionView, { fr: string; en: string }>> = {
  overview: { fr: `d'ensemble`, en: 'Overview' },
  panoramic: { fr: 'panoramique', en: 'Panoramic' },
  occlusal: { fr: 'occlusale', en: 'Occlusal' },
  lingual: { fr: 'linguale', en: 'Lingual' },
  arch: { fr: 'des arcades', en: 'Arch' },
};

/** A surface as the review line says it: "occlusal-mesialroot" reads "occlusal, mesial root". */
export function previewSurface(surface: string): string {
  const all = surface.split('-').filter(Boolean);
  const crown = all.filter(part => !part.endsWith('root')).join('-');
  const roots = all.filter(part => part.endsWith('root')).map(part => `${part.slice(0, -'root'.length)} root`);
  return [crown, ...roots].filter(Boolean).join(', ');
}

@Injectable({ providedIn: 'root' })
export class VoiceCommandsService {
  private registry = inject(VoiceCommandRegistryService);
  private clinical = inject(ClinicalRecordService);
  private chart = inject(DentalChartService);
  private chartView = inject(Dental3dViewService);
  private patients = inject(PatientService);
  private schedule = inject(ScheduleService);
  private invoices = inject(InvoiceService);
  private context = inject(VoiceContextService);
  private sessions = inject(VoiceSessionService);
  private orchestrator = inject(VoiceOrchestratorService);
  /** The consultation's services are reached lazily: they depend on the pipeline this registers into. */
  private injector = inject(Injector);

  /**
   * No navigation to another module or patient. Within the dossier, since Nov
   * 2026 the owner asked for the opposite of the old rule ("voice never changes
   * what is on screen"): during a consultation the screen follows the doctor,
   * and "montre les allergies", "zoom sur la 16", "retour" are one sentence each
   * — each undone by another ("retour", "toute la bouche").
   */
  registerAll(): void {
    this.registry.registerMany([
      ...this.sessionCommands(),
      ...this.viewCommands(),
      ...this.consultationCommands(),
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
      // Spoken, so it is being handled by the queue a wait would wait on.
      end: async () => { await this.sessions.end({ waitForClips: false }); },
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
            spokenFr: 'Examen démarré.',
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
          // reaches the record only when the dentist saves at review. Spoken,
          // so it is being handled by the queue a wait would wait on.
          await this.sessions.end({ waitForClips: false });
          return {
            ok: true,
            message: 'Examination ended. Review it on screen before saving.',
            spokenFr: 'Examen terminé. Le compte rendu est prêt à relire.',
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
          // What was dictated is staged, not in the clinical tables, until the
          // dentist saves — so the record is empty for a tooth just dictated.
          // Read what is staged: it is the only way to check by ear.
          const staged = this.orchestrator.buffered();
          if (staged.length > 0 && this.sessions.isActive()) {
            void this.sessions.refreshSummary().catch(() => undefined);
            return {
              ok: true,
              message: spokenStagedList(staged, 'en').text,
              spokenFr: spokenStagedList(staged, 'fr').text,
            };
          }
          const summary = await this.sessions.refreshSummary();
          if (!summary) {
            return {
              ok: true,
              message: 'No examination is running. Say "start examination" to begin one.',
              spokenFr: 'Aucun examen en cours.',
            };
          }
          return {
            ok: true,
            message: this.sessions.spokenSummary(summary),
            spokenFr: this.sessions.spokenSummary(summary, 'fr'),
          };
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
            return {
              ok: false,
              message: 'Say which finding to remove, and on which tooth.',
              spokenFr: 'Quelle constatation retirer, et sur quelle dent ?',
            };
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
            ? { ok: true, message: 'Removed from this examination.', spokenFr: 'Retiré.' }
            : { ok: false, message: 'Nothing removed.', spokenFr: 'Rien retiré.' };
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
          if (!undo) return { ok: false, message: 'There\'s nothing to undo.', spokenFr: 'Rien à annuler.' };
          await undo.run();
          return { ok: true, message: 'Undone.', spokenFr: 'Annulé.' };
        },
      },
    ];
  }

  // ── Dental chart ────────────────────────────────────────────────────

  /** Whether the consultation cockpit is on screen: then a section can be put on its stage. */
  private inCockpit(): boolean {
    const consultation = this.injector.get(ConsultationService);
    return consultation.isRecording() && consultation.cockpitEnabled();
  }

  /**
   * A chart command shows the chart first, in the cockpit. Elsewhere the chart
   * is where it is; a camera move asked while none is mounted waits for one.
   */
  private showChart(): void {
    if (this.inCockpit()) this.injector.get(ConsultationFocusService).show('chart');
  }

  private language(): 'fr' | 'en' {
    return spokenLanguage(this.context.locale());
  }

  /** The order a dentist goes round the mouth: upper right to upper left, lower left to lower right. */
  private archOrder(): string[] {
    const dentition = this.context.snapshot().dentition;
    const run = (quadrant: number, count: number, down: boolean) =>
      Array.from({ length: count }, (_, i) => `${quadrant}${down ? count - i : i + 1}`);
    return dentition === 'child'
      ? [...run(5, 5, true), ...run(6, 5, false), ...run(7, 5, true), ...run(8, 5, false)]
      : [...run(1, 8, true), ...run(2, 8, false), ...run(3, 8, true), ...run(4, 8, false)];
  }

  // ── What a consultation takes into its review ───────────────────────

  /**
   * Dictated with the wake word during a consultation, these never run here:
   * the pipeline hands them to the consultation's review (VoiceOrchestratorService
   * INTAKE_COMMANDS). Outside one there is no review to put them in.
   */
  private consultationCommands(): VoiceCommand[] {
    const only = async (): Promise<VoiceCommandResult> => ({
      ok: false, message: 'Available during a consultation.', spokenFr: 'Disponible pendant une consultation.',
    });
    return [
      {
        id: 'consultation.addPlanItem', description: 'Add a line to the consultation\'s treatment plan, with its teeth and its price',
        risk: 'SAFE', requiresPatient: true, args: { label: 'the treatment', teeth: 'FDI codes, comma-separated', price: 'dirhams', quantity: 'how many' },
        examples: ['plan : détartrage, 300 dirhams', 'ajoute au plan un composite sur la 16 et la 17, 400 dirhams chacun', 'plan: scaling, 300 dirhams'],
        preview: (entities) => `Plan: ${entities['label']}`, execute: only,
      },
      {
        id: 'consultation.setAppointment', description: 'Set the next appointment of the consultation',
        risk: 'SAFE', requiresPatient: true, args: { date: 'YYYY-MM-DD', time: 'HH:mm' },
        examples: ['rendez-vous demain à 10 heures', 'prochain rendez-vous dans 15 jours', 'appointment tomorrow at 10'],
        preview: (entities) => `Appointment ${entities['date']} ${entities['time'] ?? ''}`, execute: only,
      },
      {
        id: 'consultation.setField', description: 'Set or correct one of the patient\'s details: first name, last name, phone, ID card, age, date of birth, sex, insurer, policy number',
        risk: 'SAFE', requiresPatient: true, args: { field: 'firstName | lastName | phone | cin | age | dateOfBirth | gender | insuranceProvider | insuranceNumber', value: 'the value' },
        examples: ['prénom : Achraf', 'le prénom s\'écrit A, C, H, R, A, F', 'téléphone : 06 61 23 45 98', 'first name: Achraf'],
        preview: (entities) => `${entities['field']}: ${entities['value']}`, execute: only,
      },
    ];
  }

  // ── What is on screen ───────────────────────────────────────────────

  private viewCommands(): VoiceCommand[] {
    const names: Record<StageView, [string, string]> = {
      chart: ['Schéma.', 'Chart.'], allergies: ['Allergies.', 'Allergies.'], history: ['Antécédents.', 'History.'],
      treatments: ['Traitements.', 'Treatments.'], plan: ['Plan.', 'Plan.'], appointment: ['Rendez-vous.', 'Appointment.'],
      patient: ['Patient.', 'Patient.'], summary: ['Résumé.', 'Summary.'], findings: ['Constatations.', 'Findings.'],
      transcript: ['Conversation.', 'Conversation.'], help: ['Aide.', 'Help.'],
    };
    const onlyInConsultation: VoiceCommandResult = {
      ok: false, message: 'Available during a consultation.', spokenFr: 'Disponible pendant une consultation.',
    };
    const model = () => this.injector.get(CockpitModelService);
    const focus = () => this.injector.get(ConsultationFocusService);
    const view = (entities: Record<string, unknown>) => String(entities['target'] ?? 'chart') as StageView;

    return [
      {
        id: 'ui.show',
        description: 'Show a part of the consultation: the 3D chart, allergies, history, current treatments, the plan, the appointment, the patient details, the findings, the conversation or the summary',
        risk: 'SAFE',
        requiresPatient: true,
        args: { target: 'chart | allergies | history | treatments | plan | appointment | patient | findings | transcript | summary' },
        examples: ['je veux voir la vue 3D', 'montre les allergies', 'plan de traitement', 'ses informations', 'show the allergies', 'treatment plan'],
        preview: (entities) => `Show ${view(entities)}`,
        execute: async (entities) => {
          const target = view(entities);
          const [fr, en] = names[target];
          if (!this.inCockpit()) {
            // No stage to switch: the chart is already where it is, and anything else is read.
            if (target === 'chart') return { ok: true, message: 'The chart is on screen.', spokenFr: 'Le schéma est à l\'écran.' };
            return { ok: true, message: sectionReading(target, model(), 'en'), spokenFr: sectionReading(target, model(), 'fr'), briefFr: fr, briefText: en };
          }
          focus().show(target);
          return { ok: true, message: sectionSummary(target, model(), 'en'), spokenFr: sectionSummary(target, model(), 'fr'), briefFr: fr, briefText: en };
        },
      },
      {
        id: 'ui.back',
        description: 'Go back to the previous view of the consultation',
        risk: 'SAFE',
        requiresPatient: true,
        args: {},
        examples: ['retour', 'vue précédente', 'go back'],
        preview: () => 'Previous view',
        execute: async () => {
          if (!this.inCockpit()) return onlyInConsultation;
          return focus().back()
            ? { ok: true, message: 'Back.', spokenFr: 'Retour.' }
            : { ok: false, message: 'No previous view.', spokenFr: 'Pas de vue précédente.' };
        },
      },
      {
        id: 'ui.pin',
        description: 'Keep the current view: the screen stops following the last change',
        risk: 'SAFE',
        requiresPatient: true,
        args: {},
        examples: ['garde cette vue', 'keep this view'],
        preview: () => 'Keep this view',
        execute: async () => {
          if (!this.inCockpit()) return onlyInConsultation;
          focus().pin();
          return { ok: true, message: 'View kept.', spokenFr: 'Vue gardée.' };
        },
      },
      {
        id: 'ui.unpin',
        description: 'Let the screen follow the last change again',
        risk: 'SAFE',
        requiresPatient: true,
        args: {},
        examples: ['suis-moi', 'follow me'],
        preview: () => 'Follow the last change',
        execute: async () => {
          if (!this.inCockpit()) return onlyInConsultation;
          focus().unpin();
          return { ok: true, message: 'Following.', spokenFr: 'Je suis.' };
        },
      },
      {
        id: 'ui.read',
        description: 'Read a part of the consultation aloud: allergies, history, current treatments, plan, appointment, patient details, findings or summary',
        risk: 'SAFE',
        requiresPatient: true,
        args: { target: 'allergies | history | treatments | plan | appointment | patient | findings | summary' },
        examples: ['lis les allergies', 'quelles sont ses allergies', 'relis le plan', 'read the allergies'],
        preview: (entities) => `Read ${view(entities)}`,
        execute: async (entities) => {
          const target = view(entities);
          return { ok: true, message: sectionReading(target, model(), 'en'), spokenFr: sectionReading(target, model(), 'fr') };
        },
      },
      {
        id: 'help.show',
        description: 'Show what can be said',
        risk: 'SAFE',
        args: {},
        examples: ['aide', 'qu\'est-ce que je peux dire', 'help'],
        preview: () => 'Help',
        execute: async () => {
          if (this.inCockpit()) focus().show('help');
          return {
            ok: true,
            message: 'Dictate: "tooth 16, occlusal caries". See: "show the allergies", "treatment plan", "back".',
            spokenFr: 'Dictez : « dent 16, carie occlusale ». Voir : « montre les allergies », « plan de traitement », « retour ».',
          };
        },
      },
      {
        id: 'voice.repeat',
        description: 'Say the last confirmation again',
        risk: 'SAFE',
        args: {},
        examples: ['répète', 'qu\'est-ce que tu as compris', 'repeat'],
        preview: () => 'Repeat',
        execute: async () => {
          const last = this.injector.get(VoiceFeedbackService).last();
          if (!last) return { ok: false, message: 'Nothing to repeat yet.', spokenFr: 'Rien à répéter pour l\'instant.' };
          return { ok: true, message: last.text, spokenFr: last.text, spokenText: last.text };
        },
      },
      {
        id: 'feedback.set',
        description: 'How much is said back for the rest of this consultation: full, brief, tones only or silent',
        risk: 'SAFE',
        args: { level: 'full | brief | tones | silent' },
        examples: ['silence', 'confirmations brèves', 'sons seulement', 'parle', 'be quiet'],
        preview: (entities) => `Feedback: ${entities['level']}`,
        execute: async (entities) => {
          const level = String(entities['level'] ?? 'full') as FeedbackLevel;
          this.injector.get(VoicePreferencesService).setSessionLevel(level);
          if (level === 'silent') {
            // Cuts what is being said; and says nothing, which is what was asked.
            this.injector.get(VoiceFeedbackService).cancel();
            return { ok: true, message: 'Silent.', spokenFr: 'Silence.', quiet: true };
          }
          const said: Record<string, [string, string]> = {
            full: ['Confirmations complètes.', 'Full confirmations.'], brief: ['Confirmations brèves.', 'Brief confirmations.'],
            tones: ['Sons seulement.', 'Tones only.'],
          };
          return { ok: true, message: said[level][1], spokenFr: said[level][0] };
        },
      },
      {
        id: 'chart.zoom',
        description: 'Move the 3D chart\'s camera closer or further',
        risk: 'SAFE',
        requiresPatient: true,
        args: { direction: 'in | out', steps: '1 to 3' },
        examples: ['zoom avant', 'dézoome', 'plus près', 'zoom in', 'zoom out'],
        preview: (entities) => `Zoom ${entities['direction']}`,
        execute: async (entities) => {
          this.showChart();
          const direction = entities['direction'] === 'out' ? 'out' : 'in';
          const steps = Number(entities['steps'] ?? 1) || 1;
          const limit = this.chartView.atLimit();
          if (direction === 'out' && this.chartView.zoomedFdi() && limit === 'far') {
            // At the furthest a close-up allows, further out is the whole mouth.
            this.chartView.zoomedFdi.set(null);
            return { ok: true, message: 'The whole mouth.', spokenFr: 'Toute la bouche.' };
          }
          if (direction === 'in' && limit === 'near') return { ok: true, message: 'Maximum zoom.', spokenFr: 'Zoom maximum.' };
          if (direction === 'out' && limit === 'far' && !this.chartView.zoomedFdi()) return { ok: true, message: 'Furthest out.', spokenFr: 'Zoom minimum.' };
          this.chartView.zoom(direction, steps);
          return direction === 'in'
            ? { ok: true, message: 'Zoom in.', spokenFr: 'Zoom avant.' }
            : { ok: true, message: 'Zoom out.', spokenFr: 'Zoom arrière.' };
        },
      },
      {
        id: 'chart.rotate',
        description: 'Turn the 3D chart left, right, up, down, or to the other side',
        risk: 'SAFE',
        requiresPatient: true,
        args: { direction: 'left | right | up | down | flip' },
        examples: ['tourne à gauche', 'tourne vers le haut', 'l\'autre côté', 'turn left'],
        preview: (entities) => `Turn ${entities['direction']}`,
        execute: async (entities) => {
          this.showChart();
          const direction = String(entities['direction'] ?? 'left') as 'left' | 'right' | 'up' | 'down' | 'flip';
          this.chartView.rotate(direction);
          const fr: Record<string, string> = { left: 'À gauche.', right: 'À droite.', up: 'Vers le haut.', down: 'Vers le bas.', flip: 'L\'autre côté.' };
          return { ok: true, message: `Turned ${direction}.`, spokenFr: fr[direction] ?? 'Tourné.' };
        },
      },
      {
        id: 'chart.reset',
        description: 'The whole mouth again, camera reset',
        risk: 'SAFE',
        requiresPatient: true,
        args: {},
        examples: ['toute la bouche', 'vue complète', 'réinitialise la vue', 'whole mouth'],
        preview: () => 'Whole mouth',
        execute: async () => {
          this.showChart();
          this.chartView.zoomedFdi.set(null);
          this.chartView.resetCamera();
          return { ok: true, message: 'The whole mouth.', spokenFr: 'Toute la bouche.' };
        },
      },
      {
        id: 'chart.step',
        description: 'The next or the previous tooth along the arch, alone in close-up',
        risk: 'SAFE',
        requiresPatient: true,
        args: { delta: '1 for the next tooth, -1 for the previous one' },
        examples: ['dent suivante', 'dent précédente', 'next tooth'],
        preview: (entities) => (Number(entities['delta']) < 0 ? 'Previous tooth' : 'Next tooth'),
        execute: async (entities) => {
          this.showChart();
          const order = this.archOrder();
          const from = this.chartView.zoomedFdi() ?? this.context.selectedFdi() ?? null;
          const index = from ? order.indexOf(from) : -1;
          const delta = Number(entities['delta']) < 0 ? -1 : 1;
          const next = index < 0 ? order[0] : order[(index + delta + order.length) % order.length];
          this.chartView.zoomedFdi.set(next);
          this.context.selectTooth(next);
          return { ok: true, message: `Tooth ${next}.`, spokenFr: `Dent ${next}.`, highlightFdi: next };
        },
      },
    ];
  }

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
            certainty: f.certainty ?? undefined,
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
          const fdi = String(entities['fdi'] ?? '') || context.lastWrite?.fdi;
          const labels = this.findingsOf(entities).map(f => f.label).join(', ');
          return fdi
            ? `Correct tooth ${fdi} (${describeFdi(fdi)}) to: ${labels}`
            : `Correct the last entry to: ${labels}`;
        },
        // While an examination is being dictated nothing is on the record: the
        // last write is a staged entry, and its id is an audit row, not a
        // finding. The orchestrator replaces that entry, so there is nothing
        // to retract. Only a write that reached the record carries finding ids.
        toServerEntities: (entities, context) => ({
          // A correction that moves the entry names its tooth; a plain "no,
          // actually…" does not and stays on the tooth of the last write.
          fdi: String(entities['fdi'] ?? '') || context.lastWrite?.fdi || '',
          ...(context.lastWrite?.targetType === 'BufferedCommand' || entities['replaceAuditId']
            ? {}
            : { retractIds: (context.lastWrite?.targetId ?? '').split(',').filter(Boolean) }),
          findings: this.findingsOf(entities).map(f => ({
            code: f.code,
            surface: f.surface ?? undefined,
            severity: f.severity ?? undefined,
            certainty: f.certainty ?? undefined,
          })),
        }),
        onServerExecuted: (audit, entities, context) => {
          const result = this.findingsRecorded(audit, entities, context);
          return { ...result, message: `Corrected. ${result.message}` };
        },
      },
      {
        id: 'chart.reclassifyFinding',
        description: 'Replace a finding on a tooth with the right one: "not caries, it\'s inflammation"',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addFindings',
        args: { fdi: 'FDI tooth code', from: 'the finding that was wrong', findings: 'what it really is' },
        examples: ['not caries, it\'s inflammation', 'ce n\'est pas une carie, c\'est une inflammation'],
        preview: (entities) => {
          const fdi = String(entities['fdi'] ?? '');
          const wrong = this.fromOf(entities).map(f => f.label ?? findingLabel(f.code)).join(', ');
          const right = this.findingsOf(entities).map(f => f.label ?? findingLabel(f.code)).join(', ');
          return `Tooth ${fdi} (${describeFdi(fdi)}): not ${wrong}, but ${right}`;
        },
        // The server withdraws what is on the tooth under those codes when the
        // command executes, and records the replacement in the same transaction.
        toServerEntities: (entities) => ({
          fdi: String(entities['fdi'] ?? ''),
          retractCodes: this.fromOf(entities).map(f => f.code),
          findings: this.findingsOf(entities).map(f => ({
            code: f.code,
            surface: f.surface ?? undefined,
            severity: f.severity ?? undefined,
            certainty: f.certainty ?? undefined,
          })),
        }),
        onServerExecuted: (audit, entities, context) => {
          const result = this.findingsRecorded(audit, entities, context);
          return { ...result, message: `Corrected. ${result.message}` };
        },
      },
      {
        id: 'chart.moveFindings',
        description: 'Move an entry to the right tooth: "forget tooth 16, this is 17"',
        risk: 'CONFIRM',
        requiresPatient: true,
        serverIntent: 'clinical.addFindings',
        args: { fromFdi: 'the tooth it was recorded on by mistake', fdi: 'the tooth it belongs to' },
        examples: ['forget tooth 16, this is 17', 'oublie la 16, c\'est la 17'],
        preview: (entities) => {
          const fdi = String(entities['fdi'] ?? '');
          return `Move the entry from tooth ${String(entities['fromFdi'] ?? '')} to tooth ${fdi} (${describeFdi(fdi)})`;
        },
        toServerEntities: (entities) => ({
          fdi: String(entities['fdi'] ?? ''),
          findings: this.findingsOf(entities).map(f => ({
            code: f.code,
            surface: f.surface ?? undefined,
            severity: f.severity ?? undefined,
            certainty: f.certainty ?? undefined,
          })),
        }),
        onServerExecuted: (audit, entities, context) => this.findingsRecorded(audit, entities, context),
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
          const labels = this.findingsOf(entities).map(f => f.label ?? findingLabel(f.code)).join(', ');
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
          return { ok: true, message: `Tooth ${fdi} — ${describeFdi(fdi)}`, spokenFr: `Dent ${fdi}.`, highlightFdi: fdi };
        },
      },
      {
        id: 'chart.setView',
        description: 'Change how the teeth are arranged on the 3D chart: overview (the mouth: arches with the gums, the palate, the gum state and the tartar), panoramic (the arches unrolled, every crown and root), occlusal (biting surfaces), lingual (tongue side) or arch (the arches, teeth only)',
        risk: 'SAFE',
        requiresPatient: true,
        args: { view: 'overview, panoramic, occlusal, lingual or arch' },
        examples: ['occlusal view', 'vue linguale', 'show the arches', 'vue panoramique'],
        preview: (entities) => `Show the ${String(entities['view'])} view`,
        execute: async (entities) => {
          const view = String(entities['view']) as DentitionView;
          if (!DENTITION_VIEWS.includes(view)) {
            return { ok: false, message: `There is no ${view} view.`, spokenFr: `Cette vue n'existe pas.` };
          }
          this.showChart();
          this.chartView.zoomedFdi.set(null);
          this.chartView.view.set(view);
          return { ok: true, message: `${VIEW_WORDS[view].en} view.`, spokenFr: `Vue ${VIEW_WORDS[view].fr}.` };
        },
      },
      {
        id: 'chart.gums',
        description: 'Show or hide the gums and the palate on the 3D mouth view (overview): hidden, the arches show their teeth and roots alone',
        risk: 'SAFE',
        requiresPatient: true,
        args: { show: 'true to show the gums and the palate, false to hide them' },
        examples: ['hide the gums', 'cache les gencives', 'show the gums', 'affiche les gencives'],
        preview: (entities) => (entities['show'] === false ? 'Hide the gums' : 'Show the gums'),
        execute: async (entities) => {
          const show = entities['show'] !== false;
          this.showChart();
          this.chartView.zoomedFdi.set(null);
          // The gums belong to the mouth view: asking for them is asking for it.
          if (show) this.chartView.view.set('overview');
          this.chartView.showGums(show);
          return show
            ? { ok: true, message: 'Gums and palate shown.', spokenFr: 'Gencives affichées.' }
            : { ok: true, message: 'Gums and palate hidden.', spokenFr: 'Gencives masquées.' };
        },
      },
      {
        id: 'chart.zoomTooth',
        description: 'Close in on one tooth on the 3D chart, or with no tooth go back to the whole mouth',
        risk: 'SAFE',
        requiresPatient: true,
        args: { fdi: 'FDI tooth code; omit for the whole mouth' },
        examples: ['zoom on tooth 16', 'zoom sur la 26', 'whole mouth'],
        preview: (entities) => (entities['fdi'] ? `Zoom on tooth ${entities['fdi']}` : 'Back to the whole mouth'),
        execute: async (entities) => {
          this.showChart();
          const fdi = entities['fdi'] ? String(entities['fdi']) : null;
          this.chartView.zoomedFdi.set(fdi);
          if (!fdi) return { ok: true, message: 'The whole mouth.', spokenFr: 'Toute la bouche.' };
          this.context.selectTooth(fdi);
          return { ok: true, message: `Tooth ${fdi}, close up.`, spokenFr: `Dent ${fdi}, en gros plan.`, highlightFdi: fdi };
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

          // Dictated during this examination and not yet saved: not on the
          // record, so without this "read tooth 16" answers "nothing" for the
          // tooth just dictated.
          const staged = [...new Set(this.orchestrator.buffered()
            .filter(entry => entry.intent === 'clinical.addFindings' && entityString(entry.entities, 'fdi') === fdi)
            .flatMap(entry => stagedFindingCodes(entry.entities)))];
          const recorded = findings.map(f => f.findingCode).filter(code => !staged.includes(code));

          if (staged.length === 0 && recorded.length === 0) {
            return {
              ok: true,
              message: `Tooth ${fdi} (${describeFdi(fdi)}) has nothing recorded.`,
              spokenFr: `Dent ${fdi} : rien d'enregistré.`,
              highlightFdi: fdi,
            };
          }
          const en = (codes: string[]) => codes.map(code => findingLabel(code)).join(', ');
          const fr = (codes: string[]) => codes.map(code => spokenFindingLabel(code, 'fr')).join(', ');
          const parts = (join: (codes: string[]) => string, language: 'fr' | 'en') => {
            const out: string[] = [];
            if (staged.length) out.push(`${language === 'fr' ? 'à enregistrer' : 'to be saved'} ${join(staged)}`);
            if (recorded.length) out.push(`${language === 'fr' ? 'au dossier' : 'on record'} ${join(recorded)}`);
            return out.join(language === 'fr' ? ' ; ' : '; ');
          };
          return {
            ok: true,
            message: `Tooth ${fdi} — ${parts(en, 'en')}.`,
            spokenFr: `Dent ${fdi} : ${parts(fr, 'fr')}.`,
            highlightFdi: fdi,
          };
        },
      },
    ];
  }

  /** The findings a correction says were wrong. */
  private fromOf(entities: Record<string, unknown>): FindingEntity[] {
    const raw = entities['from'];
    return Array.isArray(raw) ? raw as FindingEntity[] : [];
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
      if (f.surface) parts.push(previewSurface(f.surface));
      if (f.note && /^(?:\d+(?:\.\d+)? mm|grade \w+)$/.test(f.note)) parts.push(f.note);
      if (f.certainty === 'SUSPECTED') parts.push('suspected');
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
      {
        id: 'tasks.create',
        description: 'Create a task for the team (reception, the doctor, the administrator), with an optional day',
        risk: 'CONFIRM',
        requiresPatient: true,
        // Staged with the consultation and made when the doctor saves it, like every other write said
        // aloud: nothing reaches the team before the doctor has reviewed it.
        serverIntent: 'tasks.create',
        args: {
          title: 'what is to be done, in the doctor\'s own words',
          assigneeRole: 'ASSISTANT (reception) | DOCTOR | ADMIN; omitted when the task is the doctor\'s own',
          dueDay: 'today | tomorrow, when said',
          priority: 'URGENT when said to be urgent',
        },
        examples: [
          'create a task for reception: call the patient back tomorrow',
          'crée une tâche pour l\'accueil : commander des gants',
        ],
        preview: (entities) => {
          const who = { ASSISTANT: ' for reception', DOCTOR: ' for the doctor', ADMIN: ' for the administrator' }[
            String(entities['assigneeRole'] ?? '')] ?? '';
          const day = entities['dueDay'] === 'tomorrow' ? ', due tomorrow' : entities['dueDay'] === 'today' ? ', due today' : '';
          const urgent = entities['priority'] === 'URGENT' ? ', urgent' : '';
          return `Task${who}${day}${urgent}: "${entities['title']}"`;
        },
        toServerEntities: (entities) => {
          const due = new Date();
          if (entities['dueDay'] === 'tomorrow') due.setDate(due.getDate() + 1);
          return {
            title: String(entities['title'] ?? '').trim(),
            assigneeRole: entities['assigneeRole'] ? String(entities['assigneeRole']) : undefined,
            dueDate: entities['dueDay'] ? isoDate(due) : undefined,
            dueDay: entities['dueDay'] ? String(entities['dueDay']) : undefined,
            priority: entities['priority'] ? String(entities['priority']) : undefined,
            linkPatient: entities['linkPatient'] === true ? true : undefined,
          };
        },
        onServerExecuted: (audit) => ({
          ok: true,
          message: 'Task created.',
          targetType: 'task',
          targetId: audit.targetId ?? undefined,
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
            // Said in front of the patient, so only whether something is owed —
            // the amount is on screen.
            spokenFr: outstanding > 0
              ? 'Un solde reste à payer. Le montant est à l\'écran.'
              : 'Rien à payer, le compte est soldé.',
            spokenText: outstanding > 0
              ? 'A balance is due. The amount is on screen.'
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
          // The calendar loads in the background and covers a bounded window.
          // An answer of "none" while it is still loading, or after it failed,
          // is a wrong answer said with confidence.
          if (this.schedule.loading() || this.schedule.error()) {
            return {
              ok: false,
              message: 'The appointment calendar is not available right now.',
              spokenFr: 'Le calendrier n\'est pas disponible pour l\'instant.',
            };
          }
          const now = Date.now();
          const next = this.schedule.appointments()
            .filter(a => a.patientId === context.patientId && a.status !== 'CANCELLED')
            .filter(a => new Date(a.dateTime).getTime() >= now)
            .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())[0];
          if (!next) {
            return {
              ok: true,
              message: 'No appointment is booked in the next six months.',
              spokenFr: 'Aucun rendez-vous dans les six prochains mois.',
            };
          }
          const when = new Date(next.dateTime);
          return {
            ok: true,
            message: `Next appointment: ${when.toLocaleString()}.`,
            spokenFr: `Prochain rendez-vous : ${when.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`,
          };
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
      execute: async () => ({
        ok: false,
        message: `${description} has to be done on screen.`,
        spokenFr: 'Cela se fait à l\'écran, pas à la voix.',
      }),
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
