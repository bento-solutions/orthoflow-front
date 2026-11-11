import { beforeAll, describe, expect, it } from 'vitest';
import { ReplayResult, replayConsultation } from './consultation-replay.testing';
import { SESSION_2026_11_10 } from './fixtures/session-2026-11-10.testing';

/**
 * The golden transcript: the consultation of 10 Nov 2026, in which three of
 * eleven dictated findings were lost without a sound and one was saved wrong.
 * Each `it` is one row of the command-path column of
 * docs/VOICE-COCKPIT-PLAN.md part I §7.
 *
 * A row the pipeline does not satisfy yet is written `it.fails`: it passes
 * while the behaviour is wrong, and fails the moment a change fixes it — which
 * is when the work package that fixed it turns it into a plain `it`.
 */

const INTAKE_INTENTS = ['clinical.addAllergy', 'clinical.addMedicalHistory'];

describe('golden transcript — the consultation of 10 Nov 2026', () => {
  let result: ReplayResult;

  beforeAll(async () => {
    result = await replayConsultation(SESSION_2026_11_10);
  });

  /** Kept as conversation: nothing staged, nothing run, nothing said. */
  const heard = (time: string) => {
    const row = result.byTime(time);
    expect(row.staged).toEqual([]);
    expect(row.stagedIntents).toEqual([]);
    expect(row.ran).toEqual([]);
    expect(row.spoken).toEqual([]);
    expect(row.verdict).toBe('heard');
  };
  const staged = (time: string, findings: string[]) => {
    const row = result.byTime(time);
    expect(row.staged.sort()).toEqual([...findings].sort());
  };

  it('22:31:58 "Calypso." opens the wake window and stages nothing', () => {
    const row = result.byTime('22:31:58');
    expect(row.staged).toEqual([]);
    expect(row.verdict).toBe('control');
  });

  it('22:32:21 the identity card\'s digit groups are not teeth', () => heard('22:32:21'));
  it('22:32:26 a question about an allergy is conversation', () => heard('22:32:26'));
  it('22:32:36 the corrected card number is conversation', () => heard('22:32:36'));
  it('22:32:52 the allergies told to the patient are conversation', () => heard('22:32:52'));
  it('22:33:22 the treatments question is conversation', () => heard('22:33:22'));
  it('22:33:25 "Du paracétamol." is conversation', () => heard('22:33:25'));
  it('22:33:33 "vous prenez du paracétamol" is conversation', () => heard('22:33:33'));
  it('22:33:43 the history question is conversation', () => heard('22:33:43'));
  it('22:33:50 "la goutte" is conversation', () => heard('22:33:50'));
  it('22:34:08 the corrected diabetes is conversation', () => heard('22:34:08'));
  it('22:34:34 the first name is conversation', () => heard('22:34:34'));
  it('22:34:46 the spelling is conversation', () => heard('22:34:46'));
  it('22:35:09 the corrected name is conversation', () => heard('22:35:09'));
  it('22:35:36 the plan explained to the patient is conversation', () => heard('22:35:36'));
  it('22:35:38 its second half is conversation', () => heard('22:35:38'));

  it.fails('22:36:11 "Plan de traitement." shows the plan', () => {
    expect(result.byTime('22:36:11').ran).toContain('ui.show');
    expect(result.byTime('22:36:11').view).toBe('plan');
  });

  it('22:36:35 "ça sera demain" is conversation', () => heard('22:36:35'));
  it('22:36:40 is conversation', () => heard('22:36:40'));
  it('22:36:51 the price said to the patient is conversation', () => heard('22:36:51'));

  it('22:37:18 "soins en place" on 18 is an existing filling', () => {
    staged('22:37:18', ['18:existing_filling']);
  });

  it('22:37:39 "dans 16 caries occlusales" (mis-heard "dent") is occlusal caries on 16', () => {
    staged('22:37:39', ['16:caries@occlusal']);
  });

  it('22:38:32 "dont 11 caries occlusales" is occlusal caries on 11', () => {
    staged('22:38:32', ['11:caries@occlusal']);
  });

  it.fails('22:38:57 "Calypso schéma dentaire" (second sentence) shows the chart', () => {
    expect(result.byTime('22:38:57').ran).toContain('ui.show');
    expect(result.byTime('22:38:57').view).toBe('chart');
  });

  it('22:39:06 "On dit zuite, carie occlusale." stages nothing', () => {
    expect(result.byTime('22:39:06').staged).toEqual([]);
  });

  it.fails('22:39:06 … and is marked not understood', () => {
    expect(result.byTime('22:39:06').verdict).toBe('unsure');
  });

  it.fails('22:39:39 "dis-moi comment j\'interagis avec le schéma dentaire" shows the help', () => {
    expect(result.byTime('22:39:39').ran).toContain('help.show');
  });

  it('22:40:22 "Dans 11 carrés." is already noted: no second entry', () => {
    expect(result.byTime('22:40:22').staged).toEqual([]);
    expect(result.finalFindings.filter(f => f.startsWith('11:caries'))).toHaveLength(1);
  });

  it('22:40:28 "dont 12 absentes." — 12 missing', () => staged('22:40:28', ['12:missing']));
  it('22:40:34 "Dent 13, carie." — 13 caries', () => staged('22:40:34', ['13:caries']));
  it('22:40:41 "dont 24 absentes." — 24 missing', () => staged('22:40:41', ['24:missing']));

  it('22:40:49 "38 carré occlusal." is occlusal caries on 38', () => {
    staged('22:40:49', ['38:caries@occlusal']);
  });

  it('22:40:57 "Dent 38, carie occlusale." is already noted', () => {
    const row = result.byTime('22:40:57');
    expect(row.staged).toEqual([]);
    expect(row.stagedIntents).toEqual([]);
    expect(row.spoken.join(' ')).toMatch(/déjà notée/u);
  });

  it('22:41:06 "dont 35 absentes." — 35 missing', () => staged('22:41:06', ['35:missing']));
  it('22:41:14 "44, 43 et 45 couronnes." — three crowns', () => {
    staged('22:41:14', ['44:existing_crown', '43:existing_crown', '45:existing_crown']);
  });

  it('22:41:28 "Non, donc 45, c\'est pas couronne, amalgame." replaces the crown on 45', () => {
    const row = result.byTime('22:41:28');
    expect(row.staged).toEqual(['45:existing_amalgam']);
    expect(row.rejected).toHaveLength(1);
    expect(result.finalFindings.filter(f => f.startsWith('45:'))).toEqual(['45:existing_amalgam']);
  });

  it('22:41:55 the next appointment told to the patient is conversation, not a read', () => heard('22:41:55'));

  it('22:42:39 "Calypso, stop, fin de consultation." ends at once, with no model call', () => {
    const row = result.byTime('22:42:39');
    expect(row.ended).toBe(true);
    expect(row.nluCalls).toBe(0);
  });

  it('ends with the eleven findings, none lost, none wrong', () => {
    expect([...result.finalFindings].sort()).toEqual([
      '18:existing_filling', '16:caries@occlusal', '11:caries@occlusal', '12:missing', '13:caries',
      '24:missing', '38:caries@occlusal', '35:missing', '44:existing_crown', '43:existing_crown',
      '45:existing_amalgam',
    ].sort());
  });

  it('stages no allergy, history or medication entry', () => {
    expect(result.finalIntents.filter(intent => INTAKE_INTENTS.includes(intent))).toEqual([]);
    expect(result.rows.flatMap(row => row.stagedIntents).filter(intent => INTAKE_INTENTS.includes(intent))).toEqual([]);
  });
});

describe('golden transcript — the allergies sentence with the wake window open (A3)', () => {
  it('is still conversation, even right after a command', async () => {
    const result = await replayConsultation([
      { time: '22:32:40', text: 'Dent 13, carie.' },
      { time: '22:32:52', text: SESSION_2026_11_10.find(line => line.time === '22:32:52')!.text },
    ]);
    const row = result.byTime('22:32:52');
    expect(row.stagedIntents).toEqual([]);
    expect(row.staged).toEqual([]);
  });
});
