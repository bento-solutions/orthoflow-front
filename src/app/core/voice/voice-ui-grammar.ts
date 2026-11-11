import { VoiceContextSnapshot, VoiceResolution } from './voice-intent.model';

/**
 * What can be said to change what is on screen, and to listen: the
 * consultation's views, the chart's camera, reading a section aloud, help,
 * repeat and the feedback level (docs/VOICE-COCKPIT-PLAN.md appendix A §1–§5).
 *
 * Every rule here matches the **whole sentence** (after fillers), never a
 * sentence that merely contains the words: "affiche les allergies du patient" is
 * a view, "allergie à la pénicilline" is an allergy, and "je vois que vous avez
 * des allergies" is conversation. The view and camera rules are class *view*
 * and so need no wake word; reading, help, repeat and the feedback level are
 * *read* and *control*, and do.
 *
 * Patterns are written for {@link normalizeUtterance}'s output: lower case,
 * apostrophes and punctuation turned to spaces.
 */

export type UiTarget = 'chart' | 'allergies' | 'patient' | 'history' | 'treatments' | 'plan' | 'appointment'
  | 'findings' | 'transcript' | 'summary';

interface UiRule {
  id: string;
  match: (raw: string, text: string, context: VoiceContextSnapshot) => VoiceResolution | null;
}

const STRONG = 0.92;

const resolution = (intent: string, entities: Record<string, unknown>, raw: string): VoiceResolution => ({
  kind: 'intent',
  intent: { intent, entities, confidence: STRONG, resolver: 'grammar', transcript: raw },
});

/** Fillers in front of a command: "alors", "bon", "donc"… */
const F = '(?:(?:et|alors|donc|bon|ben|ok|okay|euh|hum|puis|voil[àa]|and|so|well|then|now|uh|um|right)\\s+)*';

/** §1 — the words that may lead to a target: "je veux voir", "montre", "passe au"… */
const LEAD = '(?:(?:je\\s+(?:veux|voudrais|souhaite)|j\\s+aimerais|on\\s+(?:veut|va)|peux\\s+tu|tu\\s+peux|pouvez\\s+vous)\\s+)?'
  + '(?:(?:me\\s+)?(?:voir|montrer|afficher|ouvrir)|montre(?:z)?(?:\\s+moi)?|affiche(?:z)?(?:\\s+moi)?|ouvre|fais\\s+voir'
  + '|(?:on\\s+)?pass(?:e|ons|er)\\s+(?:a|à|au|aux)|va\\s+(?:a|à|au|aux)|reviens?\\s+(?:a|à|au|aux)|retour\\s+(?:a|à|au|aux)'
  + '|show(?:\\s+me)?|let\\s+me\\s+see|i\\s+want\\s+to\\s+see|open|go\\s+to|switch\\s+to|back\\s+to)';
const ARTICLE = '(?:(?:la|le|les|l|ses|son|sa|the|his|her|their)\\s+)?';

/** §2 — the targets, and whether each may be said on its own ("allergies", "plan de traitement"). */
const TARGETS: ReadonlyArray<{ target: UiTarget; words: string; bare: boolean }> = [
  { target: 'chart', bare: true, words: 'vue\\s+3\\s?d|3\\s?d(?:\\s+view)?|mod[èe]le\\s+3\\s?d|sch[ée]ma(?:\\s+dentaire)?|odontogramme|dents|bouche|(?:dental\\s+)?chart|teeth' },
  { target: 'allergies', bare: true, words: 'allergies?(?:\\s+du\\s+patient|\\s+de\\s+la\\s+patiente)?' },
  { target: 'patient', bare: false, words: 'informations?(?:\\s+(?:du|de\\s+la)\\s+patiente?)?|infos?(?:\\s+patient)?|fiche(?:\\s+(?:du\\s+)?patient)?|identit[ée]|coordonn[ée]es|patient\\s+(?:info(?:rmation)?|details)|details' },
  { target: 'history', bare: true, words: 'ant[ée]c[ée]dents(?:\\s+m[ée]dicaux)?|historique\\s+m[ée]dical|(?:medical\\s+)?history' },
  { target: 'treatments', bare: false, words: 'traitements?\\s+en\\s+cours|m[ée]dicaments|current\\s+treatments?|medications?' },
  { target: 'plan', bare: true, words: 'plan(?:\\s+de\\s+(?:traitement|soins))?|devis|(?:treatment\\s+)?plan' },
  { target: 'appointment', bare: false, words: '(?:prochain\\s+)?rendez\\s?vous|rdv|(?:next\\s+)?appointment' },
  { target: 'findings', bare: false, words: 'constatations|liste\\s+des\\s+dents|ce\\s+qui\\s+est\\s+dict[ée]|findings' },
  { target: 'transcript', bare: true, words: 'transcription|conversation|ce\\s+qui\\s+a\\s+[ée]t[ée]\\s+dit|transcript' },
  { target: 'summary', bare: true, words: 'r[ée]sum[ée]|r[ée]capitulatif|summary' },
];
/** "Tout" / "everything" is the summary only with a lead in front: "montre tout". */
const LEAD_ONLY_SUMMARY = 'tout|everything';

