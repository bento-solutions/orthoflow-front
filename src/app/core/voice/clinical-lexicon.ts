/**
 * Spoken clinical language → canonical finding codes.
 *
 * The codes here must exactly match the server's
 * `com.orthoflow.clinical.domain.model.FindingCatalog`; anything else is
 * rejected at the API boundary. `GET /api/v1/voice/lexicon` publishes the
 * server's list and {@link assertLexiconMatches} checks the two agree at
 * startup, so a drift shows up as a console warning at boot rather than as a
 * write that fails while a doctor is mid-examination.
 *
 * Two design points worth stating:
 *
 * 1. **Order is significance.** Patterns are tried most-specific first and
 *    each match consumes its span, so "needs a crown" cannot also register as
 *    "has a crown". Reordering this list changes clinical meaning.
 *
 * 2. **Several findings per utterance is the normal case.** "Old crown,
 *    recurrent caries underneath, crown needs replacement" is three findings.
 *    Recording only the last one — which a single-status model forces — throws
 *    away most of what the doctor said.
 *
 * Patterns are written with `\b` for readability and always executed through
 * {@link unicodeBoundaries}; see `voice-regex.ts` for why a raw `\b` loses
 * every French term that ends in an accent.
 */

import { unicodeBoundaries } from './voice-regex';
import { clauseBounds, clauseAround, isNegatedAt } from './voice-negation';

export type FindingKind = 'EXISTING' | 'CONDITION' | 'TREATMENT_REQUIRED' | 'OBSERVATION';
export type Severity = 'MILD' | 'MODERATE' | 'SEVERE';

export interface FindingDefinition {
  code: string;
  kind: FindingKind;
  /** Shown in the preview and the chart legend. */
  label: string;
  patterns: RegExp[];
}

/**
 * `i` and `u` flags throughout; no `g` — each pattern is applied once per
 * scan position and the matched span is consumed by the caller.
 */
const F = (code: string, kind: FindingKind, label: string, ...patterns: RegExp[]): FindingDefinition =>
  ({ code, kind, label, patterns });

/**
 * Ordered most-specific first. "Treatment required" phrasings come before the
 * "already present" ones for the same restoration, because "needs a crown"
 * and "has a crown" share the word that would otherwise decide it.
 */
