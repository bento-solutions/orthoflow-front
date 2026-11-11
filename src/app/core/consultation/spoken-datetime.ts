import { parseNumber } from '../voice/tooth-lexicon';

/**
 * "Demain à 10 heures", "dans 15 jours", "lundi prochain 9 h 30", "le 20
 * novembre à midi et demie": a date and a time, read against the clinic's today.
 * Null when no date is said — a time alone is not an appointment.
 *
 * Pure, and the clock is an argument, so a spec can stand on any day.
 */
export interface SpokenDateTime {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm`, or null when only a day was said. */
  time: string | null;
}

const WEEKDAYS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const NUMBER = '(\\d{1,2}|[a-zàâçéèêëîïôûùüÿ-]+(?:\\s+(?:et\\s+)?[a-zàâçéèêëîïôûùüÿ-]+)?)';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  // "Dans un mois" on 31 January is the end of February, not 3 March.
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), lastDay));
  return next;
}

function count(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  if (/^une?$|^a$|^an$/iu.test(word)) return 1;
  return parseNumber(word.replace(/-/g, ' '));
}

function readDate(text: string, today: Date): Date | null {
  if (/\bapr[èe]s[\s-]?demain\b/iu.test(text) || /\bthe\s+day\s+after\s+tomorrow\b/iu.test(text)) return addDays(today, 2);
  if (/\bdemain\b|\btomorrow\b/iu.test(text)) return addDays(today, 1);
  if (/\baujourd\s*['’]?\s*hui\b|\btoday\b/iu.test(text)) return today;

  const within = new RegExp(`\\b(?:dans|d['’ ]ici|in)\\s+${NUMBER}\\s+(jours?|semaines?|mois|days?|weeks?|months?)\\b`, 'iu').exec(text);
  if (within) {
    const n = count(within[1]);
    if (n !== null && n > 0 && n < 400) {
      const unit = within[2].toLowerCase();
      if (/^(?:jours?|days?)$/u.test(unit)) return addDays(today, n);
      if (/^(?:semaines?|weeks?)$/u.test(unit)) return addDays(today, n * 7);
      return addMonths(today, n);
    }
  }
  if (/\b(?:la\s+)?semaine\s+prochaine\b|\bnext\s+week\b/iu.test(text)) return addDays(today, 7);

  const named = new RegExp(`\\b(?:le\\s+|on\\s+(?:the\\s+)?)?(\\d{1,2}|premier|1er)\\s+(?:de\\s+)?(${Object.keys(MONTHS).join('|')})\\b`, 'iu').exec(text);
  if (named) {
    const day = /^(?:premier|1er)$/iu.test(named[1]) ? 1 : Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    let year = today.getFullYear();
    let candidate = new Date(year, month - 1, day);
    if (candidate.getMonth() !== month - 1) return null;
    if (candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      year += 1;
      candidate = new Date(year, month - 1, day);
    }
    return candidate;
  }

  const weekday = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})(\\s+prochain|\\s+next)?\\b|\\bnext\\s+(${Object.keys(WEEKDAYS).join('|')})\\b`, 'iu').exec(text);
  if (weekday) {
    const name = (weekday[1] ?? weekday[3]).toLowerCase();
    const target = WEEKDAYS[name];
    let ahead = (target - today.getDay() + 7) % 7;
    // "Lundi" said on a Monday is next Monday: an appointment is not made for today by naming its day.
    if (ahead === 0) ahead = 7;
    return addDays(today, ahead);
  }
  return null;
}

function readTime(text: string): string | null {
  if (/\bmidi\b|\bnoon\b/iu.test(text)) {
    return /\bmidi\s+et\s+demie?\b/iu.test(text) ? '12:30' : /\bmidi\s+et\s+quart\b/iu.test(text) ? '12:15' : '12:00';
  }
  const compact = /\b(\d{1,2})\s*[h:]\s*(\d{2})\b/iu.exec(text);
  if (compact) {
    const hour = Number(compact[1]);
    const minute = Number(compact[2]);
    if (hour <= 23 && minute <= 59) return `${pad(hour)}:${pad(minute)}`;
  }
  const spoken = new RegExp(`\\b(?:[àa]\\s+|vers\\s+|at\\s+)?${NUMBER}\\s*(?:heures?|h|o['’]?\\s*clock)\\b(?:\\s+(et\\s+demie?|et\\s+quart|moins\\s+le\\s+quart|\\d{1,2}|[a-zé-]+))?`, 'iu').exec(text);
  if (spoken) {
    const hour = count(spoken[1]);
    if (hour === null || hour > 23) return null;
    const tail = (spoken[2] ?? '').toLowerCase();
    if (/^et\s+demie?$/u.test(tail)) return `${pad(hour)}:30`;
    if (/^et\s+quart$/u.test(tail)) return `${pad(hour)}:15`;
    if (/^moins\s+le\s+quart$/u.test(tail)) return `${pad(Math.max(0, hour - 1))}:45`;
    const minutes = tail ? count(tail) : null;
    return `${pad(hour)}:${pad(minutes !== null && minutes < 60 ? minutes : 0)}`;
  }
  const at = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/iu.exec(text);
  if (at && Number(at[1]) <= 23) return `${pad(Number(at[1]))}:${at[2] ?? '00'}`;
  const pm = /\b(\d{1,2})\s*(am|pm)\b/iu.exec(text);
  if (pm) {
    const hour = Number(pm[1]) % 12 + (pm[2].toLowerCase() === 'pm' ? 12 : 0);
    return `${pad(hour)}:00`;
  }
  return null;
}

export function parseSpokenDateTime(text: string, today: Date): SpokenDateTime | null {
  const clean = text.toLowerCase().replace(/[,.;!?]/g, ' ');
  const date = readDate(clean, today);
  if (!date) return null;
  return { date: iso(date), time: readTime(clean) };
}
