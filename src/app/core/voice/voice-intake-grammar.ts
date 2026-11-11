import { parseSpokenDateTime } from '../consultation/spoken-datetime';
import { spokenSpelling } from '../consultation/spoken-spelling';
import { findToothMentions, parseNumber } from './tooth-lexicon';
import { VoiceContextSnapshot, VoiceResolution } from './voice-intent.model';

/**
 * What a doctor dictates into a consultation after the wake word that is not a
 * chart finding (docs/VOICE-COCKPIT-PLAN.md appendix A §9): a plan line, the
 * next appointment, a patient detail. Class *intake*: never without "Calypso"
 * in the same sentence. In a consultation each goes straight into the review;
 * outside one there is nowhere for it to go, and the command says so.
 */

interface IntakeRule {
  id: string;
  match: (raw: string, text: string, context: VoiceContextSnapshot) => VoiceResolution | null;
}

const resolution = (intent: string, entities: Record<string, unknown>, raw: string): VoiceResolution => ({
  kind: 'intent',
  intent: { intent, entities, confidence: 0.9, resolver: 'grammar', transcript: raw },
});

const ask = (question: string, raw: string): VoiceResolution => ({
  kind: 'clarification', clarification: { question, options: [], transcript: raw },
});

// ── Plan ────────────────────────────────────────────────────────────────

