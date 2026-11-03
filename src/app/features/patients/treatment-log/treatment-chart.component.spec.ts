import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { describe, expect, it, beforeEach } from 'vitest';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TreatmentPassport } from '../../../core/api/contract';
import { TreatmentChartComponent } from './treatment-chart.component';

const passport: TreatmentPassport = {
  format: 'orthoflow.treatment-passport',
  version: 1,
  teeth: [{ fdi: '16', findingCode: 'caries', kind: 'CONDITION', surfaces: ['mesial'] }],
  planned: [{ teeth: ['36'], code: 'filling_required', surfaces: ['occlusal'], outcome: 'REQUIRED' }],
  log: [],
  chart: {
    dentition: 'adult',
    teeth: [
      { fdi: '16', status: 'caries', keys: ['A', 'C'], done: true, owed: false },
      { fdi: '26', status: 'crown', keys: ['B'], done: true, owed: false },
      { fdi: '36', status: 'present', keys: ['D'], done: false, owed: true },
    ],
    legend: [
      { key: 'A', group: 'DONE', symbol: 'solid', code: 'filling_required', outcome: 'TREATED', uses: [{ teeth: ['16'], surfaces: ['occlusal'], date: '2025-02-03', origin: 'THIS_CLINIC' }] },
      { key: 'B', group: 'DONE', symbol: 'hatch', code: 'existing_crown', outcome: 'IN_PLACE', uses: [{ teeth: ['26'], surfaces: [], date: '2021-11-20', origin: 'EXTERNAL', provider: 'Dr Alaoui' }] },
      { key: 'E', group: 'DONE', symbol: 'ring', name: 'Scaling', actCode: 'D 20', outcome: 'COMPLETED', uses: [{ teeth: [], surfaces: [], date: '2026-09-15', origin: 'THIS_CLINIC', provider: 'Dr Idrissi' }] },
      { key: 'C', group: 'CONDITION', symbol: 'stipple', code: 'caries', outcome: 'ACTIVE', uses: [{ teeth: ['16'], surfaces: ['mesial'], origin: 'THIS_CLINIC' }] },
      { key: 'D', group: 'PLANNED', symbol: 'dashed', code: 'filling_required', outcome: 'REQUIRED', uses: [{ teeth: ['36'], surfaces: ['occlusal'], origin: 'THIS_CLINIC' }] },
    ],
  },
};

describe('TreatmentChartComponent', () => {
  const setUp = async (value: TreatmentPassport = passport) => {
    TestBed.configureTestingModule({
      imports: [TreatmentChartComponent, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('fr', JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', 'fr.json'), 'utf-8')));
    translate.use('fr');
    const fixture = TestBed.createComponent(TreatmentChartComponent);
    fixture.componentRef.setInput('passport', value);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    // jsdom lays nothing out, and the drawing measures its teeth to place what goes on them.
    (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 }) as DOMRect;
  });

  it('sets out what was administered first, then the rest', async () => {
    const fixture = await setUp();
    const headings = [...(fixture.nativeElement as HTMLElement).querySelectorAll('h4')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Soins réalisés', 'Pathologies', 'Soins restant à réaliser']);
  });

  it('says in words what was done, where, when and by whom', async () => {
    const fixture = await setUp();
    const text = (fixture.nativeElement as HTMLElement).querySelector('.legend')?.textContent ?? '';
    expect(text).toContain('Obturation réalisée');
    expect(text).toContain('16 (O)');
    expect(text).toContain('Couronne');
    expect(text).toContain('Dr Alaoui');
    expect(text).toContain('Ailleurs');
    expect(text).toContain('Scaling [D 20]');
    expect(text).toContain('Toute la bouche');
  });

  it('picks out the teeth of the line being pointed at', async () => {
    const fixture = await setUp();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.legend li');
    rows[1].dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(fixture.componentInstance['highlighted']()).toEqual(['26']);
    rows[1].dispatchEvent(new Event('mouseleave'));
    expect(fixture.componentInstance['highlighted']()).toEqual([]);
  });

  it('tells the drawing which teeth had treatment administered and their letters', async () => {
    const fixture = await setUp();
    expect(fixture.componentInstance['doneTeeth']()).toEqual(['16', '26']);
    expect(fixture.componentInstance['keys']()).toEqual({ '16': ['A', 'C'], '26': ['B'], '36': ['D'] });
  });

  it('says so when nothing is recorded', async () => {
    const fixture = await setUp({ ...passport, chart: { dentition: 'adult', teeth: [], legend: [] } });
    expect((fixture.nativeElement as HTMLElement).querySelector('.muted')?.textContent).toContain('Rien d');
  });

  it('has no accessibility violations in the legend', async () => {
    const fixture = await setUp();
    const legend = (fixture.nativeElement as HTMLElement).querySelector('.legend') as HTMLElement;
    const results = await axe.run(legend, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
