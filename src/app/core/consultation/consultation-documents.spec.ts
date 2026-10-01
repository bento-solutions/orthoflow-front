import { describe, expect, it } from 'vitest';
import { buildAssistantSheetHtml, buildReportHtml, DocumentInput, esc } from './consultation-documents';

const LABELS: Record<string, string> = {
  REPORT_TITLE: 'Compte rendu de consultation', SHEET_TITLE: 'Fiche assistant', DOCTOR: 'Dr', PATIENT: 'Patient',
  AGE: 'Âge', YEARS: 'ans', GENDER: 'Sexe', PHONE: 'Téléphone', CIN: 'CIN', INSURANCE: 'Assurance',
  COMPLAINT: 'Motif', ALLERGIES: 'Allergies', HISTORY: 'Antécédents', ACTIVE_TREATMENTS: 'Traitements en cours',
  CHART_FINDINGS: 'Constatations', REPORT: 'Compte rendu', PLAN: 'Plan de traitement', TOOTH: 'Dent',
  NEXT_APPOINTMENT: 'Prochain rendez-vous', DOCTOR_SIGNATURE: 'Signature', TREATMENT: 'Soin', QUANTITY: 'Qté',
  UNIT_PRICE: 'Prix unitaire', AMOUNT: 'Montant', TOTAL: 'Total', TOTAL_PARTIAL: 'Total partiel',
  UNPRICED_NOTE: 'Certains actes n\'ont pas de prix.', NO_PLAN: 'Aucun plan de traitement.',
  SEVERITY_MODERATE: 'modérée',
};

function input(overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    clinic: { name: 'Cabinet Dentaire Atlas', address: '12 rue des Orangers', phone: '0522000000' },
    patient: { fullName: 'Karim Alaoui', age: 34, gender: 'M', phone: '0612345678', cin: 'BK123456', insurance: 'CNOPS' },
    record: {
      allergies: [{ substance: 'pénicilline', reaction: 'urticaire', severity: 'MODERATE' }],
      medicalHistory: [{ category: 'CONDITION', label: 'Diabète', detail: 'depuis 10 ans' }],
      activeTreatments: [{ label: 'Kardegic', type: 'MEDICATION', detail: '75 mg' }],
      chiefComplaint: 'Douleur sur la 16',
      treatmentPlan: [
        { label: 'Détartrage', price: 300, quantity: 1 },
        { label: 'Composite', teeth: '16', price: 400, quantity: 2, notes: 'anesthésie locale' },
      ],
      report: 'Carie profonde.\nSurveillance.',
      approvedAuditIds: [], rejectedAuditIds: [], amendments: [],
    },
    chartLines: ['16 : carie mésio-occlusale'],
    doctorName: 'Bennani',
    date: new Date('2026-10-01T10:00:00'),
    appointmentText: '16 octobre 2026 à 10:00',
    labels: LABELS,
    dir: 'ltr',
    lang: 'fr',
    currency: 'MAD',
    ...overrides,
  };
}

describe('esc', () => {
  it('escapes the five characters that can open markup or an attribute', () => {
    expect(esc(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });

  it('treats null and undefined as empty', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('escaping in the printed documents', () => {
  const hostile = '<img src=x onerror=alert(1)>';

  it('renders a patient name, an allergy, a note and a plan line as text, in both documents', () => {
    const doc = input({
      patient: { fullName: hostile },
      chartLines: [hostile],
      doctorName: hostile,
      appointmentText: hostile,
      clinic: { name: hostile, address: hostile },
    });
    doc.record.allergies = [{ substance: hostile, reaction: hostile }];
    doc.record.medicalHistory = [{ category: 'OTHER', label: hostile, detail: hostile }];
    doc.record.activeTreatments = [{ label: hostile, type: 'OTHER', detail: hostile }];
    doc.record.chiefComplaint = hostile;
    doc.record.report = hostile;
    doc.record.treatmentPlan = [{ label: hostile, teeth: hostile, notes: hostile, quantity: 1, price: 1 }];

    for (const html of [buildReportHtml(doc), buildAssistantSheetHtml(doc)]) {
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });
});

describe('the consultation report', () => {
  it('carries the patient, what they said, what was found and what is planned', () => {
    const html = buildReportHtml(input());

    expect(html).toContain('Compte rendu de consultation');
    expect(html).toContain('Karim Alaoui');
    expect(html).toContain('34 ans');
    expect(html).toContain('BK123456');
    expect(html).toContain('Douleur sur la 16');
    expect(html).toContain('pénicilline');
    expect(html).toContain('urticaire');
    expect(html).toContain('modérée');
    expect(html).toContain('Diabète');
    expect(html).toContain('Kardegic');
    expect(html).toContain('16 : carie mésio-occlusale');
    expect(html).toContain('Carie profonde.<br>Surveillance.');
    expect(html).toContain('16 octobre 2026 à 10:00');
    expect(html).toContain('Cabinet Dentaire Atlas');
  });

  it('leaves out a section with nothing in it', () => {
    const doc = input({ chartLines: [], appointmentText: null });
    doc.record.allergies = [];
    doc.record.medicalHistory = [];

    const html = buildReportHtml(doc);

    expect(html).not.toContain('<h2>Allergies</h2>');
    expect(html).not.toContain('<h2>Antécédents</h2>');
    expect(html).not.toContain('<h2>Constatations</h2>');
    expect(html).not.toContain('<h2>Prochain rendez-vous</h2>');
  });

  it('is a complete document in the right language and direction', () => {
    const html = buildReportHtml(input({ dir: 'rtl', lang: 'ar' }));

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });
});

describe('the assistant\'s sheet', () => {
  it('lists every act with its price and totals price × quantity', () => {
    const html = buildAssistantSheetHtml(input());

    expect(html).toContain('Fiche assistant');
    expect(html).toContain('Détartrage');
    expect(html).toContain('Composite');
    expect(html).toContain('anesthésie locale');
    // 300 + 400 × 2 = 1 100
    expect(html).toMatch(/1[\s  ]100 MAD/);
    expect(html).toContain('>Total<');
    expect(html).not.toContain('Total partiel');
  });

  it('says the total is partial when an act has no price', () => {
    const doc = input();
    doc.record.treatmentPlan = [
      { label: 'Détartrage', price: 300, quantity: 1 },
      { label: 'Couronne', quantity: 1 },
    ];

    const html = buildAssistantSheetHtml(doc);

    expect(html).toContain('Total partiel');
    expect(html).toContain('Certains actes n&#39;ont pas de prix.');
    expect(html).toContain('—');
  });

  it('keeps the allergy warning for the person preparing the room, and the rest of the clinical record off the sheet', () => {
    const html = buildAssistantSheetHtml(input());

    expect(html).toContain('pénicilline');
    expect(html).not.toContain('Diabète');
    expect(html).not.toContain('Kardegic');
    expect(html).not.toContain('Douleur sur la 16');
    expect(html).not.toContain('BK123456');
  });

  it('says so when there is no plan', () => {
    const doc = input();
    doc.record.treatmentPlan = [];

    expect(buildAssistantSheetHtml(doc)).toContain('Aucun plan de traitement.');
  });
});
