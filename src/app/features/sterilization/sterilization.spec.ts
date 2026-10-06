import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { OperationsApi } from '../../core/services/operations-api.service';
import { Cycle, CycleSummary, EndoKit, SterilItem, SterilizationApi, TraceEntry } from '../../core/services/sterilization-api.service';
import { SCAN_STARTER, QrScannerComponent, ScanSession, ScanStarter, denied } from '../../shared/ui/qr-scanner.component';
import { screenMocks } from '../../testing/screen-mocks';
import { candidateAppointments, stateTone } from './item-actions.component';
import { ScanComponent, addToBasket, loadableItems } from './scan.component';
import { SterilizationCyclesComponent, eligible, nowLocal, resultTone, warningKey } from './sterilization-cycles.component';
import { SterilizationDashboardComponent, needsAttention } from './sterilization-dashboard.component';
import { SterilizationEndoComponent, wear } from './sterilization-endo.component';
import { SterilizationHandoff } from './sterilization-handoff.service';
import { SterilizationItemsComponent, stillListed } from './sterilization-items.component';
import { SterilizationTraceComponent, byDay } from './sterilization-trace.component';

const item = (over: Partial<SterilItem> = {}): SterilItem => ({
  id: 'i1', code: 'KIT-1', name: 'Plateau de soins', kind: 'TRAY', state: 'READY', stateChangedAt: '2026-10-06T09:00:00Z', serialNumber: '', notes: '', active: true, lastUsedAt: '' as never,
  lastLubricatedAt: '' as never, lubricationDue: false, lastCycleId: '' as never, nextActions: ['USE'], ...over,
});

describe('sterilization helpers', () => {
  it('colours states by what they ask of the team', () => {
    expect(stateTone('READY')).toBe('pill-done');
    expect(stateTone('USED')).toBe('pill-critical');
    expect(stateTone('DIRTY')).toBe('pill-attention');
    expect(stateTone('PROCESSED')).toBe('pill-active');
  });

  it('offers today\'s appointments of the patient, the one under way first and none that are over', () => {
    const all = [
      { id: 'a', patientId: 'p', status: 'SCHEDULED', dateTime: '2026-10-06T15:00:00Z' }, { id: 'b', patientId: 'p', status: 'IN_CHAIR', dateTime: '2026-10-06T09:00:00Z' },
      { id: 'c', patientId: 'p', status: 'COMPLETED', dateTime: '2026-10-06T08:00:00Z' }, { id: 'd', patientId: 'other', status: 'IN_CHAIR', dateTime: '2026-10-06T09:00:00Z' },
    ];
    expect(candidateAppointments(all as never, 'p').map(a => a.id)).toEqual(['b', 'a']);
  });

  it('keeps one entry per scanned item, the latest scan first', () => {
    const a = item({ id: 'a' });
    const b = item({ id: 'b' });
    expect(addToBasket([a], b).map(i => i.id)).toEqual(['b', 'a']);
    expect(addToBasket([b, a], a).map(i => i.id)).toEqual(['a', 'b']);
  });

  it('loads only what is waiting to be sterilised', () => {
    const dirty = item({ id: 'd', state: 'DIRTY', nextActions: ['ADD_TO_CYCLE'] });
    const ready = item({ id: 'r' });
    expect(loadableItems([dirty, ready]).map(i => i.id)).toEqual(['d']);
    expect(eligible([dirty, item({ id: 'x', active: false, nextActions: ['ADD_TO_CYCLE'] })]).map(i => i.id)).toEqual(['d']);
  });

  it('drops from a selection what is no longer in the list', () => {
    expect(stillListed(new Set(['a', 'z']), [{ id: 'a' }, { id: 'b' }])).toEqual(['a']);
  });

  it('flags a dashboard that has anything for a person to do', () => {
    expect(needsAttention({ lubricationDue: [], shelfLifeExceeded: [], pendingControls: [], endoAlerts: [] })).toBe(false);
    expect(needsAttention({ lubricationDue: [item()], shelfLifeExceeded: [], pendingControls: [], endoAlerts: [] })).toBe(true);
  });

  it('colours a failed control as a problem', () => {
    expect(resultTone('FAILED')).toBe('pill-critical');
    expect(resultTone('PASSED')).toBe('pill-done');
    expect(resultTone('PENDING')).toBe('pill-attention');
  });

  it('recognises the one server warning it can translate and passes the rest through', () => {
    expect(warningKey('Handpiece HP-3 has not been lubricated since it was last used')).toEqual({ key: 'STER.WARNINGS.NOT_LUBRICATED', params: { code: 'HP-3' } });
    expect(warningKey('Something else')).toBeNull();
  });

  it('writes the time for a datetime-local field', () => {
    expect(nowLocal(new Date(2026, 9, 6, 9, 5))).toBe('2026-10-06T09:05');
  });

  it('names a file\'s wear', () => {
    expect(wear({ atLimit: true, nearLimit: true })).toBe('LIMIT');
    expect(wear({ atLimit: false, nearLimit: true })).toBe('NEAR');
    expect(wear({ atLimit: false, nearLimit: false })).toBe('OK');
  });

  it('groups a history by day, newest first', () => {
    const e = (id: string, at: string) => ({ eventId: id, at }) as TraceEntry;
    const days = byDay([e('1', '2026-10-05T10:00:00Z'), e('2', '2026-10-06T08:00:00Z'), e('3', '2026-10-06T12:00:00Z')]);
    expect(days.map(d => d.day)).toEqual(['2026-10-06', '2026-10-05']);
    expect(days[0].entries.map(x => x.eventId)).toEqual(['3', '2']);
  });

  it('tells a refused camera from a missing one', () => {
    expect(denied({ name: 'NotAllowedError' })).toBe(true);
    expect(denied({ name: 'NotFoundError' })).toBe(false);
    expect(denied(null)).toBe(false);
  });
});

