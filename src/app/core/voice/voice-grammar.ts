import { describeFdi, normalizeUtterance, resolveTooth, ToothResolution } from './tooth-lexicon';
import { extractFindings, ExtractedFinding } from './clinical-lexicon';
import { WORD_END } from './voice-regex';
import {
  FindingEntity,
  VoiceContextSnapshot,
  VoiceResolution,
} from './voice-intent.model';

/**
 * The deterministic first stage of the pipeline.
 *
 * Audit XII.4 §6 argues for a constrained grammar before open-ended NLU, and
 * the reasons hold up in practice: a dictated examination is a small, closed
 * set of sentence shapes, the grammar resolves them in under a millisecond,
 * it works with no network and no API key, and it cannot invent an action
 * that was not written here. The natural-language fallback exists for the
 * long tail, not for the main path.
 *
 * Rules are ordered and the first match wins, so ordering encodes precedence.
 * The one that matters most: patient-level narrative ("patient reports pain
 * on the right side") is matched *before* the tooth rule, because that
 * sentence contains both a finding word and a side word and would otherwise
 * be mistaken for an under-specified tooth finding.
 */

export interface GrammarRule {
  id: string;
  /** Returns null to decline, so the next rule can try. */
  match: (raw: string, normalized: string, context: VoiceContextSnapshot) => VoiceResolution | null;
}

const CONFIDENCE_EXACT = 0.95;
const CONFIDENCE_STRONG = 0.9;
const CONFIDENCE_MODERATE = 0.75;

function intent(
  id: string,
  entities: Record<string, unknown>,
  confidence: number,
  transcript: string,
): VoiceResolution {
  return { kind: 'intent', intent: { intent: id, entities, confidence, resolver: 'grammar', transcript } };
}

function ask(
  question: string,
  transcript: string,
  options: Array<{ value: string; label: string }> = [],
  pending?: { intent: string; entities: Record<string, unknown>; awaiting: string },
): VoiceResolution {
  return {
    kind: 'clarification',
    clarification: {
      question,
      options,
      transcript,
      pendingIntent: pending?.intent,
      pendingEntities: pending?.entities,
      awaiting: pending?.awaiting,
    },
  };
}

function toEntities(findings: ExtractedFinding[]): FindingEntity[] {
  return findings.map(f => ({
    code: f.code,
    label: f.label,
    kind: f.kind,
    surface: f.surface,
    severity: f.severity,
  }));
}

/**
 * What is left of the clause after a colon once every recognised finding has
 * been removed from it. Returns undefined when nothing substantive remains,
 * so a tidy "16: caries" does not acquire an empty note.
 */
function residualNote(raw: string, findings: ExtractedFinding[]): string | undefined {
  const match = raw.match(/[:–—]\s*(.+)$/);
  if (!match) return undefined;

  let remainder = match[1];
  for (const finding of findings) {
    remainder = remainder.replace(finding.matchedText, ' ');
  }
  remainder = remainder.replace(/[,;.\s]+/g, ' ').trim();
  // A single leftover word is nearly always a fragment of a phrase a finding
  // already claimed ("recurrent caries underneath" leaves "underneath"), not a
  // clinical note worth attaching to every finding on the tooth.
  return remainder.split(' ').filter(Boolean).length >= 2 ? remainder : undefined;
}

const ANAPHORA = /\b(?:that|this|the\s+same|it|same)\s+(?:tooth|one)\b|\bcette\s+dent\b|\bla\s+m[êe]me\s+dent\b/iu;

// ── Rules ───────────────────────────────────────────────────────────────

