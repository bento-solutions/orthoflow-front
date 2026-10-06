import {
  describeFdi,
  findToothMentions,
  normalizeUtterance,
  resolveTooth,
  ToothMention,
  ToothResolution,
} from './tooth-lexicon';
import { affirmedFindings, extractEveryFinding, extractFindings, ExtractedFinding } from './clinical-lexicon';
import { clauseAround, containsNegation, firstNegationIndex, isNegatedAt, startsNegated } from './voice-negation';
import { WORD_END } from './voice-regex';
import {
  FindingEntity,
  VoiceContextSnapshot,
  VoiceIntent,
  VoiceResolution,
} from './voice-intent.model';

/** Asked when one utterance names several teeth the grammar cannot safely split. */
export const SEVERAL_TEETH_QUESTION = 'I heard more than one tooth. Please give them one at a time.';

/** Asked when a number was said as a tooth that no tooth has — "dent 58". */
export const NO_SUCH_TOOTH_QUESTION = 'That tooth number does not exist. Which tooth did you mean?';

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

function makeIntent(
  id: string,
  entities: Record<string, unknown>,
  confidence: number,
  transcript: string,
): VoiceIntent {
  return { intent: id, entities, confidence, resolver: 'grammar', transcript };
}

function intent(
  id: string,
  entities: Record<string, unknown>,
  confidence: number,
  transcript: string,
): VoiceResolution {
  return { kind: 'intent', intent: makeIntent(id, entities, confidence, transcript) };
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
    ...(f.note ? { note: f.note } : {}),
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

/**
 * A negated statement kept as the dentist's own words. Never a finding: "pas
 * de carie" recorded as caries is the opposite of what was said. As a note it
 * is a true record, and it is read back aloud so the dentist hears it.
 */
function noteIntent(
  content: string,
  category: string,
  fdi: string | null,
  confidence: number,
  transcript: string,
): VoiceIntent {
  const entities: Record<string, unknown> = { category, content: content.replace(/[.!\s]+$/u, '').trim() };
  if (fdi) entities['fdi'] = fdi;
  return makeIntent('clinical.addNote', entities, confidence, transcript);
}

function uniqueByCode(findings: ExtractedFinding[]): ExtractedFinding[] {
  const seen = new Set<string>();
  return findings.filter(f => (seen.has(f.code) ? false : (seen.add(f.code), true)));
}

/** The clauses of the utterance a negation governed, without repeats. */
function negatedClauses(findings: ExtractedFinding[]): string[] {
  return [...new Set(findings.filter(f => f.negated).map(f => f.clause).filter(Boolean))];
}

/**
 * What one tooth's findings become: the affirmed ones as findings, and any
 * clause a negation governed as the tooth's note. When nothing was affirmed
 * the whole thing is a note.
 */
function recordOnTooth(
  raw: string,
  findings: ExtractedFinding[],
  fdi: string,
  confidence: number,
  withResidualNote: boolean,
): VoiceIntent {
  const affirmed = uniqueByCode(affirmedFindings(findings));
  const denied = negatedClauses(findings);

  if (affirmed.length === 0) {
    return noteIntent(denied.join('; '), 'OBSERVATION', fdi, Math.min(confidence, CONFIDENCE_STRONG), raw);
  }
  const note = [withResidualNote ? residualNote(raw, affirmed) : undefined, ...denied]
    .filter((part): part is string => !!part)
    .join('; ') || undefined;
  return makeIntent('chart.addToothFindings', { fdi, findings: toEntities(affirmed), note }, confidence, raw);
}

/**
 * One utterance naming several teeth. The single-tooth path reads the first
 * and puts every finding on it, so "dent 16 carie et dent 17 couronne" used
 * to record both on 16 and never mention 17. Split it when the split is
 * unambiguous; otherwise ask, because a finding on the wrong tooth reads as an
 * ordinary, correctly spelled record.
 */
interface ToothFindingsPlan {
  fdi: string;
  findings: ExtractedFinding[];
}

/**
 * Which findings belong to which of the several teeth named, or null when the
 * split is not unambiguous. One plan serves adding findings and removing them:
 * "carie sur la 16 et la 17" means the same two teeth either way.
 */
function planTeeth(
  raw: string,
  findings: ExtractedFinding[],
  mentions: ToothMention[],
): ToothFindingsPlan[] | null {
  const teeth = [...new Set(mentions.map(m => m.fdi))];

  const firstStart = mentions[0].start;
  const lastEnd = mentions[mentions.length - 1].end;
  const leading = findings.filter(f => f.at < firstStart);
  const trailing = findings.filter(f => f.at >= lastEnd);
  const between = findings.filter(f => f.at >= firstStart && f.at < lastEnd);

  // "Dent 16, 17 et 18 : carie" / "carie sur la 16 et la 17" — the teeth are
  // listed together and the findings sit wholly on one side of the list.
  if (between.length === 0 && (leading.length === 0 || trailing.length === 0)) {
    return teeth.map(fdi => ({ fdi, findings }));
  }

  // "Dent 16 carie et dent 17 couronne" — each tooth followed by its own
  // findings. Anything said before the first tooth belongs to no tooth.
  if (leading.length === 0) {
    const byTooth = new Map<string, ExtractedFinding[]>();
    mentions.forEach((mention, index) => {
      const next = mentions[index + 1]?.start ?? raw.length;
      const segment = raw.slice(mention.start, next);
      // A negation's clause is clipped to this tooth's own words, so the note
      // on tooth 16 does not carry what was said about tooth 17.
      const own = findings
        .filter(f => f.at >= mention.start && f.at < next)
        .map(f => (f.negated
          ? { ...f, clause: clauseAround(segment, f.at - mention.start).replace(/\s+(?:et|and|puis|then|mais|but)$/iu, '') }
          : f));
      byTooth.set(mention.fdi, [...(byTooth.get(mention.fdi) ?? []), ...own]);
    });
    if ([...byTooth.values()].every(own => own.length > 0)) {
      return [...byTooth].map(([fdi, own]) => ({ fdi, findings: own }));
    }
  }

  // "Carie sur la 16 et fracture sur la 17" — the finding comes first and the
  // tooth closes it. Each tooth takes what was said since the previous one.
  if (trailing.length === 0 && leading.length > 0) {
    const byTooth = new Map<string, ExtractedFinding[]>();
    let linked = true;
    mentions.forEach((mention, index) => {
      const from = index === 0 ? 0 : mentions[index - 1].end;
      const own = findings.filter(f => f.at >= from && f.at < mention.end);
      // Only when the tooth is tied to its finding by a word that does the
      // tying — "carie SUR la 16". "Carie, dent 16 couronne, dent 17" is
      // nothing of the kind, and pairing it this way hands each tooth the
      // finding said about the other.
      const last = own[own.length - 1];
      const between = last ? raw.slice(last.at + last.matchedText.length, mention.start) : '';
      if (!last || !/\b(?:sur|de|du|des|on|at|in|of|pour|dans)\b/iu.test(between) || /[,;.]/.test(between)) linked = false;
      byTooth.set(mention.fdi, [...(byTooth.get(mention.fdi) ?? []), ...own]);
    });
    if (linked && [...byTooth.values()].every(own => own.length > 0)) {
      return [...byTooth].map(([fdi, own]) => ({ fdi, findings: own }));
    }
  }

  return null;
}

function severalTeeth(
  raw: string,
  findings: ExtractedFinding[],
  mentions: ToothMention[],
  context: VoiceContextSnapshot,
): VoiceResolution {
  const teeth = [...new Set(mentions.map(m => m.fdi))];

  // Each has to be a tooth this patient's chart has.
  for (const fdi of teeth) {
    const tooth = resolveTooth(`dent ${fdi}`, context.dentition);
    if (tooth.kind === 'ambiguous') return ask(tooth.question, raw);
  }

  const plan = planTeeth(raw, findings, mentions);
  if (!plan) return ask(SEVERAL_TEETH_QUESTION, raw);
  return {
    kind: 'sequence',
    intents: plan.map(({ fdi, findings: own }) => recordOnTooth(raw, own, fdi, CONFIDENCE_STRONG, false)),
  };
}

/**
 * Several teeth named by description — "molaire supérieure droite carie et
 * canine inférieure gauche fracture" — where there are no tooth numbers for
 * {@link planTeeth} to split on. Read as one utterance the resolver takes the
 * first description and every finding lands on it.
 *
 * Split at the conjunctions; a piece that names a tooth opens a group, and a
 * piece that names only findings carries on the group before it ("…première
 * molaire carie, fracture"). Fewer than two groups is an ordinary single-tooth
 * utterance and is left to the normal rule.
 */
function describedTeeth(raw: string, context: VoiceContextSnapshot): VoiceResolution | null {
  const segments = raw.split(/\s*(?:,|;|\bet\b|\band\b|\bpuis\b|\bthen\b)\s*/iu).filter(Boolean);
  if (segments.length < 2) return null;

  const groups: ToothFindingsPlan[] = [];
  for (const segment of segments) {
    const tooth = resolveTooth(segment, context.dentition);
    const own = extractFindings(segment);
    if (tooth.kind === 'resolved') {
      groups.push({ fdi: tooth.fdi, findings: own });
    } else if (tooth.kind === 'ambiguous' && /\b(?:sup[ée]rieur\w*|inf[ée]rieur\w*|upper|lower|droite?|gauche|right|left)\b/iu.test(segment)) {
      // A description that stops short of one tooth: ask about it, do not drop it.
      return ask(tooth.question, raw);
    } else if (own.length > 0 && groups.length > 0) {
      groups[groups.length - 1].findings.push(...own);
    } else if (own.length > 0) {
      // Findings before any tooth was named belong to no tooth.
      return null;
    }
  }

  if (groups.length < 2) return null;
  if (groups.some(group => group.findings.length === 0)) return ask(SEVERAL_TEETH_QUESTION, raw);
  if (new Set(groups.map(group => group.fdi)).size < 2) return null;
  return {
    kind: 'sequence',
    intents: groups.map(({ fdi, findings }) => recordOnTooth(raw, findings, fdi, CONFIDENCE_STRONG, false)),
  };
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

    // A negated finding is not something to change it to.
    const findings = affirmedFindings(extractFindings(raw));
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

    const findings = extractFindings(raw);
    if (findings.length === 0) {
      return ask('Which finding should I remove?', raw);
    }

    // "Enlève la carie sur la 16 et la 17" names two teeth. Taking the first
    // and dropping the second leaves a finding on the record the dentist just
    // said to remove, and nothing says so.
    const mentions = findToothMentions(raw);
    if (mentions.some(mention => !mention.valid)) return ask(NO_SUCH_TOOTH_QUESTION, raw);
    if (new Set(mentions.map(mention => mention.fdi)).size > 1) {
      const plan = planTeeth(raw, extractEveryFinding(raw), mentions);
      if (!plan) return ask(SEVERAL_TEETH_QUESTION, raw);
      return {
        kind: 'sequence',
        intents: plan.map(({ fdi, findings: own }) =>
          makeIntent('chart.removeFinding', { fdi, findings: toEntities(own) }, CONFIDENCE_STRONG, raw)),
      };
    }

    const tooth = resolveTooth(raw, context.dentition);
    // A tooth the resolver missed but the mention scan found — "sur la 58 et
    // la 17" — is still a named tooth, and must not fall to the selected one.
    const named = tooth.kind === 'none' && mentions.length === 1 ? mentions[0].fdi : null;
    const fdi = tooth.kind === 'resolved'
      ? tooth.fdi
      : named
        ? named
        : (ANAPHORA.test(raw) || tooth.kind === 'none')
          ? context.selectedFdi ?? context.lastWrite?.fdi ?? null
          : null;

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

/**
 * "Pas d'allergie", "le patient n'est pas allergique à la pénicilline",
 * "no known allergies". Matched before the allergy rule, which would read the
 * same words as an allergy to penicillin — or to "connue". A statement that
 * there is no allergy is worth keeping, as a note in the dentist's own words.
 */
const noAllergy: GrammarRule = {
  id: 'grammar.allergy.none',
  match: (raw) => {
    const allergy = /allerg\w*/iu.exec(raw);
    if (!allergy) return null;
    const denied = isNegatedAt(raw, allergy.index)
      || /allerg\w*\s*[:\-–]?\s*(?:aucune?s?|none|nil|n[ée]ant|non|no)(?![\p{L}\p{N}])/iu.test(raw);
    if (!denied) return null;
    return { kind: 'intent', intent: noteIntent(raw, 'MEDICAL_HISTORY', null, CONFIDENCE_STRONG, raw) };
  },
};

/** The part of a spoken label before any negation, and whether nothing is left. */
function beforeNegation(label: string): string {
  const cut = firstNegationIndex(label);
  const kept = cut > 0 ? label.slice(0, cut) : label;
  return kept.replace(/\s*(?:mais|but|et|and)?\s*$/iu, '').trim();
}

const addAllergy: GrammarRule = {
  id: 'grammar.allergy.add',
  match: (raw, text) => {
    // normalizeUtterance has already stripped the colon from "allergy:
    // penicillin", so the separator has to be optional here.
    const explicit = text.match(/\ballerg(?:y|ies|ie|ic|ique)\s*(?:to|[àa]|au|aux)?\s+(.+)$/iu);
    const patientIs = text.match(/\bpatient\s+est\s+allergique\s+(?:[àa]|au|aux)\s+(.+)$/iu);
    const raw_substance = (explicit?.[1] ?? patientIs?.[1] ?? '').trim();
    if (!raw_substance) return null;

    // "allergie à la pénicilline" — the article is grammar, not the substance.
    // "… mais pas à l'amoxicilline" is a second statement, not part of the name.
    const substance = beforeNegation(raw_substance)
      .replace(/[.,;]+$/, '')
      // A whole word only — "latex" is not "la" + "tex". The normaliser has
      // already turned "l'amoxicilline" into "l amoxicilline".
      .replace(/^(?:(?:de\s+la|de\s+l|la|le|les|l|du|des|the)\s+|l['’]\s*)/iu, '')
      .trim();
    if (!substance || startsNegated(substance)) {
      if (startsNegated(raw_substance)) {
        return { kind: 'intent', intent: noteIntent(raw, 'MEDICAL_HISTORY', null, CONFIDENCE_STRONG, raw) };
      }
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
    const label = beforeNegation(match[1].replace(/[.,;]+$/, '').trim());
    if (!label) return ask('What should I add to the medical history?', raw);
    // "Antécédents médicaux : aucun" is a statement, not an entry called "aucun".
    if (startsNegated(label)) {
      return { kind: 'intent', intent: noteIntent(raw, 'MEDICAL_HISTORY', null, CONFIDENCE_STRONG, raw) };
    }
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
    // "Ne prend pas de médicaments" is the absence of one, not one called "pas de médicaments".
    if (startsNegated(label) || isNegatedAt(text, match.index ?? 0)) {
      return { kind: 'intent', intent: noteIntent(raw, 'MEDICAL_HISTORY', null, CONFIDENCE_STRONG, raw) };
    }
    return intent('clinical.addMedicalHistory', { category: 'MEDICATION', label }, CONFIDENCE_MODERATE, raw);
  },
};

/**
 * "Patient diabétique", "hypertendu", "sous anticoagulants": what a dentist says
 * about the patient's health in passing. Filed as medical history, not left as
 * a note nobody will search, and — the point — never dropped: "diabétique sous
 * insuline" is two entries, not one with the medication lost.
 */
const MEDICAL_CONDITIONS: RegExp[] = [
  /\bdiab[ée]tiques?\b/iu, /\bdiab[èe]te\b/iu, /\bdiabetic\b/iu, /\bdiabetes\b/iu,
  /\bhypertendu(?:e|s|es)?\b/iu, /\bhypertension\b/iu, /\bhypertensive\b/iu,
  /\bcardiaques?\b/iu, /\bcardiopathe\b/iu, /\bcardiopathie\b/iu, /\bheart\s+(?:disease|condition|problems?)\b/iu,
  /\basthmatiques?\b/iu, /\basthme\b/iu, /\basthma\b/iu,
  /\b[ée]pileptiques?\b/iu, /\b[ée]pilepsie\b/iu, /\bepilep\w+/iu,
  /\benceinte\b/iu, /\bpregnan\w+/iu,
  /\bfumeu(?:r|rs|se|ses)\b/iu, /\bsmoker\b/iu,
  /\bh[ée]mophile\b/iu, /\bh[ée]mophilie\b/iu, /\bhaemophil\w+/iu, /\bhemophil\w+/iu,
];

/** "Sous anticoagulants", "traité par metformine" — said of the patient, not of a tooth. */
const MEDICATION_OF_PATIENT =
  /\b(?:patiente?\s+(?:est\s+)?sous|(?:il|elle)\s+est\s+sous|patient\s+(?:is\s+)?(?:on|under)|trait[ée]e?\s+par|sous\s+traitement\s+(?:de|par|d['’])?)\s*(.+)$/iu;

const MEDICATION_AFTER = /\bsous\s+(?!(?:la|le|les|l['’]|une?|des|du)\b)(.+)$/iu;

const medicalStatement: GrammarRule = {
  id: 'grammar.history.statement',
  match: (raw, text) => {
    // Said about the patient, never a question, never about a tooth.
    if (!/\bpatient\w*|\bsous\b|\btrait[ée]e?\s+par\b/iu.test(text)) return null;
    if (/\?\s*$/.test(raw) || /^(?:what|which|where|est-ce|qu)\b/iu.test(text)) return null;
    if (findToothMentions(raw).length > 0) return null;
    // A denial is kept as the words it was said in: "pas diabétique" is a note.
    if (containsNegation(raw)) return null;
    // A story — "a eu un infarctus il y a deux ans" — is the narrative rule's.
    if (/\bhistory\b|\bant[ée]c[ée]dent|\bago\b|\bil\s+y\s+a\b|\bdepuis\b|\bhad\b|\ba\s+eu\b/iu.test(text)) return null;

    const intents: VoiceIntent[] = [];
    const seen = new Set<string>();
    for (const pattern of MEDICAL_CONDITIONS) {
      const match = pattern.exec(raw);
      if (!match) continue;
      const label = match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
      if (seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      intents.push(makeIntent('clinical.addMedicalHistory', { category: 'CONDITION', label }, CONFIDENCE_MODERATE, raw));
    }

    // "Patient diabétique sous insuline": the drug follows the condition, so
    // "sous" on its own counts once the sentence is about the patient — but
    // not "sous la couronne", which is about a tooth.
    const medication = MEDICATION_OF_PATIENT.exec(raw)
      ?? (/\bpatient\w*/iu.test(text) ? MEDICATION_AFTER.exec(raw) : null);
    if (medication) {
      const drugs = medication[1]
        .replace(/[.,;]+$/, '')
        .split(/\s*(?:,|\bet\b|\band\b)\s*/iu)
        // Whatever follows the drug that is a condition already claimed above.
        .map(part => part.trim())
        .filter(part => part && !MEDICAL_CONDITIONS.some(condition => condition.test(part)) && !startsNegated(part));
      for (const drug of drugs) {
        if (seen.has(drug.toLowerCase())) continue;
        seen.add(drug.toLowerCase());
        intents.push(makeIntent('clinical.addMedicalHistory', { category: 'MEDICATION', label: drug }, CONFIDENCE_MODERATE, raw));
      }
    }

    if (intents.length === 0) return null;
    if (intents.length === 1) return { kind: 'intent', intent: intents[0] };
    return { kind: 'sequence', intents };
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
    if (startsNegated(detail)) {
      return { kind: 'intent', intent: noteIntent(raw, 'DENTAL_HISTORY', null, CONFIDENCE_STRONG, raw) };
    }

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

/**
 * "Crée une tâche pour l'accueil : rappeler le patient demain" — a job for the team, said while
 * examining. Matched only on the word for a task, so it cannot be mistaken for a note or a recall
 * (the sentence it carries often has "rappeler" or "rendez-vous" in it). The task's words are kept
 * as the doctor said them, case included; who it is for and when are read off the front of it.
 */
const TASK_START = /^\s*(?:(?:cr[ée]e[rz]?|ajoute[rz]?|nouvelle|new|create|add|make)\s+)?(?:une?\s+|a\s+)?(?:t[âa]che|task|to-?do)(?![\p{L}\d])\s*(.*)$/isu;
const TASK_FOR = new RegExp(
  '^(?:pour|for|[àa]|to)\\s+(?:l[ae]\\s+|l[\'’]\\s*|le\\s+|the\\s+|mon\\s+|ma\\s+)?'
  + '(r[ée]ception|accueil|secr[ée]taire|assistante?|moi|me|docteur|dentiste|doctor|dentist|admin\\p{L}*|direction)(?![\\p{L}])\\s*', 'iu');
const TASK_DAY = /^(?:(?:pour|for|d['’]ici|by)\s+)?(demain|aujourd['’]hui|tomorrow|today)(?![\p{L}])\s*/iu;
const TASK_URGENT = /^(?:(?:c['’]est\s+|et\s+)?urgent(?:e)?|urgently|asap)(?![\p{L}])\s*/iu;
const TASK_ABOUT_PATIENT = /\b(?:le|ce|cette|la)\s+patient(?:e)?\b|\b(?:the|this)\s+patient\b/iu;

const TASK_ROLES: Array<[RegExp, 'ASSISTANT' | 'DOCTOR' | 'ADMIN' | null]> = [
  [/^(?:r[ée]ception|accueil|secr[ée]taire|assistante?)$/iu, 'ASSISTANT'],
  [/^(?:docteur|dentiste|doctor|dentist)$/iu, 'DOCTOR'],
  [/^(?:admin\p{L}*|direction)$/iu, 'ADMIN'],
  [/^(?:moi|me)$/iu, null],
];

const createTask: GrammarRule = {
  id: 'grammar.task.create',
  match: (raw, _text, context) => {
    const start = TASK_START.exec(raw);
    if (!start) return null;
    // "Pas de tâche à faire" is the opposite of a task.
    if (startsNegated(raw)) return null;

    let rest = start[1].trim();
    const entities: Record<string, unknown> = {};

    // The three little phrases may come in any order: "pour l'accueil, demain, urgent : …".
    for (let i = 0; i < 3; i++) {
      rest = rest.replace(/^[,\s]+/u, '');
      const who = TASK_FOR.exec(rest);
      if (who && entities['assigneeRole'] === undefined) {
        entities['assigneeRole'] = TASK_ROLES.find(([re]) => re.test(who[1]))?.[1] ?? null;
        rest = rest.slice(who[0].length);
        continue;
      }
      const day = TASK_DAY.exec(rest);
      if (day && entities['dueDay'] === undefined) {
        entities['dueDay'] = /^(?:demain|tomorrow)$/iu.test(day[1]) ? 'tomorrow' : 'today';
        rest = rest.slice(day[0].length);
        continue;
      }
      const urgent = TASK_URGENT.exec(rest);
      if (urgent && entities['priority'] === undefined) {
        entities['priority'] = 'URGENT';
        rest = rest.slice(urgent[0].length);
        continue;
      }
      break;
    }
    // "Pour moi" names no one: the task is the doctor's own.
    if (entities['assigneeRole'] === null) delete entities['assigneeRole'];

    const title = rest.replace(/^[\s:,\-–—]+/u, '').replace(/[.!\s]+$/u, '').trim();
    if (!title) {
      return ask('What should the task say?', raw, [], { intent: 'tasks.create', entities, awaiting: 'title' });
    }
    entities['title'] = title.charAt(0).toUpperCase() + title.slice(1);
    // Only a task about the patient in front of the doctor is filed against them; "commander des
    // gants" is not, even though a patient happens to be open.
    if (context.patientId && TASK_ABOUT_PATIENT.test(title)) entities['linkPatient'] = true;
    return intent('tasks.create', entities, CONFIDENCE_STRONG, raw);
  },
};

/** "Schedule a follow-up": an appointment word with a scheduling verb. */
const SCHEDULE_VERB = /\b(?:schedule|book|set\s+up|programme[rz]?|planifie[rz]?|fixe[rz]?)\b/iu;
const RECALL_NOUN = /\b(?:follow[- ]?up|appointment|recall|rendez[- ]?vous|contr[ôo]le|rdv|rappel)\b/iu;
/** "Revoir dans 15 jours": a recall verb with a delay, no scheduling verb needed. */
const RECALL_VERB = /\b(?:revoir|revoyez|revenir|reconvoquer|rappeler|recheck|review|see\s+(?:him|her|them|the\s+patient)\s+again)\b/iu;
const DELAY = new RegExp(
  '\\b(?:dans|in|after|apr[èe]s|d[\'’]ici)\\s+(?:\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente|'
  + 'one|two|three|four|five|seven|eight|nine|ten|fifteen|twenty|thirty|a|an)\\s*'
  + '(?:jours?|semaines?|mois|ans?|days?|weeks?|months?|years?)\\b', 'iu');

const scheduleFollowUp: GrammarRule = {
  id: 'grammar.schedule.followUp',
  match: (raw, text, context) => {
    const asked = (SCHEDULE_VERB.test(text) && RECALL_NOUN.test(text))
      || ((RECALL_VERB.test(text) || RECALL_NOUN.test(text)) && DELAY.test(text));
    if (!asked) return null;
    // "Pas besoin de rendez-vous" would be filed as a follow-up to book.
    if (containsNegation(raw)) return null;

    // "Dent 16 carie, revoir dans 15 jours" is two things. The recall is taken
    // out and the rest resolved on its own, so neither swallows the other.
    const recall = followUpIntent(raw);
    const span = /\b(?:revoir|revoyez|revenir|reconvoquer|rappeler|recheck|review|contr[ôo]le|rappel|follow[- ]?up|recall)\b[^,;.]*?\b(?:jours?|semaines?|mois|ans?|days?|weeks?|months?|years?)\b/iu.exec(raw);
    if (!span) return { kind: 'intent', intent: recall };
    const rest = (raw.slice(0, span.index) + ' ' + raw.slice(span.index + span[0].length))
      .replace(/(?:^|\s)(?:et|puis|and|then)\s*$/iu, ' ')
      .replace(/[,;.\s]+$/u, '')
      .replace(/^[,;.\s]+/u, '')
      .trim();
    if (rest.split(/\s+/).filter(Boolean).length < 2) return { kind: 'intent', intent: recall };

    const other = resolveWithGrammar(rest, context);
    if (other.kind === 'intent') return { kind: 'sequence', intents: [other.intent, recall] };
    if (other.kind === 'sequence') return { kind: 'sequence', intents: [...other.intents, recall] };
    // The rest named nothing the grammar knows: the recall alone stands.
    return { kind: 'intent', intent: recall };
  },
};

function followUpIntent(raw: string): VoiceIntent {
  return makeIntent('schedule.followUp', { when: raw.trim() }, CONFIDENCE_MODERATE, raw);
}

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

    const mentions = findToothMentions(raw);

    // A number said as a tooth that does not exist ("dent 58") must not fall
    // through to whichever tooth happens to be selected.
    if (mentions.some(mention => !mention.valid)) {
      return ask(NO_SUCH_TOOTH_QUESTION, raw, [], pendingForTooth(findings, affirmedFindings(findings)));
    }

    // More than one tooth named: split the utterance or ask, never pick the first.
    if (new Set(mentions.map(mention => mention.fdi)).size > 1) {
      return severalTeeth(raw, extractEveryFinding(raw), mentions, context);
    }
    // No numbers, but several teeth described in words.
    if (mentions.length === 0) {
      const described = describedTeeth(raw, context);
      if (described) return described;
    }

    const tooth = resolveTooth(raw, context.dentition);
    const usesAnaphora = ANAPHORA.test(raw);
    const affirmed = affirmedFindings(findings);

    let fdi: string | null = null;
    if (tooth.kind === 'resolved') {
      fdi = tooth.fdi;
    } else if (tooth.kind === 'ambiguous') {
      // The doctor clearly meant a tooth but did not name one uniquely.
      // Offer the candidates rather than picking (audit XII.4 §5).
      return ask(tooth.question, raw, toothOptions(tooth), pendingForTooth(findings, affirmed));
    } else if (usesAnaphora || context.selectedFdi) {
      // "that tooth", or simply continuing on the tooth already selected.
      fdi = context.selectedFdi;
    }

    if (!fdi) {
      return ask('Which tooth is that for?', raw, [], pendingForTooth(findings, affirmed));
    }

    // Whatever the doctor said beyond the recognised findings is kept as the
    // tooth's free-text note, so nuance the closed vocabulary cannot express
    // ("patient anxious about this one") is not silently dropped.
    const confidence = tooth.kind === 'resolved'
      ? Math.min(tooth.confidence, CONFIDENCE_STRONG)
      : CONFIDENCE_MODERATE;

    return { kind: 'intent', intent: recordOnTooth(raw, findings, fdi, confidence, true) };
  },
};

/**
 * What to finish once the doctor says which tooth. Findings that were
 * affirmed carry on as findings; if everything was negated, what waits is the
 * note that says so.
 */
function pendingForTooth(
  findings: ExtractedFinding[],
  affirmed: ExtractedFinding[],
): { intent: string; entities: Record<string, unknown>; awaiting: string } {
  if (affirmed.length === 0) {
    return {
      intent: 'clinical.addNote',
      entities: { category: 'OBSERVATION', content: negatedClauses(findings).join('; ') },
      awaiting: 'fdi',
    };
  }
  const denied = negatedClauses(findings).join('; ');
  return {
    intent: 'chart.addToothFindings',
    entities: { findings: toEntities(affirmed), ...(denied ? { note: denied } : {}) },
    awaiting: 'fdi',
  };
}

/**
 * Ordered. Session control and corrections first (they are short and
 * unmistakable), then structured clinical records, then reads, then the
 * general tooth rule.
 */
export const GRAMMAR_RULES: GrammarRule[] = [
  startExamination,
  endExamination,
  createTask,
  showFindings,
  undoLast,
  correctLast,
  removeFinding,
  noAllergy,
  addAllergy,
  addMedicalHistory,
  addDentalHistory,
  addMedication,
  medicalStatement,
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
