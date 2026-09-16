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
    /\bcouronne\s+(?:[àa]\s+poser|n[ée]cessaire|indiqu[ée]e?|recommand[ée]e?)/iu),

  F('root_canal_required', 'TREATMENT_REQUIRED', 'Root canal required',
    /\b(?:needs?|requires?)\s+(?:a\s+|an\s+)?(?:root\s+canal|endo(?:dontic)?\w*|rct)/iu,
    /\broot\s+canal\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\b(?:d[ée]vitaliser|traitement\s+(?:de\s+)?canal(?:aire)?\s+(?:n[ée]cessaire|[àa]\s+faire)|endodontie\s+n[ée]cessaire)/iu),

  F('extraction_required', 'TREATMENT_REQUIRED', 'Extraction required',
    /\b(?:needs?|requires?|for|indicated\s+for)\s+(?:an?\s+)?extraction/iu,
    /\b(?:needs?|has)\s+to\s+(?:be\s+(?:extracted|pulled|removed)|come\s+out)/iu,
    /\bextraction\s+(?:is\s+)?(?:required|needed|indicated|recommended)/iu,
    /\b(?:extraire|[àa]\s+extraire|extraction\s+(?:n[ée]cessaire|indiqu[ée]e?))/iu),

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
    /\b(?:scaling|d[ée]tartrage)\s+(?:is\s+)?(?:required|needed|indicated|n[ée]cessaire)/iu),

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
    /\bcaries?\b/iu, /\bcarious\b/iu, /\bdecay(?:ed)?\b/iu, /\bcarie\b/iu, /\btsous\b/iu),

  F('cavity', 'CONDITION', 'Cavity',
    /\bcavit(?:y|ies)\b/iu, /\bcavit[ée]\b/iu, /\btrou\b/iu),

  F('fracture', 'CONDITION', 'Fracture',
    // First, so "fractured crown" is one fracture rather than a fracture plus
    // an assertion that a crown restoration is present.
    /\bfractured?\s+crowns?\b/iu, /\bcouronne\s+fractur[ée]e?\b/iu,
    /\bfractur\w+/iu, /\bcracked?\b/iu, /\bchipped?\b/iu, /\bbroken\s+(?:tooth|cusp|edge)/iu,
    /\bf[êe]l[ée]e?\b/iu, /\bcass[ée]e?\b/iu),

  F('crown_defective', 'CONDITION', 'Defective crown',
    /\b(?:defective|failing|leaking|broken|loose|cracked)\s+crown/iu,
    /\bcrown\s+(?:is\s+)?(?:defective|failing|leaking|loose|broken|cracked)/iu,
    /\bcouronne\s+(?:d[ée]fectueuse|cass[ée]e|descell[ée]e|fissur[ée]e)/iu),

  F('retained_root', 'CONDITION', 'Retained root',
    /\bretained\s+roots?/iu, /\broot\s+(?:remnant|fragment)/iu, /\bracine\s+r[ée]siduelle/iu),

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
    /\bhypersensitiv\w+/iu, /\breacts?\s+to\s+cold\b/iu),

  F('pain', 'CONDITION', 'Pain',
    /\bpain(?:ful)?\b/iu, /\baches?\b/iu, /\baching\b/iu, /\bdouleur\w*/iu, /\bdouloureu\w+/iu,
    /\btoothache\b/iu, /\bhurts?\b/iu),

  F('tooth_wear', 'CONDITION', 'Tooth wear',
    /\b(?:tooth\s+)?wear\b/iu, /\battrition\b/iu, /\berosion\b/iu, /\babfraction\b/iu,
    /\bbruxism\b/iu, /\busure\b/iu, /\b[ée]rosion\b/iu),

  F('discoloration', 'CONDITION', 'Discoloration',
    /\bdiscolo\w+/iu, /\bstain(?:ed|ing)?\b/iu, /\bd[ée]color\w+/iu, /\btach[ée]e?\b/iu),

  F('gingival_inflammation', 'CONDITION', 'Gingival inflammation',
    /\bgingivitis\b/iu, /\bgingival\s+inflammation\b/iu, /\b(?:inflamed|swollen|bleeding)\s+gums?\b/iu,
    /\bgums?\s+(?:are\s+)?(?:inflamed|swollen|bleeding)\b/iu,
    /\bgingivite\b/iu, /\bgencives?\s+(?:enflamm[ée]es?|gonfl[ée]es?|qui\s+saignent)/iu),

  F('periodontal_pocket', 'CONDITION', 'Periodontal pocket',
    /\b(?:periodontal\s+)?pockets?\b/iu, /\bperiodontitis\b/iu,
    /\bpoche\s+parodontale\b/iu, /\bparodontite\b/iu),

  F('gingival_recession', 'CONDITION', 'Gingival recession',
    /\b(?:gingival\s+|gum\s+)?recession\b/iu, /\br[ée]cession\s+gingivale\b/iu),

  F('plaque_calculus', 'CONDITION', 'Plaque / calculus',
    /\bcalculus\b/iu, /\btartar\b/iu, /\bplaque\b/iu, /\btartre\b/iu),

  F('malposition', 'CONDITION', 'Malposition',
    /\bmalpositioned?\b/iu, /\bcrowded?\b/iu, /\brotated?\b/iu, /\bmalposition\w*/iu,
    /\bencombrement\b/iu, /\bversion\b/iu),

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
    /\bd[ée]vitalis[ée]e?\b/iu, /\btraitement\s+canalaire\s+(?:existant|ant[ée]rieur)/iu),

  F('existing_post', 'EXISTING', 'Existing post',
    /\b(?:post\s+and\s+core|post\b|pivot\b|inlay[- ]core)/iu, /\btenon\b/iu),

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
    /\b(?:ancienne\s+)?obturation\b/iu, /\bplomb\w*/iu),

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
  { code: 'occlusal', pattern: /\bocclusal\w*|\bbiting\s+surface\b/iu },
  { code: 'mesial', pattern: /\bm[ée]sial\w*/iu },
  { code: 'distal', pattern: /\bdistal\w*/iu },
  { code: 'buccal', pattern: /\bbuccal\w*|\bvestibul\w*|\bfacial\s+surface\b/iu },
  { code: 'lingual', pattern: /\blingual\w*|\bpalatal\w*|\bpalatin\w*/iu },
  { code: 'incisal', pattern: /\bincisal\w*/iu },
  { code: 'cervical', pattern: /\bcervical\w*|\bneck\s+of\s+the\s+tooth\b/iu },
];

