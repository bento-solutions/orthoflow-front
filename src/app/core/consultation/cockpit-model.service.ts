import { Injectable, computed, inject } from '@angular/core';
import { ClinicalRecordService } from '../services/clinical-record.service';
import { PatientService } from '../services/patient.service';
import { VoiceOrchestratorService, summaryOf } from '../voice/voice-orchestrator.service';
import { VoiceContextService } from '../voice/voice-context.service';
import { spokenLanguage } from '../voice/voice-vocabulary';
import { ConsultationService } from './consultation.service';
import { PATIENT_FIELDS, ReviewItem, ReviewStatus, planTotal } from './consultation-draft';
import { StageView } from './consultation-focus.service';

/** How a line of "this consultation" came to be, shown as its chip. */
export type LineStatus = 'dictated' | 'proposed' | 'validated' | 'to-confirm';

export interface CockpitLine {
  key: string;
  label: string;
  detail: string | null;
  status: LineStatus | null;
  quote: string | null;
}

function statusOf(item: { status: ReviewStatus; dictated?: boolean; manual?: boolean }): LineStatus {
  if (item.dictated) return 'dictated';
  if (item.status === 'proposed') return 'proposed';
  return 'validated';
}

function live<T>(items: ReviewItem<T>[]): ReviewItem<T>[] {
  return items.filter(item => item.status !== 'removed');
}

/**
 * What each section of the cockpit shows: what is **on record** for the patient
 * and what **this consultation** adds, apart, each line with how it came to be.
 * One place, so the rail's counts and the sections never disagree.
 */
@Injectable({ providedIn: 'root' })
export class CockpitModelService {
  private readonly c = inject(ConsultationService);
  private readonly clinical = inject(ClinicalRecordService);
  private readonly patients = inject(PatientService);
  private readonly voice = inject(VoiceOrchestratorService);
  private readonly context = inject(VoiceContextService);

  readonly allergiesOnRecord = computed<CockpitLine[]>(() => (this.clinical.record()?.allergies ?? []).map(a => ({
    key: `record:${a.id}`, label: a.substance ?? '', detail: a.reaction ?? null, status: null, quote: null,
  })));
  readonly allergiesNow = computed<CockpitLine[]>(() => live(this.c.review().allergies).map(item => ({
    key: item.key, label: item.data.substance, detail: item.data.reaction, status: statusOf(item), quote: item.quote,
  })));

  private readonly historyRecord = computed(() => this.clinical.record()?.medicalHistory ?? []);
  readonly historyOnRecord = computed<CockpitLine[]>(() => this.historyRecord()
    .filter(h => h.category !== 'MEDICATION')
    .map(h => ({ key: `record:${h.id}`, label: h.label ?? '', detail: h.detail ?? null, status: null, quote: null })));
  readonly historyNow = computed<CockpitLine[]>(() => live(this.c.review().medicalHistory).map(item => ({
    key: item.key, label: item.data.label, detail: item.data.detail, status: statusOf(item), quote: item.quote,
  })));

  readonly treatmentsOnRecord = computed<CockpitLine[]>(() => this.historyRecord()
    .filter(h => h.category === 'MEDICATION')
    .map(h => ({ key: `record:${h.id}`, label: h.label ?? '', detail: h.detail ?? null, status: null, quote: null })));
  readonly treatmentsNow = computed<CockpitLine[]>(() => live(this.c.review().activeTreatments).map(item => ({
    key: item.key, label: item.data.label, detail: item.data.detail, status: statusOf(item), quote: item.quote,
  })));

  readonly planNow = computed(() => live(this.c.review().plan).map(item => ({
    key: item.key,
    label: item.data.label,
    teeth: item.data.teeth,
    price: item.data.price,
    quantity: item.data.quantity,
    status: statusOf(item),
    quote: item.quote,
  })));
  readonly planSummary = computed(() => planTotal(live(this.c.review().plan).map(item => item.data)));

  readonly appointment = computed(() => this.c.review().appointment);
  readonly appointmentSuggestion = computed(() => this.c.review().appointmentSuggestion);

  readonly patient = computed(() => this.patients.currentPatient());
  /** Each patient field: what the record says, and what this consultation proposes or dictated. */
  readonly patientFields = computed(() => {
    const p = this.patient() as unknown as Record<string, unknown> | null;
    const review = this.c.review().patient;
    return PATIENT_FIELDS.map(name => {
      const field = review[name];
      return {
        name,
        record: p ? (p[name] ?? null) as string | number | null : null,
        now: field && field.status !== 'removed' ? field.value : null,
        status: field && field.status !== 'removed' ? statusOf(field) : null,
        quote: field?.quote ?? null,
      };
    });
  });

  readonly complaint = computed(() => {
    const field = this.c.review().chiefComplaint;
    return field && field.status !== 'removed' ? { text: field.value, status: statusOf(field), quote: field.quote } : null;
  });

  /** What was dictated onto the chart, in the doctor's language. */
  readonly chartLines = computed<CockpitLine[]>(() => {
    const language = spokenLanguage(this.context.locale());
    return this.voice.buffered()
      .filter(entry => entry.intent === 'clinical.addFindings' || entry.intent === 'clinical.retractFindings')
      .map(entry => ({
        key: entry.auditId,
        label: summaryOf(entry, language),
        detail: null,
        status: entry.needsConfirmation ? 'to-confirm' as const : 'dictated' as const,
        quote: entry.transcript,
      }));
  });
  /** Notes and tasks dictated: not chart findings, shown in the summary. */
  readonly noteLines = computed<CockpitLine[]>(() => {
    const language = spokenLanguage(this.context.locale());
    return this.voice.buffered()
      .filter(entry => entry.intent !== 'clinical.addFindings' && entry.intent !== 'clinical.retractFindings')
      .map(entry => ({ key: entry.auditId, label: summaryOf(entry, language), detail: null, status: 'dictated' as const, quote: entry.transcript }));
  });

  readonly allergyBadges = computed(() => {
    const seen = new Set<string>();
    const out: { label: string; fromRecord: boolean }[] = [];
    for (const line of [...this.allergiesOnRecord().map(l => ({ ...l, fromRecord: true })), ...this.allergiesNow().map(l => ({ ...l, fromRecord: false }))]) {
      const key = line.label.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ label: line.label, fromRecord: line.fromRecord });
    }
    return out;
  });

  /** The rail's count per section: what is in it, record and consultation together. */
  readonly counts = computed<Partial<Record<StageView, number>>>(() => ({
    chart: this.chartLines().length,
    allergies: this.allergiesOnRecord().length + this.allergiesNow().length,
    history: this.historyOnRecord().length + this.historyNow().length,
    treatments: this.treatmentsOnRecord().length + this.treatmentsNow().length,
    plan: this.planNow().length,
    appointment: this.appointment() || this.appointmentSuggestion() ? 1 : 0,
    summary: this.noteLines().length + (this.complaint() ? 1 : 0),
    transcript: this.c.lines().length,
  }));
}
