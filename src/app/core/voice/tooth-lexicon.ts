/**
 * Spoken tooth references → FDI codes.
 *
 * This is the safety-critical part of the voice system. A doctor clicking a
 * tooth sees which one highlights before anything is written; a doctor
 * speaking has no such confirmation, so a mapping that quietly returns the
 * wrong tooth writes to the wrong clinical record (audit XII.2). Every
 * function here is therefore built to return *ambiguous* rather than a best
 * guess: "upper molar" names three teeth and must produce a question, not a
 * choice.
 *
 * Deliberately framework-free so it can be unit-tested without Angular, a
 * microphone, or a browser.
 *
 * ── FDI, briefly ──────────────────────────────────────────────────────────
 * Two digits: quadrant then position, both counted from the patient's own
 * perspective (the clinical convention — the patient's right is the one on
 * your left as you face them).
 *
 *   Permanent:  1 = upper right   2 = upper left
 *               4 = lower right   3 = lower left
 *   Deciduous:  5 = upper right   6 = upper left
 *               8 = lower right   7 = lower left
 *
 *   Position (permanent):  1 central incisor · 2 lateral incisor · 3 canine
 *                          4 first premolar  · 5 second premolar
 *                          6 first molar     · 7 second molar · 8 third molar
 *   Position (deciduous):  1 central incisor · 2 lateral incisor · 3 canine
 *                          4 first molar     · 5 second molar   (no premolars)
 */

export type Dentition = 'adult' | 'child';

export type ToothResolution =
  | {
      kind: 'resolved';
      fdi: string;
      /** 0–1. Below the orchestrator's threshold the doctor is asked to confirm. */
      confidence: number;
      /** The slice of the utterance this came from, for the "I heard…" display. */
      matchedText: string;
      /** Plain-language read-back: "upper right first molar". Never skip showing this. */
      label: string;
    }
  | {
      kind: 'ambiguous';
      candidates: string[];
      question: string;
      matchedText: string;
    }
  | { kind: 'none' };

// ── Number words ────────────────────────────────────────────────────────

const UNITS_EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40,
};

const UNITS_FR: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40,
};

/**
 * Transliterated Darija/MSA. Moroccan clinicians code-switch mid-sentence and
 * a French-configured recogniser transliterates rather than transcribing in
 * Arabic script, so both forms need to be here. Coverage is 1–10 only, which
 * is what tooth positions and spoken FDI digits actually need.
 */
const UNITS_AR: Record<string, number> = {
  wahed: 1, wahid: 1, jouj: 2, zouj: 2, ithnayn: 2, tnayn: 2, tlata: 3,
  thalatha: 3, rbaa: 4, arbaa: 4, khamsa: 5, setta: 6, sitta: 6, sbaa: 7,
  sabaa: 7, tmnya: 8, thamanya: 8, tsoud: 9, tisaa: 9, ashra: 10, achra: 10,
  'واحد': 1, 'اثنان': 2, 'اثنين': 2, 'ثلاثة': 3, 'أربعة': 4, 'اربعة': 4,
  'خمسة': 5, 'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10,
};

const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, premier: 1, premiere: 1, première: 1,
  second: 2, seconds: 2, '2nd': 2, deuxieme: 2, deuxième: 2, seconde: 2,
  third: 3, '3rd': 3, troisieme: 3, troisième: 3,
  fourth: 4, quatrieme: 4, quatrième: 4,
  fifth: 5, cinquieme: 5, cinquième: 5,
  sixth: 6, sixieme: 6, sixième: 6,
  seventh: 7, septieme: 7, septième: 7,
  eighth: 8, huitieme: 8, huitième: 8,
};

const ALL_UNITS: Record<string, number> = { ...UNITS_EN, ...UNITS_FR, ...UNITS_AR };

/**
 * Every word that can name a number, in any of the three languages.
 *
 * Exported so the fuzzy matcher can refuse to touch them. Correcting "seize"
 * to "seizure" — or, far worse, to "sept" — puts a finding on a different
 * tooth, and nothing downstream would catch it: the record would read as a
 * perfectly ordinary finding, correctly spelled, on the wrong tooth.
 */
export const NUMBER_WORDS: ReadonlySet<string> = new Set(Object.keys(ALL_UNITS));

// ── Positional vocabulary ───────────────────────────────────────────────