const PLAN_START = /^\s*(?:(?:ajoute[rz]?|mets?|add)\s+(?:au|to\s+the)\s+plan\s+(?:une?\s+|des\s+|an?\s+)?|(?:le\s+)?plan(?:\s+de\s+(?:traitement|soins))?\s*:?\s+(?:une?\s+|des\s+)?|(?:treatment\s+)?plan\s*:?\s+)(.+)$/isu;
const PRICE = /(\d+(?:[.,]\d+)?)\s*(?:dirhams?|dhs?|mad)(?![\p{L}])/iu;
const EACH = /\b(?:chacun|chacune|par\s+dent|each|per\s+tooth)\b/iu;
const TEETH_PHRASE = /(?:\s|^)(?:sur|pour|on|for)\s+(?:la|le|les|l['’]|the)?\s*(?:dents?|teeth|tooth)?\s*\d{2}(?:\s*(?:,|et|and)\s*(?:la\s+|le\s+)?\d{2})*/giu;

export interface PlanLine {
  label: string;
  teeth: string | null;
  price: number | null;
  quantity: number;
}

/** "Un composite sur la 16 et la 17, 400 dirhams chacun" → composite, 16,17, 400, ×2. */
export function readPlanLine(body: string): PlanLine | null {
  const priceMatch = PRICE.exec(body);
  const price = priceMatch ? Number(priceMatch[1].replace(',', '.')) : null;
  const teeth = [...new Set(findToothMentions(body).filter(m => m.valid).map(m => m.fdi))];
  const each = EACH.test(body);
  let label = body;
  if (priceMatch) label = label.replace(priceMatch[0], ' ');
  label = label.replace(EACH, ' ').replace(TEETH_PHRASE, ' ');
  label = label.replace(/\s*\b(?:à|a|at|pour|for)\s*$/iu, '').replace(/[,;:.!]+/g, ' ').replace(/\s+/g, ' ').trim();
  label = label.replace(/^(?:une?|des|le|la|les|l['’]\s*|an?|the)\s+/iu, '').trim();
  if (!label || label.split(' ').length > 8) return null;
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    teeth: teeth.length ? teeth.join(',') : null,
    price,
    quantity: each && teeth.length > 1 ? teeth.length : 1,
  };
}

const addPlanItem: IntakeRule = {
  id: 'grammar.consultation.plan',
  match: (raw) => {
    const start = PLAN_START.exec(raw);
    if (!start) return null;
    const line = readPlanLine(start[1]);
    if (!line) return ask('Which treatment?', raw);
    return resolution('consultation.addPlanItem', { ...line }, raw);
  },
};

// ── Appointment ─────────────────────────────────────────────────────────

const APPOINTMENT_START = /^\s*(?:(?:le\s+)?prochain\s+)?(?:rendez[\s-]?vous|rdv|next\s+appointment|appointment)\s*:?\s+(.+)$/isu;
const RECALL_START = /^\s*(?:revoir|reconvoquer|see\s+(?:him|her|the\s+patient)\s+again)\s+(?:le\s+patient\s+|la\s+patiente\s+)?(.+)$/isu;

const setAppointment: IntakeRule = {
  id: 'grammar.consultation.appointment',
  match: (raw) => {
    const start = APPOINTMENT_START.exec(raw) ?? RECALL_START.exec(raw);
    if (!start) return null;
    // Only when a date is said: "revoir dans 15 jours" without one is the follow-up note it always was.
    const when = parseSpokenDateTime(start[1], new Date());
    if (!when) return null;
    return resolution('consultation.setAppointment', { date: when.date, time: when.time }, raw);
  },
};

// ── Patient details ─────────────────────────────────────────────────────

const FIELD_START = /^\s*(?:corrige[rz]?\s+)?(?:le\s+|la\s+|l['’]\s*)?(pr[ée]nom|nom(?:\s+de\s+famille)?|t[ée]l[ée]phone|num[ée]ro\s+de\s+t[ée]l[ée]phone|cin|carte\s+nationale|[âa]ge|date\s+de\s+naissance|sexe|assurance|mutuelle|num[ée]ro\s+de\s+police|first\s+name|last\s+name|phone|age|insurance)\s*(?::|c['’\s]?\s*est|s['’\s]?\s*[ée]crit|est|is)?\s+(.+)$/isu;

const INSURERS = ['CNOPS', 'CNSS', 'CNAM', 'RAMED', 'PRIVATE'];
const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};

function fieldName(word: string): string | null {
  const w = word.toLowerCase().replace(/\s+/g, ' ');
  if (/^pr[ée]nom$|^first name$/u.test(w)) return 'firstName';
  if (/^nom( de famille)?$|^last name$/u.test(w)) return 'lastName';
  if (/t[ée]l[ée]phone|^phone$/u.test(w)) return 'phone';
  if (/^cin$|^carte nationale$/u.test(w)) return 'cin';
  if (/^[âa]ge$/u.test(w)) return 'age';
  if (/^date de naissance$/u.test(w)) return 'dateOfBirth';
  if (/^sexe$/u.test(w)) return 'gender';
  if (/^(?:assurance|mutuelle|insurance)$/u.test(w)) return 'insuranceProvider';
  if (/^num[ée]ro de police$/u.test(w)) return 'insuranceNumber';
  return null;
}

/** The value a field takes from what was said, by the parser's own rules; null when it is not one. */
export function readFieldValue(field: string, spoken: string): string | number | null {
  const said = spoken.replace(/[.!?]+$/u, '').trim();
  switch (field) {
    case 'firstName':
    case 'lastName': {
      const spelled = spokenSpelling(said);
      if (spelled) return spelled;
      const words = said.split(/\s+/).filter(Boolean);
      if (words.length === 0 || words.length > 3) return null;
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    case 'phone': {
      const digits = said.replace(/[^\d+]/g, '');
      return /^(?:0\d{9}|\+212\d{9}|00212\d{9})$/.test(digits) ? digits : null;
    }
    case 'cin': {
      const compact = said.replace(/[\s.-]/g, '').toUpperCase();
      return /^[A-Z]{1,2}\d{4,7}$/.test(compact) ? compact : null;
    }
    case 'age': {
      const n = /^\d+$/.test(said.replace(/\s*ans?$/iu, '')) ? Number(said.replace(/\s*ans?$/iu, '')) : parseNumber(said);
      return n !== null && n > 0 && n < 120 ? n : null;
    }
    case 'dateOfBirth': {
      const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(said);
      const named = /^(?:le\s+)?(\d{1,2}|premier|1er)\s+([a-zéû]+)\s+(\d{4})$/iu.exec(said);
      const [day, month, year] = numeric
        ? [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])]
        : named ? [/^(?:premier|1er)$/iu.test(named[1]) ? 1 : Number(named[1]), MONTHS[named[2].toLowerCase()] ?? 0, Number(named[3])] : [0, 0, 0];
      if (!day || !month || year < 1900) return null;
      const date = new Date(year, month - 1, day);
      if (date.getMonth() !== month - 1 || date > new Date()) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    case 'gender':
      if (/^(?:homme|masculin|m|male|man)$/iu.test(said)) return 'M';
      if (/^(?:femme|f[ée]minin|f|female|woman)$/iu.test(said)) return 'F';
      return null;
    case 'insuranceProvider': {
      const upper = said.toUpperCase().replace(/\s+/g, '');
      return INSURERS.find(name => upper === name) ?? (/^priv[ée]e?$/iu.test(said) ? 'PRIVATE' : null);
    }
    case 'insuranceNumber': {
      const compact = said.replace(/\s+/g, '').toUpperCase();
      return /^[A-Z0-9-]{3,30}$/.test(compact) ? compact : null;
    }
    default:
      return null;
  }
}

const setField: IntakeRule = {
  id: 'grammar.consultation.field',
  match: (raw) => {
    const start = FIELD_START.exec(raw);
    if (!start) return null;
    const field = fieldName(start[1]);
    if (!field) return null;
    const value = readFieldValue(field, start[2]);
    if (value === null) return ask('I did not get that value. Say it again.', raw);
    return resolution('consultation.setField', { field, value }, raw);
  },
};

export const INTAKE_RULES: IntakeRule[] = [addPlanItem, setAppointment, setField];
