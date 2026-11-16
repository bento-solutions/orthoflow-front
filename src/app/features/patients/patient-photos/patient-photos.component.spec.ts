import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screenMocks } from '../../../testing/screen-mocks';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { ClinicalPhotoApi, PHOTO_STAGES, PhotoSeries } from '../../../core/services/clinical-photo-api.service';
import { PatientFile, PatientFilesApi } from '../../../core/services/patient-files-api.service';
import { PatientPhotosComponent, VIEW_GROUPS } from './patient-photos.component';

const series = (over: Partial<PhotoSeries> = {}): PhotoSeries => ({
  id: 's1', patientId: 'p1', stage: 'INITIAL', takenOn: '2026-01-10', note: '', createdAt: '2026-01-10T09:00:00Z', photos: [], ...over,
});
const photo = (view: PhotoSeries['photos'][number]['view'], fileId: string) =>
  ({ view, fileId, name: `${view}.jpg`, contentType: 'image/jpeg', sizeBytes: 10, uploadedAt: '2026-01-10T09:00:00Z' });

describe('PatientPhotosComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let files: { list: ReturnType<typeof vi.fn>; blob: ReturnType<typeof vi.fn>; version: ReturnType<typeof signal<number>> };
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;

  const mount = async (can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks(can);
    TestBed.configureTestingModule({
      imports: [PatientPhotosComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ClinicalPhotoApi, useValue: api },
        { provide: PatientFilesApi, useValue: files },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(PatientPhotosComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    document.body.appendChild(fixture.nativeElement);
    await settle(fixture);
    return fixture;
  };
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    confirmAnswer = true;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:photo');
    globalThis.URL.revokeObjectURL = vi.fn();
    api = {
      list: vi.fn(async () => [] as PhotoSeries[]),
      create: vi.fn(async (_p: string, body: { stage: PhotoSeries['stage']; takenOn: string }) => series({ id: 'new', ...body })),
      update: vi.fn(),
      delete: vi.fn(async () => undefined),
      upload: vi.fn(async () => series({ photos: [photo('SMILE', 'f1')] })),
      removePhoto: vi.fn(async () => series()),
      image: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
    };
    files = {
      list: vi.fn(async () => [] as PatientFile[]),
      blob: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
      version: signal(0),
    };
  });

  const doc = (over: Partial<PatientFile> = {}): PatientFile => ({
    id: 'd1', name: 'panoramique.png', contentType: 'image/png', sizeBytes: 10, createdAt: '2026-11-16T10:00:00Z', category: 'XRAY', ...over,
  });

  it('shows the X-rays and images uploaded in Documents, even before any sitting', async () => {
    files.list.mockResolvedValue([
      doc(),
      doc({ id: 'd2', name: 'smile.jpg', contentType: 'image/jpeg', category: 'IMAGE', createdAt: '2026-11-17T10:00:00Z' }),
      doc({ id: 'd3', name: 'arch.stl', contentType: 'model/stl', category: 'INTRAORAL_3D' }),
    ]);
    await mount();

    const tiles = [...document.querySelectorAll('.doc-tile')];
    // Pictures only, newest first; a 3D scan is not a picture this tab can show.
    expect(tiles.map(t => t.querySelector('img')?.getAttribute('alt'))).toEqual(['smile.jpg', 'panoramique.png']);
    expect(document.querySelector('.empty-title')?.textContent).toContain('PATIENTS.PHOTOS.NO_SERIES_TITLE');
    expect(button('PATIENTS.PHOTOS.START_INITIAL')).toBeTruthy();
  });

  it('keeps the usual empty state when Documents has no picture either', async () => {
    await mount();

    expect(document.querySelector('.docs')).toBeNull();
    expect(document.querySelector('.empty-title')?.textContent).toContain('PATIENTS.PHOTOS.EMPTY_TITLE');
  });

  it('puts an X-ray from Documents into the panoramic slot without choosing the file again', async () => {
    files.list.mockResolvedValue([doc({ id: 'img', name: 'face.jpg', contentType: 'image/jpeg', category: 'IMAGE' }), doc()]);
    api['list'].mockResolvedValue([series()]);
    api['upload'].mockResolvedValue(series({ photos: [photo('PANORAMIC_XRAY', 'f9')] }));
    const fixture = await mount();

    const slot = [...document.querySelectorAll('.slot')].find(el => el.textContent?.includes('PATIENTS.PHOTOS.VIEWS.PANORAMIC_XRAY'))!;
    ([...slot.querySelectorAll('button')].find(b => b.textContent?.includes('PATIENTS.PHOTOS.FROM_DOCS')) as HTMLButtonElement).click();
    await settle(fixture);

    // The X-ray comes first for a radiograph slot.
    const items = [...document.querySelectorAll<HTMLButtonElement>('.picker-item')];
    expect(items.map(i => i.querySelector('.picker-name')?.textContent)).toEqual(['panoramique.png', 'face.jpg']);
    items[0].click();
    await settle(fixture);

    expect(files.blob).toHaveBeenCalledWith('d1');
    const [seriesId, view, file] = api['upload'].mock.calls[0];
    expect(seriesId).toBe('s1');
    expect(view).toBe('PANORAMIC_XRAY');
    expect((file as File).name).toBe('panoramique.png');
    expect((file as File).type).toBe('image/png');
    expect(document.querySelector('.picker')).toBeNull();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('offers to start the initial records when the patient has none', async () => {
    const fixture = await mount();

    button('PATIENTS.PHOTOS.START_INITIAL')!.click();
    await settle(fixture);

    expect(api['create']).toHaveBeenCalledWith('p1', expect.objectContaining({ stage: 'INITIAL' }));
    // The new series is open with all ten views waiting for a picture.
    expect(document.querySelectorAll('.slot').length).toBe(10);
    expect(document.querySelectorAll('img.guide').length).toBe(10);
  });

  it('shows the pictures a series has and the guide for the views it lacks', async () => {
    api['list'].mockResolvedValue([series({ photos: [photo('SMILE', 'f1'), photo('PANORAMIC_XRAY', 'f2')] })]);
    await mount();

    expect(api['image']).toHaveBeenCalledWith('f1');
    expect(api['image']).toHaveBeenCalledWith('f2');
    expect(document.querySelectorAll('.frame-btn img').length).toBe(2);
    expect(document.querySelectorAll('img.guide').length).toBe(8);
    expect(document.querySelector('.meta-progress')?.textContent).toContain('PATIENTS.PHOTOS.PROGRESS');
  });

  it('uploads a chosen picture into its view', async () => {
    api['list'].mockResolvedValue([series()]);
    const fixture = await mount();

    const input = document.querySelector<HTMLInputElement>('.slot input[type=file]')!;
    const file = new File(['x'], 'smile.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(api['upload']).toHaveBeenCalledWith('s1', 'SMILE', file);
    expect(document.querySelectorAll('.frame-btn img').length).toBe(1);
  });

  it('refuses a file that is not a picture without calling the server', async () => {
    api['list'].mockResolvedValue([series()]);
    const fixture = await mount();

    await fixture.componentInstance.upload('SMILE', new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));

    expect(api['upload']).not.toHaveBeenCalled();
    expect(mocks.toasts).toEqual([{ kind: 'error', message: 'PATIENTS.PHOTOS.ONLY_IMAGES' }]);
  });

  it('lets someone without the clinical write permission look but not change anything', async () => {
    api['list'].mockResolvedValue([series({ photos: [photo('SMILE', 'f1')] })]);
    await mount({ can: ['CLINICAL_READ'] });

    expect(document.querySelectorAll('input[type=file]').length).toBe(0);
    expect(button('PATIENTS.PHOTOS.NEW_SERIES')).toBeUndefined();
    expect(button('PATIENTS.PHOTOS.DELETE_SERIES')).toBeUndefined();
  });

  it('compares the selected sitting with the oldest one', async () => {
    api['list'].mockResolvedValue([
      series({ id: 'final', stage: 'FINAL', takenOn: '2026-09-01', photos: [photo('SMILE', 'after')] }),
      series({ id: 'initial', stage: 'INITIAL', takenOn: '2026-01-10', photos: [photo('SMILE', 'before')] }),
    ]);
    const fixture = await mount();

    button('PATIENTS.PHOTOS.COMPARE')!.click();
    await settle(fixture);

    expect(fixture.componentInstance.compareId()).toBe('initial');
    expect(api['image']).toHaveBeenCalledWith('before');
    expect(document.querySelectorAll('.compare-img img').length).toBe(2);
  });
});

describe('photo translations', () => {
  const load = (lang: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', `${lang}.json`), 'utf-8')).PATIENTS.PHOTOS as Record<string, unknown>;
  const built = [
    ...VIEW_GROUPS.flatMap(g => g.slots.map(s => `VIEWS.${s.view}`)),
    ...VIEW_GROUPS.map(g => `GROUPS.${g.key}`),
    ...PHOTO_STAGES.map(s => `STAGES.${s}`),
  ];

  for (const lang of ['fr', 'en', 'ar']) {
    it(`${lang} has every view, group and stage label`, () => {
      const keys = load(lang);
      expect(built.filter(k => !k.split('.').reduce<unknown>((n, part) => (n as Record<string, unknown>)?.[part], keys))).toEqual([]);
    });
  }

  it('covers every view the server knows', () => {
    expect(VIEW_GROUPS.flatMap(g => g.slots).length).toBe(10);
  });
});