/** Tooth-type words → position in the permanent dentition. */
const TOOTH_TYPE_PERMANENT: Array<{ terms: string[]; position: number; needsOrdinal?: boolean }> = [
  { terms: ['central incisor', 'centrals', 'central', 'incisive centrale', 'centrale',
            'ثنية', 'thnaya'], position: 1 },
  { terms: ['lateral incisor', 'lateral', 'incisive laterale', 'incisive latérale', 'laterale', 'latérale'],
    position: 2 },
  { terms: ['canine', 'cuspid', 'eye tooth', 'eyetooth', 'canines', 'ناب', 'nab'], position: 3 },
  { terms: ['wisdom tooth', 'wisdom', 'third molar', 'dent de sagesse', 'sagesse',
            'troisieme molaire', 'troisième molaire', 'ضرس العقل'], position: 8 },
  // Ordinal-bearing families are matched after the fixed ones above so
  // "third molar" wins over the generic molar rule.
  { terms: ['premolar', 'premolars', 'bicuspid', 'premolaire', 'prémolaire', 'ضاحك'],
    position: 4, needsOrdinal: true },
  { terms: ['molar', 'molars', 'molaire', 'ضرس', 'derss'], position: 6, needsOrdinal: true },
  { terms: ['incisor', 'incisors', 'incisive', 'ثنايا'], position: 1, needsOrdinal: true },
];

/** Deciduous teeth: no premolars, and molars start at position 4. */
const TOOTH_TYPE_DECIDUOUS: Array<{ terms: string[]; position: number; needsOrdinal?: boolean }> = [
  { terms: ['central incisor', 'central', 'incisive centrale', 'centrale'], position: 1 },
  { terms: ['lateral incisor', 'lateral', 'incisive laterale', 'incisive latérale', 'laterale'], position: 2 },
  { terms: ['canine', 'cuspid', 'canines'], position: 3 },
  { terms: ['molar', 'molars', 'molaire'], position: 4, needsOrdinal: true },
  { terms: ['incisor', 'incisors', 'incisive'], position: 1, needsOrdinal: true },
];

const UPPER_TERMS = ['upper', 'top', 'maxillary', 'maxilla', 'superieur', 'supérieur',
                     'superieure', 'supérieure', 'haut', 'du haut', 'علوي', 'فوق'];
const LOWER_TERMS = ['lower', 'bottom', 'mandibular', 'mandible', 'inferieur', 'inférieur',
                     'inferieure', 'inférieure', 'bas', 'du bas', 'سفلي', 'تحت'];
const RIGHT_TERMS = ['right', 'droite', 'droit', 'يمين', 'الأيمن'];
const LEFT_TERMS = ['left', 'gauche', 'يسار', 'الأيسر'];

/** Anterior/posterior hints. They narrow a region but never name one tooth. */
const ANTERIOR_TERMS = ['front', 'anterior', 'anterieur', 'antérieur', 'devant', 'أمامي'];
const POSTERIOR_TERMS = ['back', 'posterior', 'posterieur', 'postérieur', 'arriere', 'arrière', 'خلفي'];

const TOOTH_WORD = ['tooth', 'teeth', 'dent', 'dents', 'سن', 'ضرس'];

// ── Labels for read-back ────────────────────────────────────────────────

const QUADRANT_LABEL: Record<string, string> = {
  '1': 'upper right', '2': 'upper left', '3': 'lower left', '4': 'lower right',
  '5': 'upper right', '6': 'upper left', '7': 'lower left', '8': 'lower right',
};

const POSITION_LABEL_PERMANENT: Record<number, string> = {
  1: 'central incisor', 2: 'lateral incisor', 3: 'canine',
  4: 'first premolar', 5: 'second premolar',
  6: 'first molar', 7: 'second molar', 8: 'third molar',
};

const POSITION_LABEL_DECIDUOUS: Record<number, string> = {
  1: 'central incisor', 2: 'lateral incisor', 3: 'canine',
  4: 'first molar', 5: 'second molar',
};

/** "16" → "upper right first molar". Used everywhere a tooth is shown back. */
export function describeFdi(fdi: string): string {
  if (!isValidFdi(fdi)) return `tooth ${fdi}`;
  const quadrant = fdi[0];
  const position = Number(fdi[1]);
  const deciduous = Number(quadrant) >= 5;
  const label = deciduous ? POSITION_LABEL_DECIDUOUS[position] : POSITION_LABEL_PERMANENT[position];
  return `${QUADRANT_LABEL[quadrant]} ${label}${deciduous ? ' (baby tooth)' : ''}`;
}

