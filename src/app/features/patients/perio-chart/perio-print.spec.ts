import { beforeEach, describe, expect, it } from 'vitest';
import { PerioPrintOptions, buildPrintDocument } from './perio-print';

const LABELS = {
  title: 'Charte parodontale', patient: 'Patient', born: 'Naissance', chartDate: 'Date', practitioner: 'Praticien',
  reason: 'Motif', notes: 'Notes', generated: 'Imprimé depuis OrthoFlow le 12 oct. 2026',
};

describe('perio print document', () => {
  let target: Document;
  let sheet: HTMLElement;
  let summary: HTMLElement;

  const options = (over: Partial<PerioPrintOptions> = {}): PerioPrintOptions => ({
    labels: LABELS, clinicName: 'Cabinet Atlas', clinicContact: ['12 rue des Fleurs', '+212 600 000 001'],
    patientName: 'Sara Benziane', patientBirthDate: '2 mai 1988', chartDate: '12 oct. 2026', practitioner: 'Dr Farrak',
    visitReason: 'Contrôle', clinicalNotes: 'Saignement diffus', sheet, summary, direction: 'ltr', language: 'fr', ...over,
  });

  beforeEach(() => {
    target = document.implementation.createHTMLDocument('');
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('tabindex', '0');
    sheet.innerHTML = `
      <div class="tip">Astuce</div>
      <div role="alert">Erreur</div>
      <p class="sr-only">annonce</p>
      <button class="chip" type="button">18</button>
      <svg><rect stroke="#3b82f6"/><rect stroke="#2563eb"/><polyline points="0,0 1,1"/></svg>`;
    summary = document.createElement('app-perio-summary');
    summary.innerHTML = '<section><h3>Résumé</h3></section>';
  });

  it('puts the clinic, the patient and the examination at the head of the page', () => {
    buildPrintDocument(target, document, options());

    expect(target.querySelector('.clinic')?.textContent).toBe('Cabinet Atlas');
    expect(target.querySelector('h1')?.textContent).toBe('Charte parodontale');
    expect(target.querySelector('.contact')?.textContent).toContain('+212 600 000 001');
    const meta = [...target.querySelectorAll('.print-meta div')].map((d) => `${d.querySelector('dt')?.textContent}=${d.querySelector('dd')?.textContent}`);
    expect(meta).toEqual([
      'Patient=Sara Benziane', 'Naissance=2 mai 1988', 'Date=12 oct. 2026', 'Praticien=Dr Farrak', 'Motif=Contrôle', 'Notes=Saignement diffus',
    ]);
    expect(target.querySelector('.print-footer')?.textContent).toBe(LABELS.generated);
    expect(target.title).toContain('Sara Benziane');
  });

  it('draws what someone typed as text, never as markup', () => {
    buildPrintDocument(target, document, options({ patientName: '<img src=x onerror=alert(1)>', clinicalNotes: '<script>alert(2)</script>' }));

    expect(target.querySelector('.print-page img')).toBeNull();
    expect(target.querySelector('.print-page script')).toBeNull();
    expect(target.querySelector('.print-meta')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('leaves out what was not filled in', () => {
    buildPrintDocument(target, document, options({ patientBirthDate: null, practitioner: '', visitReason: null, clinicalNotes: null }));
    const labels = [...target.querySelectorAll('.print-meta dt')].map((d) => d.textContent);
    expect(labels).toEqual(['Patient', 'Date']);
  });

  it('prints the chart as a copy, without the cursor, the tip, the messages or the keyboard stops', () => {
    buildPrintDocument(target, document, options());
    const copy = target.querySelector('.print-zoom .sheet')!;

    expect(copy.querySelector('rect[stroke="#3b82f6"]')).toBeNull();
    expect(copy.querySelector('rect[stroke="#2563eb"]')).not.toBeNull();
    expect(copy.querySelector('polyline')).not.toBeNull();
    expect(copy.querySelector('.tip, [role=alert], .sr-only')).toBeNull();
    expect(copy.hasAttribute('tabindex')).toBe(false);
    expect((copy.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    // the screen is untouched
    expect(sheet.querySelector('rect[stroke="#3b82f6"]')).not.toBeNull();
    expect(sheet.hasAttribute('tabindex')).toBe(true);
  });

  it('keeps the chart in the dentist’s orientation whatever the language of the page', () => {
    buildPrintDocument(target, document, options({ direction: 'rtl', language: 'ar' }));

    expect(target.documentElement.dir).toBe('rtl');
    expect(target.documentElement.lang).toBe('ar');
    expect(target.querySelector('.print-zoom')?.getAttribute('dir')).toBe('ltr');
  });

  it('puts the summary on a page of its own, and prints without one when there is none', () => {
    buildPrintDocument(target, document, options());
    expect(target.querySelector('.print-summary app-perio-summary')).not.toBeNull();

    const bare = document.implementation.createHTMLDocument('');
    buildPrintDocument(bare, document, options({ summary: null }));
    expect(bare.querySelector('.print-summary')).toBeNull();
  });

  it('asks for A4 paper and for backgrounds to be printed', () => {
    buildPrintDocument(target, document, options());
    const css = [...target.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('size: A4 portrait');
    expect(css).toContain('print-color-adjust: exact');
  });
});