@Component({ standalone: true, imports: [QrScannerComponent], template: `<app-qr-scanner [active]="on()" (scanned)="codes.push($event)" />` })
class ScannerHost {
  on = signal(false);
  codes: string[] = [];
}

describe('QrScannerComponent', () => {
  let stopped: number;
  let emit: (text: string) => void;
  let starter: ReturnType<typeof vi.fn>;

  const mount = (start: ScanStarter) => {
    TestBed.configureTestingModule({ imports: [ScannerHost, TranslateModule.forRoot()], providers: [{ provide: SCAN_STARTER, useValue: start }] });
    const fixture = TestBed.createComponent(ScannerHost);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  };
  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    stopped = 0;
    starter = vi.fn(async (_video: HTMLVideoElement, onCode: (t: string) => void): Promise<ScanSession> => {
      emit = onCode;
      return { stop: () => stopped++ };
    });
  });

  it('does not touch the camera until it is switched on, and releases it when switched off', async () => {
    const fixture = mount(starter as ScanStarter);
    await flush(fixture);
    expect(starter).not.toHaveBeenCalled();
    fixture.componentInstance.on.set(true);
    await flush(fixture);
    expect(starter).toHaveBeenCalledTimes(1);
    fixture.componentInstance.on.set(false);
    await flush(fixture);
    expect(stopped).toBe(1);
  });

  it('reports a code once even when the same label is read many times a second', async () => {
    const fixture = mount(starter as ScanStarter);
    fixture.componentInstance.on.set(true);
    await flush(fixture);
    emit('STER-ABC');
    emit('STER-ABC');
    emit('STER-ABC');
    emit('STER-XYZ');
    expect(fixture.componentInstance.codes).toEqual(['STER-ABC', 'STER-XYZ']);
  });

  it('stops the camera when the screen goes away', async () => {
    const fixture = mount(starter as ScanStarter);
    fixture.componentInstance.on.set(true);
    await flush(fixture);
    fixture.destroy();
    expect(stopped).toBe(1);
  });

  it('says so when permission is refused, and when there is no camera', async () => {
    const refused = mount(vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); }) as ScanStarter);
    refused.componentInstance.on.set(true);
    await flush(refused);
    expect(document.querySelector('[role=alert]')!.textContent).toContain('STER.SCAN.DENIED');
    refused.destroy();
    TestBed.resetTestingModule();
    document.body.innerHTML = '';

    const missing = mount(vi.fn(async () => { throw new Error('none'); }) as ScanStarter);
    missing.componentInstance.on.set(true);
    await flush(missing);
    expect(document.querySelector('[role=alert]')!.textContent).toContain('STER.SCAN.NO_CAMERA');
  });

  it('stops a camera that finished starting after it was switched off', async () => {
    let finish!: (s: ScanSession) => void;
    const slow = vi.fn(() => new Promise<ScanSession>(resolve => { finish = resolve; }));
    const fixture = mount(slow as unknown as ScanStarter);
    fixture.componentInstance.on.set(true);
    await flush(fixture);
    fixture.componentInstance.on.set(false);
    await flush(fixture);
    finish({ stop: () => stopped++ });
    await new Promise(resolve => setTimeout(resolve));
    expect(stopped).toBe(1);
  });
});