const end = '\\s*$';

/** "Ses informations", "le rendez-vous", "les constatations": a target with its article is a request on its own. */
const REQUIRED_ARTICLE = '(?:la|le|les|l|ses|son|sa|the|his|her|their)\\s+';
/** "Fiche patient" says what it is without an article. */
const BARE_EXTRA: ReadonlyArray<[UiTarget, string]> = [['patient', 'fiche\\s+(?:du\\s+)?patient(?:e)?']];

function targetOf(text: string, withLead: boolean): UiTarget | null {
  for (const { target, words, bare } of TARGETS) {
    const prefix = withLead ? `${LEAD}\\s+${ARTICLE}` : bare ? ARTICLE : REQUIRED_ARTICLE;
    if (new RegExp(`^${F}${prefix}(?:${words})${end}`, 'iu').test(text)) return target;
  }
  if (!withLead) {
    for (const [target, words] of BARE_EXTRA) {
      if (new RegExp(`^${F}(?:${words})${end}`, 'iu').test(text)) return target;
    }
  }
  if (withLead && new RegExp(`^${F}${LEAD}\\s+${ARTICLE}(?:${LEAD_ONLY_SUMMARY})${end}`, 'iu').test(text)) return 'summary';
  return null;
}

/** "Montre les allergies", "allergies", "plan de traitement", "je veux voir la vue 3D". */
const uiShow: UiRule = {
  id: 'grammar.ui.show',
  match: (raw, text) => {
    const target = targetOf(text, true) ?? targetOf(text, false);
    return target ? resolution('ui.show', { target }, raw) : null;
  },
};

/** §3 — back, pin, unpin. */
const uiBack: UiRule = {
  id: 'grammar.ui.back',
  match: (raw, text) => new RegExp(`^${F}(?:retour|reviens|vue\\s+pr[ée]c[ée]dente|en\\s+arri[èe]re|back|go\\s+back|previous\\s+view)${end}`, 'iu').test(text)
    ? resolution('ui.back', {}, raw) : null,
};

const uiPin: UiRule = {
  id: 'grammar.ui.pin',
  match: (raw, text) => {
    if (new RegExp(`^${F}(?:garde\\s+(?:cette|la)\\s+vue|[ée]pingle(?:\\s+la\\s+vue)?|verrouille\\s+la\\s+vue|ne\\s+bouge\\s+plus|keep\\s+this\\s+view|pin(?:\\s+the\\s+view)?|lock\\s+the\\s+view)${end}`, 'iu').test(text)) {
      return resolution('ui.pin', {}, raw);
    }
    if (new RegExp(`^${F}(?:suis\\s+moi|vue\\s+automatique|lib[èe]re\\s+la\\s+vue|d[ée]s[ée]pingle|follow\\s+me|unpin|auto\\s+view)${end}`, 'iu').test(text)) {
      return resolution('ui.unpin', {}, raw);
    }
    return null;
  },
};

/** §4 — the camera. */
const STEPS_ONE = '(?:\\s+(?:un\\s+peu|encore|plus|a\\s+(?:bit|little)|more))?';
const STEPS_MANY = '\\s+(?:beaucoup|[àa]\\s+fond|au\\s+maximum|a\\s+lot|all\\s+the\\s+way)';
const ZOOM_IN = 'zoom(?:e[rz]?)?(?:\\s+avant)?|plus\\s+pr[èe]s|rapproche(?:\\s+toi)?|agrandis?|plus\\s+gros|plus\\s+grand|zoom\\s+in|closer|bigger|magnify';
const ZOOM_OUT = 'zoom\\s+arri[èe]re|d[ée]zoom(?:e[rz]?)?|plus\\s+loin|[ée]loigne(?:\\s+toi)?|recule|plus\\s+petit|zoom\\s+out|further|smaller';
const RESET = 'toute\\s+la\\s+bouche|vue\\s+compl[èe]te|r[ée]initialise\\s+la\\s+vue|recentre|vue\\s+normale|(?:the\\s+)?whole\\s+mouth|(?:the\\s+)?full\\s+mouth|reset(?:\\s+the)?\\s+view';

