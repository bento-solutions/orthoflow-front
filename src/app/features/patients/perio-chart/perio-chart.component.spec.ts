import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerioChartDto, PerioChartListItem, SavePerioChartRequest } from '../../../core/clinical/perio/perio.model';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PerioChartService } from '../../../core/services/perio-chart.service';
import { expectNoA11yViolations } from '../../../testing/axe';
import { screenMocks } from '../../../testing/screen-mocks';
import { PerioChartComponent } from './perio-chart.component';

const SUMMARY = {
  sitesRecorded: 0, bleedingPercent: 0, plaquePercent: 0, suppurationPercent: 0, meanPocketDepth: null,
  pocketsAboveFourPercent: null, deepestPocketDepth: null, meanRecession: null, meanCal: null, sitesAboveFiveCalPercent: null,
};

const chart = (over: Partial<PerioChartDto> = {}): PerioChartDto => ({
  id: 'c1', patientId: 'p1', chartDate: '2026-10-01', visitReason: null, clinicalNotes: null, toothStatus: {}, teeth: {},
  version: 0, createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-01T09:00:00Z', summary: SUMMARY, ...over,
});
const item = (c: PerioChartDto): PerioChartListItem => ({
  id: c.id, chartDate: c.chartDate, version: c.version, updatedAt: c.updatedAt, summary: c.summary,
});

/** The real French translations, so a spec can say "no raw key reaches the screen". */
const french = JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', 'fr.json'), 'utf-8'));
const useFrench = (): void => {
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('fr', french);
  translate.use('fr');
};

