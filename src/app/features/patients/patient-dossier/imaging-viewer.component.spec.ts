import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientFile, PatientFilesApi } from '../../../core/services/patient-files-api.service';
import { ImagingViewerComponent, MAX_ZOOM, imagingFiles, zoomAround } from './imaging-viewer.component';

const file = (id: string, createdAt: string, category: PatientFile['category'] = 'XRAY', contentType = 'image/png'): PatientFile =>
  ({ id, name: `${id}.png`, contentType, sizeBytes: 10, createdAt, category });

// Newest first, as the API lists them.
const FILES: PatientFile[] = [
  file('x3', '2026-11-15T10:00:00Z'),
  file('x2', '2026-03-02T10:00:00Z'),
  file('x1', '2025-09-12T10:00:00Z'),
  file('scan', '2026-10-01T10:00:00Z', 'INTRAORAL_3D', 'model/stl'),
  file('photo', '2026-10-01T10:00:00Z', 'IMAGE'),
  file('pdf', '2026-10-01T10:00:00Z', 'XRAY', 'application/pdf'),
];

describe('zoomAround', () => {
  it('keeps what is under the pointer where it is', () => {
    const at = { x: 100, y: -40 };
    const next = zoomAround(1, { x: 0, y: 0 }, 2, at);
    expect(next.zoom).toBe(2);
    expect(next.pan).toEqual({ x: -100, y: 40 });
    // The picture's point that was under the pointer (at / 1) is drawn at pan + 2 × it: still under the pointer.
    expect(next.pan.x + 2 * at.x).toBe(at.x);
    expect(next.pan.y + 2 * at.y).toBe(at.y);
  });

  it('stops at the fitted size, back in the middle, and at the closest', () => {
    expect(zoomAround(1.5, { x: 30, y: 30 }, 0.1, { x: 0, y: 0 })).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
    expect(zoomAround(MAX_ZOOM, { x: 0, y: 0 }, 2, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
});

describe('imagingFiles', () => {
  it('shows pictures of the kind, and 3D models only among the intraoral scans', () => {
    expect(imagingFiles(FILES, 'XRAY').map((f) => f.id)).toEqual(['x3', 'x2', 'x1']);
    expect(imagingFiles(FILES, 'INTRAORAL_3D').map((f) => f.id)).toEqual(['scan']);
  });
});

describe('ImagingViewerComponent', () => {
  let fixture: ComponentFixture<ImagingViewerComponent>;
  let viewer: ImagingViewerComponent;
  let closed: number;
  let created = 0;

  const el = () => fixture.nativeElement as HTMLElement;
  const key = (k: string, target: EventTarget = el()) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  beforeEach(async () => {
    created = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${++created}`, revokeObjectURL: () => undefined }));
    TestBed.configureTestingModule({
      imports: [ImagingViewerComponent, TranslateModule.forRoot()],
      providers: [{ provide: PatientFilesApi, useValue: { blob: async () => new Blob(['x'], { type: 'image/png' }) } }],
    });
    fixture = TestBed.createComponent(ImagingViewerComponent);
    viewer = fixture.componentInstance;
    fixture.componentRef.setInput('files', FILES);
    fixture.componentRef.setInput('startId', 'x2');
    fixture.componentRef.setInput('patientName', 'Salma Bennani');
    closed = 0;
    viewer.closed.subscribe(() => closed++);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens on the picture it was asked for, with every X-ray of the patient in the strip', () => {
    expect(viewer.current()?.id).toBe('x2');
    expect(el().querySelectorAll('.iv-thumb').length).toBe(3);
    expect(el().querySelector('.iv-count')?.textContent).toContain('IMAGING.POSITION');
    expect(el().querySelector('.iv-pane img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(el().getAttribute('role')).toBe('dialog');
  });

  it('goes to the older and the newer one with the arrows, and no further', () => {
    key('ArrowLeft');
    expect(viewer.current()?.id).toBe('x1');
    key('ArrowLeft');
    expect(viewer.current()?.id).toBe('x1');
    key('ArrowRight');
    key('ArrowRight');
    expect(viewer.current()?.id).toBe('x3');
  });

  it('zooms, turns and inverts from the keyboard, and a new picture starts afresh', () => {
    key('+');
    key('r');
    key('i');
    expect(viewer.zoom()).toBeGreaterThan(1);
    expect(viewer.transform()).toContain('rotate(90deg)');
    expect(viewer.filter()).toContain('invert(1)');
    key('ArrowRight');
    expect(viewer.zoom()).toBe(1);
    expect(viewer.transform()).toContain('rotate(0deg)');
    // How the doctor set the light holds from one X-ray to the next.
    expect(viewer.filter()).toContain('invert(1)');
  });

  it('compares with the one taken before, and a thumbnail picks the other side', () => {
    viewer.toggleCompare();
    fixture.detectChanges();
    expect(viewer.compareWith()?.id).toBe('x1');
    expect(el().querySelectorAll('.iv-pane').length).toBe(2);

    viewer.choose(FILES[0]);
    fixture.detectChanges();
    expect(viewer.current()?.id).toBe('x2');
    expect(viewer.compareWith()?.id).toBe('x3');
  });

  it('switches to the intraoral scans, where a 3D model has no picture tools', () => {
    viewer.pick('INTRAORAL_3D');
    fixture.detectChanges();
    expect(viewer.current()?.id).toBe('scan');
    expect(viewer.model()).toBe('model/stl');
    expect(el().querySelector('input[type="range"]')).toBeNull();
  });

  it('closes on Escape, and the arrows on a slider stay the slider’s', () => {
    const slider = el().querySelector<HTMLInputElement>('input[type="range"]')!;
    key('ArrowLeft', slider);
    expect(viewer.current()?.id).toBe('x2');

    const escape = key('Escape');
    expect(closed).toBe(1);
    expect(escape.defaultPrevented).toBe(true);
  });
});