export const FINDINGS: FindingDefinition[] = [
  // ── Treatment required ──────────────────────────────────────────────
  F('crown_replacement_required', 'TREATMENT_REQUIRED', 'Crown replacement required',
    /\bcrowns?\s+(?:needs?|requires?|to\s+be|has\s+to\s+be|must\s+be)\s+(?:a\s+)?(?:replac\w*|redone|remade|changed)/iu,
    /\b(?:replace|redo|remake|change)\s+(?:the\s+|this\s+|that\s+)?crown/iu,
    /\bcrown\s+replacement(?:\s+(?:required|needed|recommended))?/iu,
    // A bare "replacement recommended" after a restoration has been named.
    // Ordered inside this definition so it claims its own span and leaves
    // "existing crown" free to match separately in the same utterance.
    /\breplacement\s+(?:is\s+)?(?:recommended|required|needed|indicated)/iu,
    /\bneeds?\s+(?:to\s+be\s+)?replac\w+/iu,
    /\bcouronne\s+[àa]\s+(?:remplacer|refaire|changer)/iu,
    /\bremplacer?\s+(?:la\s+)?couronne/iu,
    /\brefaire\s+(?:la\s+)?couronne/iu),

  F('crown_required', 'TREATMENT_REQUIRED', 'Crown required',
    /\b(?:needs?|requires?|indicated\s+for)\s+(?:a\s+|an\s+)?(?:new\s+|full\s+)?crown/iu,
    /\bcrown\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\b(?:pose|poser|mettre)\s+(?:une\s+)?couronne/iu,
    /\bcouronne\s+(?:[àa]\s+(?:poser|faire|placer|pr[ée]voir|r[ée]aliser)|n[ée]cessaire|indiqu[ée]e?|recommand[ée]e?)/iu),

  F('root_canal_required', 'TREATMENT_REQUIRED', 'Root canal required',
    /\b(?:needs?|requires?)\s+(?:a\s+|an\s+)?(?:root\s+canal|endo(?:dontic)?\w*|rct)/iu,
    /\broot\s+canal\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\b(?:d[ée]vitaliser|traitement\s+(?:de\s+)?canal(?:aire)?\s+(?:n[ée]cessaire|[àa]\s+faire)|endodontie\s+n[ée]cessaire)/iu,
    /\bd[ée]vitalisation\s+(?:n[ée]cessaire|[àa]\s+(?:faire|pr[ée]voir|r[ée]aliser))/iu),

  F('extraction_required', 'TREATMENT_REQUIRED', 'Extraction required',
    /\b(?:needs?|requires?|for|indicated\s+for)\s+(?:an?\s+)?extraction/iu,
    /\b(?:needs?|has)\s+to\s+(?:be\s+(?:extracted|pulled|removed)|come\s+out)/iu,
    /\bextraction\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\b(?:extraire|[àa]\s+extraire|extraction\s+(?:n[ée]cessaire|indiqu[ée]e?))/iu,
    // "Extraction" on its own names a plan, not a fact: the past is "extraite".
    // Read as required, never as extracted, so a tooth is not recorded as gone
    // because of a noun; the read-back says "extraction à prévoir".
    /\bextraction\b/iu),

  F('filling_required', 'TREATMENT_REQUIRED', 'Filling required',
    /\b(?:needs?|requires?)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:filling|restoration|composite|amalgam|obturation)/iu,
    /\b(?:filling|restoration)\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\b(?:[àa]\s+obturer|obturation\s+(?:n[ée]cessaire|[àa]\s+faire)|soin\s+n[ée]cessaire)/iu),

  F('implant_required', 'TREATMENT_REQUIRED', 'Implant required',
    /\b(?:needs?|requires?|candidate\s+for)\s+(?:an?\s+)?implant/iu,
    /\bimplant\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\bimplant\s+(?:n[ée]cessaire|indiqu[ée]|[àa]\s+poser)/iu),

  F('bridge_required', 'TREATMENT_REQUIRED', 'Bridge required',
    /\b(?:needs?|requires?)\s+(?:a\s+)?bridge/iu,
    /\bbridge\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\bbridge\s+(?:n[ée]cessaire|[àa]\s+poser)/iu),

  F('veneer_required', 'TREATMENT_REQUIRED', 'Veneer required',
    /\b(?:needs?|requires?)\s+(?:a\s+)?(?:veneer|facette)/iu,
    /\b(?:veneer|facette)\s+(?:is\s+)?(?:required|needed|indicated|recommand[ée]e?|n[ée]cessaire)/iu),

  F('scaling_required', 'TREATMENT_REQUIRED', 'Scaling required',
    /\b(?:needs?|requires?)\s+(?:a\s+)?(?:scaling|cleaning|prophylaxis|d[ée]tartrage)/iu,
    /\b(?:scaling|d[ée]tartrage)\s+(?:is\s+)?(?:required|needed|indicated|n[ée]cessaire)/iu,
    /\bd[ée]tartrage\s+[àa]\s+(?:faire|pr[ée]voir|r[ée]aliser)/iu),

  F('sealant_required', 'TREATMENT_REQUIRED', 'Sealant required',
    /\b(?:needs?|requires?)\s+(?:a\s+)?sealant/iu,
    /\bsealant\s+(?:is\s+)?(?:required|needed|indicated)/iu,
    /\bscellement\s+(?:de\s+sillons\s+)?(?:n[ée]cessaire|[àa]\s+faire)/iu),

  F('periodontal_treatment_required', 'TREATMENT_REQUIRED', 'Periodontal treatment required',
    /\b(?:needs?|requires?)\s+(?:periodontal|perio|gum)\s+(?:treatment|therapy|care)/iu,
    /\btraitement\s+parodontal\s+(?:n[ée]cessaire|indiqu[ée])/iu),

  F('restoration_required', 'TREATMENT_REQUIRED', 'Restoration required',
    /\b(?:needs?|requires?)\s+(?:treatment|restoring|repair)/iu,
    /\b(?:[àa]\s+traiter|[àa]\s+restaurer|[àa]\s+soigner)/iu),

  // ── Conditions ──────────────────────────────────────────────────────
  F('recurrent_caries', 'CONDITION', 'Recurrent caries',
    /\brecurrent\s+car\w+/iu, /\bsecondary\s+car\w+/iu,
    /\bcar\w+\s+(?:underneath|under\s+(?:the\s+)?(?:crown|filling|restoration))/iu,
    /\bcarie\s+(?:r[ée]cidivante|r[ée]currente|secondaire|sous\s+(?:la\s+)?(?:couronne|obturation))/iu),

  F('deep_caries', 'CONDITION', 'Deep caries',
    /\bdeep\s+(?:car\w+|cavit\w+|decay)/iu, /\bcarie\s+profonde/iu),

  F('caries', 'CONDITION', 'Caries',
    /\bcaries?\b/iu, /\bcarious\b/iu, /\bdecay(?:ed)?\b/iu, /\bcarie\b/iu, /\btsous\b/iu,
    /\bcari[ée]e?s?\b/iu, /\bl[ée]sions?\s+carieuses?\b/iu),

  F('cavity', 'CONDITION', 'Cavity',
    /\bcavit(?:y|ies)\b/iu, /\bcavit[ée]\b/iu, /\btrou\b/iu),

  F('fracture', 'CONDITION', 'Fracture',
    // First, so "fractured crown" is one fracture rather than a fracture plus
    // an assertion that a crown restoration is present.
    /\bfractured?\s+crowns?\b/iu, /\bcouronne\s+fractur[ée]e?\b/iu,
    /\bfractur\w+/iu, /\bfractur[ée]e?s?\b/iu, /\bcracked?\b/iu, /\bchipped?\b/iu, /\bbroken\s+(?:tooth|cusp|edge)/iu,
    /\bf[êe]l[ée]e?\b/iu, /\bf[êe]lures?\b/iu, /\bcass[ée]e?\b/iu),

  F('crown_defective', 'CONDITION', 'Defective crown',
    /\b(?:defective|failing|leaking|broken|loose|cracked)\s+crown/iu,
    /\bcrown\s+(?:is\s+)?(?:defective|failing|leaking|loose|broken|cracked)/iu,
    /\bcouronne\s+(?:d[ée]fectueuse|cass[ée]e|descell[ée]e|fissur[ée]e)/iu),

  F('retained_root', 'CONDITION', 'Retained root',
    /\bretained\s+roots?/iu, /\broot\s+(?:remnant|fragment)/iu, /\bracine\s+r[ée]siduelle/iu),

  F('avulsion', 'CONDITION', 'Avulsion',
    /\bavuls(?:ion|[ée]e?s?)\b/iu),

  F('extensive_destruction', 'CONDITION', 'Extensive destruction',
    /\bd[ée]labr(?:[ée]e?s?|ement)\b/iu, /\bbadly\s+(?:broken\s+down|destroyed)\b/iu, /\bextensive(?:ly)?\s+(?:destruction|destroyed|broken\s+down)\b/iu),

  F('pulpitis', 'CONDITION', 'Pulpitis',
    /\bpulpit(?:is|e)\b/iu),

  F('necrosis', 'CONDITION', 'Pulp necrosis',
    /\b(?:pulp(?:al)?\s+)?necro(?:sis|tic)\b/iu, /\bn[ée]cros\w+/iu),

  F('periapical_lesion', 'CONDITION', 'Periapical lesion',
    /\bgranulom\w+/iu, /\bkystes?\b/iu, /\bcysts?\b/iu,
    /\bl[ée]sions?\s+p[ée]ri[- ]?apicales?\b/iu, /\bperiapical\s+(?:lesion|radiolucency)\b/iu),

  F('extracted', 'CONDITION', 'Extracted',
    /\b(?:already\s+)?extracted\b/iu, /\bhas\s+been\s+(?:pulled|removed|extracted)/iu,
    /\bextraite?\b/iu, /\bd[ée]j[àa]\s+extraite?/iu),

  F('missing', 'CONDITION', 'Missing',
    /\bmissing\b/iu, /\babsent\b/iu, /\bnot\s+present\b/iu, /\bmanquante?\b/iu, /\babsente?\b/iu),

  F('impacted', 'CONDITION', 'Impacted',
    /\bimpacted\b/iu, /\bunerupted\b/iu, /\bincluse?\b/iu, /\bnon\s+[ée]rupt[ée]e?\b/iu),

  F('abscess', 'CONDITION', 'Abscess',
    /\babscess\w*/iu, /\bfistula\b/iu, /\babc[èe]s\b/iu),

  F('infection', 'CONDITION', 'Infection',
    /\binfect(?:ion|ed)\b/iu, /\bsuppurat\w+/iu, /\binfect[ée]e?\b/iu),

  F('mobility', 'CONDITION', 'Mobility',
    /\bmobilit(?:y|[ée])\b/iu, /\b(?:tooth\s+is\s+)?(?:loose|wobbly)\b/iu, /\bmobile\b/iu),

  F('sensitivity', 'CONDITION', 'Sensitivity',
    /\bsensitiv\w+/iu, /\bsensible\b/iu, /\bsensibilit[ée]\b/iu,
    /\bhypersensitiv\w+/iu, /\bhypersensibilit[ée]s?\b/iu, /\breacts?\s+to\s+cold\b/iu),

  F('pain', 'CONDITION', 'Pain',
    /\bpain(?:ful)?\b/iu, /\baches?\b/iu, /\baching\b/iu, /\bdouleur\w*/iu, /\bdouloureu\w+/iu,
    /\btoothache\b/iu, /\bhurts?\b/iu),

  F('tooth_wear', 'CONDITION', 'Tooth wear',
    /\b(?:tooth\s+)?wear\b/iu, /\battrition\b/iu, /\berosion\b/iu, /\babfraction\b/iu,
    /\bbruxism\b/iu, /\bbruxisme\b/iu, /\busure\b/iu, /\b[ée]rosion\b/iu),

  F('discoloration', 'CONDITION', 'Discoloration',
    /\bdiscolo\w+/iu, /\bstain(?:ed|ing)?\b/iu, /\bd[ée]color\w+/iu, /\btach[ée]e?\b/iu,
    /\bcolor[ée]e?\b/iu),

  F('gingival_inflammation', 'CONDITION', 'Gingival inflammation',
    /\bgingivitis\b/iu, /\bgingival\s+inflammation\b/iu, /\b(?:inflamed|swollen|bleeding)\s+gums?\b/iu,
    /\bgums?\s+(?:are\s+)?(?:inflamed|swollen|bleeding)\b/iu,
    /\bgingivite\b/iu, /\bgencives?\s+(?:enflamm[ée]es?|gonfl[ée]es?|qui\s+saignent)/iu,
    // A bare "inflammation" ("not caries, it's inflammation"): the soft tissue, unless a
    // pulp or periapical word before it has already claimed the phrase.
    /\binflammation\b/iu, /\binflamm[ée]e?s?\b/iu),

  F('periodontal_pocket', 'CONDITION', 'Periodontal pocket',
    /\b(?:periodontal\s+)?pockets?\b/iu, /\bperiodontitis\b/iu,
    /\bpoche\s+parodontale\b/iu, /\bparodontite\b/iu),

  F('gingival_recession', 'CONDITION', 'Gingival recession',
    /\b(?:gingival\s+|gum\s+)?recession\b/iu, /\br[ée]cession(?:\s+gingivale)?\b/iu),

  F('bleeding', 'CONDITION', 'Bleeding',
    /\bbleeding\b/iu, /\bsaignements?\b/iu, /\bsaigne(?:nt)?\b/iu),

  F('swelling', 'CONDITION', 'Swelling',
    /\bswell\w+/iu, /\bgonflements?\b/iu, /\bgonfl[ée]e?s?\b/iu, /\btum[ée]faction\b/iu),

  F('plaque_calculus', 'CONDITION', 'Plaque / calculus',
    /\bcalculus\b/iu, /\btartar\b/iu, /\bplaque\b/iu, /\btartre\b/iu),

  F('malposition', 'CONDITION', 'Malposition',
    /\bmalpositioned?\b/iu, /\bcrowded?\b/iu, /\brotated?\b/iu, /\bmalposition\w*/iu,
    /\bencombrement\b/iu, /\bversion\b/iu,
    /\ben\s+rotation\b/iu, /\brotation\b/iu, /\b[ée]gression\b/iu, /\bextrusion\b/iu,
    /\bectopi\w+/iu, /\b(?:supra|infra)[- ]?(?:position|occlusion)\b/iu),

  // ── Existing restorations ───────────────────────────────────────────
  F('existing_crown', 'EXISTING', 'Existing crown',
    /\b(?:old|existing|previous|has\s+an?)\s+crown/iu, /\bcrowned\b/iu, /\bcrowns?\b/iu,
    /\b(?:ancienne\s+)?couronne\b/iu),

  F('existing_bridge', 'EXISTING', 'Existing bridge',
    /\b(?:old|existing|previous|has\s+an?)\s+bridge/iu, /\bbridge\b/iu, /\bbridge\s+existant\b/iu),

  F('existing_implant', 'EXISTING', 'Existing implant',
    /\b(?:old|existing|previous|has\s+an?)\s+implant/iu, /\bimplant\b/iu),

  F('existing_veneer', 'EXISTING', 'Existing veneer',
    /\b(?:old|existing|previous|has\s+an?)\s+(?:veneer|facette)/iu, /\bveneer\b/iu, /\bfacette\b/iu),

  F('existing_root_canal', 'EXISTING', 'Existing root canal',
    /\b(?:previous|old|existing|prior)\s+(?:root\s+canal|endo\w*|rct)/iu,
    /\broot\s+(?:canal|filled|treated)\b/iu, /\bendodontically\s+treated\b/iu,
    /\bd[ée]vitalis[ée]e?\b/iu, /\bd[ée]vitalisation\b/iu,
    /\btraitement\s+canalaire\s+(?:existant|ant[ée]rieur)/iu),

  F('existing_post', 'EXISTING', 'Existing post',
    /\b(?:post\s+and\s+core|post\b|pivot\b|inlay[- ]core)/iu, /\btenon\b/iu,
    /\breconstitution\s+corono[- ]?radiculaire\b/iu, /\bfaux[- ]moignon\b/iu, /\brcr\b/iu),

  F('existing_inlay', 'EXISTING', 'Existing inlay / onlay',
    /\b(?:inlay|onlay)s?\b/iu, /\binlays?[- ]?onlays?\b/iu),

  F('existing_amalgam', 'EXISTING', 'Existing amalgam',
    /\bamalgam\w*/iu, /\bsilver\s+filling/iu, /\bamalgame\b/iu),

  F('existing_composite', 'EXISTING', 'Existing composite',
    /\bcomposite\b/iu, /\bwhite\s+filling/iu, /\btooth[- ]coloured\s+filling/iu),

  F('existing_sealant', 'EXISTING', 'Existing sealant',
    /\bsealant\b/iu, /\bscellement\s+de\s+sillons\b/iu),

  F('existing_deciduous', 'EXISTING', 'Deciduous tooth retained',
    /\b(?:retained\s+)?(?:deciduous|baby|milk|primary)\s+tooth\b/iu, /\bdent\s+de\s+lait\b/iu),

  // Generic "filling" last, so amalgam/composite claim their specific code first.
  F('existing_filling', 'EXISTING', 'Existing filling',
    /\b(?:old|existing|previous|has\s+an?)\s+(?:filling|restoration|obturation)/iu,
    /\bfilled\b/iu, /\bfillings?\b/iu, /\brestoration\b/iu,
    /\b(?:ancienne\s+)?obturation\b/iu, /\bplomb\w*/iu, /\breconstitutions?(?:\s+coronaire)?\b/iu),

  // ── Observations ────────────────────────────────────────────────────
  F('monitor', 'OBSERVATION', 'Monitor',
    /\bmonitor\w*/iu, /\bwatch\b/iu, /\bkeep\s+an\s+eye\s+on\b/iu, /\bobserve\b/iu,
    /\b[àa]\s+surveiller\b/iu, /\bsurveiller\b/iu, /\bsurveillance\b/iu),

  F('follow_up', 'OBSERVATION', 'Follow-up',
    /\bfollow[- ]?up\b/iu, /\brecall\b/iu, /\br[ée]valuer\b/iu, /\bcontr[ôo]le\b/iu),

  F('normal', 'OBSERVATION', 'Normal',
    /\bnormal\b/iu, /\bhealthy\b/iu, /\bsound\b/iu, /\bnothing\s+(?:to\s+report|abnormal)\b/iu,
    /\bras\b/iu, /\bsaine?\b/iu, /\brien\s+[àa]\s+signaler\b/iu),
];

