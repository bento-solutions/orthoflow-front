import { planTotal } from './consultation-draft';
import { CommitConsultationDto } from './consultation.model';

/**
 * The two papers a consultation produces, built as self-contained HTML.
 *
 * **The consultation report** is the doctor's record of the visit: who the
 * patient is, what they reported, what was found on the chart, the plan, the
 * next appointment. **The assistant's sheet** is one page for the person who
 * books and bills: the treatment plan, its price, the total — and nothing
 * clinical beyond what the assistant needs to schedule it.
 *
 * ── Why a string and a hidden frame, not the dossier's print styles ─────
 *
 * The dossier prints by hiding everything that is not the dossier. Two
 * different documents from the same screen would need two sets of "hide
 * everything else" rules fighting over one page. A standalone HTML document in
 * its own frame prints exactly what it contains, in any language and direction,
 * and cannot be disturbed by whatever the app is showing.
 *
 * ── Escaping ────────────────────────────────────────────────────────────
 *
 * Every value that reaches this HTML was typed by a person or transcribed from
 * speech — a patient name, an allergy, a note. {@link esc} is applied to all of
 * it, and the tests pin that a `<script>` in a field comes out as text.
 */

export interface DocumentLabels {
  [key: string]: string;
}

export interface DocumentClinic {
  name: string;
  address?: string | null;
  phone?: string | null;
}

export interface DocumentPatient {
  fullName: string;
  age?: number | null;
  gender?: string | null;
  phone?: string | null;
  cin?: string | null;
  insurance?: string | null;
}

export interface DocumentInput {
  clinic: DocumentClinic;
  patient: DocumentPatient;
  /** What the doctor signed off. */
  record: CommitConsultationDto;
  /** Lines describing the chart findings that were saved, already worded. */
  chartLines: string[];
  doctorName: string | null;
  /** When the consultation took place. */
  date: Date;
  /** The appointment as booked, already formatted for people. */
  appointmentText: string | null;
  labels: DocumentLabels;
  /** `ltr` / `rtl`, and the language tag for the formatter. */
  dir: 'ltr' | 'rtl';
  lang: string;
  currency: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes a value; null and undefined are empty. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);
}

/** Text with line breaks kept, escaped. */
function multiline(value: string | null | undefined): string {
  return esc(value ?? '').replace(/\r?\n/g, '<br>');
}

function money(value: number, lang: string, currency: string): string {
  try {
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  } catch {
    return `${value} ${currency}`;
  }
}

