/**
 * A name said letter by letter, or with a letter put right: "A, C, H, R, A, F",
 * "le prénom s'écrit A C H R A F", "Achraf avec un C". The recogniser writes a
 * name the way it sounds ("Ashraf"); the doctor spells it, and the spelling is
 * what goes in the record.
 */

/** How letters are said in French, as a recogniser writes them. */
const LETTER_NAMES: Record<string, string> = {
  a: 'a', be: 'b', bé: 'b', ce: 'c', cé: 'c', de: 'd', dé: 'd', e: 'e', eu: 'e', ef: 'f', effe: 'f', ge: 'g', gé: 'g',
  ache: 'h', hache: 'h', i: 'i', ji: 'j', ka: 'k', el: 'l', elle: 'l', em: 'm', emme: 'm', en: 'n', enne: 'n', o: 'o', pe: 'p', pé: 'p',
  qu: 'q', ku: 'q', er: 'r', erre: 'r', es: 's', esse: 's', te: 't', té: 't', u: 'u', ve: 'v', vé: 'v', w: 'w', 'double-v': 'w',
  ix: 'x', 'i-grec': 'y', igrec: 'y', zed: 'z', zède: 'z',
};

function letterOf(token: string): string | null {
  const word = token.toLowerCase();
  if (/^\p{L}$/u.test(word)) return word;
  return LETTER_NAMES[word] ?? null;
}

function capitalise(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * The name spelled in `text`, or null when nothing in it is a spelling.
 * Three letters at least, so "a" in a sentence is not a name.
 */
export function spokenSpelling(text: string): string | null {
  const tokens = text.replace(/[,.;:!?]/g, ' ').split(/\s+/).filter(Boolean);
  let best: string[] = [];
  let run: string[] = [];
  for (const token of tokens) {
    const letter = letterOf(token);
    if (letter) {
      run.push(letter);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  if (best.length >= 3) return capitalise(best.join(''));

  // "Achraf avec un C": the name is the word before; the letter is what the doctor
  // insisted on, and the word already has it, or a recogniser's guess at it.
  const corrected = /(\p{L}[\p{L}'’-]+)\s+avec\s+(?:un|une|deux)\s+\p{L}\b/iu.exec(text);
  if (corrected) return capitalise(corrected[1]);
  return null;
}