const FINDING_BY_CODE = new Map(FINDINGS.map(f => [f.code, f]));

export function findingLabel(code: string): string {
  return FINDING_BY_CODE.get(code)?.label ?? code;
}

export function findingKind(code: string): FindingKind | null {
  return FINDING_BY_CODE.get(code)?.kind ?? null;
}

export function allFindingCodes(): string[] {
  return FINDINGS.map(f => f.code);
}

// ── Surfaces and severity ───────────────────────────────────────────────

const SURFACES: Array<{ code: string; pattern: RegExp }> = [
  // The combining forms ("mésio-occlusale", "occluso-distale") are how a
  // dentist names a compound surface; each part is a surface of its own.
  { code: 'mesial', pattern: /\bm[ée]sial\w*|\bm[ée]sio\b/iu },
  { code: 'occlusal', pattern: /\bocclusal\w*|\bocclus[oa]\b|\bbiting\s+surface\b/iu },
  { code: 'distal', pattern: /\bdistal\w*|\bdisto\b/iu },
  { code: 'incisal', pattern: /\bincisal\w*|\bincisio\b/iu },
  { code: 'buccal', pattern: /\bbuccal\w*|\bvestibul\w*|\bbucco\b|\bfacial\s+surface\b/iu },
  { code: 'lingual', pattern: /\blingual\w*|\blinguo\b|\bpalatal\w*|\bpalatin\w*|\bpalato\b/iu },
  { code: 'cervical', pattern: /\bcervical\w*|\bcervico\b|\bneck\s+of\s+the\s+tooth\b/iu },
];

