import { UtteranceEvent } from '../voice/voice-intent.model';
import { ReviewState } from './consultation-draft';
import { ActionInput, StageView } from './consultation-focus.service';

/**
 * What changed in a consultation, in the terms the cockpit shows it: which
 * section, which row, and a line for the last-action card.
 */
export interface ReviewChange {
  list: 'patient' | 'complaint' | 'allergies' | 'medicalHistory' | 'activeTreatments' | 'plan' | 'appointment';
  key: string;
  kind: 'added' | 'changed' | 'removed';
  /** "Allergie : ananas" */
  label: string;
}

const VIEW_OF_LIST: Readonly<Record<ReviewChange['list'], StageView>> = {
  patient: 'patient',
  complaint: 'summary',
  allergies: 'allergies',
  medicalHistory: 'history',
  activeTreatments: 'treatments',
  plan: 'plan',
  appointment: 'appointment',
};

export function viewOfList(list: ReviewChange['list']): StageView {
  return VIEW_OF_LIST[list];
}

type Labeller = (change: Omit<ReviewChange, 'label'>, state: ReviewState) => string;

/** Every change between two review states, in the order the sections are shown. */
export function diffReview(before: ReviewState, after: ReviewState, label: Labeller = defaultLabel): ReviewChange[] {
  const changes: ReviewChange[] = [];
  const push = (change: Omit<ReviewChange, 'label'>) => changes.push({ ...change, label: label(change, after) });

  for (const list of ['allergies', 'medicalHistory', 'activeTreatments', 'plan'] as const) {
    type Item = { key: string; status: string; data: unknown };
    const old = new Map<string, Item>((before[list] as Item[]).map(item => [item.key, item]));
    for (const item of after[list] as Item[]) {
      const previous = old.get(item.key);
      if (!previous) {
        if (item.status !== 'removed') push({ list, key: item.key, kind: 'added' });
      } else if (item.status === 'removed' && previous.status !== 'removed') {
        push({ list, key: item.key, kind: 'removed' });
      } else if (JSON.stringify(previous.data) !== JSON.stringify(item.data)) {
        push({ list, key: item.key, kind: 'changed' });
      }
    }
  }
  for (const [name, field] of Object.entries(after.patient)) {
    const previous = before.patient[name as keyof ReviewState['patient']];
    if (!field) continue;
    if (!previous) push({ list: 'patient', key: name, kind: 'added' });
    else if (previous.value !== field.value) push({ list: 'patient', key: name, kind: 'changed' });
  }
  if (after.chiefComplaint && after.chiefComplaint.value !== before.chiefComplaint?.value) {
    push({ list: 'complaint', key: 'chiefComplaint', kind: before.chiefComplaint ? 'changed' : 'added' });
  }
  const suggested = (state: ReviewState) => JSON.stringify(state.appointmentSuggestion ?? null) + JSON.stringify(state.appointment ?? null);
  if (suggested(before) !== suggested(after) && (after.appointment || after.appointmentSuggestion)) {
    push({ list: 'appointment', key: 'appointment', kind: before.appointment || before.appointmentSuggestion ? 'changed' : 'added' });
  }
  return changes;
}

function defaultLabel(change: Omit<ReviewChange, 'label'>, state: ReviewState): string {
  switch (change.list) {
    case 'allergies': return state.allergies.find(i => i.key === change.key)?.data.substance ?? change.key;
    case 'medicalHistory': return state.medicalHistory.find(i => i.key === change.key)?.data.label ?? change.key;
    case 'activeTreatments': return state.activeTreatments.find(i => i.key === change.key)?.data.label ?? change.key;
    case 'plan': return state.plan.find(i => i.key === change.key)?.data.label ?? change.key;
    case 'patient': return String(state.patient[change.key as keyof ReviewState['patient']]?.value ?? '');
    case 'complaint': return state.chiefComplaint?.value ?? '';
    case 'appointment': {
      const a = state.appointment ?? (state.appointmentSuggestion ? { date: state.appointmentSuggestion.date, time: state.appointmentSuggestion.time } : null);
      return a ? [a.date, a.time].filter(Boolean).join(' ') : '';
    }
  }
}

/** The view an intent's result belongs on. */
export function viewOfIntent(intent: string): StageView | null {
  if (intent.startsWith('chart.') || intent === 'clinical.addFindings' || intent === 'clinical.retractFindings') return 'chart';
  if (intent === 'clinical.addAllergy') return 'allergies';
  if (intent === 'clinical.addMedicalHistory') return 'history';
  if (intent === 'consultation.addPlanItem') return 'plan';
  if (intent === 'consultation.setAppointment') return 'appointment';
  if (intent === 'consultation.setField') return 'patient';
  if (intent === 'clinical.addNote' || intent === 'tasks.create' || intent === 'schedule.followUp') return 'summary';
  return null;
}

/**
 * The last-action card for one utterance, or null when nothing changed that the
 * doctor needs to see (conversation, another language, a bare wake word).
 * A view command moves the stage itself and only updates the card.
 */
export function actionFromUtterance(event: UtteranceEvent): ActionInput | null {
  if (event.verdict === 'heard' || event.verdict === 'other-language') return null;
  if (event.verdict === 'unsure') {
    return {
      kind: 'unsure', title: event.summary ?? event.text, detail: null, status: 'not-understood',
      heard: event.text, target: null, undoable: false, source: 'voice',
    };
  }
  if (event.verdict === 'control' && !event.summary) return null;
  const intent = event.intents.find(id => viewOfIntent(id) !== null) ?? event.intents[0] ?? '';
  const view = viewOfIntent(intent);
  const isView = intent.startsWith('ui.') || intent === 'help.show'
    || ['chart.zoom', 'chart.zoomTooth', 'chart.rotate', 'chart.reset', 'chart.step', 'chart.setView', 'chart.selectTooth', 'chart.readTooth'].includes(intent);
  const writesChart = view === 'chart' && !isView;
  return {
    kind: isView ? 'view' : writesChart ? 'chart' : view ? 'intake' : 'control',
    title: event.summary ?? event.text,
    detail: null,
    status: event.verdict === 'acted' && !isView ? 'noted' : null,
    heard: event.text,
    target: isView || !view ? null : { view, fdi: event.fdi[0] },
    undoable: event.auditIds.length > 0,
    source: 'voice',
  };
}
