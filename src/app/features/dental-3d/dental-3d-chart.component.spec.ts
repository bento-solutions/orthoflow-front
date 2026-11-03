import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DentalChartState } from '../../core/models/patient.model';
import { Dental3dChartComponent } from './dental-3d-chart.component';

const chart: DentalChartState = {
  patientId: 'p1',
  chartType: 'adult',
  lastUpdated: '2026-11-03T10:00:00Z',
  teeth: { '16': { id: '16', status: 'caries' } },
};

/**
 * What can be checked here is what must hold when the graphics card cannot be used,
 * which is also what this test environment is: charting carries on with the 2D chart.
 * The drawing itself is checked in a browser (see docs/DENTAL-3D-CHART.md).
 */
describe('Dental3dChartComponent without WebGL', () => {
  let fixture: ComponentFixture<Dental3dChartComponent>;
  let ref: ComponentRef<Dental3dChartComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Dental3dChartComponent, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Dental3dChartComponent);
    ref = fixture.componentRef;
    ref.setInput('chart', chart);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('falls back to the interactive 2D chart and says why', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('app-dental-chart')).not.toBeNull();
    expect(element.querySelector('.d3-note')?.textContent).toContain('DENTAL_3D.UNAVAILABLE');
    expect(element.querySelector('.d3-stage')).toBeNull();
  });
});