/**
 * "Proximal" is the collective word for the two contact surfaces, not a surface of its
 * own: it is stored as mesial + distal so a lesion is never tagged with a third,
 * overlapping value (which would also give it a third price).
 */
const PROXIMAL = /\b(?:inter)?proximal\w*|\bapproximal\w*/iu;

/** A compound surface is stored joined — "mesial-occlusal" — in this order, at most this many parts. */
const MAX_SURFACES = 3;

const SEVERITIES: Array<{ code: Severity; pattern: RegExp }> = [
  { code: 'SEVERE', pattern: /\bsevere\w*|\bdeep\b|\badvanced\b|\bs[ée]v[èe]re\b|\bprofonde?\b|\bavanc[ée]e?\b/iu },
  { code: 'MODERATE', pattern: /\bmoderate\w*|\bmod[ée]r[ée]e?\b/iu },
  { code: 'MILD', pattern: /\bmild\b|\bslight\w*|\bearly\b|\bincipient\b|\bl[ée]g[èe]re?\b|\bd[ée]butante?\b/iu },
];

/** Every surface named in `text`, canonical order, as one value; null when none. */
export function detectSurface(text: string): string | null {
  const named = new Set(SURFACES.filter(s => unicodeBoundaries(s.pattern).test(text)).map(s => s.code));
  if (unicodeBoundaries(PROXIMAL).test(text)) {
    named.add('mesial');
    named.add('distal');
  }
  const ordered = SURFACES.map(s => s.code).filter(code => named.has(code));
  return ordered.length ? ordered.slice(0, MAX_SURFACES).join('-') : null;
}

