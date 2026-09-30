import { describe, expect, it } from 'vitest';
import { clauseAround, containsNegation, isNegatedAt, startsNegated } from './voice-negation';

/** True when the word `target` in `text` is governed by a negation. */
const negated = (text: string, target: string) => isNegatedAt(text, text.toLowerCase().indexOf(target));

describe('isNegatedAt — what a negation reaches', () => {
  it('reaches the finding it introduces, in French', () => {
    expect(negated('pas de carie sur la seize', 'carie')).toBe(true);
    expect(negated('dent 16 sans carie', 'carie')).toBe(true);
    expect(negated('aucune fracture visible', 'fracture')).toBe(true);
    expect(negated('absence de mobilité', 'mobilité')).toBe(true);
    expect(negated('pas de signe de carie', 'carie')).toBe(true);
  });

  it('reaches the finding it introduces, in English', () => {
    expect(negated('no caries on 16', 'caries')).toBe(true);
    expect(negated('16 is not fractured', 'fractured')).toBe(true);
    expect(negated('tooth 16 without decay', 'decay')).toBe(true);
    expect(negated('the tooth doesn\'t hurt', 'hurt')).toBe(true);
  });

  it('carries across "ni" and "nor" to the second thing denied', () => {
    expect(negated('pas de carie ni de fracture', 'fracture')).toBe(true);
    expect(negated('no caries nor fracture', 'fracture')).toBe(true);
  });

  it('reads Darija and Arabic negation', () => {
    expect(negated('makayn carie', 'carie')).toBe(true);
    expect(negated('بدون تسوس', 'تسوس')).toBe(true);
  });

  it('does not reach a finding in another clause', () => {
    expect(negated('pas de carie, fracture', 'fracture')).toBe(false);
    expect(negated('pas de carie mais fracture', 'fracture')).toBe(false);
    expect(negated('no caries but a fracture', 'fracture')).toBe(false);
    expect(negated('pas de douleur. carie profonde', 'carie')).toBe(false);
  });

  it('does not reach a finding too many words away', () => {
    expect(negated('pas vraiment très clairement visiblement une belle carie', 'carie')).toBe(false);
  });

  it('leaves an affirmed finding alone', () => {
    expect(negated('carie sur la seize', 'carie')).toBe(false);
    expect(negated('dent 16 carie profonde', 'carie')).toBe(false);
  });

  it('does not treat a reply particle as a negation', () => {
    // "Non, en fait couronne à remplacer" is a correction, and so is "no, actually…".
    expect(negated('non, en fait couronne à remplacer', 'couronne')).toBe(false);
    expect(negated('non en fait couronne à remplacer', 'couronne')).toBe(false);
    expect(negated('no, actually crown replacement', 'crown')).toBe(false);
    expect(negated('non couronne à remplacer', 'couronne')).toBe(false);
  });

  it('still reads "non" inside a phrase as a negation', () => {
    expect(negated('dent 16 non mobile', 'mobile')).toBe(true);
  });

  it('is not fooled by a cue that is only part of another word', () => {
    expect(negated('dent 16 notable carie', 'carie')).toBe(false);
    expect(negated('dent 16 pasteurisée carie', 'carie')).toBe(false);
  });
});

describe('containsNegation', () => {
  it('finds a cue anywhere', () => {
    expect(containsNegation('le patient n\'est pas allergique')).toBe(true);
    expect(containsNegation('aucune allergie connue')).toBe(true);
    expect(containsNegation('allergie à la pénicilline')).toBe(false);
  });
});

describe('startsNegated', () => {
  it('recognises a label that is itself a denial', () => {
    expect(startsNegated('aucun')).toBe(true);
    expect(startsNegated('pas de médicaments')).toBe(true);
    expect(startsNegated('none')).toBe(true);
    expect(startsNegated('sans antécédent')).toBe(true);
  });

  it('leaves a real label alone', () => {
    expect(startsNegated('diabète')).toBe(false);
    expect(startsNegated('penicillin')).toBe(false);
    expect(startsNegated('nonsteroidal anti-inflammatories')).toBe(false);
  });
});

describe('clauseAround', () => {
  it('returns the words of the clause, for keeping as a note', () => {
    const text = 'dent 16 pas de carie, mais fracture';
    expect(clauseAround(text, text.indexOf('carie'))).toBe('dent 16 pas de carie');
    expect(clauseAround(text, text.indexOf('fracture'))).toBe('fracture');
  });
});
