/**
 * What kind of thing each command is, which decides how it may be reached.
 *
 * - **chart** — dictation onto the chart. Without the wake word only when the
 *   sentence is plainly dictation (it names a tooth and a finding), or, in the
 *   follow-up window, a bare finding said on the tooth in hand.
 * - **correction** — "non, en fait…", "annule", "enlève la carie sur la 16".
 *   Free in the follow-up window: it only ever edits what was just staged.
 * - **view** — what the screen shows and where the chart's camera is. Free
 *   when the whole sentence is the command.
 * - **read** — something read aloud. Wake word.
 * - **control** — the session, the feedback level, help. Wake word: "pause",
 *   "silence" and "aide" are things people say to each other.
 * - **intake** — allergies, history, medication, plan, appointment, patient
 *   details. Wake word in the same sentence, always: a free-text command is
 *   exactly what swallows a sentence of conversation (R7).
 * - **task** — notes, tasks, a follow-up. Wake word.
 *
 * An id with no class here is treated as intake, the strictest; a spec walks
 * the registry and fails on any command left out.
 */
export type IntentClass = 'chart' | 'correction' | 'view' | 'control' | 'read' | 'intake' | 'task';

const CLASSES: Readonly<Record<string, IntentClass>> = {
  'voice.session.start': 'control',
  'voice.session.end': 'control',
  'voice.session.summary': 'read',
  'voice.correction.remove': 'correction',
  'voice.correction.undo': 'correction',

  'chart.addToothFindings': 'chart',
  'chart.replaceLastFinding': 'correction',
  'chart.reclassifyFinding': 'correction',
  'chart.moveFindings': 'correction',
  'chart.removeFinding': 'correction',

  'chart.selectTooth': 'view',
  'chart.setView': 'view',
  'chart.zoomTooth': 'view',
  'chart.zoom': 'view',
  'chart.rotate': 'view',
  'chart.reset': 'view',
  'chart.step': 'view',
  'ui.show': 'view',
  'ui.back': 'view',
  'ui.pin': 'view',
  'ui.unpin': 'view',

  'chart.readTooth': 'read',
  'ui.read': 'read',
  'patients.readBalance': 'read',
  'patients.readNextAppointment': 'read',

  'help.show': 'control',
  'voice.repeat': 'control',
  'feedback.set': 'control',

  'clinical.addAllergy': 'intake',
  'clinical.addMedicalHistory': 'intake',
  'consultation.addPlanItem': 'intake',
  'consultation.setAppointment': 'intake',
  'consultation.setField': 'intake',

  'clinical.addNote': 'task',
  'schedule.followUp': 'task',
  'tasks.create': 'task',

  // Never by voice, but registered so the doctor hears why: the strictest gate.
  'patients.delete': 'intake',
  'billing.voidInvoice': 'intake',
  'billing.recordPayment': 'intake',
  'stock.validateCount': 'intake',
  'clinical.prescribe': 'intake',
};

export function intentClass(id: string): IntentClass {
  return CLASSES[id] ?? 'intake';
}

/** Whether a command id has a class of its own, rather than the strict default. */
export function hasExplicitClass(id: string): boolean {
  return id in CLASSES;
}