interface SurfaceMention {
  code: string;
  start: number;
  end: number;
}

/** Each surface word and where it stands, so it can be given to the finding it describes. */
function surfaceMentions(utterance: string): SurfaceMention[] {
  const mentions: SurfaceMention[] = [];
  for (const surface of SURFACES) {
    const pattern = unicodeBoundaries(new RegExp(surface.pattern.source, 'giu'));
    for (const match of utterance.matchAll(pattern)) {
      if (match.index === undefined) continue;
      mentions.push({ code: surface.code, start: match.index, end: match.index + match[0].length });
    }
  }
  for (const match of utterance.matchAll(unicodeBoundaries(new RegExp(PROXIMAL.source, 'giu')))) {
    if (match.index === undefined) continue;
    const at = { start: match.index, end: match.index + match[0].length };
    mentions.push({ code: 'mesial', ...at }, { code: 'distal', ...at });
  }
  return mentions;
}

/** How far, in characters, a surface word may stand from the finding it describes. */
const SURFACE_REACH = 40;

/**
 * Gives each surface word to the nearest finding in its clause. Read from
 * the words around each finding instead, "carie mésio-occlusale et fracture
 * distale" would hand every surface to both.
 */
/**
 * "Mésio-occlusale" is one thing said as two words, and "mesial occlusal" is
 * two words said together. Mentions with nothing between them but a hyphen or a
 * space are one description, given to one finding as a unit; judged one by one
 * the second half can land on a different finding than the first.
 */