export function isValidFdi(fdi: string): boolean {
  if (!/^[1-8][1-8]$/.test(fdi)) return false;
  const quadrant = Number(fdi[0]);
  const position = Number(fdi[1]);
  return quadrant <= 4 ? position <= 8 : position <= 5;
}

/** Every FDI code that exists in a given dentition. */
export function allFdiCodes(dentition: Dentition): string[] {
  const quadrants = dentition === 'adult' ? ['1', '2', '3', '4'] : ['5', '6', '7', '8'];
  const positions = dentition === 'adult' ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5];
  return quadrants.flatMap(q => positions.map(p => `${q}${p}`));
}

// ── Universal (US) numbering ────────────────────────────────────────────

/**
 * Universal 1–32 runs clockwise from the patient's upper right third molar.
 * Included because imported records and US-trained clinicians use it; a bare
 * number in that range is otherwise indistinguishable from an FDI code, so
 * it is only consulted when the utterance says "universal" explicitly.
 */
const UNIVERSAL_TO_FDI: string[] = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '38', '37', '36', '35', '34', '33', '32', '31',
  '41', '42', '43', '44', '45', '46', '47', '48',
];

export function universalToFdi(universal: number): string | null {
  if (!Number.isInteger(universal) || universal < 1 || universal > 32) return null;
  return UNIVERSAL_TO_FDI[universal - 1];
}

// ── Text normalisation ──────────────────────────────────────────────────

