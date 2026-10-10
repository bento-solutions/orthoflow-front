/* =========================================================================
   Dictation language filter
   =========================================================================

   The doctor says, at the start of a session, which language they dictate in.
   Anything the recogniser hears in another language — a patient answering in
   Arabic, a colleague in the corridor, the TV — is noise, and must not be
   read as a command or a finding.

   The filter is deliberately conservative. Moroccan clinicians code-switch
   within one sentence ("la carie est mésiale, ça fait mal"), tooth numbers and
   the wake word are language-neutral, and a clinical record is the wrong place
   to guess: an utterance is only called noise when the evidence is
   overwhelming, otherwise it is kept. Wrongly ignoring a finding costs the
   doctor a repetition; wrongly accepting noise could write to a record.
   ========================================================================= */

export type InputLanguage = 'fr' | 'en' | 'ar';
export type LanguageVerdict = 'match' | 'noise' | 'unsure';

export const INPUT_LANGUAGES: readonly InputLanguage[] = ['fr', 'en', 'ar'];

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿ]/g;
const LATIN_LETTER = /[A-Za-zÀ-ÿ]/g;

/** Words that are French and not English, and the reverse. Ambiguous ones (a, en, on, me, son) are left out. */
const FRENCH = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'est', 'sont', 'dans', 'sur', 'avec', 'pour', 'pas',
  'que', 'qui', 'au', 'aux', 'il', 'elle', 'je', 'nous', 'vous', 'ce', 'cette', 'ces', 'mon', 'ma', 'mes', 'ses',
  'ont', 'ca', 'ça', 'très', 'tres', 'mais', 'ou', 'où', 'donc', 'oui', 'non', 'merci', 'bonjour', 'faire',
]);
const ENGLISH = new Set([
  'the', 'and', 'is', 'are', 'of', 'to', 'in', 'with', 'for', 'not', 'that', 'this', 'these', 'it', 'he', 'she',
  'you', 'we', 'they', 'my', 'your', 'his', 'her', 'has', 'have', 'was', 'were', 'but', 'or', 'yes', 'no',
  'thanks', 'hello', 'does', 'did', 'will', 'would', 'there', 'what', 'when', 'where',
]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
}

function score(list: readonly string[], vocabulary: Set<string>): number {
  return list.reduce((n, w) => n + (vocabulary.has(w) ? 1 : 0), 0);
}

/**
 * Whether `text` is in the language the doctor dictates in.
 *
 * - **Script first.** Mostly Arabic letters while dictating French or English,
 *   or mostly Latin letters while dictating Arabic, is another language.
 * - **French against English** only on a longer utterance (four words or more)
 *   and only when one language's function words clearly outnumber the other's.
 * - Anything shorter or more mixed is `unsure`, which callers keep.
 */
export function classifyLanguage(text: string, expected: InputLanguage): LanguageVerdict {
  const arabic = (text.match(ARABIC_LETTER) ?? []).length;
  const latin = (text.match(LATIN_LETTER) ?? []).length;
  const letters = arabic + latin;
  if (letters < 3) return 'unsure';

  const arabicShare = arabic / letters;

  if (expected === 'ar') {
    // Latin tokens are normal in Arabic dictation (tooth codes, the wake word,
    // Latin drug and material names); a sentence that is all Latin is not.
    return letters >= 8 && arabicShare <= 0.1 ? 'noise' : arabicShare >= 0.5 ? 'match' : 'unsure';
  }

  if (arabicShare >= 0.7) return 'noise';
  if (arabicShare > 0.3) return 'unsure';

  const list = words(text);
  if (list.length < 4) return 'unsure';
  const fr = score(list, FRENCH);
  const en = score(list, ENGLISH);
  const other = expected === 'fr' ? en : fr;
  const own = expected === 'fr' ? fr : en;
  if (other >= 3 && other - own >= 3) return 'noise';
  return own > other ? 'match' : 'unsure';
}

/** The BCP-47 tag a recogniser wants for each dictation language. */
export const SPEECH_LOCALE: Readonly<Record<InputLanguage, string>> = {
  // fr-MA rather than fr-FR: Moroccan clinicians code-switch between French
  // and Darija mid-sentence, and the regional model handles that far better.
  fr: 'fr-MA',
  ar: 'ar-MA',
  en: 'en-US',
};