function surfaceClusters(utterance: string): Array<{ codes: string[]; start: number; end: number }> {
  const mentions = surfaceMentions(utterance).sort((a, b) => a.start - b.start);
  const clusters: Array<{ codes: string[]; start: number; end: number }> = [];
  for (const mention of mentions) {
    const last = clusters[clusters.length - 1];
    if (last && mention.start - last.end <= 1 && /^[-\s]?$/u.test(utterance.slice(last.end, mention.start))) {
      last.codes.push(mention.code);
      last.end = mention.end;
    } else {
      clusters.push({ codes: [mention.code], start: mention.start, end: mention.end });
    }
  }
  return clusters;
}

function assignSurfaces(utterance: string, findings: ExtractedFinding[]): void {
  const owned = new Map<ExtractedFinding, Set<string>>();
  for (const mention of surfaceClusters(utterance)) {
    const clause = clauseBounds(utterance, mention.start);
    let best: ExtractedFinding | null = null;
    let bestGap = Infinity;
    for (const finding of findings) {
      const end = finding.at + finding.matchedText.length;
      if (clauseBounds(utterance, finding.at).start !== clause.start) continue;
      const gap = mention.start >= end ? mention.start - end : finding.at >= mention.end ? finding.at - mention.end : 0;
      if (gap < bestGap) {
        best = finding;
        bestGap = gap;
      }
    }
    if (!best || bestGap > SURFACE_REACH) continue;
    const set = owned.get(best) ?? new Set<string>();
    mention.codes.forEach(code => set.add(code));
    owned.set(best, set);
  }
  for (const finding of findings) {
    const codes = owned.get(finding);
    finding.surface = codes
      ? SURFACES.map(s => s.code).filter(code => codes.has(code)).slice(0, MAX_SURFACES).join('-')
      : null;
  }
}

const MOBILITY_GRADE =
  /\b(?:grade|degr[ée]|classe|class|stade|miller)\s*(?:de\s+)?(?:n[°o]\s*)?(1|2|3|i{1,3}|un|une|deux|trois|one|two|three)\b/iu;

const GRADE_NUMBER: Readonly<Record<string, 1 | 2 | 3>> = {
  '1': 1, i: 1, un: 1, une: 1, one: 1,
  '2': 2, ii: 2, deux: 2, two: 2,
  '3': 3, iii: 3, trois: 3, three: 3,
};

const GRADE_SEVERITY: Readonly<Record<1 | 2 | 3, Severity>> = { 1: 'MILD', 2: 'MODERATE', 3: 'SEVERE' };

/**
 * "Mobilité grade 2" says how mobile. The grade is recorded — as the finding's
 * severity and, verbatim, in its note — rather than dropped with the rest of
 * the words the lexicon has no slot for.
 */
