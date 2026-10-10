import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prescription, PrescriptionTemplate, PrescriptionsApi } from '../../../core/services/prescriptions-api.service';
import { screenMocks } from '../../../testing/screen-mocks';
import { PrescriptionEditorComponent, completeLines, incompleteLines } from './prescription-editor.component';

const AUGMENTIN = { drug: 'AUGMENTIN 1 G/125 MG', form: 'Sachet', dci: 'Amoxicilline + acide clavulanique', posology: '1 sachet 3 fois par jour' };

describe('prescription lines', () => {
  it('sends only lines with a drug and a posology, trimmed, and counts the half-filled ones', () => {
    const lines = [
      { drug: ' AUGMENTIN ', form: '', dci: '', posology: ' 1 sachet ' },
      { drug: '', form: '', dci: '', posology: '' },
      { drug: 'BRUFEN', form: 'Comprimé', dci: '', posology: '' },
    ];
    expect(completeLines(lines)).toEqual([{ drug: 'AUGMENTIN', form: null, dci: null, posology: '1 sachet' }]);
    expect(incompleteLines(lines)).toBe(1);
  });
});

describe('PrescriptionEditorComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const template = { id: 'tpl', name: 'Abcès dentaire', category: 'DENTAL', lines: [AUGMENTIN], advice: 'Ne pas fumer.',
    libraryCode: 'abces-dentaire', reviewed: false, reviewedAt: '', reviewedByName: '', active: true } as unknown as PrescriptionTemplate;

  const mount = async () => {
    const mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [PrescriptionEditorComponent, TranslateModule.forRoot()],
      providers: [{ provide: PrescriptionsApi, useValue: api }, ...mocks.providers],
    });
    const fixture = TestBed.createComponent(PrescriptionEditorComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    fixture.componentRef.setInput('patientName', 'Yasmine Bennani');
    fixture.componentRef.setInput('open', true);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    // The lists load in an effect; let those promises land before looking.
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();
    }
    return fixture;
  };
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await new Promise(resolve => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    fixture.detectChanges();
  };
  const issueButton = () => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('RX.ISSUE')) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    api = {
      templates: vi.fn(async () => [template]),
      library: vi.fn(async () => []),
      check: vi.fn(async () => [{ drug: AUGMENTIN.drug, allergy: 'pénicilline', reason: 'même famille : bêta-lactamines' }]),
      issue: vi.fn(async () => ({ id: 'rx1', number: 'ORD-2026-00001' }) as Prescription),
      open: vi.fn(async () => undefined),
    };
  });

  it('fills the drugs from a template and flags one that is still to review', async () => {
    const fixture = await mount();
    const select = document.querySelector('select') as HTMLSelectElement;
    select.value = 't:tpl';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect((document.querySelector('input[placeholder="RX.DRUG"]') as HTMLInputElement).value).toBe(AUGMENTIN.drug);
    expect(document.body.textContent).toContain('RX.TEMPLATE_TO_REVIEW');
  });

  it('stops at an allergy warning and issues only once the prescriber has acknowledged it', async () => {
    const fixture = await mount();
    const select = document.querySelector('select') as HTMLSelectElement;
    select.value = 't:tpl';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    issueButton().click();
    await settle(fixture);
    expect(api['check']).toHaveBeenCalledWith('p1', [AUGMENTIN]);
    expect(api['issue']).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('RX.ALLERGY_TITLE');
    expect(issueButton().disabled).toBe(true);

    const ack = [...document.querySelectorAll('input[type=checkbox]')].at(-1) as HTMLInputElement;
    ack.click();
    await settle(fixture);
    issueButton().click();
    await settle(fixture);

    expect(api['issue']).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'p1', templateId: 'tpl', lines: [AUGMENTIN], advice: 'Ne pas fumer.', acknowledgeWarnings: true,
    }));
    expect(api['open']).toHaveBeenCalledWith('rx1');
  });

  it('issues straight away when no allergy is concerned', async () => {
    api['check'] = vi.fn(async () => []);
    const fixture = await mount();
    const drug = document.querySelector('input[placeholder="RX.DRUG"]') as HTMLInputElement;
    drug.value = 'DOLIPRANE 1 G';
    drug.dispatchEvent(new Event('input'));
    const posology = document.querySelector('textarea[placeholder="RX.POSOLOGY"]') as HTMLTextAreaElement;
    posology.value = '1 comprimé toutes les 8 heures';
    posology.dispatchEvent(new Event('input'));
    await settle(fixture);

    issueButton().click();
    await settle(fixture);

    expect(api['issue']).toHaveBeenCalledWith(expect.objectContaining({ acknowledgeWarnings: false, templateId: undefined }));
  });
});