const SEVERITIES: Array<{ code: Severity; pattern: RegExp }> = [
  { code: 'SEVERE', pattern: /\bsevere\w*|\bdeep\b|\badvanced\b|\bs[ée]v[èe]re\b|\bprofonde?\b|\bavanc[ée]e?\b/iu },
  { code: 'MODERATE', pattern: /\bmoderate\w*|\bmod[ée]r[ée]e?\b/iu },
  { code: 'MILD', pattern: /\bmild\b|\bslight\w*|\bearly\b|\bincipient\b|\bl[ée]g[èe]re?\b|\bd[ée]butante?\b/iu },
];

export function detectSurface(text: string): string | null {
  return SURFACES.find(s => unicodeBoundaries(s.pattern).test(text))?.code ?? null;
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
  let remaining = utterance;
  const found: Array<ExtractedFinding & { at: number }> = [];

  for (const definition of FINDINGS) {
    for (const pattern of definition.patterns) {
      const match = unicodeBoundaries(pattern).exec(remaining);
      if (!match) continue;

      const matchedText = match[0];
      const at = match.index;

      // Severity and surface are read from the words around the finding, not
      // from the whole utterance: in "deep caries on 16, mild wear on 17" the
      // "deep" belongs to the caries and must not leak onto the wear.
      const contextStart = Math.max(0, at - 30);
      const context = remaining.slice(contextStart, at + matchedText.length + 30);

      found.push({
        code: definition.code,
        kind: definition.kind,
        label: definition.label,
        surface: detectSurface(context),
        severity: detectSeverity(context),
        matchedText: matchedText.trim(),
        at,
      });

      // Blank the span rather than deleting it, so the indices of everything
      // still to be matched stay meaningful.
      remaining =
        remaining.slice(0, at) + ' '.repeat(matchedText.length) + remaining.slice(at + matchedText.length);
      break;
    }
  }

  return found
    .sort((a, b) => a.at - b.at)
    .map(({ at, ...finding }) => finding);
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
