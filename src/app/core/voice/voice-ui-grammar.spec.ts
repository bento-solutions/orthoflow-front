import { describe, expect, it } from 'vitest';
import { resolveWithGrammar } from './voice-grammar';
import { isSelfEvidentUiCommand } from './voice-followup';
import { VoiceContextSnapshot } from './voice-intent.model';

/** docs/VOICE-COCKPIT-PLAN.md part I §5 and appendix A §1–§5, phrase by phrase. */
const context: VoiceContextSnapshot = {
  patientId: 'p', patientName: null, dentition: 'adult', module: 'patient-dossier', route: '/patients/p',
  selectedFdi: null, sessionId: 's', locale: 'fr-MA', recentIntents: [], recentUtterances: [], lastWrite: null,
};
const read = (said: string) => {
  const result = resolveWithGrammar(said, context);
  return result.kind === 'intent' ? { id: result.intent.intent, ...result.intent.entities } : { id: result.kind };
};

describe('view commands — free when the whole sentence is the command', () => {
  it.each([
    ['je veux voir la vue 3D', 'chart'], ['montre le schéma', 'chart'], ['schéma dentaire', 'chart'], ['Schéma dentaire.', 'chart'],
    ['je veux voir ses allergies', 'allergies'], ['montre les allergies', 'allergies'], ['allergies', 'allergies'],
    ['affiche les allergies du patient', 'allergies'], ['ses informations', 'patient'], ['fiche patient', 'patient'],
    ['montre les antécédents', 'history'], ['les traitements en cours', 'treatments'], ['montre le plan de traitement', 'plan'],
    ['Plan de traitement.', 'plan'], ['le rendez-vous', 'appointment'], ['montre les constatations', 'findings'],
    ['la conversation', 'transcript'], ['le résumé', 'summary'], ['alors, montre les allergies', 'allergies'],
    ['show the allergies', 'allergies'], ['treatment plan', 'plan'],
  ])('"%s" shows %s', (said, target) => {
    expect(read(said)).toEqual({ id: 'ui.show', target });
    expect(isSelfEvidentUiCommand(said, context)).toBe(true);
  });

  it.each([['retour', 'ui.back'], ['vue précédente', 'ui.back'], ['garde cette vue', 'ui.pin'], ['suis-moi', 'ui.unpin'], ['go back', 'ui.back']])(
    '"%s" is %s', (said, id) => {
      expect(read(said).id).toBe(id);
      expect(isSelfEvidentUiCommand(said, context)).toBe(true);
    });
});

describe('camera commands — free', () => {
  it.each([
    ['zoom avant', { direction: 'in', steps: 1 }], ['zoome', { direction: 'in', steps: 1 }], ['plus près', { direction: 'in', steps: 1 }],
    ['zoom avant beaucoup', { direction: 'in', steps: 3 }], ['zoom arrière', { direction: 'out', steps: 1 }],
    ['dézoome', { direction: 'out', steps: 1 }], ['plus loin', { direction: 'out', steps: 1 }], ['dézoome un peu', { direction: 'out', steps: 1 }],
    ['zoom in', { direction: 'in', steps: 1 }], ['zoom out a lot', { direction: 'out', steps: 3 }],
  ])('"%s" zooms', (said, entities) => {
    expect(read(said)).toEqual({ id: 'chart.zoom', ...entities });
  });

  it.each([['zoom sur la 16', '16'], ['montre la dent 16', '16'], ['inspecte la 16', '16'], ['gros plan sur la 26', '26'], ['focus sur la 26', '26']])(
    '"%s" puts tooth %s alone in close-up', (said, fdi) => {
      expect(read(said)).toEqual({ id: 'chart.zoomTooth', fdi });
    });

  it.each([
    ['dent suivante', 'chart.step', { delta: 1 }], ['dent précédente', 'chart.step', { delta: -1 }],
    ['tourne à gauche', 'chart.rotate', { direction: 'left' }], ['tourne à droite', 'chart.rotate', { direction: 'right' }],
    ['tourne vers le haut', 'chart.rotate', { direction: 'up' }], ['tourne vers le bas', 'chart.rotate', { direction: 'down' }],
    ["l'autre côté", 'chart.rotate', { direction: 'flip' }], ['toute la bouche', 'chart.reset', {}], ['vue complète', 'chart.reset', {}],
    ['réinitialise la vue', 'chart.reset', {}],
  ])('"%s" is %s', (said, id, entities) => {
    expect(read(said)).toEqual({ id, ...entities });
    expect(isSelfEvidentUiCommand(said, context)).toBe(true);
  });
});

describe('reading, help, repeat, feedback — after the wake word', () => {
  it.each([
    ['lis les allergies', 'ui.read', { target: 'allergies' }], ['quelles sont ses allergies', 'ui.read', { target: 'allergies' }],
    ['relis le plan', 'ui.read', { target: 'plan' }], ['lis la dent 16', 'chart.readTooth', { fdi: '16' }],
    ['aide', 'help.show', {}], ["qu'est-ce que je peux dire", 'help.show', {}], ['comment ça marche', 'help.show', {}],
    ["dis-moi comment j'interagis avec le schéma dentaire.", 'help.show', {}],
    ['répète', 'voice.repeat', {}], ["qu'est-ce que tu as compris", 'voice.repeat', {}],
    ['silence', 'feedback.set', { level: 'silent' }], ['tais-toi', 'feedback.set', { level: 'silent' }],
    ['confirmations brèves', 'feedback.set', { level: 'brief' }], ['sons seulement', 'feedback.set', { level: 'tones' }],
    ['parle', 'feedback.set', { level: 'full' }],
  ])('"%s" is %s, and needs the wake word', (said, id, entities) => {
    expect(read(said)).toEqual({ id, ...entities });
    expect(isSelfEvidentUiCommand(said, context)).toBe(false);
  });
});

describe('never a view from a sentence that only mentions one', () => {
  it.each([
    'je vois que vous avez des allergies', 'pour les allergies, vous avez une allergie à l\'ananas',
    'Voilà pour le plan traitement', 'donc pour le plan traitement on va faire une consultation', 'les allergies ?',
    'retour à la maison demain', 'tourne la tête', 'montrez-moi où vous avez mal',
  ])('"%s"', said => {
    expect(isSelfEvidentUiCommand(said, context)).toBe(false);
  });

  it('keeps a dictated allergy an allergy and a plan line a plan line', () => {
    expect(read('allergie à la pénicilline').id).toBe('clinical.addAllergy');
    expect(read('affiche les allergies du patient').id).toBe('ui.show');
  });
});