/**
 * Lower-cases, strips punctuation, folds Arabic-Indic digits to ASCII, and
 * collapses whitespace — but deliberately keeps accents and Arabic script,
 * because "prémolaire" and "ضرس" are the words the lexicon matches on.
 */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[.,;:!?()"']/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A number anywhere in a phrase, as digits or as a word, in any of the three
 * languages. Handles French "vingt et un" and English "twenty one" compounds.
 */
export function parseNumber(text: string): number | null {
  const normalized = normalizeUtterance(text);
  if (!normalized) return null;

  const digits = normalized.match(/\b\d{1,2}\b/);
  if (digits) return Number(digits[0]);

  const words = normalized.split(' ').filter(w => w !== 'et' && w !== 'and');
  let total: number | null = null;
  for (const word of words) {
    const value = ALL_UNITS[word];
    if (value === undefined) continue;
    if (total === null) {
      total = value;
    } else if (total % 10 === 0 && total >= 20 && value < 10) {
      // "twenty" + "one" → 21; "vingt" + "et" + "un" → 21
      total += value;
    } else {
      break;
    }
  }
  return total;
}

// ── The resolver ────────────────────────────────────────────────────────

interface ParsedTooth {
  arch: 'upper' | 'lower' | null;
  side: 'right' | 'left' | null;
  position: number | null;
  region: 'anterior' | 'posterior' | null;
  /** Set when the utterance named an FDI or Universal code outright. */
  explicitFdi: string | null;
  /** The utterance named a tooth family this dentition does not have. */
  impossibleForDentition?: boolean;
  /** The code was inferred from a loose number rather than announced as a tooth. */
  explicitWasBare?: boolean;
  matchedText: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Index of `term` in `text` as a whole word (or whole phrase), or -1.
 *
 * Substring matching is not good enough here: `"premolar".includes("molar")`
 * is true, which silently turned every premolar into a molar — two teeth
 * along, in the wrong tooth family. Boundaries are expressed as
 * "not a letter or digit" rather than \b so they also hold for Arabic script.
 */
function phraseIndex(text: string, term: string): number {
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRegex(term)})(?![\\p{L}\\p{N}])`, 'u');
  const match = pattern.exec(text);
  return match ? match.index + match[0].length - match[1].length : -1;
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some(term => phraseIndex(text, term) >= 0);
}

/**
 * Reads whatever tooth information an utterance contains, without deciding
 * whether it is enough. Separating "what did they say" from "is that a single
 * tooth" is what makes the ambiguity handling honest rather than incidental.
 */
function parseToothPhrase(utterance: string, dentition: Dentition): ParsedTooth {
  const text = normalizeUtterance(utterance);
  const parsed: ParsedTooth = {
    arch: null, side: null, position: null, region: null, explicitFdi: null, matchedText: utterance.trim(),
  };

  // 1. An explicit code wins outright, in either notation.
  const universalMatch = text.match(/\b(?:universal|us)\s+(?:number\s+|tooth\s+)?(\d{1,2}|[a-z؀-ۿ]+(?:\s+[a-z]+)?)\b/);
  if (universalMatch) {
    const value = parseNumber(universalMatch[1]);
    const fdi = value === null ? null : universalToFdi(value);
    if (fdi) {
      parsed.explicitFdi = fdi;
      return parsed;
    }
  }

  // Digit-by-digit is the recommended spoken form for codes ("one six"),
  // because compound numerals are exactly where recognisers confuse
  // sixteen/seventeen and vingt-six/vingt-sept (audit XII.4 §5).
  const digitPair = text.match(
    new RegExp(`\\b(?:${TOOTH_WORD.join('|')})\\s+([1-8])\\s+([1-8])\\b`)
  );
  if (digitPair) {
    const candidate = `${digitPair[1]}${digitPair[2]}`;
    if (isValidFdi(candidate)) {
      parsed.explicitFdi = candidate;
      return parsed;
    }
  }

  const digitPairWords = text.match(
    new RegExp(`\\b(?:${TOOTH_WORD.join('|')})\\s+([a-z؀-ۿ]+)\\s+([a-z؀-ۿ]+)\\b`)
  );
  if (digitPairWords) {
    const first = ALL_UNITS[digitPairWords[1]];
    const secondValue = ALL_UNITS[digitPairWords[2]];
    if (first !== undefined && secondValue !== undefined && first >= 1 && first <= 8) {
      const candidate = `${first}${secondValue}`;
      if (isValidFdi(candidate)) {
        parsed.explicitFdi = candidate;
        return parsed;
      }
    }
  }

  // "tooth sixteen" / "dent 16" — a whole two-digit code spoken as one number.
  const wholeCode = text.match(
    new RegExp(`\\b(?:${TOOTH_WORD.join('|')})\\s+(\\d{2}|[a-z؀-ۿ]+(?:\\s+(?:et\\s+)?[a-z؀-ۿ]+)?)\\b`)
  );
  if (wholeCode) {
    const value = parseNumber(wholeCode[1]);
    if (value !== null && value >= 11 && isValidFdi(String(value))) {
      parsed.explicitFdi = String(value);
      return parsed;
    }
  }

  // "Carie sur la seize", "la vingt-six" — how French dental dictation
  // actually names a tooth: an article in place of "dent". Only a spoken
  // number that is itself a valid code qualifies, so "la deux" or "le
  // second" never become teeth — and the word after the article must be a
  // number, so "la carie" is skipped and "sur la seize" further on is found.
  const articleCodes = text.matchAll(
    /(?:^|[^\p{L}\p{N}])(?:sur\s+)?(?:la|le|number|numero|numéro)\s+(\p{L}+(?:\s+(?:et\s+)?\p{L}+)?)(?![\p{L}\p{N}])/gu,
  );
  for (const articleCode of articleCodes) {
    if (ALL_UNITS[articleCode[1].split(' ')[0]] === undefined) continue;
    const value = parseNumber(articleCode[1]);
    if (value !== null && value >= 11 && isValidFdi(String(value))) {
      parsed.explicitFdi = String(value);
      return parsed;
    }
  }

  // A bare two-digit FDI with no "tooth" in front ("sixteen, recurrent caries").
  const bareCode = text.match(/(?:^|[^\p{L}\p{N}])([1-8][1-8])(?![\p{L}\p{N}])/u);
  if (bareCode && isValidFdi(bareCode[1])) {
    parsed.explicitFdi = bareCode[1];
    parsed.explicitWasBare = true;
    return parsed;
  }

  // 2. Otherwise, gather the descriptive parts.
  if (containsAny(text, UPPER_TERMS)) parsed.arch = 'upper';
  else if (containsAny(text, LOWER_TERMS)) parsed.arch = 'lower';

  if (containsAny(text, RIGHT_TERMS)) parsed.side = 'right';
  else if (containsAny(text, LEFT_TERMS)) parsed.side = 'left';

  if (containsAny(text, ANTERIOR_TERMS)) parsed.region = 'anterior';
  else if (containsAny(text, POSTERIOR_TERMS)) parsed.region = 'posterior';

  // A baby chart has no premolars at all, so a premolar phrase against one is
  // a genuine mismatch worth raising rather than quietly rounding to a molar.
  if (dentition === 'child' && containsAny(text, ['premolar', 'premolars', 'bicuspid', 'premolaire', 'prémolaire'])) {
    parsed.impossibleForDentition = true;
    return parsed;
  }

  const table = dentition === 'adult' ? TOOTH_TYPE_PERMANENT : TOOTH_TYPE_DECIDUOUS;
  let pendingFamily: { base: number } | null = null;

  for (const entry of table) {
    const matched = entry.terms.find(term => phraseIndex(text, term) >= 0);
    if (!matched) continue;

    if (!entry.needsOrdinal) {
      parsed.position = entry.position;
      break;
    }

    // "first molar", "molar one", "molaire 1" — the ordinal may lead or trail.
    const ordinal = findOrdinalNear(text, matched);
    if (ordinal === null) {
      // A bare "molar"/"premolar"/"incisor" names a family, not a tooth. Keep
      // the family so a number further along the phrase can still complete it
      // ("molaire superieure droite un"); if none appears, the caller asks.
      parsed.region = parsed.region ?? (entry.position >= 6 ? 'posterior' : 'anterior');
      pendingFamily = { base: entry.position };
      break;
    }
    parsed.position = entry.position + (ordinal - 1);
    break;
  }

  // A lone digit completes whatever is still open: an ordinal within the
  // pending family ("molar … one" → first molar), or, with no family named,
  // an absolute position ("upper right six" → first molar).
  if (parsed.position === null && (parsed.arch || parsed.side || pendingFamily)) {
    const lone = text.match(/(?:^|[^\p{L}\p{N}])([1-8])(?![\p{L}\p{N}])/u);
    let value: number | null = lone ? Number(lone[1]) : null;
    if (value === null) {
      const word = text.split(' ').map(w => ALL_UNITS[w]).find(v => v !== undefined && v >= 1 && v <= 8);
      value = word ?? null;
    }
    if (value !== null) {
      parsed.position = pendingFamily ? pendingFamily.base + (value - 1) : value;
    }
  }

  return parsed;
}

/** Finds an ordinal immediately before or after the tooth-family word. */
function findOrdinalNear(text: string, familyTerm: string): number | null {
  const index = text.indexOf(familyTerm);
  const before = text.slice(0, index).trim().split(' ').slice(-2);
  const after = text.slice(index + familyTerm.length).trim().split(' ').slice(0, 2);

  for (const word of [...before.reverse(), ...after]) {
    if (!word) continue;
    if (ORDINALS[word] !== undefined) return ORDINALS[word];
    const numeric = ALL_UNITS[word] ?? (/^\d$/.test(word) ? Number(word) : undefined);
    if (numeric !== undefined && numeric >= 1 && numeric <= 3) return numeric;
  }
  return null;
}

function quadrantFor(arch: 'upper' | 'lower', side: 'right' | 'left', dentition: Dentition): string {
  if (dentition === 'adult') {
    if (arch === 'upper') return side === 'right' ? '1' : '2';
    return side === 'right' ? '4' : '3';
  }
  if (arch === 'upper') return side === 'right' ? '5' : '6';
  return side === 'right' ? '8' : '7';
}

/**
 * Resolves a spoken tooth reference, or explains what is missing.
 *
 * Returns `ambiguous` — never a guess — whenever the utterance leaves more
 * than one tooth possible. "Which upper molar do you mean?" is a better
 * outcome than a 1-in-3 chance of the right clinical record.
 */
export function resolveTooth(utterance: string, dentition: Dentition = 'adult'): ToothResolution {
  const parsed = parseToothPhrase(utterance, dentition);

  if (parsed.explicitFdi) {
    const expectedDeciduous = dentition === 'child';
    const isDeciduousCode = Number(parsed.explicitFdi[0]) >= 5;
    // A permanent code spoken against a child chart is a real mistake worth
    // surfacing, not something to silently translate.
    if (expectedDeciduous !== isDeciduousCode) {
      return {
        kind: 'ambiguous',
        candidates: [parsed.explicitFdi],
        question: `Tooth ${parsed.explicitFdi} (${describeFdi(parsed.explicitFdi)}) isn't part of this patient's `
          + `${dentition === 'child' ? 'baby' : 'adult'} chart. Which tooth did you mean?`,
        matchedText: parsed.matchedText,
      };
    }
    return {
      kind: 'resolved',
      fdi: parsed.explicitFdi,
      confidence: parsed.explicitWasBare ? 0.82 : 0.95,
      matchedText: parsed.matchedText,
      label: describeFdi(parsed.explicitFdi),
    };
  }

  if (parsed.impossibleForDentition) {
    return {
      kind: 'ambiguous',
      candidates: [],
      question: 'A baby tooth chart has no premolars — five teeth per quadrant, molars included. '
        + 'Which tooth did you mean?',
      matchedText: parsed.matchedText,
    };
  }

  const maxPosition = dentition === 'adult' ? 8 : 5;
  if (parsed.position !== null && (parsed.position < 1 || parsed.position > maxPosition)) {
    return {
      kind: 'ambiguous',
      candidates: [],
      question: dentition === 'child'
        ? `A baby tooth chart has five teeth per quadrant and no premolars — which tooth did you mean?`
        : `I couldn't place that tooth position. Which tooth did you mean?`,
      matchedText: parsed.matchedText,
    };
  }

  const haveAll = parsed.arch !== null && parsed.side !== null && parsed.position !== null;
  if (haveAll) {
    const quadrant = quadrantFor(parsed.arch!, parsed.side!, dentition);
    const fdi = `${quadrant}${parsed.position}`;
    if (!isValidFdi(fdi)) {
      return {
        kind: 'ambiguous',
        candidates: [],
        question: 'That tooth doesn\'t exist in this chart. Which tooth did you mean?',
        matchedText: parsed.matchedText,
      };
    }
    return {
      kind: 'resolved',
      fdi,
      confidence: 0.9,
      matchedText: parsed.matchedText,
      label: describeFdi(fdi),
    };
  }

  // Not enough to name one tooth. Work out exactly what is missing and
  // enumerate the teeth still in play, so the question is specific and the
  // caller can offer them as a pick-list rather than making the doctor repeat
  // the whole phrase.
  const nothingSaid = parsed.arch === null && parsed.side === null
    && parsed.position === null && parsed.region === null;
  if (nothingSaid) return { kind: 'none' };

  const candidates = enumerateCandidates(parsed, dentition);
  return {
    kind: 'ambiguous',
    candidates,
    question: buildQuestion(parsed, candidates),
    matchedText: parsed.matchedText,
  };
}