const chartCamera: UiRule = {
  id: 'grammar.chart.camera',
  match: (raw, text) => {
    for (const [direction, words] of [['in', ZOOM_IN], ['out', ZOOM_OUT]] as const) {
      if (new RegExp(`^${F}(?:${words})${STEPS_MANY}${end}`, 'iu').test(text)) return resolution('chart.zoom', { direction, steps: 3 }, raw);
      if (new RegExp(`^${F}(?:${words})${STEPS_ONE}${end}`, 'iu').test(text)) return resolution('chart.zoom', { direction, steps: 1 }, raw);
    }
    if (new RegExp(`^${F}(?:reviens?\\s+(?:a|à)\\s+|retour\\s+(?:a|à)\\s+|montre\\s+|back\\s+to\\s+|show\\s+)?(?:${RESET})${end}`, 'iu').test(text)) {
      return resolution('chart.reset', {}, raw);
    }
    const turn = new RegExp(`^${F}(?:tourne|pivote|turn|rotate)\\s+(?:(?:[àa]|vers\\s+(?:la|le))\\s+)?(gauche|droite|haut|bas|left|right|up|down)${end}`, 'iu').exec(text);
    if (turn) {
      const word = turn[1].toLowerCase();
      const direction = ({ gauche: 'left', droite: 'right', haut: 'up', bas: 'down' } as Record<string, string>)[word] ?? word;
      return resolution('chart.rotate', { direction }, raw);
    }
    if (new RegExp(`^${F}(?:l\\s+autre\\s+c[ôo]t[ée]|retourne(?:\\s+la\\s+dent)?|(?:the\\s+)?other\\s+side|flip)${end}`, 'iu').test(text)) {
      return resolution('chart.rotate', { direction: 'flip' }, raw);
    }
    if (new RegExp(`^${F}(?:(?:dent|la)\\s+suivante|suivante|next(?:\\s+tooth)?)${end}`, 'iu').test(text)) return resolution('chart.step', { delta: 1 }, raw);
    if (new RegExp(`^${F}(?:(?:dent|la)\\s+pr[ée]c[ée]dente|pr[ée]c[ée]dente|previous(?:\\s+tooth)?)${end}`, 'iu').test(text)) return resolution('chart.step', { delta: -1 }, raw);
    return null;
  },
};

/** §3 — reading a section aloud: "lis les allergies", "quelles sont ses allergies", "relis le plan". */
const uiRead: UiRule = {
  id: 'grammar.ui.read',
  match: (raw, text) => {
    const lead = '(?:(?:re)?lis|lire|quelles?\\s+sont|quel\\s+est|dis\\s+moi|read|what\\s+(?:are|is))\\s+';
    for (const { target, words } of TARGETS) {
      if (target === 'chart' || target === 'transcript') continue;
      if (new RegExp(`^${F}${lead}${ARTICLE}(?:${words})${end}`, 'iu').test(text)) return resolution('ui.read', { target }, raw);
    }
    if (new RegExp(`^${F}(?:(?:re)?lis|read)\\s+(?:ses|les|his|her|the)\\s+(?:infos?|informations?)${end}`, 'iu').test(text)) {
      return resolution('ui.read', { target: 'patient' }, raw);
    }
    return null;
  },
};

/** §3 — help, repeat, the feedback level. */
const help: UiRule = {
  id: 'grammar.help',
  match: (raw, text) => new RegExp(`^${F}(?:aide(?:\\s+moi)?|qu\\s+est\\s+ce\\s+que\\s+je\\s+peux\\s+dire|comment\\s+(?:ça|ca)\\s+marche|dis\\s+moi\\s+comment(?:\\s.*)?|quelles\\s+commandes|help|what\\s+can\\s+i\\s+say|how\\s+does\\s+(?:this|it)\\s+work)${end}`, 'iu').test(text)
    ? resolution('help.show', {}, raw) : null,
};

const repeat: UiRule = {
  id: 'grammar.voice.repeat',
  match: (raw, text) => new RegExp(`^${F}(?:r[ée]p[èe]te(?:z)?|redis|qu\\s+est\\s+ce\\s+que\\s+tu\\s+as\\s+compris|pardon|repeat|say\\s+(?:that\\s+)?again|what\\s+did\\s+you\\s+(?:hear|understand))${end}`, 'iu').test(text)
    ? resolution('voice.repeat', {}, raw) : null,
};

const FEEDBACK_WORDS: ReadonlyArray<[string, string]> = [
  ['silent', 'silence|tais\\s+toi|mode\\s+silencieux|arr[êe]te\\s+de\\s+parler|ne\\s+parle\\s+plus|be\\s+quiet|stop\\s+talking|mute'],
  ['brief', 'confirmations?\\s+br[èe]ves?|parle\\s+moins|plus\\s+court|brief(?:\\s+confirmations?)?|shorter'],
  ['tones', 'sons?\\s+seulement|juste\\s+(?:les\\s+)?sons?|bips?\\s+seulement|tones?\\s+only|just\\s+(?:the\\s+)?(?:beeps?|tones?)'],
  ['full', 'parle|confirmations?\\s+vocales?|confirmations?\\s+compl[èe]tes?|tu\\s+peux\\s+parler|speak|full\\s+confirmations?|talk'],
];

const feedbackSet: UiRule = {
  id: 'grammar.feedback.set',
  match: (raw, text) => {
    for (const [level, words] of FEEDBACK_WORDS) {
      if (new RegExp(`^${F}(?:${words})${end}`, 'iu').test(text)) return resolution('feedback.set', { level }, raw);
    }
    return null;
  },
};

/** In the grammar's order: before the free-text rules, so "affiche les allergies du patient" is never an allergy. */
export const UI_RULES: UiRule[] = [uiBack, uiPin, chartCamera, uiShow, uiRead, help, repeat, feedbackSet];
