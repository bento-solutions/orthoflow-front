import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientFile, PatientFilesApi } from '../../../core/services/patient-files-api.service';
import { PatientImagingPaneComponent } from './patient-imaging-pane.component';

const FILES: PatientFile[] = [
  { id: 'x2', name: 'pano-2026.png', contentType: 'image/png', sizeBytes: 10, createdAt: '2026-11-15T10:00:00Z', category: 'XRAY' },
  { id: 'x1', name: 'pano-2025.png', contentType: 'image/png', sizeBytes: 10, createdAt: '2025-09-12T10:00:00Z', category: 'XRAY' },
];

/**
 * The pane beside the 3D chart. Its "Open" button and a click on the X-ray must open the
 * full-screen reading viewer over the page, not just put the browser in full screen.
 */
describe('PatientImagingPaneComponent', () => {
  let fixture: ComponentFixture<PatientImagingPaneComponent>;
  let pane: PatientImagingPaneComponent;
  const el = () => fixture.nativeElement as HTMLElement;

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: () => undefined }));
    TestBed.configureTestingModule({
      imports: [PatientImagingPaneComponent, TranslateModule.forRoot()],
      providers: [{
        provide: PatientFilesApi,
        useValue: { version: signal(0), list: async () => FILES, blob: async () => new Blob(['x'], { type: 'image/png' }) },
      }],
    });
    fixture = TestBed.createComponent(PatientImagingPaneComponent);
    pane = fixture.componentInstance;
    fixture.componentRef.setInput('patientId', 'p1');
    fixture.componentRef.setInput('patientName', 'Salma Bennani');
    await settle();
    await settle();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens the reading viewer on the X-ray shown, and closes it again', async () => {
    expect(el().querySelector('app-imaging-viewer')).toBeNull();
    const open = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.includes('IMAGING.OPEN'));
    expect(open).toBeTruthy();
    open!.click();
    await settle();

    const viewer = el().querySelector('app-imaging-viewer');
    expect(viewer).not.toBeNull();
    expect(viewer!.getAttribute('role')).toBe('dialog');
    expect(viewer!.textContent).toContain('Salma Bennani');

    (viewer!.querySelector('.iv-close') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelector('app-imaging-viewer')).toBeNull();
    expect(pane.viewing()).toBeNull();
  });

  it('opens the viewer from a click on the picture too', async () => {
    (el().querySelector('button.cursor-zoom-in') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelector('app-imaging-viewer')).not.toBeNull();
  });

  it('passes the viewer\'s way to the 3D chart window up', async () => {
    let asked = 0;
    pane.openChart.subscribe(() => asked++);
    pane.openViewer();
    await settle();
    const chart = Array.from(el().querySelectorAll('app-imaging-viewer button')).find((b) => b.textContent?.includes('IMAGING.CHART'));
    (chart as HTMLButtonElement).click();
    expect(asked).toBe(1);
  });
});
