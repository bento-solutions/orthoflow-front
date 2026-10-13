/* =========================================================================
   Dictation language filter
   =========================================================================

   The doctor says which language they dictate in. Anything the recogniser
   hears in another language — a patient answering in Darija, an assistant in
   the corridor, the TV — is noise, and must not be read as a command or a
   finding. The same goes for a sentence the doctor says in the wrong language:
   dictating French with English chosen is ignored (and said so aloud, see the
   orchestrator), not guessed at.

   What "noise" means is *for commands only*. A recorded consultation keeps the
   whole conversation whatever language it is in; this filter sits in front of
   the command pipeline, never in front of the transcript.

   ── How an utterance is judged ──────────────────────────────────────────

   Word by word. Every word is French, English, Arabic (Arabic script, or
   Darija written in Latin letters — "wakha", "3andi", "fiha"), or neutral:
   numbers, the wake word, Latin clinical terms that read the same everywhere
   ("amalgam", "implant"), and anything unknown. Only words that belong to one
   language and not another are counted, so a cognate can never tip a verdict.

   - Nothing of the chosen language and something of another → noise.
   - Another language outnumbers the chosen one, by at least two words → noise.
   - A mixed sentence, "tooth 17 infectione et amalgam", has about as much of
     each: kept. A doctor who code-switches mid-sentence is not noise.
   - Neutral-only ("16", "Calypso") → unsure, and callers keep it.
   ========================================================================= */

import { foldAccents } from './voice-fuzzy';
import { stripWakeWord } from './voice-wake';

export type InputLanguage = 'fr' | 'en' | 'ar';
export type LanguageVerdict = 'match' | 'noise' | 'unsure';

export const INPUT_LANGUAGES: readonly InputLanguage[] = ['fr', 'en', 'ar'];

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿ]/u;
const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿ]/g;
const LATIN_LETTER = /[A-Za-zÀ-ÿ]/g;

/**
 * Words that are French and not English (accents folded). Ambiguous ones — a,
 * on, me, son, dent, patient, canine — are left out on purpose.
 */
const FRENCH = new Set((
  'le la les un une des du de au aux et est sont dans sur avec pour pas que qui quoi dont il elle ils elles je tu nous vous '
  + 'ce cet cette ces mon ma mes ton ta tes sa ses notre nos votre vos leur leurs ont avez avons suis es etes etre ete '
  + 'avait avaient sera serait ca cela ceci tres mais ou donc oui merci bonjour bonsoir salut faire fait fais font voir vois '
  + 'voit voyez voyons vu aussi encore deja toujours jamais rien tout tous toute toutes bien mal petit petite grand grande '
  + 'beaucoup peu trop plus moins comme quand comment pourquoi combien depuis pendant avant apres sous entre vers chez sans '
  + 'ni ne se si sur alors voila bon euh puis ensuite maintenant demain hier aujourd '
  // French clinical words an English sentence never contains.
  + 'carie cariee cariees couronne couronnes obturation obturations amalgame amalgames devitalisee devitalisation '
  + 'mobilite abces douleur douleurs douloureux douloureuse sensible sensibilite gencive gencives racine racines '
  + 'detartrage tartre fracturee felee cassee manquante absente extraite infectee mesiale distale '
  + 'occlusale vestibulaire linguale palatine molaire premolaire superieur superieure inferieur inferieure '
  + 'droite gauche droit haut bas docteur madame monsieur '
  + 'allergie allergique antecedents medicaments traitement prochain rendez vous revoir jours semaines mois'
).split(/\s+/));

const ENGLISH = new Set((
  'the and is are of to in with for not that this these those it he she you we they my your his her has have had was were '
  + 'but or yes no thanks hello does did will would there what when where which who how why please also still just very '
  + 'much many some any from at by an be been being can could should may might must do dont isnt doesnt didnt wont cant '
  + 'see sees look think need needs want got get gets give '
  // English clinical words a French sentence never contains.
  + 'tooth teeth crown crowns filling fillings root decay cavity broken loose pain painful swollen swelling '
  + 'bleeding gum gums upper lower left right back molar premolar incisor wisdom sensitive sensitivity infected '
  + 'fractured cracked chipped worn stained missing extracted replace replaced replacement redo remove removed '
  + 'deep mild severe moderate examination start end undo cancel actually doctor '
  + 'allergy allergic history medication treatment next appointment review follow weeks days months'
).split(/\s+/));

/**
 * Darija written in Latin letters, the way a recogniser transliterates it when
 * it has been told to expect French. Only words that mean nothing in French or
 * English ("had", "sir", "ras", "dial" are all words there, so they are out).
 */
const DARIJA_LATIN = new Set((
  'wakha wakkha safi bzaf bzzaf bezzaf daba dba khoya khouya lalla labas labass lbas shnou chnou chno shno achno kayn kayna '
  + 'kaynin makayn makaynch makaynach mazal mazzal ghadi gadi bghit bghiti bgha bghina kanet kant mchat machi matkhafch '
  + 'ntouma ntoma howa hiya houma homa hna hnaya temma tma dyal diyal dyali dyalek dyalo hadi hada hadchi hadak hadik '
  + 'dak dik fih fiha feha fihom fik fiya blasa zwin zwina mzyan mzyana khayb khayba mrid mrida wjaa dars drass snan '
  + 'sinna tsous tsos tsawes khdma jib jibi walakin walaken kifach kifash imta mnin wach chhal shhal ghir ghayr kolchi '
  + 'kulshi kolshi nhar lyoum sbah lkhir smitek smiytek afak shukran choukran salam salamou alaykoum alikoum inchallah '
  + 'insha hamdullah hamdolilah hamdoullah bismillah yallah'
).split(/\s+/));

