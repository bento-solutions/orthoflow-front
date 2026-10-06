/**
 * Clock times in a named zone, without a date library.
 *
 * The public booking page is shown free times as "09:30" in the clinic's zone. The server wants a
 * moment (an offset date-time), and the offset is not a constant: Morocco keeps +01:00 except
 * during Ramadan, when it is +00:00. So the offset is worked out from the zone's own rules for the
 * date in question, never assumed and never taken from the visitor's browser.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(timeZone: string, instant: number): number {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  const part = (type: string): number => Number(format!.formatToParts(new Date(instant)).find(p => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/** Minutes east of UTC that `timeZone` is at, at the instant `instant` (milliseconds). */
function offsetAt(timeZone: string, instant: number): number {
  return Math.round((wallClock(timeZone, instant) - Math.floor(instant / 1000) * 1000) / 60000);
}

/**
 * `2026-03-01` and `10:00` in `Africa/Casablanca` as `2026-03-01T10:00:00+00:00` (Ramadan) or
 * `…+01:00`, whichever the zone really has at that moment.
 */
export function zonedIso(day: string, time: string, timeZone: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The offset depends on the instant, which depends on the offset: two passes settle it away from a transition.
  const first = offsetAt(timeZone, asIfUtc);
  const offset = offsetAt(timeZone, asIfUtc - first * 60000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${day}T${time}:00${sign}${hh}:${mm}`;
}