function applyMobilityGrade(utterance: string, finding: ExtractedFinding): void {
  if (finding.code !== 'mobility') return;
  const clause = clauseBounds(utterance, finding.at);
  const after = utterance.slice(finding.at + finding.matchedText.length, clause.end);
  const match = unicodeBoundaries(MOBILITY_GRADE).exec(after);
  if (!match) return;
  const grade = GRADE_NUMBER[match[1].toLowerCase()];
  if (!grade) return;
  finding.severity = GRADE_SEVERITY[grade];
  finding.note = `grade ${grade}`;
}

export function detectSeverity(text: string): Severity | null {
  return SEVERITIES.find(s => unicodeBoundaries(s.pattern).test(text))?.code ?? null;
}

// ── Extraction ──────────────────────────────────────────────────────────

export interface ExtractedFinding {
  code: string;
  kind: FindingKind;
  label: string;
  surface: string | null;
  severity: Severity | null;
  /** The words this came from, shown in the preview so the doctor can check it. */
  matchedText: string;
  /**
   * A negation governs this finding — "pas de carie", "sans mobilité", "not
   * fractured". It is reported rather than dropped so the caller can keep the
   * dentist's words as a note; it must never be recorded as a finding.
   */
  negated: boolean;
  /** Where in the utterance the words start. */
  at: number;
  /** The clause the words sit in, for a note when the finding is negated. */
  clause: string;
  /** A qualifier the lexicon has no slot for but that must not be lost, e.g. "grade 2". */
  note?: string;
}

/** Findings the dentist affirmed — the only ones that may be recorded as findings. */
export function affirmedFindings<T extends { negated: boolean }>(findings: readonly T[]): T[] {
  return findings.filter(finding => !finding.negated);
}

// ── "Needs X" is not "has X" ────────────────────────────────────────────

/**
 * An existing restoration named next to a word that asks for it to be done is
 * a treatment need, not a fact about the tooth. "Couronne à faire" and "il
 * faudra une couronne" would otherwise record a crown the tooth does not
 * have; "composite à refaire" would record a composite as present and say
 * nothing of it needing work. The lexicon spells out the common phrasings as
 * patterns of their own; this catches the rest, whatever restoration they
 * name.
 */
const NEED_BEFORE =
  /\b(?:il\s+(?:faut|faudra|faudrait)|faut|faudra|n[ée]cessite|besoin\s+d|pr[ée]voir|envisager|needs?|requires?|should\s+(?:get|have|receive)|recommend\w*|to\s+(?:do|place|make|redo))\b/iu;

const NEED_AFTER =
  /\b(?:[àa]\s+(?:faire|refaire|remplacer|changer|reprendre|poser|placer|mettre|r[ée]aliser|pr[ée]voir|envisager)|n[ée]cessaire|indiqu[ée]\w*|recommand[ée]\w*|souhaitable|to\s+(?:be\s+)?(?:done|replaced|redone|made|placed|remade|changed)|(?:is\s+|are\s+)?(?:needed|required|recommended|indicated))\b/iu;

const REPLACEMENT_WORDS = /\b(?:remplac\w*|refai\w*|chang\w*|repris\w*|replac\w*|redo\w*|remad\w*|remak\w*)\b/iu;

/** How many words either side of a restoration count as "next to" it. */
const NEED_REACH_WORDS = 4;

/** The treatment-required code an existing-restoration code turns into. */
const REQUIRED_EQUIVALENT: Readonly<Record<string, (replacing: boolean) => string>> = {
  existing_crown: replacing => (replacing ? 'crown_replacement_required' : 'crown_required'),
  existing_bridge: () => 'bridge_required',
  existing_implant: () => 'implant_required',
  existing_veneer: () => 'veneer_required',
  existing_root_canal: () => 'root_canal_required',
  existing_amalgam: () => 'filling_required',
  existing_composite: () => 'filling_required',
  existing_filling: () => 'filling_required',
  existing_sealant: () => 'sealant_required',
  existing_post: () => 'restoration_required',
  existing_inlay: () => 'restoration_required',
};

function lastWords(text: string, count: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-count).join(' ');
}

function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, count).join(' ');
}

/** The definition an existing restoration really is, given what is said beside it. */
function asTreatmentNeed(
  definition: FindingDefinition,
  utterance: string,
  at: number,
  length: number,
): FindingDefinition {
  const equivalent = REQUIRED_EQUIVALENT[definition.code];
  if (!equivalent) return definition;

  const clause = clauseBounds(utterance, at);
  const before = lastWords(utterance.slice(clause.start, at), NEED_REACH_WORDS);
  const after = firstWords(utterance.slice(at + length, clause.end), NEED_REACH_WORDS);
  if (!unicodeBoundaries(NEED_BEFORE).test(before) && !unicodeBoundaries(NEED_AFTER).test(after)) return definition;

  const replacing = unicodeBoundaries(REPLACEMENT_WORDS).test(`${before} ${after}`);
  return FINDING_BY_CODE.get(equivalent(replacing)) ?? definition;
}