// `text` has had its apostrophes replaced by spaces, so "l'examen" arrives
// as "l examen" — the article alternatives have to accept both spellings.
const startExamination: GrammarRule = {
  id: 'grammar.session.start',
  match: (raw, text) => {
    if (!/^(?:start|begin|commence[rz]?|d[ée]marre[rz]?|commencer)\s+(?:the\s+|l'|l\s+|le\s+|la\s+)?(?:exam\w*|consultation|dictation|session|dict[ée]e)/iu.test(text)) {
      return null;
    }
    return intent('voice.session.start', {}, CONFIDENCE_EXACT, raw);
  },
};

const endExamination: GrammarRule = {
  id: 'grammar.session.end',
  match: (raw, text) => {
    if (!/^(?:end|stop|finish|terminer?|arr[êe]te[rz]?|fin\s+de)\s+(?:the\s+|l'|l\s+|le\s+|la\s+)?(?:exam\w*|consultation|dictation|session|dict[ée]e)/iu.test(text)) {
      return null;
    }
    return intent('voice.session.end', {}, CONFIDENCE_EXACT, raw);
  },
};

const showFindings: GrammarRule = {
  id: 'grammar.session.summary',
  match: (raw, text) => {
    if (!new RegExp(`\\b(?:show|read|give|list|r[ée]capitule[rz]?|montre[rz]?)\\b.*(?:findings|summary|r[ée]sum[ée]|constatations|bilan)${WORD_END}`, 'iu').test(text)
      && !new RegExp(`^(?:summary|r[ée]sum[ée])${WORD_END}`, 'iu').test(text)) {
      return null;
    }
    return intent('voice.session.summary', {}, CONFIDENCE_EXACT, raw);
  },
};

const undoLast: GrammarRule = {
  id: 'grammar.correction.undo',
  match: (raw, text) => {
    if (!new RegExp(
      `^(?:undo|cancel\\s+that|scratch\\s+that|annule[rz]?|efface[rz]?(?:\\s+(?:ça|ca|cela|la\\s+derni[èe]re))?|revenir\\s+en\\s+arri[èe]re|retour\\s+arri[èe]re)${WORD_END}`,
      'iu',
    ).test(text)
      && !/\bundo\s+(?:that|the\s+last)\b/iu.test(text)) {
      return null;
    }
    return intent('voice.correction.undo', {}, CONFIDENCE_EXACT, raw);
  },
};

/**
 * "No, actually crown replacement." Attaches to the tooth of the last write
 * rather than starting a new record — the correction case in §11 of the
 * requirements, and the one that most obviously breaks if each utterance is
 * treated as independent.
 */
const correctLast: GrammarRule = {
  id: 'grammar.correction.replace',
  match: (raw, text, context) => {
    const isCorrection =
      /^(?:no|non)[,\s]+(?:actually|actual|in\s+fact|plut[ôo]t|en\s+fait)\b/iu.test(text)
      || /^(?:change|make|corrige[rz]?|remplace[rz]?)\s+(?:that|it|this|[çc]a|cela)\b/iu.test(text)
      || /^(?:actually|en\s+fait|plut[ôo]t)\b/iu.test(text);
    if (!isCorrection) return null;

    const findings = extractFindings(raw);
    if (findings.length === 0) {
      return ask(
        'What should I change it to?',
        raw,
        [],
        { intent: 'chart.replaceLastFinding', entities: {}, awaiting: 'findings' },
      );
    }
    if (!context.lastWrite) {
      return ask('I don\'t have a previous entry to correct. Which tooth and finding do you mean?', raw);
    }
    return intent(
      'chart.replaceLastFinding',
      { findings: toEntities(findings) },
      CONFIDENCE_STRONG,
      raw,
    );
  },
};

/** "Remove the sensitivity note from that tooth." */
const removeFinding: GrammarRule = {
  id: 'grammar.correction.remove',
  match: (raw, text, context) => {
    if (!/^(?:remove|delete|retire[rz]?|supprime[rz]?|enl[èe]ve[rz]?)\b/iu.test(text)) return null;

    const tooth = resolveTooth(raw, context.dentition);
    const fdi = tooth.kind === 'resolved'
      ? tooth.fdi
      : (ANAPHORA.test(raw) || tooth.kind === 'none')
        ? context.selectedFdi ?? context.lastWrite?.fdi ?? null
        : null;

    const findings = extractFindings(raw);
    if (findings.length === 0) {
      return ask('Which finding should I remove?', raw);
    }
    if (!fdi) {
      return ask('Which tooth should I remove that from?', raw);
    }
    return intent(
      'chart.removeFinding',
      { fdi, findings: toEntities(findings) },
      CONFIDENCE_STRONG,
      raw,
    );
  },
};

/**
 * Patient-level narrative. Ordered before the tooth rule on purpose: "patient
 * reports pain when chewing on the right side" carries a finding word and a
 * side word, and reading it as an under-specified tooth finding would make the
 * assistant ask "which tooth?" about a sentence that was never about one tooth.
 */
const patientNarrative: GrammarRule = {
  id: 'grammar.note.patient',
  match: (raw, text) => {
    const narrative = /^(?:the\s+)?patient\s+(?:reports?|complains?|says?|states?|has|had|is|mentions?)\b/iu.test(text)
      || /^le\s+patient\s+/iu.test(text)
      || /^(?:patient|il|elle)\s+(?:se\s+plaint|rapporte|pr[ée]sente)\b/iu.test(text);
    if (!narrative) return null;

    // "Patient is allergic to latex" is a structured allergy, not prose.
    if (/\ballerg\w+/iu.test(text)) return null;

    const isHistory = /\bhistory\b|\bant[ée]c[ée]dent/iu.test(text)
      || /\bpatient\s+had\b/iu.test(text)
      || /\b(?:years?|months?|ans?|mois)\s+ago\b/iu.test(text)
      || /\bil\s+y\s+a\s+\w+\s+(?:ans?|mois)\b/iu.test(text);

    if (!isHistory) {
      // A present-tense complaint is an observation about today's visit.
      return intent('clinical.addNote', { category: 'OBSERVATION', content: raw.trim() },
        CONFIDENCE_STRONG, raw);
    }

    const dental = /\b(?:dental|dentist|orthodont\w*|braces|root\s+canal|extraction|filling|crown|implant|veneer|denture|gum|periodont\w*|dentaire|orthodontie|couronne|obturation)\b/iu.test(text);
    const medical = /\b(?:diabet\w*|hypertens\w*|blood\s+pressure|tension\s+art[ée]rielle|asthma|asthme|cardiac|heart|cancer|pregnan\w*|enceinte|epilep\w*|hepatit\w*|hiv|anticoagul\w*|bisphosphonat\w*|surgery|chirurgie|thyroid\w*|kidney|renal|anemi\w*|stroke|avc)\b/iu.test(text);

    if (dental && !medical) {
      return intent('clinical.addMedicalHistory',
        { category: 'DENTAL_HISTORY', label: raw.trim() }, CONFIDENCE_STRONG, raw);
    }
    if (medical && !dental) {
      return intent('clinical.addMedicalHistory',
        { category: 'CONDITION', label: raw.trim() }, CONFIDENCE_STRONG, raw);
    }

    // Genuinely undetermined — requirement §4 says ask, not default.
    return ask(
      'Should I add this to the general medical history or the dental history?',
      raw,
      [
        { value: 'CONDITION', label: 'Medical history' },
        { value: 'DENTAL_HISTORY', label: 'Dental history' },
        { value: 'OBSERVATION', label: 'Just a clinical note' },
      ],
      { intent: 'clinical.addMedicalHistory', entities: { label: raw.trim() }, awaiting: 'category' },
    );
  },
};

const addAllergy: GrammarRule = {
  id: 'grammar.allergy.add',
  match: (raw, text) => {
    // normalizeUtterance has already stripped the colon from "allergy:
    // penicillin", so the separator has to be optional here.
    const explicit = text.match(/\ballerg(?:y|ies|ie|ic|ique)\s*(?:to|[àa]|au|aux)?\s+(.+)$/iu);
    const patientIs = text.match(/\bpatient\s+est\s+allergique\s+(?:[àa]|au|aux)\s+(.+)$/iu);
    const raw_substance = (explicit?.[1] ?? patientIs?.[1] ?? '').trim();
    if (!raw_substance) return null;

    const substance = raw_substance.replace(/[.,;]+$/, '').trim();
    if (!substance) {
      return ask('Allergic to what?', raw, [], { intent: 'clinical.addAllergy', entities: {}, awaiting: 'substance' });
    }
    return intent('clinical.addAllergy', { substance }, CONFIDENCE_STRONG, raw);
  },
};

const addMedicalHistory: GrammarRule = {
  id: 'grammar.history.medical',
  match: (raw, text) => {
    const match = text.match(/\b(?:medical\s+history|ant[ée]c[ée]dents?\s+m[ée]dicaux?)\s*(?::|is|includes?)?\s*(.+)$/iu);
    if (!match) return null;
    const label = match[1].replace(/[.,;]+$/, '').trim();
    if (!label) return ask('What should I add to the medical history?', raw);
    return intent(
      'clinical.addMedicalHistory',
      { category: 'CONDITION', label },
      CONFIDENCE_STRONG,
      raw,
    );
  },
};

const addMedication: GrammarRule = {
  id: 'grammar.history.medication',
  match: (raw, text) => {
    // "What is on tooth 16" contains "is on"; a question is never a
    // medication being recorded.
    if (/^(?:what|which|where|read|tell|lis|lire|qu)\b/iu.test(text)) return null;
    const match = text.match(/\b(?:patient\s+)?(?:takes?|is\s+on|medication\s*:?|traitement\s*:?|prend)\s+(.+)$/iu);
    if (!match) return null;
    if (!/\bmedication\b|\btraitement\b|\btakes?\b|\bis\s+on\b|\bprend\b/iu.test(text)) return null;
    const label = match[1].replace(/[.,;]+$/, '').trim();
    if (!label) return null;
    return intent('clinical.addMedicalHistory', { category: 'MEDICATION', label }, CONFIDENCE_MODERATE, raw);
  },
};

/**
 * Dental history. When it names a tooth it is still history, not a finding on
 * the current chart — "previous root canal on the lower left molar" describes
 * what was done before, and filing it as a live finding would misstate the
 * record.
 */
const addDentalHistory: GrammarRule = {
  id: 'grammar.history.dental',
  match: (raw, text, context) => {
    const match = text.match(
      /\b(?:previous\s+(?:dental\s+)?(?:history|treatment|work)|dental\s+history|ant[ée]c[ée]dents?\s+dentaires?|historique\s+dentaire)\s*(?::|is|includes?)?\s*(.+)$/iu,
    );
    if (!match) return null;
    const detail = match[1].replace(/[.,;]+$/, '').trim();
    if (!detail) return ask('What should I add to the dental history?', raw);

    const tooth = resolveTooth(detail, context.dentition);
    return intent(
      'clinical.addMedicalHistory',
      {
        category: 'DENTAL_HISTORY',
        label: detail,
        fdi: tooth.kind === 'resolved' ? tooth.fdi : null,
      },
      CONFIDENCE_STRONG,
      raw,
    );
  },
};

const addNote: GrammarRule = {
  id: 'grammar.note.explicit',
  match: (raw, text, context) => {
    const match = text.match(/^(?:add\s+(?:a\s+)?note|note|ajoute[rz]?\s+(?:une\s+)?note|remarque)\s*(?::|that|-)?\s*(.+)$/iu);
    if (!match) return null;
    const content = match[1].replace(/[.,;]+$/, '').trim();
    if (!content) return ask('What should the note say?', raw, [], { intent: 'clinical.addNote', entities: {}, awaiting: 'content' });

    // A note dictated while a tooth is selected attaches to that tooth only if
    // the doctor said so; otherwise it stays patient-level. Guessing between
    // the two is exactly the ambiguity §4 of the requirements says to ask about.
    const tooth = resolveTooth(content, context.dentition);
    const explicitTooth = tooth.kind === 'resolved' || (ANAPHORA.test(content) && context.selectedFdi);
    return intent(
      'clinical.addNote',
      {
        category: 'GENERAL',
        content,
        fdi: tooth.kind === 'resolved' ? tooth.fdi : (explicitTooth ? context.selectedFdi : null),
      },
      CONFIDENCE_STRONG,
      raw,
    );
  },
};

const scheduleFollowUp: GrammarRule = {
  id: 'grammar.schedule.followUp',
  match: (raw, text) => {
    if (!/\b(?:schedule|book|set\s+up|programme[rz]?|planifie[rz]?|fixe[rz]?)\b/iu.test(text)) return null;
    if (!/\b(?:follow[- ]?up|appointment|recall|rendez[- ]?vous|contr[ôo]le|rdv)\b/iu.test(text)) return null;
    return intent('schedule.followUp', { when: raw.trim() }, CONFIDENCE_MODERATE, raw);
  },
};

// Navigation — to another module, another patient, or another tab of this
// dossier — is deliberately not in the grammar. Dictation happens inside one
// patient's dossier and its results are shown there; a misheard "ouvre" that
// swapped the screen mid-examination cost the dentist their view of the chart
// and could not be undone hands-free. The command palette still navigates.

const selectTooth: GrammarRule = {
  id: 'grammar.chart.selectTooth',
  match: (raw, text, context) => {
    if (!/^(?:show|select|go\s+to|highlight|s[ée]lectionne[rz]?|affiche[rz]?)\b/iu.test(text)) return null;
    if (!/\b(?:tooth|teeth|dent|molar|incisor|canine|premolar|molaire|incisive|canine|pr[ée]molaire)\b/iu.test(text)) {
      return null;
    }
    const tooth = resolveTooth(raw, context.dentition);
    if (tooth.kind === 'resolved') {
      return intent('chart.selectTooth', { fdi: tooth.fdi }, CONFIDENCE_STRONG, raw);
    }
    if (tooth.kind === 'ambiguous') {
      return ask(tooth.question, raw, toothOptions(tooth));
    }
    return null;
  },
};

const readBalance: GrammarRule = {
  id: 'grammar.query.balance',
  match: (raw, text, context) => {
    if (!context.patientId) return null;
    if (!new RegExp(`\\b(?:balance|outstanding|owed?|solde|reste\\s+[àa]\\s+payer|impay[ée])${WORD_END}`, 'iu').test(text)) return null;
    return intent('patients.readBalance', {}, CONFIDENCE_STRONG, raw);
  },
};

const readNextAppointment: GrammarRule = {
  id: 'grammar.query.nextAppointment',
  match: (raw, text, context) => {
    if (!context.patientId) return null;
    if (!/\bnext\s+appointment\b|\bprochain\s+rendez[- ]?vous\b|\bprochain\s+rdv\b/iu.test(text)) return null;
    return intent('patients.readNextAppointment', {}, CONFIDENCE_STRONG, raw);
  },
};

const readToothFindings: GrammarRule = {
  id: 'grammar.query.toothFindings',
  match: (raw, text, context) => {
    if (!/^(?:what(?:'s|\s+s|\s+is|\s+are)|read|tell\s+me|lis|lire|qu\s*y\s+a\s+t\s+il|qu\s+est\s+ce\s+qu\s*il\s+y\s+a)\b/iu.test(text)) return null;
    if (!/\b(?:tooth|dent|molar|incisor|canine|premolar|molaire|incisive|pr[ée]molaire)\b/iu.test(text)) return null;
    const tooth = resolveTooth(raw, context.dentition);
    const fdi = tooth.kind === 'resolved' ? tooth.fdi : context.selectedFdi;
    if (!fdi) return null;
    return intent('chart.readTooth', { fdi }, CONFIDENCE_STRONG, raw);
  },
};

function toothOptions(resolution: ToothResolution): Array<{ value: string; label: string }> {
  if (resolution.kind !== 'ambiguous') return [];
  return resolution.candidates.slice(0, 6).map(fdi => ({ value: fdi, label: `${fdi} — ${describeFdi(fdi)}` }));
}

/**
 * The primary examination rule: a tooth reference plus one or more findings.
 * Last among the write rules, so anything with a more specific shape has
 * already claimed it.
 */
const toothFindings: GrammarRule = {
  id: 'grammar.chart.toothFindings',
  match: (raw, text, context) => {
    const findings = extractFindings(raw);
    if (findings.length === 0) return null;

    const tooth = resolveTooth(raw, context.dentition);
    const usesAnaphora = ANAPHORA.test(raw);

    let fdi: string | null = null;
    if (tooth.kind === 'resolved') {
      fdi = tooth.fdi;
    } else if (tooth.kind === 'ambiguous') {
      // The doctor clearly meant a tooth but did not name one uniquely.
      // Offer the candidates rather than picking (audit XII.4 §5).
      return ask(tooth.question, raw, toothOptions(tooth), {
        intent: 'chart.addToothFindings',
        entities: { findings: toEntities(findings) },
        awaiting: 'fdi',
      });
    } else if (usesAnaphora || context.selectedFdi) {
      // "that tooth", or simply continuing on the tooth already selected.
      fdi = context.selectedFdi;
    }

    if (!fdi) {
      return ask('Which tooth is that for?', raw, [], {
        intent: 'chart.addToothFindings',
        entities: { findings: toEntities(findings) },
        awaiting: 'fdi',
      });
    }

    // Whatever the doctor said beyond the recognised findings is kept as the
    // tooth's free-text note, so nuance the closed vocabulary cannot express
    // ("patient anxious about this one") is not silently dropped.
    const note = residualNote(raw, findings);

    const confidence = tooth.kind === 'resolved'
      ? Math.min(tooth.confidence, CONFIDENCE_STRONG)
      : CONFIDENCE_MODERATE;

    return intent(
      'chart.addToothFindings',
      { fdi, findings: toEntities(findings), note },
      confidence,
      raw,
    );
  },
};

/**
 * Ordered. Session control and corrections first (they are short and
 * unmistakable), then structured clinical records, then reads, then the
 * general tooth rule.
 */
export const GRAMMAR_RULES: GrammarRule[] = [
  startExamination,
  endExamination,
  showFindings,
  undoLast,
  correctLast,
  removeFinding,
  addAllergy,
  addMedicalHistory,
  addDentalHistory,
  addMedication,
  patientNarrative,
  addNote,
  scheduleFollowUp,
  selectTooth,
  readToothFindings,
  readBalance,
  readNextAppointment,
  toothFindings,
];

/**
 * Runs the grammar. Returns `unrecognized` — not a guess — when no rule
 * claims the utterance; the orchestrator then decides whether to consult the
 * natural-language fallback or simply ask.
 */
export function resolveWithGrammar(
  transcript: string,
  context: VoiceContextSnapshot,
): VoiceResolution {
  const raw = transcript.trim();
  if (!raw) return { kind: 'unrecognized', transcript };
  const normalized = normalizeUtterance(raw);

  for (const rule of GRAMMAR_RULES) {
    const result = rule.match(raw, normalized, context);
    if (result) return result;
  }
  return { kind: 'unrecognized', transcript: raw };
}
