import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgApexchartsModule } from 'ng-apexcharts';
import { beforeEach, describe, expect, it } from 'vitest';
import { PerioChartListItem, PerioSummary } from '../../../core/clinical/perio/perio.model';
import { PerioProgressionComponent } from './perio-progression.component';
import { hasProgression, progressionPoints, trendsOf } from './perio-progression';

const summary = (over: Partial<PerioSummary> = {}): PerioSummary => ({
  sitesRecorded: 12, bleedingPercent: 40, plaquePercent: 30, suppurationPercent: 5, meanPocketDepth: 4.2,
  pocketsAboveFourPercent: 50, deepestPocketDepth: 7, meanRecession: 1, meanCal: 5.2, sitesAboveFiveCalPercent: 25, ...over,
});
const chart = (id: string, chartDate: string, over: Partial<PerioSummary> = {}, updatedAt = `${chartDate}T10:00:00Z`): PerioChartListItem => ({
  id, chartDate, version: 1, updatedAt, summary: summary(over),
});

describe('perio progression', () => {
  it('orders the examinations oldest first, whatever order they come in', () => {
    const points = progressionPoints([chart('b', '2026-06-01'), chart('a', '2026-01-01'), chart('c', '2026-10-01')]);
    expect(points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders two examinations of the same day by when they were last saved', () => {
    const points = progressionPoints([chart('late', '2026-06-01', {}, '2026-06-01T16:00:00Z'), chart('early', '2026-06-01', {}, '2026-06-01T09:00:00Z')]);
    expect(points.map((p) => p.id)).toEqual(['early', 'late']);
  });

  it('leaves out a chart with nothing on it: it is not an examination', () => {
    const points = progressionPoints([chart('empty', '2026-02-01', { sitesRecorded: 0 }), chart('real', '2026-03-01')]);
    expect(points.map((p) => p.id)).toEqual(['real']);
  });

  it('needs two examinations to show a trend', () => {
    expect(hasProgression(progressionPoints([chart('a', '2026-01-01')]))).toBe(false);
    expect(hasProgression(progressionPoints([chart('a', '2026-01-01'), chart('b', '2026-02-01')]))).toBe(true);
  });

  it('draws the six trends a periodontist looks at, one value per examination', () => {
    const trends = trendsOf(progressionPoints([
      chart('a', '2026-01-01', { bleedingPercent: 60, meanPocketDepth: 5, meanCal: 6 }),
      chart('b', '2026-06-01', { bleedingPercent: 20, meanPocketDepth: 3, meanCal: 4 }),
    ]));

    expect(trends.map((t) => t.key)).toEqual(['PERCENT', 'DEPTH', 'DEEP', 'CAL', 'RECESSION', 'SEVERE']);
    expect(trends[0].series.find((s) => s.metric === 'BLEEDING')?.values).toEqual([60, 20]);
    expect(trends[1].series.find((s) => s.metric === 'MEAN_DEPTH')?.values).toEqual([5, 3]);
    expect(trends[3].series[0].values).toEqual([6, 4]);
    expect(trends.filter((t) => t.unit === '%').map((t) => t.key)).toEqual(['PERCENT', 'DEEP', 'SEVERE']);
  });

  it('keeps a gap where an examination has no value, rather than drawing a zero', () => {
    const trends = trendsOf(progressionPoints([
      chart('a', '2026-01-01', { meanCal: null }),
      chart('b', '2026-06-01', { meanCal: 4 }),
    ]));
    expect(trends[3].series[0].values).toEqual([null, 4]);
  });

  it('colours bleeding, plaque and suppuration as the chart does', () => {
    const [percent] = trendsOf(progressionPoints([chart('a', '2026-01-01'), chart('b', '2026-02-01')]));
    expect(percent.series.map((s) => s.color)).toEqual(['#dc2626', '#6d28d9', '#d97706']);
  });
});

@Component({ selector: 'apx-chart', standalone: true, template: '<div class="apx-stub"></div>' })
class ApexStub {
  @Input() series: unknown;
  @Input() chart: unknown;
  @Input() xaxis: unknown;
  @Input() yaxis: unknown;
  @Input() stroke: unknown;
  @Input() colors: unknown;
  @Input() dataLabels: unknown;
  @Input() grid: unknown;
  @Input() tooltip: unknown;
  @Input() legend: unknown;
  @Input() markers: unknown;
}

describe('PerioProgressionComponent', () => {
  const french = JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', 'fr.json'), 'utf-8'));

  const mount = (charts: PerioChartListItem[]) => {
    TestBed.configureTestingModule({ imports: [PerioProgressionComponent, TranslateModule.forRoot()] });
    TestBed.overrideComponent(PerioProgressionComponent, { remove: { imports: [NgApexchartsModule] }, add: { imports: [ApexStub] } });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('fr', french);
    translate.use('fr');
    const fixture = TestBed.createComponent(PerioProgressionComponent);
    fixture.componentRef.setInput('charts', charts);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('says what is missing when there is nothing to compare yet', () => {
    mount([chart('only', '2026-01-01')]);

    expect(document.querySelector('.few')?.textContent).toContain('Pas assez de données');
    expect(document.querySelector('.few .one')).not.toBeNull();
    expect(document.querySelectorAll('.trend')).toHaveLength(0);
  });

  it('draws six trends once there are two examinations, titled and dated', () => {
    mount([chart('a', '2026-01-01'), chart('b', '2026-06-01')]);

    const titles = [...document.querySelectorAll('.trend h4')].map((h) => h.textContent?.trim());
    expect(titles).toEqual([
      'Saignement, plaque, suppuration', 'Profondeur des poches', 'Poches profondes',
      'Niveau d’attache clinique', 'Récession', 'Perte d’attache sévère',
    ]);
    expect(document.querySelector('header p')?.textContent).toContain('2 chartes');
    expect(document.body.textContent).not.toMatch(/PERIO\./);
  });
});
