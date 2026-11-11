import { CockpitModelService } from './cockpit-model.service';
import { StageView } from './consultation-focus.service';

/**
 * What the app says when a section is shown ("3 allergies : ananas, pénicilline,
 * kiwi.") and when it is read aloud ("lis les allergies"): one line for the
 * first, the items for the second, up to six and then "et N autres". Never the
 * patient's balance — that has a command of its own, and a room has ears.
 */

type Language = 'fr' | 'en';

const READ_MAX_ITEMS = 6;

function list(items: string[], language: Language): string {
  const shown = items.slice(0, READ_MAX_ITEMS);
  const rest = items.length - shown.length;
  if (rest <= 0) return shown.join(', ');
  return `${shown.join(', ')}${language === 'fr' ? ` et ${rest} autre${rest > 1 ? 's' : ''}` : ` and ${rest} more`}`;
}

/** "jeudi 12 novembre à 10:00": a date said as a person says it, never "2026-11-12". */
export function spokenWhen(date: string, time: string | null, language: Language): string {
  const when = new Date(`${date}T${time ?? '00:00'}:00`);
  if (Number.isNaN(when.getTime())) return [date, time].filter(Boolean).join(' ');
  try {
    const day = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(when);
    return time ? `${day} ${language === 'fr' ? 'à' : 'at'} ${time}` : day;
  } catch {
    return [date, time].filter(Boolean).join(' ');
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

function counted(items: string[], language: Language, fr: [string, string, string], en: [string, string, string]): string {
  const [one, many, none] = language === 'fr' ? fr : en;
  if (items.length === 0) return none;
  return `${plural(items.length, one, many)}${language === 'fr' ? ' : ' : ': '}${list(items, language)}.`;
}

/** The one line said when a section is put on the stage. */
export function sectionSummary(view: StageView, model: CockpitModelService, language: Language): string {
  const fr = language === 'fr';
  switch (view) {
    case 'chart': return fr ? 'Schéma dentaire.' : 'Dental chart.';
    case 'allergies':
    case 'history':
    case 'treatments':
      return sectionReading(view, model, language);
    case 'plan': {
      const lines = model.planNow();
      if (lines.length === 0) return fr ? 'Aucun acte au plan.' : 'No treatment in the plan.';
      const total = model.planSummary().total;
      const price = total > 0 ? `, ${total} dirhams` : '';
      return fr ? `Plan : ${plural(lines.length, 'acte', 'actes')}${price}.` : `Plan: ${plural(lines.length, 'treatment', 'treatments')}${price}.`;
    }
    case 'appointment': {
      const set = model.appointment();
      if (set) return fr ? `Rendez-vous : ${spokenWhen(set.date, set.time, language)}.` : `Appointment: ${spokenWhen(set.date, set.time, language)}.`;
      const proposed = model.appointmentSuggestion();
      if (proposed?.date) {
        const at = spokenWhen(proposed.date, proposed.time, language);
        return fr ? `Rendez-vous proposé : ${at}.` : `Proposed appointment: ${at}.`;
      }
      return fr ? 'Aucun rendez-vous.' : 'No appointment.';
    }
    case 'findings': {
      const lines = model.chartLines();
      const teeth = new Set(lines.map(line => /\d{2}/.exec(line.label)?.[0]).filter(Boolean)).size;
      if (lines.length === 0) return fr ? 'Aucune constatation dictée.' : 'No finding dictated.';
      return fr ? `${plural(lines.length, 'constatation', 'constatations')} sur ${plural(teeth, 'dent', 'dents')}.`
        : `${plural(lines.length, 'finding', 'findings')} on ${plural(teeth, 'tooth', 'teeth')}.`;
    }
    case 'patient': return fr ? 'Fiche patient.' : 'Patient details.';
    case 'transcript': return fr ? 'Conversation.' : 'Conversation.';
    case 'summary': return fr ? 'Résumé.' : 'Summary.';
    case 'help': return fr ? 'Aide.' : 'Help.';
  }
}

/** What "lis …" reads: the items themselves, record and consultation together. */
export function sectionReading(view: StageView, model: CockpitModelService, language: Language): string {
  const fr = language === 'fr';
  const labels = (lines: { label: string }[]) => [...new Set(lines.map(line => line.label.trim()).filter(Boolean))];
  switch (view) {
    case 'allergies':
      return counted(labels([...model.allergiesOnRecord(), ...model.allergiesNow()]), language,
        ['allergie', 'allergies', 'Aucune allergie notée.'], ['allergy', 'allergies', 'No allergy noted.']);
    case 'history':
      return counted(labels([...model.historyOnRecord(), ...model.historyNow()]), language,
        ['antécédent', 'antécédents', 'Aucun antécédent noté.'], ['history entry', 'history entries', 'No history noted.']);
    case 'treatments':
      return counted(labels([...model.treatmentsOnRecord(), ...model.treatmentsNow()]), language,
        ['traitement en cours', 'traitements en cours', 'Aucun traitement en cours noté.'], ['current treatment', 'current treatments', 'No current treatment noted.']);
    case 'plan': {
      const lines = model.planNow().map(line => `${line.label}${line.teeth ? ` ${fr ? 'sur' : 'on'} ${line.teeth}` : ''}${line.price !== null ? `, ${line.price * (line.quantity || 1)} dirhams` : ''}`);
      if (lines.length === 0) return fr ? 'Aucun acte au plan.' : 'No treatment in the plan.';
      const total = model.planSummary().total;
      return `${fr ? 'Plan' : 'Plan'} : ${list(lines, language)}.${total > 0 ? (fr ? ` Total ${total} dirhams.` : ` Total ${total} dirhams.`) : ''}`;
    }
    case 'patient': {
      const fields = model.patientFields()
        .map(field => ({ name: field.name, value: field.now ?? field.record }))
        .filter(field => field.value !== null && field.value !== '' && ['firstName', 'lastName', 'age', 'phone', 'insuranceProvider'].includes(field.name));
      if (fields.length === 0) return fr ? 'Rien sur la fiche.' : 'Nothing on the record.';
      const names: Record<string, [string, string]> = {
        firstName: ['prénom', 'first name'], lastName: ['nom', 'last name'], age: ['âge', 'age'], phone: ['téléphone', 'phone'],
        insuranceProvider: ['assurance', 'insurer'],
      };
      return `${fields.map(field => `${names[field.name][fr ? 0 : 1]} ${field.value}`).join(', ')}.`;
    }
    case 'summary': {
      const lines = [...(model.complaint() ? [model.complaint()!.text] : []), ...labels(model.noteLines())];
      if (lines.length === 0) return fr ? 'Rien à résumer.' : 'Nothing to summarise.';
      return `${list(lines, language)}.`;
    }
    default:
      return sectionSummary(view, model, language);
  }
}