describe('sterilization screens', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;

  const setup = (component: unknown, extra: unknown[] = []) => {
    mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [component as never, TranslateModule.forRoot()],
      providers: [
        provideRouter([{ path: '**', component: ScannerHost }]),
        { provide: SterilizationApi, useValue: api },
        { provide: OperationsApi, useValue: { upcomingAppointments: vi.fn(async () => []) } },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: DownloadService, useValue: { open: vi.fn(async () => undefined) } },
        { provide: SCAN_STARTER, useValue: vi.fn(async () => ({ stop: () => undefined })) },
        ...extra as never[],
        ...mocks.providers,
      ],
    });
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const mount = async <T>(type: new () => T) => {
    const fixture = TestBed.createComponent(type);
    document.body.appendChild(fixture.nativeElement);
    await settleUi(fixture);
    await settleUi(fixture);
    return fixture;
  };
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  const type = (el: Element | null, value: string) => {
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmAnswer = true;
    api = {};
  });

  describe('scan', () => {
    beforeEach(() => {
      api['scan'] = vi.fn(async (code: string) => (code === 'DIRTY-1' ? item({ id: 'd1', code: 'DIRTY-1', state: 'DIRTY', nextActions: ['ADD_TO_CYCLE'] }) : item()));
      api['cleanItem'] = vi.fn(async () => item({ state: 'DIRTY', nextActions: ['ADD_TO_CYCLE'] }));
      api['useItem'] = vi.fn(async () => item({ state: 'USED', nextActions: ['CLEAN'] }));
      setup(ScanComponent);
    });

    it('finds an item by the code typed and offers what that state allows', async () => {
      const fixture = await mount(ScanComponent);
      type(document.querySelector('input[name=code]'), 'KIT-1');
      await settleUi(fixture);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['scan']).toHaveBeenCalledWith('KIT-1');
      expect(document.body.textContent).toContain('Plateau de soins');
      expect(buttonWith('STER.ACTIONS.USE')).toBeDefined();
      expect(buttonWith('STER.ACTIONS.CLEAN')).toBeUndefined();
    });

    it('reports a code nobody knows and keeps the list as it was', async () => {
      api['scan'].mockRejectedValueOnce(new Error('404'));
      const fixture = await mount(ScanComponent);
      type(document.querySelector('input[name=code]'), 'NOPE');
      await settleUi(fixture);
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(mocks.errors).toHaveLength(1);
      expect(document.querySelectorAll('li.card')).toHaveLength(0);
    });

    it('hands the items ready for the autoclave to the cycles screen', async () => {
      const fixture = await mount(ScanComponent);
      for (const code of ['KIT-1', 'DIRTY-1']) {
        type(document.querySelector('input[name=code]'), code);
        await settleUi(fixture);
        (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
        await settleUi(fixture);
      }
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      buttonWith('STER.SCAN.START_CYCLE')!.click();
      await settleUi(fixture);
      expect(TestBed.inject(SterilizationHandoff).request()).toEqual({ itemIds: ['d1'] });
      expect(navigate).toHaveBeenCalledWith(['/sterilization/cycles']);
    });
  });

  describe('cycles', () => {
    const summary = (over: Partial<CycleSummary> = {}): CycleSummary => ({
      id: 'c1', autoclaveId: 'a1', autoclaveName: 'Autoclave 1', number: 12, program: '134°C 18 min', startedAt: '2026-10-06T08:00:00Z', finishedAt: '' as never, operatorName: 'Amina',
      controlType: 'CHEMICAL', controlResult: 'PENDING', controlledAt: '' as never, itemCount: 2, ...over,
    });
    const cycle = (over: Partial<CycleSummary> = {}, warnings: string[] = []): Cycle => ({ summary: summary(over), notes: '', controlNote: '', items: [item({ id: 'i1' }), item({ id: 'i2', code: 'HP-1', name: 'Turbine' })], warnings });

    beforeEach(() => {
      api['cycles'] = vi.fn(async () => [summary()]);
      api['autoclaves'] = vi.fn(async () => [{ id: 'a1', name: 'Autoclave 1', model: '', serialNumber: '', active: true }]);
      api['items'] = vi.fn(async () => [item({ id: 'd1', code: 'DIRTY-1', state: 'DIRTY', nextActions: ['ADD_TO_CYCLE'] }), item({ id: 'd2', code: 'DIRTY-2', state: 'DIRTY', nextActions: ['ADD_TO_CYCLE'] })]);
      api['cycle'] = vi.fn(async () => cycle());
      api['createCycle'] = vi.fn(async () => cycle());
      api['recordControl'] = vi.fn(async (_id: string, result: string) => cycle({ controlResult: result as never }));
      api['exposure'] = vi.fn(async () => ({
        cycle: summary({ controlResult: 'FAILED' }), items: [],
        uses: [{ eventId: 'e1', at: '2026-10-06T10:00:00Z', action: 'USED', itemId: 'i1', itemCode: 'KIT-1', itemName: 'Plateau', kind: 'TRAY', patientId: 'p1', patientName: 'Sara Alami', patientCode: 'P-1', appointmentId: '', cycleId: 'c1', cycleNumber: 12, autoclaveName: 'Autoclave 1', controlResult: 'FAILED', performedBy: 'Amina', note: '' }],
      }));
    });

    it('opens a new cycle already loaded with what was scanned', async () => {
      setup(SterilizationCyclesComponent);
      TestBed.inject(SterilizationHandoff).request.set({ itemIds: ['d2'] });
      await mount(SterilizationCyclesComponent);
      expect(document.querySelector('[role=dialog]')).not.toBeNull();
      const boxes = [...document.querySelectorAll('[role=dialog] fieldset input[type=checkbox]')] as HTMLInputElement[];
      expect(boxes.map(b => b.checked)).toEqual([false, true]);
      expect(TestBed.inject(SterilizationHandoff).request()).toBeNull();
    });

    it('starts a cycle with the chosen items and the autoclave', async () => {
      setup(SterilizationCyclesComponent);
      const fixture = await mount(SterilizationCyclesComponent);
      buttonWith('STER.CYCLES.NEW')!.click();
      await settleUi(fixture);
      (document.querySelectorAll('[role=dialog] fieldset input[type=checkbox]')[0] as HTMLInputElement).click();
      await settleUi(fixture);
      (document.querySelector('#cycle-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['createCycle']).toHaveBeenCalledWith(expect.objectContaining({ autoclaveId: 'a1', itemIds: ['d1'], controlType: 'CHEMICAL' }));
    });

    it('releases a load on a passed control', async () => {
      setup(SterilizationCyclesComponent);
      const fixture = await mount(SterilizationCyclesComponent);
      buttonWith('12')!.click();
      await settleUi(fixture);
      buttonWith('STER.CYCLES.PASSED')!.click();
      await settleUi(fixture);
      expect(api['recordControl']).toHaveBeenCalledWith('c1', 'PASSED', undefined);
      expect(api['exposure']).not.toHaveBeenCalled();
    });

    it('asks first, then lists every patient exposed when a control fails', async () => {
      confirmAnswer = false;
      setup(SterilizationCyclesComponent);
      const fixture = await mount(SterilizationCyclesComponent);
      buttonWith('12')!.click();
      await settleUi(fixture);
      buttonWith('STER.CYCLES.FAILED')!.click();
      await settleUi(fixture);
      expect(api['recordControl']).not.toHaveBeenCalled();
      confirmAnswer = true;
      buttonWith('STER.CYCLES.FAILED')!.click();
      await settleUi(fixture);
      expect(api['recordControl']).toHaveBeenCalledWith('c1', 'FAILED', undefined);
      expect(document.querySelector('[role=alert]')!.textContent).toContain('Sara Alami');
    });

    it('lets a passed cycle be declared failed later, when a biological result comes back', async () => {
      api['cycle'].mockResolvedValue(cycle({ controlResult: 'PASSED', controlType: 'BIOLOGICAL' }));
      setup(SterilizationCyclesComponent);
      const fixture = await mount(SterilizationCyclesComponent);
      buttonWith('12')!.click();
      await settleUi(fixture);
      expect(buttonWith('STER.CYCLES.PASSED')).toBeUndefined();
      buttonWith('STER.CYCLES.LATE_FAILED')!.click();
      await settleUi(fixture);
      expect(api['recordControl']).toHaveBeenCalledWith('c1', 'FAILED', undefined);
      expect(api['exposure']).toHaveBeenCalledWith('c1');
    });

    it('shows the lubrication warning in the person\'s language', async () => {
      api['cycle'].mockResolvedValue(cycle({}, ['Handpiece HP-1 has not been lubricated since it was last used']));
      setup(SterilizationCyclesComponent);
      const fixture = await mount(SterilizationCyclesComponent);
      buttonWith('12')!.click();
      await settleUi(fixture);
      expect(document.querySelector('[role=note]')!.textContent).toContain('STER.WARNINGS.NOT_LUBRICATED');
    });
  });

  describe('items', () => {
    beforeEach(() => {
      api['items'] = vi.fn(async () => [item(), item({ id: 'i2', code: 'HP-1', name: 'Turbine', kind: 'HANDPIECE', state: 'DIRTY', nextActions: ['LUBRICATE', 'ADD_TO_CYCLE'], lubricationDue: true })]);
      api['createItem'] = vi.fn(async () => item());
      api['retireItem'] = vi.fn(async () => item({ active: false }));
      api['traceByItem'] = vi.fn(async () => []);
      setup(SterilizationItemsComponent);
    });

    it('prints labels only for the items ticked', async () => {
      const downloads = TestBed.inject(DownloadService) as unknown as { open: ReturnType<typeof vi.fn> };
      const fixture = await mount(SterilizationItemsComponent);
      (document.querySelectorAll('tbody input[type=checkbox]')[1] as HTMLInputElement).click();
      await settleUi(fixture);
      buttonWith('STER.ITEMS.PRINT_LABELS')!.click();
      await settleUi(fixture);
      expect(downloads.open).toHaveBeenCalledWith('/sterilization/labels', { itemId: ['i2'], lang: 'fr' });
    });

    it('registers an item that is known to be sterile', async () => {
      const fixture = await mount(SterilizationItemsComponent);
      buttonWith('STER.ITEMS.NEW')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[name=code]'), 'INS-9');
      type(document.querySelector('input[name=name]'), 'Précelles');
      (document.querySelector('input[name=sterile]') as HTMLInputElement).click();
      await settleUi(fixture);
      (document.querySelector('#item-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['createItem']).toHaveBeenCalledWith(expect.objectContaining({ code: 'INS-9', name: 'Précelles', kind: 'INSTRUMENT', markSterile: true }));
    });

    it('retires an item only with a reason', async () => {
      const fixture = await mount(SterilizationItemsComponent);
      buttonWith('STER.ITEMS.RETIRE')!.click();
      await settleUi(fixture);
      const submit = document.querySelector('button[form=retire-form]') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      type(document.querySelector('input[name=reason]'), 'Cassé');
      await settleUi(fixture);
      (document.querySelector('#retire-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['retireItem']).toHaveBeenCalledWith('i1', 'Cassé');
    });
  });

  describe('endo kits', () => {
    const kit = (): EndoKit => ({
      item: item({ id: 'k1', code: 'ENDO-1', name: 'Kit endo 1', kind: 'ENDO_KIT' }), needsReplacement: true,
      files: [{ id: 'f1', modelId: 'm1', modelName: 'ProTaper F2', useCount: 4, maxUses: 4, remaining: 0, atLimit: true, nearLimit: true }, { id: 'f2', modelId: 'm1', modelName: 'ProTaper F1', useCount: 1, maxUses: 4, remaining: 3, atLimit: false, nearLimit: false }],
    });

    beforeEach(() => {
      api['kits'] = vi.fn(async () => [kit()]);
      api['endoModels'] = vi.fn(async () => [{ id: 'm1', name: 'ProTaper F2', brand: '', sizeTaper: '', maxUses: 4, active: true }]);
      api['addKitFile'] = vi.fn(async () => kit());
      api['discardFile'] = vi.fn(async () => kit());
      setup(SterilizationEndoComponent);
    });

    it('flags a kit with a file at its limit', async () => {
      await mount(SterilizationEndoComponent);
      expect(document.body.textContent).toContain('STER.ENDO.REPLACE');
      expect(document.body.textContent).toContain('4 / 4');
    });

    it('discards a worn file after a reason and a confirmation', async () => {
      const fixture = await mount(SterilizationEndoComponent);
      buttonWith('STER.ENDO.DISCARD')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[name=reason]'), 'Limite atteinte');
      await settleUi(fixture);
      (document.querySelector('#discard-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['discardFile']).toHaveBeenCalledWith('f1', 'Limite atteinte');
    });

    it('adds files of a model to a kit', async () => {
      const fixture = await mount(SterilizationEndoComponent);
      buttonWith('STER.ENDO.ADD_FILES')!.click();
      await settleUi(fixture);
      const model = document.querySelector('select[name=model]') as HTMLSelectElement;
      model.value = 'm1';
      model.dispatchEvent(new Event('change', { bubbles: true }));
      type(document.querySelector('input[name=qty]'), '3');
      await settleUi(fixture);
      (document.querySelector('#add-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['addKitFile']).toHaveBeenCalledWith('k1', 'm1', 3);
    });
  });

  describe('dashboard and traceability', () => {
    it('shows the counts and the controls still waiting', async () => {
      api['dashboard'] = vi.fn(async () => ({
        counts: { READY: 12, USED: 2, DIRTY: 4, PROCESSED: 3 }, lubricationDue: [], shelfLifeExceeded: [], endoAlerts: [], shelfLifeDays: 30,
        pendingControls: [{ id: 'c1', autoclaveId: 'a1', autoclaveName: 'Autoclave 1', number: 12, program: 'x', startedAt: '2026-10-06T08:00:00Z', finishedAt: '' as never, operatorName: 'A', controlType: 'CHEMICAL', controlResult: 'PENDING', controlledAt: '' as never, itemCount: 3 }],
      }));
      setup(SterilizationDashboardComponent);
      await mount(SterilizationDashboardComponent);
      const text = document.body.textContent!;
      expect(text).toContain('12');
      expect(text).toContain('STER.DASH.PENDING_CONTROLS');
      expect(text).not.toContain('STER.DASH.ALL_GOOD');
    });

    it('lists the instruments used on a patient, newest day first', async () => {
      api['items'] = vi.fn(async () => []);
      api['traceByPatient'] = vi.fn(async () => [{ eventId: 'e1', at: '2026-10-06T10:00:00Z', action: 'USED', itemId: 'i1', itemCode: 'KIT-1', itemName: 'Plateau', kind: 'TRAY', patientId: 'p1', patientName: 'Sara', patientCode: 'P-1', appointmentId: '', cycleId: 'c1', cycleNumber: 12, autoclaveName: 'Autoclave 1', controlResult: 'PASSED', performedBy: 'Amina', note: '' }]);
      setup(SterilizationTraceComponent);
      const fixture = await mount(SterilizationTraceComponent);
      expect(document.body.textContent).toContain('STER.TRACE.PICK_PATIENT');
      expect(api['traceByPatient']).not.toHaveBeenCalled();
      const component = fixture.componentInstance as unknown as { patient: { set(v: { id: string; name: string }): void } };
      component.patient.set({ id: 'p1', name: 'Sara' });
      await settleUi(fixture);
      expect(api['traceByPatient']).toHaveBeenCalledWith('p1');
      expect(document.body.textContent).toContain('KIT-1');
    });
  });
});
