import { describe, expect, it } from 'vitest';
import { emptyReview, ReviewState } from './consultation-draft';
import { actionFromUtterance, diffReview } from './consultation-events';
import { UtteranceEvent } from '../voice/voice-intent.model';

const event = (over: Partial<UtteranceEvent>): UtteranceEvent => ({
  lineId: 1, text: 'dent 16 carie', verdict: 'acted', summary: 'Dent 16 : carie.', intents: ['clinical.addFindings'],
  auditIds: ['a-1'], fdi: ['16'], latencyMs: null, ...over,
});

describe('actionFromUtterance', () => {
  it('puts a staged finding on the chart, undoable', () => {
    expect(actionFromUtterance(event({}))).toMatchObject({
      kind: 'chart', title: 'Dent 16 : carie.', status: 'noted', target: { view: 'chart', fdi: '16' }, undoable: true,
    });
  });

  it('shows a sentence that looked like a command and was not understood', () => {
    expect(actionFromUtterance(event({ verdict: 'unsure', summary: null, intents: [], text: 'On dit zuite, carie occlusale.' })))
      .toMatchObject({ kind: 'unsure', status: 'not-understood', title: 'On dit zuite, carie occlusale.', target: null });
  });

  it('leaves conversation and another language off the card', () => {
    expect(actionFromUtterance(event({ verdict: 'heard' }))).toBeNull();
    expect(actionFromUtterance(event({ verdict: 'other-language' }))).toBeNull();
  });

  it('does not move the stage for a view command, which moved it itself', () => {
    expect(actionFromUtterance(event({ intents: ['ui.show'], summary: '3 allergies.' }))).toMatchObject({ kind: 'view', target: null });
  });
});

describe('diffReview', () => {
  const withAllergy = (substance: string, status: 'proposed' | 'removed' = 'proposed'): ReviewState => ({
    ...emptyReview(),
    allergies: [{ key: `allergy:${substance}`, data: { substance, reaction: null, severity: null }, quote: substance, status, manual: false, edited: false }],
  });

  it('sees what was added, changed and removed', () => {
    expect(diffReview(emptyReview(), withAllergy('ananas'))).toEqual([
      { list: 'allergies', key: 'allergy:ananas', kind: 'added', label: 'ananas' },
    ]);
    expect(diffReview(withAllergy('ananas'), withAllergy('ananas', 'removed'))[0].kind).toBe('removed');
    expect(diffReview(withAllergy('ananas'), withAllergy('ananas'))).toEqual([]);
  });
});
