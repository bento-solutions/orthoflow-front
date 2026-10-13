/**
 * Printing a periodontal chart: a window of its own with the clinic's header, the chart exactly as it is
 * drawn on screen (so what is on paper is what the clinician saw), and the summary. The browser's print
 * dialog turns it into paper or into a PDF. The text is drawn with DOM calls, never concatenated into
 * HTML: a patient's name is whatever someone typed.
 */

export interface PerioPrintLabels {
  readonly title: string;
  readonly patient: string;
  readonly born: string;
  readonly chartDate: string;
  readonly practitioner: string;
  readonly reason: string;
  readonly notes: string;
  readonly generated: string;
}

export interface PerioPrintOptions {
  readonly labels: PerioPrintLabels;
  readonly clinicName?: string | null;
  readonly clinicContact?: readonly string[];
  readonly patientName?: string | null;
  readonly patientBirthDate?: string | null;
  readonly chartDate: string;
  readonly practitioner?: string | null;
  readonly visitReason?: string | null;
  readonly clinicalNotes?: string | null;
  /** The rendered sheet and summary of the screen: copied, not moved. */
  readonly sheet: Element;
  readonly summary: Element | null;
  readonly direction: 'ltr' | 'rtl';
  readonly language: string;
}

const PAGE_CSS = `
  @page { size: A4 portrait; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #09090b; }
  body { font-family: 'Inter', 'Manrope', system-ui, sans-serif; font-size: 12px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-page { width: 190mm; margin: 0 auto; }
  .print-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 10px; border-bottom: 1px solid #d4d4d8; }
  .print-head h1 { margin: 0; font-size: 18px; line-height: 1.2; }
  .print-head .clinic { font-size: 14px; font-weight: 600; }
  .print-head .contact { color: #52525b; font-size: 11px; text-align: end; }
  .print-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; margin: 10px 0 12px; font-size: 12px; }
  .print-meta dt { color: #71717a; text-transform: uppercase; letter-spacing: .03em; font-size: 10px; }
  .print-meta dd { margin: 0 0 4px; font-weight: 600; }
  .print-meta .wide { grid-column: 1 / -1; }
  .print-notes { white-space: pre-line; font-weight: 400 !important; }
  /* the chart is 1000px wide on screen; this is the width of the page */
  .print-zoom { zoom: 0.71; }
  .print-zoom .sheet { overflow: visible !important; }
  .print-summary { break-before: page; }
  .print-footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #e4e4e7; color: #71717a; font-size: 10px; }
  .print-logo { max-height: 40px; max-width: 160px; object-fit: contain; }
`;

const node = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string | null, className?: string): HTMLElementTagNameMap[K] => {
  const el = doc.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
};

/** Everything that styles the page the chart is on, so the copy of the chart looks like the original. */
function copyStyles(from: Document, to: Document): void {
  from.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => to.head.appendChild(to.importNode(el, true)));
}

/** The on-screen cursor and entry aids are not part of the record. */
function stripScreenOnly(copy: Element): void {
  copy.querySelectorAll('rect[stroke="#3b82f6"]').forEach((el) => el.remove());
  copy.querySelectorAll('.tip, [role="alert"], .sr-only, [role="tooltip"], .popover').forEach((el) => el.remove());
  copy.removeAttribute('tabindex');
  copy.querySelectorAll('[tabindex]').forEach((el) => el.removeAttribute('tabindex'));
  copy.querySelectorAll('button').forEach((el) => ((el as HTMLButtonElement).disabled = true));
}

/** Builds the document of the printout in `target`. Separate from opening a window so it can be tested. */
export function buildPrintDocument(target: Document, source: Document, options: PerioPrintOptions): void {
  const { labels } = options;
  target.documentElement.lang = options.language;
  target.documentElement.dir = options.direction;
  target.title = `${labels.title} — ${options.patientName ?? ''} — ${options.chartDate}`.replace(/\s+—\s+—/g, ' —');

  const base = target.createElement('base');
  base.href = `${source.location.origin}/`;
  target.head.appendChild(base);
  copyStyles(source, target);
  target.head.appendChild(node(target, 'style', PAGE_CSS));

  const page = node(target, 'div', null, 'print-page');

  const head = node(target, 'header', null, 'print-head');
  const title = node(target, 'div');
  title.appendChild(node(target, 'div', options.clinicName ?? '', 'clinic'));
  title.appendChild(node(target, 'h1', labels.title));
  head.appendChild(title);
  const contact = node(target, 'div', null, 'contact');
  (options.clinicContact ?? []).filter(Boolean).forEach((line) => contact.appendChild(node(target, 'div', line)));
  head.appendChild(contact);
  page.appendChild(head);

  const meta = node(target, 'dl', null, 'print-meta');
  const field = (label: string, value: string | null | undefined, wide = false, className?: string): void => {
    if (!value) return;
    const wrap = node(target, 'div', null, wide ? 'wide' : undefined);
    wrap.appendChild(node(target, 'dt', label));
    wrap.appendChild(node(target, 'dd', value, className));
    meta.appendChild(wrap);
  };
  field(labels.patient, options.patientName);
  field(labels.born, options.patientBirthDate);
  field(labels.chartDate, options.chartDate);
  field(labels.practitioner, options.practitioner);
  field(labels.reason, options.visitReason, true);
  field(labels.notes, options.clinicalNotes, true, 'print-notes');
  page.appendChild(meta);

  const sheet = options.sheet.cloneNode(true) as Element;
  stripScreenOnly(sheet);
  const sheetWrap = node(target, 'div', null, 'print-zoom');
  sheetWrap.setAttribute('dir', 'ltr');
  sheetWrap.appendChild(sheet);
  page.appendChild(sheetWrap);

  if (options.summary) {
    const summary = options.summary.cloneNode(true) as Element;
    stripScreenOnly(summary);
    const summaryWrap = node(target, 'div', null, 'print-summary print-zoom');
    summaryWrap.appendChild(summary);
    page.appendChild(summaryWrap);
  }

  page.appendChild(node(target, 'footer', labels.generated, 'print-footer'));
  target.body.appendChild(page);
}

/** Opens the printout and the print dialog. Returns false when the browser would not open the window. */
export function openPerioPrint(options: PerioPrintOptions): boolean {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return false;
  buildPrintDocument(win.document, document, options);
  const print = (): void => {
    win.focus();
    win.print();
  };
  // Pictures and fonts first: a printout with half-drawn teeth is worse than a printout a second late.
  if (win.document.readyState === 'complete') setTimeout(print, 300);
  else win.addEventListener('load', () => setTimeout(print, 300));
  win.addEventListener('afterprint', () => win.close());
  return true;
}