/** A digit standing in for an Arabic letter inside a Latin word: 3andi, 7ta, 9alb, 3la. */
const ARABIZI = /^(?:[a-z]{0,3}[2379][a-z]{2,}|[a-z]{2,}[2379][a-z]{0,2})$/;
/** Digit-and-letter tokens that are ordinals or units, never Darija. */
const NOT_ARABIZI = /^(?:\d+[a-z]{1,3}|[a-z]{0,3}[2379](?:st|nd|rd|th|er|re|eme|mg|ml|mm|cm|kg|ans|min|h|x))$/;

/** One word's language. 'neutral' for numbers, names, shared terms and anything unknown. */
export type WordLanguage = InputLanguage | 'neutral';

function wordLanguage(rawWord: string): WordLanguage {
  if (ARABIC_SCRIPT.test(rawWord)) return 'ar';
  const word = foldAccents(rawWord);
  if (word.length < 2) return 'neutral';
  if (DARIJA_LATIN.has(word)) return 'ar';
  if (/\d/.test(word)) return ARABIZI.test(word) && !NOT_ARABIZI.test(word) ? 'ar' : 'neutral';
  if (FRENCH.has(word)) return 'fr';
  if (ENGLISH.has(word)) return 'en';
  return 'neutral';
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** How many words of each language an utterance holds. */
function tally(text: string): Record<WordLanguage, number> {
  const counts: Record<WordLanguage, number> = { fr: 0, en: 0, ar: 0, neutral: 0 };
  for (const word of words(text)) counts[wordLanguage(word)]++;
  return counts;
}

/**
 * Whether `text` is in the language the doctor dictates in. See the file
 * comment for the rules; in short, mostly-another-language is noise and a mix
 * or a neutral utterance is kept.
 */
export function classifyLanguage(text: string, expected: InputLanguage): LanguageVerdict {
  const arabic = (text.match(ARABIC_LETTER) ?? []).length;
  const latin = (text.match(LATIN_LETTER) ?? []).length;
  const letters = arabic + latin;
  if (letters < 3) return 'unsure';

  const counts = tally(text);

  if (expected === 'ar') {
    // Latin tokens are normal in Arabic dictation (tooth codes, the wake word,
    // Latin drug and material names); a sentence that is all Latin is not.
    if (letters >= 8 && arabic / letters <= 0.1) return 'noise';
    if (counts.ar === 0 && counts.fr + counts.en >= 2) return 'noise';
    return arabic / letters >= 0.5 ? 'match' : 'unsure';
  }

  // Mostly Arabic script is another language however it is mixed with digits.
  if (arabic / letters >= 0.7) return 'noise';

  const own = counts[expected];
  const foreign = counts.fr + counts.en + counts.ar - own;
  if (foreign === 0) return own > 0 ? 'match' : 'unsure';
  if (own === 0) return 'noise';
  if (foreign >= 2 && foreign > own) return 'noise';
  return own > foreign ? 'match' : 'unsure';
}

/**
 * A yes, a no, an "ok": said to answer a question the app just asked, in any
 * language, and meaningless as a command on its own. Exempt from the language
 * filter while a question is open, or "yes" in a French session would leave the
 * question to expire unanswered.
 */
const ANSWER = /^(?:oui|non|yes|no|ok|okay|d['’]?\s?accord|confirm\w*|annule\w*|cancel\w*|nope|yep)$/iu;

export function isLanguageNeutralAnswer(text: string): boolean {
  return ANSWER.test(text.trim().replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/gu, ''));
}

// ── Changing the language by voice ──────────────────────────────────────

const SWITCH_CUE =
  /\b(?:dictee|dicte|dictons|langue|passe|passez|mets|mettez|met|change|changez|bascule|basculez|parle|parlez|switch|set|language|dictation|speak|go|use)\b/;
const LANGUAGE_WORDS: ReadonlyArray<[RegExp, InputLanguage]> = [
  [/\b(?:francais|french)\b/, 'fr'],
  [/\b(?:anglais|english)\b/, 'en'],
  [/\b(?:arabe|arabic|darija)\b/, 'ar'],
];

/**
 * "Calypso, dictée en anglais", "Calypso, switch to French", "Calypso,
 * français": the doctor naming the language to dictate in.
 *
 * It exists because the filter above makes a wrong setting costly — everything
 * said in the other language is ignored — and the doctor cannot touch the
 * screen to fix it. So it works whatever language is currently chosen (an
 * English setting must still understand "passe en français"), and needs the wake
 * word, because "en français" is also something said to a patient.
 */
export function requestedLanguage(utterance: string): InputLanguage | null {
  const afterWake = stripWakeWord(utterance);
  if (afterWake === null) return null;
  const body = foldAccents(afterWake)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(?:please|svp|stp|s il vous plait)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const count = body ? body.split(' ').length : 0;
  if (count === 0 || count > 7) return null;
  const named = LANGUAGE_WORDS.filter(([word]) => word.test(body));
  if (named.length !== 1) return null;
  return count === 1 || SWITCH_CUE.test(body) ? named[0][1] : null;
}

/** The BCP-47 tag a recogniser wants for each dictation language. */
export const SPEECH_LOCALE: Readonly<Record<InputLanguage, string>> = {
  // fr-MA rather than fr-FR: Moroccan clinicians code-switch between French
  // and Darija mid-sentence, and the regional model handles that far better.
  fr: 'fr-MA',
  ar: 'ar-MA',
  en: 'en-US',
};