function formatDate(date: Date, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 24px 28px; }
  header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  header h1 { font-size: 18px; margin: 0 0 2px; }
  header .clinic { font-size: 12px; color: #444; text-align: end; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; margin: 18px 0 6px; border-bottom: 1px solid #bbb; padding-bottom: 3px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 0; }
  dt { color: #555; }
  dd { margin: 0; font-weight: 600; }
  ul { margin: 0; padding-inline-start: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { padding: 6px 8px; text-align: start; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; color: #555; }
  td.num, th.num { text-align: end; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: 0; }
  .muted { color: #666; }
  .note { margin-top: 6px; font-size: 12px; color: #555; }
  .sign { margin-top: 36px; display: flex; justify-content: space-between; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 12px; color: #444; }
  .allergy { color: #a40000; font-weight: 700; }
  @page { margin: 14mm; }
`;

function page(input: DocumentInput, title: string, body: string): string {
  const { clinic, labels } = input;
  return `<!doctype html>
<html lang="${esc(input.lang)}" dir="${input.dir}">
<head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>
  <header>
    <div><h1>${esc(title)}</h1><div class="muted">${esc(formatDate(input.date, input.lang))}</div></div>
    <div class="clinic"><strong>${esc(clinic.name)}</strong>
      ${clinic.address ? `<div>${esc(clinic.address)}</div>` : ''}
      ${clinic.phone ? `<div>${esc(clinic.phone)}</div>` : ''}
      ${input.doctorName ? `<div>${esc(labels['DOCTOR'])} ${esc(input.doctorName)}</div>` : ''}
    </div>
  </header>
  ${body}
</body>
</html>`;
}

function patientBlock(input: DocumentInput, withDetails: boolean): string {
  const { patient, labels } = input;
  const rows: Array<[string, string | number | null | undefined]> = [[labels['PATIENT'], patient.fullName]];
  if (withDetails) {
    rows.push(
      [labels['AGE'], patient.age != null ? `${patient.age} ${labels['YEARS']}` : null],
      [labels['GENDER'], patient.gender],
      [labels['PHONE'], patient.phone],
      [labels['CIN'], patient.cin],
      [labels['INSURANCE'], patient.insurance],
    );
  }
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  return `<dl>${shown.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
}

function section(title: string, content: string): string {
  return content ? `<h2>${esc(title)}</h2>${content}` : '';
}

function list(items: string[], className = ''): string {
  return items.length
    ? `<ul>${items.map(item => `<li${className ? ` class="${className}"` : ''}>${item}</li>`).join('')}</ul>`
    : '';
}

/** The consultation report: the doctor's record of the visit. */
export function buildReportHtml(input: DocumentInput): string {
  const { record, labels } = input;

  const allergies = record.allergies.map(a => {
    const extra = [a.reaction, a.severity ? labels[`SEVERITY_${a.severity}`] ?? a.severity : null].filter(Boolean).join(', ');
    return `${esc(a.substance)}${extra ? ` <span class="muted">(${esc(extra)})</span>` : ''}`;
  });
  const history = record.medicalHistory.map(h =>
    `${esc(h.label)}${h.detail ? ` <span class="muted">— ${esc(h.detail)}</span>` : ''}`);
  const treatments = record.activeTreatments.map(t =>
    `${esc(t.label)}${t.detail ? ` <span class="muted">— ${esc(t.detail)}</span>` : ''}`);
  const plan = record.treatmentPlan.map(line => {
    const bits = [line.teeth ? `${labels['TOOTH']} ${line.teeth}` : null, line.quantity > 1 ? `×${line.quantity}` : null]
      .filter(Boolean).join(' ');
    return `${esc(line.label)}${bits ? ` <span class="muted">(${esc(bits)})</span>` : ''}`;
  });

  const body = [
    patientBlock(input, true),
    section(labels['COMPLAINT'], record.chiefComplaint ? `<p>${multiline(record.chiefComplaint)}</p>` : ''),
    section(labels['ALLERGIES'], list(allergies, 'allergy')),
    section(labels['HISTORY'], list(history)),
    section(labels['ACTIVE_TREATMENTS'], list(treatments)),
    section(labels['CHART_FINDINGS'], list(input.chartLines.map(esc))),
    section(labels['REPORT'], record.report ? `<p>${multiline(record.report)}</p>` : ''),
    section(labels['PLAN'], list(plan)),
    section(labels['NEXT_APPOINTMENT'], input.appointmentText ? `<p>${esc(input.appointmentText)}</p>` : ''),
    `<div class="sign"><div>${esc(labels['DOCTOR_SIGNATURE'])}</div></div>`,
  ].join('\n');

  return page(input, labels['REPORT_TITLE'], body);
}

/** The assistant's sheet: what to schedule and what to charge. */
export function buildAssistantSheetHtml(input: DocumentInput): string {
  const { record, labels } = input;
  const { total, complete } = planTotal(record.treatmentPlan);

  const rows = record.treatmentPlan.map(line => {
    const quantity = Math.max(1, line.quantity || 1);
    const unit = line.price ?? null;
    return `<tr>
      <td>${esc(line.label)}${line.notes ? `<div class="muted">${esc(line.notes)}</div>` : ''}</td>
      <td>${esc(line.teeth ?? '')}</td>
      <td class="num">${quantity}</td>
      <td class="num">${unit === null ? '—' : esc(money(unit, input.lang, input.currency))}</td>
      <td class="num">${unit === null ? '—' : esc(money(unit * quantity, input.lang, input.currency))}</td>
    </tr>`;
  }).join('');

  const table = record.treatmentPlan.length
    ? `<table>
        <thead><tr>
          <th>${esc(labels['TREATMENT'])}</th><th>${esc(labels['TOOTH'])}</th>
          <th class="num">${esc(labels['QUANTITY'])}</th><th class="num">${esc(labels['UNIT_PRICE'])}</th>
          <th class="num">${esc(labels['AMOUNT'])}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="4">${esc(complete ? labels['TOTAL'] : labels['TOTAL_PARTIAL'])}</td>
          <td class="num">${esc(money(total, input.lang, input.currency))}</td>
        </tr></tfoot>
      </table>
      ${complete ? '' : `<p class="note">${esc(labels['UNPRICED_NOTE'])}</p>`}`
    : `<p class="muted">${esc(labels['NO_PLAN'])}</p>`;

  const body = [
    patientBlock(input, false),
    // An allergy the assistant should know before preparing the room.
    record.allergies.length
      ? section(labels['ALLERGIES'], list(record.allergies.map(a => esc(a.substance)), 'allergy'))
      : '',
    section(labels['PLAN'], table),
    section(labels['NEXT_APPOINTMENT'], input.appointmentText ? `<p>${esc(input.appointmentText)}</p>` : ''),
  ].join('\n');

  return page(input, labels['SHEET_TITLE'], body);
}

/**
 * Prints an HTML document through a hidden frame and removes the frame.
 * Returns false when there is no DOM to print from.
 */
export function printHtml(html: string): boolean {
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  frame.onload = () => {
    const view = frame.contentWindow;
    if (!view) {
      frame.remove();
      return;
    }
    view.focus();
    view.print();
    // Printing is asynchronous in some engines; leave the frame until it is done.
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
  return true;
}
