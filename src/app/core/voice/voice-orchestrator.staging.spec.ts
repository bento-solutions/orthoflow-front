import { describe, expect, it } from 'vitest';
import { replayConsultation } from './testing/consultation-replay.testing';

/**
 * What the pipeline does with a sentence set against what this session has
 * already staged: a denial corrects, a repeat is not staged twice, and a bare
 * "Calypso, stop" is asked back. Each through the real orchestrator.
 */

const at = (seconds: number) => {
  const total = 10 * 3600 + seconds;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
};
const lines = (...texts: string[]) => texts.map((text, index) => ({ time: at(index * 5), text }));

describe('a denial of something staged is a correction of it', () => {
  it('replaces the denied finding and keeps nothing of it', async () => {
    const result = await replayConsultation(lines('44, 43 et 45 couronnes.', 'Non, donc 45, c\'est pas couronne, amalgame.'));
    const row = result.rows[1];
    expect(row.staged).toEqual(['45:existing_amalgam']);
    expect(row.rejected).toHaveLength(1);
    expect(row.spoken.join(' ')).toMatch(/^Corrigé\. Dent 45 : amalgame/u);
    expect(result.finalFindings.sort()).toEqual(['43:existing_crown', '44:existing_crown', '45:existing_amalgam']);
  });

  it('keeps what else the entry said', async () => {
    const result = await replayConsultation(lines('dent 16 carie et fracture', 'la 16, c\'est pas une carie, une inflammation'));
    expect(result.finalFindings.sort()).toEqual(['16:fracture', '16:gingival_inflammation']);
  });

  it('takes the finding off when nothing is said instead', async () => {
    const result = await replayConsultation(lines('dent 16 carie et fracture', 'dent 16, pas de fracture'));
    expect(result.finalFindings).toEqual(['16:caries']);
    expect(result.rows[1].spoken.join(' ')).toMatch(/Retiré de la dent 16 : fracture/u);
  });

  it('leaves a denial of something not staged as a note, as before', async () => {
    const result = await replayConsultation(lines('dent 16 pas de carie'));
    expect(result.rows[0].stagedIntents).toEqual(['clinical.addNote']);
  });
});

describe('a finding already staged is not staged twice', () => {
  it('answers "déjà notée" and records no row', async () => {
    const result = await replayConsultation(lines('38 carré occlusal.', 'Dent 38, carie occlusale.'));
    expect(result.rows[1].staged).toEqual([]);
    expect(result.rows[1].stagedIntents).toEqual([]);
    expect(result.rows[1].spoken).toEqual(['Dent 38 : carie, déjà notée.']);
    expect(result.finalFindings).toEqual(['38:caries@occlusal']);
  });

  it('takes a surface added to it as a refinement, not a second caries', async () => {
    const result = await replayConsultation(lines('dent 11 carie', 'dent 11 carie occlusale'));
    expect(result.finalFindings).toEqual(['11:caries@occlusal']);
  });

  it('stages only what is new in a sentence that repeats part of it', async () => {
    const result = await replayConsultation(lines('dent 16 carie', 'dent 16 carie et fracture'));
    expect(result.rows[1].staged).toEqual(['16:fracture']);
    expect(result.finalFindings.sort()).toEqual(['16:caries', '16:fracture']);
  });

  it('keeps a different surface as a finding of its own', async () => {
    const result = await replayConsultation(lines('dent 16 carie occlusale', 'dent 16 carie mésiale'));
    expect(result.finalFindings.sort()).toEqual(['16:caries@mesial', '16:caries@occlusal']);
  });
});

describe('"Calypso, stop" is asked back', () => {
  it('asks, and a yes ends', async () => {
    const result = await replayConsultation(lines('Calypso, stop', 'oui'));
    expect(result.rows[0].ended).toBe(false);
    expect(result.rows[0].spoken).toEqual(['Terminer la consultation ?']);
    expect(result.rows[1].ended).toBe(true);
  });

  it('a no does not end', async () => {
    const result = await replayConsultation(lines('Calypso, stop', 'non'));
    expect(result.rows.some(row => row.ended)).toBe(false);
  });

  it('but the full phrase ends at once', async () => {
    const result = await replayConsultation(lines('Calypso, stop, fin de consultation.'));
    expect(result.rows[0].ended).toBe(true);
    expect(result.rows[0].nluCalls).toBe(0);
  });
});

describe('results in the doctor\'s language', () => {
  it('reads a staged entry back in French', async () => {
    const result = await replayConsultation(lines('dent 16, carie occlusale'));
    expect(result.rows[0].spoken).toEqual(['Dent 16 : carie occlusale.']);
  });
});

/**
 * Appendix A §8 of the cockpit plan: said without the wake word, each must stay
 * conversation — at any time, and with the follow-up window open.
 */
const MUST_STAY_CONVERSATION = [
  'Pour les allergies, vous avez une allergie à l\'ananas, vous avez une allergie à la pénicilline, et je vois aussi que vous avez une réaction au kiwi.',
  'on va faire le traitement la semaine prochaine',
  'le traitement va durer deux semaines',
  'il prend le bus pour venir',
  'notre prochain rendez-vous, ça sera pour demain à 10 heures',
  'Et pour les antécédents médicaux, est-ce que vous avez— OK, je vois.',
  'vous avez mal à la 16',
  'j\'ai mal à la dent 16',
  'la dent 16 me fait mal',
  'est-ce que vous avez mal à la 16 ?',
  'passe-moi le composite pour la seize',
  'rendez-vous le 15 mai pour une carie',
  'dans 15 jours on enlève les fils',
  'montrez-moi où vous avez mal',
  'vous avez une carte nationale PK 12 34 56',
  'oui docteur c\'est douloureux',
  'stop',
  'arrêtez ça fait mal',
];

describe('appendix A §8 — must stay conversation without the wake word', () => {
  for (const sentence of MUST_STAY_CONVERSATION) {
    it(`"${sentence.slice(0, 60)}" — alone, and right after a command`, async () => {
      const alone = await replayConsultation(lines(sentence));
      const afterCommand = await replayConsultation(lines('dent 13, carie', sentence));
      for (const row of [alone.rows[0], afterCommand.rows[1]]) {
        expect(row.stagedIntents, sentence).toEqual([]);
        expect(row.ran, sentence).toEqual([]);
        expect(row.ended, sentence).toBe(false);
        expect(row.spoken, sentence).toEqual([]);
      }
    });
  }

  it('with the wake word, a view is still not a write', async () => {
    const result = await replayConsultation(lines('Calypso, affiche les allergies du patient', 'Calypso, plan de traitement'));
    expect(result.rows.flatMap(row => row.stagedIntents)).toEqual([]);
  });
});