describe('PerioChartComponent', () => {
  let stored: PerioChartDto[];
  let deleted: PerioChartListItem[];
  let saves: SavePerioChartRequest[];
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let confirm: ReturnType<typeof vi.fn>;
  let mocks: ReturnType<typeof screenMocks>;

  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await vi.advanceTimersByTimeAsync(0);
    }
  };

  const mount = async () => {
    mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [PerioChartComponent, TranslateModule.forRoot()],
      providers: [
        { provide: PerioChartService, useValue: api },
        { provide: ConfirmDialogService, useValue: { confirm } },
        ...mocks.providers,
      ],
    });
    useFrench();
    const fixture = TestBed.createComponent(PerioChartComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    document.body.appendChild(fixture.nativeElement);
    await flush(fixture);
    return fixture;
  };

  const sheet = () => document.querySelector('.sheet') as HTMLElement;
  const press = (key: string) => sheet().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const saveState = () => document.querySelector('.save')?.getAttribute('data-state');

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    localStorage.setItem('orthoflow.perio.tour.v1', 'done');
    stored = [chart()];
    deleted = [];
    saves = [];
    confirm = vi.fn(() => Promise.resolve(true));
    api = {
      list: vi.fn(() => of(stored.map(item))),
      listDeleted: vi.fn(() => of(deleted)),
      get: vi.fn((_: string, id: string) => of(stored.find((c) => c.id === id)!)),
      create: vi.fn(() => {
        const created = chart({ id: 'c2', chartDate: '2026-10-12' });
        stored = [created, ...stored];
        return of(created);
      }),
      save: vi.fn((_: string, id: string, request: SavePerioChartRequest) => {
        saves.push(request);
        return of(chart({ id, version: request.expectedVersion + 1, teeth: request.teeth }));
      }),
      delete: vi.fn(() => of(undefined)),
      restore: vi.fn(() => of(chart())),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('asks for the patient’s charts and opens the most recent one', async () => {
    stored = [chart({ id: 'new', chartDate: '2026-10-01' }), chart({ id: 'old', chartDate: '2026-03-01' })];
    await mount();

    expect(api['list']).toHaveBeenCalledWith('p1');
    expect(api['get']).toHaveBeenCalledWith('p1', 'new');
    expect(sheet()).not.toBeNull();
    expect(document.querySelectorAll('#perio-chart-select option')).toHaveLength(2);
  });

  it('offers to create the first chart when there is none, and opens it', async () => {
    stored = [];
    const fixture = await mount();
    expect(sheet()).toBeNull();
    expect(document.body.textContent).toContain('Aucune charte parodontale');

    (document.querySelector('.pc-empty .btn-primary') as HTMLElement).click();
    await flush(fixture);

    expect(api['create']).toHaveBeenCalledWith('p1', {});
    expect(sheet()).not.toBeNull();
  });

  it('shows the figures of what is already charted', async () => {
    stored = [chart({ teeth: { '16': { pocketDepth: { buccal: 4, mesiobuccal: 6 }, bleeding: ['buccal'] } } })];
    await mount();

    const figures = [...document.querySelectorAll('.figure .value')].map((v) => v.textContent?.trim());
    expect(figures).toEqual(['50.0%', '0.0%', '0.0%', '5.0 mm', '100.0%', '6.0 mm']);
  });

  it('saves a moment after the last keystroke, on the version it was loaded at, with only what was charted', async () => {
    const fixture = await mount();
    press('3');
    press('4');
    await flush(fixture);

    expect(saveState()).toBe('dirty');
    expect(api['save']).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(899);
    expect(api['save']).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flush(fixture);

    expect(api['save']).toHaveBeenCalledTimes(1);
    expect(saves[0]).toMatchObject({
      expectedVersion: 0, chartDate: '2026-10-01', toothStatus: {},
      teeth: { '18': { pocketDepth: { distobuccal: 3, buccal: 4 } } },
    });
    expect(saveState()).toBe('saved');
  });

  it('builds the next save on the version the last one returned', async () => {
    const fixture = await mount();
    press('3');
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);
    press('2');
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);

    expect(saves.map((s) => s.expectedVersion)).toEqual([0, 1]);
  });

  it('sends a burst of keystrokes as one save', async () => {
    const fixture = await mount();
    for (const key of '34543') {
      press(key);
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);

    expect(api['save']).toHaveBeenCalledTimes(1);
    expect(Object.keys(saves[0].teeth['18'].pocketDepth!)).toHaveLength(3);
    expect(saves[0].teeth['17']).toBeDefined();
  });

  it('sets a refused save apart from a chart someone else changed', async () => {
    api['save'].mockImplementationOnce(() => throwError(() => ({ status: 409 })));
    const fixture = await mount();
    press('3');
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);

    expect(saveState()).toBe('conflict');
    expect(document.querySelector('.conflict')).not.toBeNull();

    // typing on does not hammer the server
    press('4');
    await vi.advanceTimersByTimeAsync(5000);
    await flush(fixture);
    expect(api['save']).toHaveBeenCalledTimes(1);

    // reloading shows the other screen's chart and drops this one's edits
    stored = [chart({ version: 5, teeth: { '11': { pocketDepth: { buccal: 2 } } } })];
    (document.querySelector('.conflict button') as HTMLElement).click();
    await flush(fixture);

    expect(document.querySelector('.conflict')).toBeNull();
    expect(saveState()).toBe('idle');
    press('2');
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);
    expect(saves.at(-1)?.expectedVersion).toBe(5);
  });

  it('offers a retry when the save fails, and keeps what was typed', async () => {
    api['save'].mockImplementationOnce(() => throwError(() => ({ status: 500 })));
    const fixture = await mount();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    press('3');
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);

    expect(saveState()).toBe('error');
    (document.querySelector('.save .link') as HTMLElement).click();
    await flush(fixture);

    expect(api['save']).toHaveBeenCalledTimes(2);
    expect(saves[0].teeth['18'].pocketDepth).toEqual({ distobuccal: 3 }); // the first attempt failed, so this is the retry
    expect(saveState()).toBe('saved');
    errors.mockRestore();
  });

  it('clears a tooth that is marked missing, and says so to the server', async () => {
    stored = [chart({ teeth: { '16': { pocketDepth: { buccal: 4 } }, '15': { pocketDepth: { buccal: 3 } } } })];
    const fixture = await mount();

    const chip = [...document.querySelectorAll('button.chip')].find((b) => b.textContent?.trim().startsWith('16')) as HTMLElement;
    chip.click();
    fixture.detectChanges();
    (document.querySelector('.popover .option.missing') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);

    expect(saves[0].toothStatus).toEqual({ '16': 'missing' });
    expect(saves[0].teeth).toEqual({ '15': { pocketDepth: { buccal: 3 } } });
  });

  it('keeps the visit’s date, reason and notes with the chart', async () => {
    const fixture = await mount();
    (document.querySelector('.visit summary') as HTMLElement).click();
    const reason = document.querySelector('.visit input[type=text]') as HTMLInputElement;
    reason.value = 'Contrôle gingival';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(900);
    await flush(fixture);

    expect(saves[0]).toMatchObject({ visitReason: 'Contrôle gingival', clinicalNotes: null });
  });

  it('sends what is waiting before it opens another chart', async () => {
    stored = [chart({ id: 'a', chartDate: '2026-10-01' }), chart({ id: 'b', chartDate: '2026-03-01' })];
    const fixture = await mount();
    press('3');
    await flush(fixture);

    const select = document.querySelector('#perio-chart-select') as HTMLSelectElement;
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(fixture);

    expect(api['save']).toHaveBeenCalledWith('p1', 'a', expect.objectContaining({ expectedVersion: 0 }));
    expect(api['get']).toHaveBeenLastCalledWith('p1', 'b');
    expect(api['save'].mock.invocationCallOrder[0]).toBeLessThan(api['get'].mock.invocationCallOrder.at(-1)!);
  });

  it('starts a new chart on request', async () => {
    const fixture = await mount();
    (document.querySelector('.controls .btn') as HTMLElement).click();
    await flush(fixture);

    expect(api['create']).toHaveBeenCalledWith('p1', {});
    expect(document.querySelectorAll('#perio-chart-select option')).toHaveLength(2);
  });

  it('deletes a chart only after a confirmation, and lists what can be restored', async () => {
    const fixture = await mount();
    confirm.mockResolvedValueOnce(false);
    (document.querySelector('.menu-wrap button') as HTMLElement).click();
    fixture.detectChanges();
    (document.querySelector('.menu .danger') as HTMLElement).click();
    await flush(fixture);
    expect(api['delete']).not.toHaveBeenCalled();

    (document.querySelector('.menu-wrap button') as HTMLElement).click();
    fixture.detectChanges();
    (document.querySelector('.menu .danger') as HTMLElement).click();
    await flush(fixture);
    expect(api['delete']).toHaveBeenCalledWith('p1', 'c1');
    expect(mocks.toasts.map((t) => t.kind)).toContain('success');
  });

  it('shows the first-use tour once', async () => {
    localStorage.removeItem('orthoflow.perio.tour.v1');
    const fixture = await mount();
    expect(document.querySelector('app-perio-tour [role=dialog]')).not.toBeNull();

    ([...document.querySelectorAll('app-perio-tour button')].find((b) => /Passer/.test(b.textContent ?? '')) as HTMLElement).click();
    await flush(fixture);
    expect(document.querySelector('app-perio-tour [role=dialog]')).toBeNull();
    expect(localStorage.getItem('orthoflow.perio.tour.v1')).toBe('done');
  });

  it('remembers which tooth numbering the clinician prefers', async () => {
    const fixture = await mount();
    ([...document.querySelectorAll('.toggle button')].find((b) => b.textContent?.includes('1-32')) as HTMLElement).click();
    await flush(fixture);

    expect(localStorage.getItem('orthoflow.perio.numbering')).toBe('universal');
    expect(document.querySelector('button.chip span')?.textContent).toBe('1');
  });

  it('shows no raw translation key', async () => {
    await mount();
    expect(document.body.textContent).not.toMatch(/\bPERIO\.[A-Z_.]+/);
  });

  it('has no accessibility violations', async () => {
    await mount();
    vi.useRealTimers(); // axe schedules its own work
    await expectNoA11yViolations(document.body);
  }, 60_000);
});

