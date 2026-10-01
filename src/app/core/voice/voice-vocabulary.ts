import { WAKE_WORD } from './voice-wake';
import { NO_SUCH_TOOTH_QUESTION, SEVERAL_TEETH_QUESTION } from './voice-grammar';
import { findingLabel } from './clinical-lexicon';
import { VoiceContextSnapshot, entityString, stagedFindingCodes } from './voice-intent.model';

/**
 * The words a session listens for, in the two languages its dentists use —
 * and the words it answers with.
 *
 * Three consumers, one list, so they cannot drift:
 *
 * - **The recogniser.** Sent with every clip as the vocabulary the model
 *   should prefer when a word is acoustically ambiguous. This is what skews
 *   "carie récurente" towards "carie récurrente" and "Kalypso" towards
 *   "Calypso" before the grammar ever sees them.
 * - **The help panel.** The examples a dentist sees are exactly the ones the
 *   spec proves the grammar parses.
 * - **Spoken confirmations.** A French dentist hears "Dent 16 : carie
 *   récurrente", not an English label read by a French voice.
 *
 * `voice-vocabulary.spec.ts` checks every term against the lexicon and every
 * example against the grammar, so a term added here that nothing can parse
 * fails the build instead of biasing the recogniser towards a dead end.
 */

export type SpokenLanguage = 'fr' | 'en';