/**
 * Pulls every finding an utterance contains, in the order it was said.
 *
 * Each match consumes its span before later patterns are tried, which is what
 * keeps "crown needs replacement" from also counting as "has a crown" while
 * still letting "old crown … crown needs replacement" produce both — they
 * occupy different spans.
 */
export function extractFindings(utterance: string): ExtractedFinding[] {
  return scanFindings(utterance, false);
}

/**
 * Every occurrence of every finding, not the first of each. "Dent 16 carie,
 * dent 17 carie" names caries twice, on two teeth; the first-only reading
 * finds one and leaves the second tooth with nothing to record.
 */
export function extractEveryFinding(utterance: string): ExtractedFinding[] {
  return scanFindings(utterance, true);
}

function scanFindings(utterance: string, every: boolean): ExtractedFinding[] {
  let remaining = utterance;
  const found: ExtractedFinding[] = [];

  for (const definition of FINDINGS) {
    let again = true;
    while (again) {
      again = false;
      for (const pattern of definition.patterns) {
        const match = unicodeBoundaries(pattern).exec(remaining);
        if (!match) continue;

        const matchedText = match[0];
        const at = match.index;

        // Blank the span rather than deleting it, so the indices of everything
        // still to be matched stay meaningful.
        const consumed =
          remaining.slice(0, at) + ' '.repeat(matchedText.length) + remaining.slice(at + matchedText.length);

        // Severity and surface are read from the words around the finding, not
        // from the whole utterance: in "deep caries on 16, mild wear on 17" the
        // "deep" belongs to the caries and must not leak onto the wear.
        const contextStart = Math.max(0, at - 30);
        const context = remaining.slice(contextStart, at + matchedText.length + 30);

        const effective = definition.kind === 'EXISTING'
          ? asTreatmentNeed(definition, utterance, at, matchedText.length)
          : definition;
        const negated = isNegatedAt(utterance, at);

        // One code once, unless asked for every occurrence. "composite à
        // refaire" next to "needs a filling" is a single filling need, not two
        // identical rows.
        const duplicate = !every && found.some(f => f.code === effective.code && f.negated === negated);
        if (!duplicate) {
          found.push({
            code: effective.code,
            kind: effective.kind,
            label: effective.label,
            surface: null,
            severity: detectSeverity(context),
            matchedText: matchedText.trim(),
            negated,
            at,
            clause: clauseAround(utterance, at),
          });
        }

        remaining = consumed;
        again = every;
        break;
      }
    }
  }

  const ordered = found.sort((a, b) => a.at - b.at);
  assignSurfaces(utterance, ordered);
  for (const finding of ordered) applyMobilityGrade(utterance, finding);
  return ordered;
}

/**
 * Warns when the browser's vocabulary and the server's catalog have drifted.
 * Called once at startup with the response from `GET /api/v1/voice/lexicon`;
 * a code the server does not know would otherwise fail validation only at the
 * moment a doctor dictates it.
 */
export function assertLexiconMatches(serverCodes: string[]): { ok: boolean; message: string } {
  const local = new Set(allFindingCodes());
  const server = new Set(serverCodes);
  const missingOnServer = [...local].filter(c => !server.has(c));
  const missingLocally = [...server].filter(c => !local.has(c));

  if (missingOnServer.length === 0 && missingLocally.length === 0) {
    return { ok: true, message: `Voice lexicon in sync (${local.size} finding codes).` };
  }
  const parts: string[] = [];
  if (missingOnServer.length) parts.push(`not accepted by the server: ${missingOnServer.join(', ')}`);
  if (missingLocally.length) parts.push(`known to the server but unspoken here: ${missingLocally.join(', ')}`);
  return {
    ok: false,
    message: `Voice lexicon drift — ${parts.join('; ')}. `
      + 'Update clinical-lexicon.ts and FindingCatalog.java together.',
  };
}

/**
 * The specific findings a general spoken term covers when the dentist takes
 * something back. "Enlève la carie sur la seize" names "carie", but what was
 * dictated a moment before was "carie récurrente" — the removal has to find
 * it, or it silently stages a withdrawal of something the tooth never had.
 */
const FINDING_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  caries: ['caries', 'recurrent_caries', 'deep_caries', 'cavity'],
  existing_crown: ['existing_crown', 'crown_defective', 'crown_replacement_required', 'crown_required'],
  existing_filling: ['existing_filling', 'existing_composite', 'existing_amalgam', 'filling_required'],
  gingival_inflammation: ['gingival_inflammation', 'periodontal_pocket'],
};

/** True when a spoken finding code refers to a staged one — the same, or its general family. */
export function spokenFindingCovers(spoken: string, staged: string): boolean {
  return spoken === staged || (FINDING_FAMILIES[spoken]?.includes(staged) ?? false);
}