function enumerateCandidates(parsed: ParsedTooth, dentition: Dentition): string[] {
  const arches: Array<'upper' | 'lower'> = parsed.arch ? [parsed.arch] : ['upper', 'lower'];
  const sides: Array<'right' | 'left'> = parsed.side ? [parsed.side] : ['right', 'left'];
  const maxPosition = dentition === 'adult' ? 8 : 5;

  let positions: number[];
  if (parsed.position !== null) {
    positions = [parsed.position];
  } else if (parsed.region === 'anterior') {
    positions = [1, 2, 3];
  } else if (parsed.region === 'posterior') {
    positions = dentition === 'adult' ? [4, 5, 6, 7, 8] : [4, 5];
  } else {
    positions = Array.from({ length: maxPosition }, (_, i) => i + 1);
  }

  const codes: string[] = [];
  for (const arch of arches) {
    for (const side of sides) {
      for (const position of positions) {
        const fdi = `${quadrantFor(arch, side, dentition)}${position}`;
        if (isValidFdi(fdi)) codes.push(fdi);
      }
    }
  }
  return codes;
}

function buildQuestion(parsed: ParsedTooth, candidates: string[]): string {
  const missing: string[] = [];
  if (parsed.arch === null) missing.push('upper or lower');
  if (parsed.side === null) missing.push('left or right');
  if (parsed.position === null) missing.push('which tooth');

  // A short candidate list is more useful read back than a description of
  // what's missing — the doctor can just say "sixteen".
  if (candidates.length > 0 && candidates.length <= 4) {
    const options = candidates.map(fdi => `${fdi} (${describeFdi(fdi)})`).join(' or ');
    return `Did you mean ${options}?`;
  }
  return `I need to know ${missing.join(' and ')}. Which tooth do you mean?`;
}