export function spokenLanguage(locale: string): SpokenLanguage {
  return locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** Synthesis voices exist for fr-FR everywhere; fr-MA often has none. */
export function synthesisLocale(language: SpokenLanguage): string {
  return language === 'fr' ? 'fr-FR' : 'en-US';
}

/**
 * How each finding is said. The first French term is also how it is read
 * back to a French-speaking dentist.
 */
export const FINDING_TERMS: Readonly<Record<string, { fr: string[]; en: string[] }>> = {
  crown_replacement_required: { fr: ['couronne à remplacer', 'couronne à refaire'], en: ['crown replacement', 'replace the crown'] },
  crown_required: { fr: ['couronne à poser', 'couronne nécessaire'], en: ['needs a crown', 'crown required'] },
  root_canal_required: { fr: ['traitement canalaire à faire', 'dévitaliser'], en: ['needs a root canal', 'root canal required'] },
  extraction_required: { fr: ['à extraire', 'extraction nécessaire'], en: ['needs extraction', 'extraction required'] },
  filling_required: { fr: ['obturation nécessaire', 'à obturer'], en: ['needs a filling', 'filling required'] },
  implant_required: { fr: ['implant à poser', 'implant nécessaire'], en: ['needs an implant', 'implant required'] },
  bridge_required: { fr: ['bridge à poser', 'bridge nécessaire'], en: ['needs a bridge', 'bridge required'] },
  veneer_required: { fr: ['facette nécessaire'], en: ['needs a veneer', 'veneer required'] },
  scaling_required: { fr: ['détartrage nécessaire'], en: ['needs scaling', 'scaling required'] },
  sealant_required: { fr: ['scellement de sillons à faire'], en: ['sealant required'] },
  periodontal_treatment_required: { fr: ['traitement parodontal nécessaire'], en: ['needs periodontal treatment'] },
  restoration_required: { fr: ['à soigner', 'à restaurer'], en: ['needs treatment'] },

  recurrent_caries: { fr: ['carie récurrente', 'carie secondaire'], en: ['recurrent caries', 'secondary caries'] },
  deep_caries: { fr: ['carie profonde'], en: ['deep caries'] },
  caries: { fr: ['carie'], en: ['caries', 'decay'] },
  cavity: { fr: ['cavité'], en: ['cavity'] },
  fracture: { fr: ['fracture', 'dent fêlée'], en: ['fracture', 'cracked tooth'] },
  crown_defective: { fr: ['couronne défectueuse', 'couronne descellée'], en: ['defective crown', 'loose crown'] },
  retained_root: { fr: ['racine résiduelle'], en: ['retained root'] },
  avulsion: { fr: ['avulsion'], en: ['avulsion'] },
  extensive_destruction: { fr: ['dent délabrée'], en: ['extensive destruction'] },
  pulpitis: { fr: ['pulpite'], en: ['pulpitis'] },
  necrosis: { fr: ['nécrose pulpaire'], en: ['pulp necrosis'] },
  periapical_lesion: { fr: ['granulome', 'lésion périapicale'], en: ['periapical lesion'] },
  extracted: { fr: ['déjà extraite'], en: ['already extracted'] },
  missing: { fr: ['dent absente', 'manquante'], en: ['missing'] },
  impacted: { fr: ['incluse'], en: ['impacted'] },
  abscess: { fr: ['abcès'], en: ['abscess'] },
  infection: { fr: ['infection'], en: ['infection'] },
  mobility: { fr: ['mobilité', 'dent mobile'], en: ['mobility', 'loose tooth'] },
  sensitivity: { fr: ['sensibilité', 'sensible au froid'], en: ['sensitivity'] },
  pain: { fr: ['douleur', 'douloureuse'], en: ['pain'] },
  tooth_wear: { fr: ['usure', 'érosion'], en: ['tooth wear', 'attrition'] },
  discoloration: { fr: ['décoloration', 'tachée'], en: ['discoloration', 'stained'] },
  gingival_inflammation: { fr: ['gingivite', 'gencives enflammées'], en: ['gingivitis', 'bleeding gums'] },
  periodontal_pocket: { fr: ['poche parodontale', 'parodontite'], en: ['periodontal pocket', 'periodontitis'] },
  gingival_recession: { fr: ['récession gingivale'], en: ['gingival recession'] },
  bleeding: { fr: ['saignement'], en: ['bleeding'] },
  swelling: { fr: ['gonflement'], en: ['swelling'] },
  plaque_calculus: { fr: ['tartre', 'plaque'], en: ['calculus', 'tartar'] },
  malposition: { fr: ['malposition', 'encombrement'], en: ['malpositioned', 'crowded'] },

  existing_crown: { fr: ['couronne', 'ancienne couronne'], en: ['existing crown', 'crown'] },
  existing_bridge: { fr: ['bridge existant'], en: ['existing bridge'] },
  existing_implant: { fr: ['implant existant'], en: ['existing implant'] },
  existing_veneer: { fr: ['facette'], en: ['existing veneer'] },
  existing_root_canal: { fr: ['dent dévitalisée', 'traitement canalaire existant'], en: ['previous root canal', 'root canal treated'] },
  existing_post: { fr: ['tenon', 'inlay core'], en: ['post and core'] },
  existing_inlay: { fr: ['inlay', 'onlay'], en: ['inlay', 'onlay'] },
  existing_amalgam: { fr: ['amalgame'], en: ['amalgam'] },
  existing_composite: { fr: ['composite'], en: ['composite'] },
  existing_sealant: { fr: ['scellement de sillons'], en: ['sealant'] },
  existing_deciduous: { fr: ['dent de lait'], en: ['baby tooth'] },
  existing_filling: { fr: ['obturation', 'ancienne obturation'], en: ['existing filling', 'filling'] },

  monitor: { fr: ['à surveiller'], en: ['monitor'] },
  follow_up: { fr: ['contrôle'], en: ['follow-up'] },
  normal: { fr: ['rien à signaler', 'saine'], en: ['normal', 'healthy'] },
};

const SURFACE_TERMS = [
  'occlusale', 'mésiale', 'distale', 'vestibulaire', 'linguale', 'palatine',
  'occlusal', 'mesial', 'distal', 'buccal', 'lingual',
];

const SURFACE_FR: Record<string, string> = {
  occlusal: 'occlusale', mesial: 'mésiale', distal: 'distale', buccal: 'vestibulaire',
  lingual: 'linguale', incisal: 'incisale', cervical: 'cervicale',
};

/** The combining form a French dentist uses for all but the last of a compound surface. */
const SURFACE_FR_STEM: Record<string, string> = {
  occlusal: 'occluso', mesial: 'mésio', distal: 'disto', buccal: 'vestibulo',
  lingual: 'linguo', incisal: 'incisio', cervical: 'cervico',
};

/**
 * A surface as it is spoken: "mesial-occlusal" is "mésio-occlusale", as the
 * dentist said it, rather than two adjectives strung together.
 */
export function spokenSurface(surface: string, language: SpokenLanguage): string {
  const parts = surface.split('-').filter(Boolean);
  if (language !== 'fr') return parts.join('-');
  if (parts.length === 1) return SURFACE_FR[parts[0]] ?? parts[0];
  const last = parts[parts.length - 1];
  return [...parts.slice(0, -1).map(part => SURFACE_FR_STEM[part] ?? part), SURFACE_FR[last] ?? last].join('-');
}

const SEVERITY_FR: Record<string, string> = { MILD: 'légère', MODERATE: 'modérée', SEVERE: 'sévère' };

/**
 * Whole commands, as a dentist says them. Each is proven by the spec to
 * resolve to `intent` in both languages.
 */
export const COMMAND_EXAMPLES: ReadonlyArray<{ intent: string; fr: string; en: string }> = [
  { intent: 'chart.addToothFindings', fr: 'dent 16, carie récurrente occlusale', en: 'tooth 36, deep caries, needs a root canal' },
  { intent: 'chart.addToothFindings', fr: 'la 26, couronne à remplacer', en: '46: existing filling, monitor' },
  { intent: 'chart.removeFinding', fr: 'enlève la carie sur la 16', en: 'remove the caries on 16' },
  { intent: 'chart.replaceLastFinding', fr: 'non, en fait couronne à remplacer', en: 'no, actually crown replacement' },
  { intent: 'voice.correction.undo', fr: 'annule', en: 'undo' },
  { intent: 'clinical.addNote', fr: 'note : patient anxieux', en: 'add a note: patient anxious' },
  { intent: 'clinical.addAllergy', fr: 'allergie à la pénicilline', en: 'allergy to penicillin' },
  { intent: 'clinical.addMedicalHistory', fr: 'antécédents médicaux : diabète', en: 'medical history: diabetes' },
  { intent: 'chart.readTooth', fr: 'lis la dent 16', en: 'what is on tooth 16' },
  { intent: 'voice.session.summary', fr: 'montre les constatations', en: 'show me today\'s findings' },
  { intent: 'voice.session.end', fr: 'fin de l\'examen', en: 'end examination' },
];

const VOCABULARY_HINT = [
  ...COMMAND_EXAMPLES.flatMap(example => [example.fr, example.en]),
  ...Object.values(FINDING_TERMS).flatMap(terms => [...terms.fr, ...terms.en]),
  ...SURFACE_TERMS,
].join('; ');

/**
 * What the recogniser is told to expect for one clip: the wake word, the
 * current tooth and the vocabulary. For spelling only — the server's
 * instruction says so.
 *
 * Deliberately not the patient's name. It went with every clip to up to three
 * outside recognisers, for no clinical gain: dictation is about teeth and
 * findings, the patient is already selected, and a name the recogniser
 * misspells costs nothing because it never reaches the record. Sending less
 * personal data is the simplest way to meet the data-minimisation duty.
 */
export function speechHints(snapshot: VoiceContextSnapshot): string {
  const parts = [WAKE_WORD];
  if (snapshot.selectedFdi) parts.push(`dent ${snapshot.selectedFdi}`);
  parts.push(VOCABULARY_HINT);
  return parts.join('; ');
}

export function spokenFindingLabel(code: string, language: SpokenLanguage): string {
  if (language === 'fr') return FINDING_TERMS[code]?.fr[0] ?? findingLabel(code);
  return findingLabel(code).toLowerCase();
}

// ── Answers ─────────────────────────────────────────────────────────────

const PHRASES = {
  sessionStarted: { fr: 'Session démarrée.', en: 'Session started.' },
  notUnderstood: { fr: 'Pas compris.', en: 'Not understood.' },
  removed: { fr: 'Retiré.', en: 'Removed.' },
  undone: { fr: 'Annulé.', en: 'Undone.' },
  nothingToUndo: { fr: 'Rien à annuler.', en: 'Nothing to undo.' },
  notInSession: { fr: 'Pas dans cette session.', en: 'Not in this session.' },
  notStaged: { fr: 'Non enregistré. Répétez.', en: 'Not recorded. Say it again.' },
  discarded: { fr: 'Abandonné.', en: 'Discarded.' },
  corrected: { fr: 'Corrigé.', en: 'Corrected.' },
  // Said aloud because the dentist is not looking at the screen: a microphone
  // that stopped hearing them, or a service that lost their words, is
  // otherwise invisible until the review shows a gap.
  micLost: {
    fr: 'Le micro est déconnecté. Je ne vous entends plus.',
    en: 'The microphone is disconnected. I can no longer hear you.',
  },
  micSuspended: {
    fr: 'Le micro est suspendu. Je ne vous entends plus.',
    en: 'The microphone is suspended. I can no longer hear you.',
  },
  micBack: { fr: 'Micro rétabli.', en: 'Microphone back.' },
  sttOffline: {
    fr: 'Pas de connexion. Je n\'ai pas pu vous entendre. Répétez quand elle revient.',
    en: 'No connection. I could not hear you. Say it again when it is back.',
  },
  sttFallback: {
    fr: 'Reconnaissance vocale du navigateur, moins précise.',
    en: 'Using the browser\'s speech recognition, which is less accurate.',
  },
  idleWarning: {
    fr: 'Aucune dictée depuis quarante minutes. Dites Calypso pour continuer, sinon l\'examen sera clôturé dans cinq minutes.',
    en: 'Nothing dictated for forty minutes. Say Calypso to carry on, or the examination will close in five minutes.',
  },
  idleEnded: {
    fr: 'Examen clôturé pour inactivité. Vos constatations sont à relire à l\'écran.',
    en: 'Examination closed for inactivity. Your findings are waiting for review on screen.',
  },
  sessionExpired: {
    fr: 'Votre connexion a expiré. Reconnectez-vous : votre examen est conservé.',
    en: 'Your login has expired. Sign in again: your examination is kept.',
  },
  lastClipLost: {
    fr: 'Votre dernière phrase n\'a pas pu être ajoutée. Vérifiez à l\'écran.',
    en: 'Your last sentence could not be added. Check the screen.',
  },
  nothingToCorrect: { fr: 'Rien à corriger.', en: 'Nothing to correct.' },
  questionExpired: { fr: 'Question annulée.', en: 'Question cancelled.' },
  sttBusy: {
    fr: 'Trop d\'enregistrements d\'un coup. Attendez un instant, puis répétez.',
    en: 'Too many recordings at once. Wait a moment, then say it again.',
  },
  pausedByVoice: {
    fr: 'En pause. Dites Calypso, reprends.',
    en: 'Paused. Say Calypso, resume.',
  },
  resumedByVoice: { fr: 'Reprise.', en: 'Resumed.' },
  nothingStaged: { fr: 'Rien à relire pour l\'instant.', en: 'Nothing to read back yet.' },
  sttDown: {
    fr: 'La reconnaissance vocale ne répond pas. Répétez.',
    en: 'Speech recognition is not responding. Say it again.',
  },
  notByVoiceHere: { fr: 'Pas possible à la voix ici.', en: 'That can\'t be done by voice from here.' },
  onScreenOnly: { fr: 'Cela se fait à l\'écran, pas à la voix.', en: 'That one has to be done on screen.' },
  openPatientFirst: { fr: 'Ouvrez d\'abord le dossier du patient.', en: 'Open a patient\'s dossier first.' },
  confirmUnsure: {
    fr: 'Je ne suis pas sûr. Dites oui pour confirmer, non pour annuler.',
    en: 'I\'m not sure. Say yes to confirm, no to cancel.',
  },
  cannotRunHere: { fr: 'Commande impossible ici.', en: 'That command can\'t run from here.' },
  saveFailed: { fr: 'Échec. Rien n\'a été enregistré.', en: 'That didn\'t save. Nothing was recorded.' },
  noConnection: { fr: 'Pas de connexion. Rien n\'a été enregistré.', en: 'No connection. Nothing was recorded.' },
  noPermission: { fr: 'Vous n\'avez pas le droit de faire cela.', en: 'You don\'t have permission to do that.' },
  recordGone: { fr: 'Cet élément n\'existe plus.', en: 'That record no longer exists.' },
  notAccepted: { fr: 'Refusé : les détails ne sont pas valides.', en: 'That wasn\'t accepted — the details didn\'t validate.' },
} as const;

export type PhraseKey = keyof typeof PHRASES;

export interface Spoken {
  text: string;
  locale: string;
}

export function phrase(key: PhraseKey, language: SpokenLanguage): Spoken {
  return { text: PHRASES[key][language], locale: synthesisLocale(language) };
}

/** The session is about to end and cannot be extended. */
export function expiryWarning(minutes: number, language: SpokenLanguage): Spoken {
  const text = language === 'fr'
    ? `Votre connexion expire dans ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. `
      + 'Terminez l\'examen, puis reconnectez-vous.'
    : `Your login expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. `
      + 'Finish the examination, then sign in again.';
  return { text, locale: synthesisLocale(language) };
}

/** Longer than this and a read-back is a monologue; the words are on screen. */
const NOTE_READBACK_MAX_CHARS = 90;

/**
 * While the app speaks, the microphone is deaf to the dentist — about 70 ms a
 * character. A tooth with many findings is read in full on screen but only
 * this many aloud, then "and N more", so one read-back does not cost ten
 * seconds of the dentist's next sentence.
 */
const READBACK_MAX_FINDINGS = 4;

/** How many staged entries "read back what we have" speaks, the most recent. */
const STAGED_LIST_MAX_ENTRIES = 6;

/**
 * The read-back for a staged write, in the resolved values: tooth number and
 * findings, never an echo of the words. Null for an intent with no dedicated
 * read-back, in which case the caller speaks its English preview.
 */
export function spokenConfirmation(
  serverIntent: string,
  entities: Record<string, unknown>,
  language: SpokenLanguage,
): Spoken | null {
  const locale = synthesisLocale(language);
  const fr = language === 'fr';

  switch (serverIntent) {
    case 'clinical.addFindings': {
      const fdi = entityString(entities, 'fdi') ?? '';
      const findings = Array.isArray(entities['findings'])
        ? entities['findings'] as Array<{ code?: string; surface?: string | null; severity?: string | null }>
        : [];
      const labels = findings.length
        ? findings.map(finding => {
          const parts = [spokenFindingLabel(String(finding.code), language)];
          if (finding.severity) parts.push(fr ? SEVERITY_FR[finding.severity] ?? '' : finding.severity.toLowerCase());
          if (finding.surface) parts.push(spokenSurface(finding.surface, language));
          return parts.filter(Boolean).join(' ');
        })
        : stagedFindingCodes(entities).map(code => spokenFindingLabel(code, language));
      const spoken = labels.length > READBACK_MAX_FINDINGS
        ? [...labels.slice(0, READBACK_MAX_FINDINGS),
           fr ? `et ${labels.length - READBACK_MAX_FINDINGS} autre${labels.length - READBACK_MAX_FINDINGS > 1 ? 's' : ''}`
              : `and ${labels.length - READBACK_MAX_FINDINGS} more`]
        : labels;
      return { text: fr ? `Dent ${fdi} : ${spoken.join(', ')}.` : `Tooth ${fdi}: ${spoken.join(', ')}.`, locale };
    }
    case 'clinical.retractFindings': {
      const fdi = entityString(entities, 'fdi') ?? '';
      const codes = Array.isArray(entities['codes']) ? (entities['codes'] as unknown[]).map(String) : [];
      const labels = codes.map(code => spokenFindingLabel(code, language)).join(', ');
      return { text: fr ? `Retrait sur la dent ${fdi} : ${labels}.` : `Withdraw from tooth ${fdi}: ${labels}.`, locale };
    }
    case 'clinical.addNote': {
      if (entities['category'] === 'FOLLOW_UP') {
        return { text: fr ? 'Contrôle noté.' : 'Follow-up noted.', locale };
      }
      // The words themselves, when they are short enough to listen to. A note
      // read back as only "Note ajoutée" lets "pas de carie" be filed and the
      // dentist never hear what was filed.
      const content = typeof entities['content'] === 'string' ? entities['content'].trim() : '';
      const fdi = entityString(entities, 'fdi');
      if (content && content.length <= NOTE_READBACK_MAX_CHARS) {
        const where = fdi ? (fr ? ` sur la dent ${fdi}` : ` on tooth ${fdi}`) : '';
        return { text: fr ? `Note${where} : ${content}.` : `Note${where}: ${content}.`, locale };
      }
      return { text: fr ? 'Note ajoutée.' : 'Note added.', locale };
    }
    case 'clinical.addAllergy':
      return { text: fr ? `Allergie : ${entities['substance']}.` : `Allergy: ${entities['substance']}.`, locale };
    case 'clinical.addMedicalHistory':
      return { text: fr ? `Antécédent : ${entities['label']}.` : `History: ${entities['label']}.`, locale };
    default:
      return null;
  }
}

/**
 * What has been staged so far, read aloud — the only way to check a dictation
 * by ear, since nothing is in the clinical tables until review. Each entry is
 * read exactly as it was read back the moment it was staged. A long session
 * reads only the latest few, and says how many there are.
 */
export function spokenStagedList(
  entries: ReadonlyArray<{ intent: string; entities: Record<string, unknown>; preview: string }>,
  language: SpokenLanguage,
): Spoken {
  if (entries.length === 0) return phrase('nothingStaged', language);
  const fr = language === 'fr';
  const count = entries.length;
  const shown = entries.slice(-STAGED_LIST_MAX_ENTRIES);
  const lines = shown.map(entry => spokenConfirmation(entry.intent, entry.entities, language)?.text ?? entry.preview);
  const head = fr
    ? `${count} entrée${count > 1 ? 's' : ''}${count > shown.length ? `, les ${shown.length} dernières` : ''}.`
    : `${count} ${count > 1 ? 'entries' : 'entry'}${count > shown.length ? `, the last ${shown.length}` : ''}.`;
  return { text: `${head} ${lines.join(' ')}`, locale: synthesisLocale(language) };
}

/** The grammar's fixed questions, as a French-speaking dentist should hear them. */
const QUESTIONS_FR: Record<string, string> = {
  'Which tooth is that for?': 'Quelle dent ?',
  'Which finding should I remove?': 'Quelle constatation retirer ?',
  'Which tooth should I remove that from?': 'Sur quelle dent ?',
  [SEVERAL_TEETH_QUESTION]: 'Plusieurs dents. Dites-les une à la fois.',
  [NO_SUCH_TOOTH_QUESTION]: 'Ce numéro de dent n\'existe pas. Quelle dent ?',
  'What should I change it to?': 'Remplacer par quoi ?',
  'I don\'t have a previous entry to correct. Which tooth and finding do you mean?':
    'Rien à corriger. Quelle dent et quelle constatation ?',
  'What should the note say?': 'Que dois-je noter ?',
  'Allergic to what?': 'Allergique à quoi ?',
  'Should I add this to the general medical history or the dental history?':
    'Antécédent médical ou dentaire ?',
  'What should I add to the medical history?': 'Quel antécédent médical ?',
  'What should I add to the dental history?': 'Quel antécédent dentaire ?',
};

export function spokenQuestion(question: string, language: SpokenLanguage): Spoken {
  if (language === 'fr') {
    const fixed = QUESTIONS_FR[question];
    if (fixed) return { text: fixed, locale: 'fr-FR' };
    // "Did you mean 16 (…) or 26 (…)?" and "Tooth 16 or tooth 26?" — the
    // codes are the part worth hearing.
    const codes = question.match(/\b[1-8][1-8]\b/g);
    if (codes && /^(?:Did you mean|Tooth)/.test(question)) {
      return { text: `Dent ${[...new Set(codes)].join(' ou ')} ?`, locale: 'fr-FR' };
    }
  }
  // The interpreter asks in the dentist's language; read it in a voice for
  // that language rather than the UI's.
  return { text: question, locale: synthesisLocale(looksFrench(question) ? 'fr' : 'en') };
}

const FRENCH_MARKERS = /[àâçéèêëîïôûùüÿœ]|\b(?:quelle?s?|quel|dent|laquelle|lequel|pouvez|voulez|vous|est-ce|sur|pour|avec|une?|des|les?)\b/iu;

/** A cheap guess at whether a sentence is French, for choosing the voice that reads it. */
export function looksFrench(text: string): boolean {
  return FRENCH_MARKERS.test(text);
}

/**
 * The language the dentist is dictating in, as the recogniser reported it —
 * which is what confirmations should be read back in, whatever the UI is set
 * to. Null when the recogniser did not say, or said "mixed".
 */
export function dictationLanguage(reported: string | null | undefined): SpokenLanguage | null {
  const value = (reported ?? '').toLowerCase();
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('en')) return 'en';
  return null;
}
