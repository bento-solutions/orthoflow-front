import '@angular/compiler';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationService } from '../consultation/consultation.service';
import { PatientApiService } from '../services/patient-api.service';
import { PatientService } from '../services/patient.service';
import { PermissionService } from '../services/permission.service';
import { ScheduleService } from '../services/schedule.service';
import { VoiceSessionService } from '../voice/voice-session.service';
import { FIRST_RUN, FirstRunApi, FirstRunService, GuideProgress, MAX_SNOOZES, OfferContext, isDossierPath, offerFor, pendingChapters } from './first-run';
import { TourOutcome, TourService } from './tours';

const row = (key: GuideProgress['key'], status: GuideProgress['status'], snoozeCount = 0, version = 1): GuideProgress =>
  ({ key, status, version, snoozeCount, lastStep: '', updatedAt: '' });

const dashboard: OfferContext = { path: '/', wide: true, canWriteClinical: true, busy: false };
const PATIENT = '/patients/0b9a5a3e-1c1f-4c55-9f0e-7a1c2b3d4e5f';

describe('first-run guide: what is still to show', () => {
  it('shows every chapter to someone who has never seen it', () => {
    expect(pendingChapters([]).map(c => c.key)).toEqual(['FIRST_RUN_DASHBOARD', 'FIRST_RUN_DOSSIER', 'FIRST_RUN_VOICE']);
  });

  it('drops finished and turned-down chapters, keeps the snoozed ones', () => {
    const pending = pendingChapters([row('FIRST_RUN_DASHBOARD', 'COMPLETED'), row('FIRST_RUN_DOSSIER', 'SNOOZED'), row('FIRST_RUN_VOICE', 'DISMISSED')]);
    expect(pending.map(c => c.key)).toEqual(['FIRST_RUN_DOSSIER']);
  });

  it('shows a chapter again when its content is newer than what was seen', () => {
    expect(pendingChapters([row('FIRST_RUN_DASHBOARD', 'COMPLETED', 0, 0)]).map(c => c.key)).toContain('FIRST_RUN_DASHBOARD');
  });

  it('recognises a patient file by its address', () => {
    expect(isDossierPath(PATIENT)).toBe(true);
    expect(isDossierPath('/patients')).toBe(false);
    expect(isDossierPath('/patients/duplicates')).toBe(false);
    expect(isDossierPath(`${PATIENT}/edit`)).toBe(false);
  });
});

describe('first-run guide: when it offers itself', () => {
  it('offers to start on the dashboard the first time', () => {
    expect(offerFor([], dashboard)).toBe('start');
  });

  it('offers to resume once part of it is done', () => {
    expect(offerFor([row('FIRST_RUN_DASHBOARD', 'COMPLETED')], dashboard)).toBe('resume');
  });

  it('says nothing once everything is settled', () => {
    expect(offerFor(FIRST_RUN.map(c => row(c.key, 'COMPLETED')), dashboard)).toBeNull();
    expect(offerFor(FIRST_RUN.map(c => row(c.key, 'DISMISSED')), dashboard)).toBeNull();
  });

  it('stops asking after two "later"s', () => {
    expect(offerFor([row('FIRST_RUN_DASHBOARD', 'SNOOZED', MAX_SNOOZES - 1)], dashboard)).toBe('start');
    expect(offerFor([row('FIRST_RUN_DASHBOARD', 'SNOOZED', MAX_SNOOZES)], dashboard)).toBeNull();
  });

  it('never interrupts a phone, the front desk, or a session in progress', () => {
    expect(offerFor([], { ...dashboard, wide: false })).toBeNull();
    expect(offerFor([], { ...dashboard, canWriteClinical: false })).toBeNull();
    expect(offerFor([], { ...dashboard, busy: true })).toBeNull();
  });

  it('only starts on the dashboard; the file chapters also wait for the first file opened', () => {
    expect(offerFor([], { ...dashboard, path: '/schedule' })).toBeNull();
    expect(offerFor([], { ...dashboard, path: PATIENT })).toBeNull();
    expect(offerFor([row('FIRST_RUN_DASHBOARD', 'COMPLETED')], { ...dashboard, path: PATIENT })).toBe('resume');
  });
});

describe('first-run guide: content', () => {
  const translations = (lang: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', `${lang}.json`), 'utf-8'));
  const value = (tree: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), tree);

  it('has a title and at most two sentences for every step, in every language', () => {
    for (const lang of ['fr', 'en', 'ar']) {
      const tree = translations(lang);
      for (const step of FIRST_RUN.flatMap(c => c.tour.steps)) {
        expect(typeof value(tree, `${step.key}.TITLE`), `${lang} ${step.key}.TITLE`).toBe('string');
        const text = value(tree, `${step.key}.TEXT`);
        expect(typeof text, `${lang} ${step.key}.TEXT`).toBe('string');
        const sentences = (text as string).split(/(?<=[.!?؟])\s+/).filter(Boolean);
        expect(sentences.length, `${lang} ${step.key}: "${text}"`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('has the welcome card and replay wording in every language', () => {
    const keys = Object.keys(translations('fr')['FIRST_RUN'] as object).map(k => `FIRST_RUN.${k}`).concat('TOUR.FIRST_RUN.TRY_NOW');
    expect(keys.length).toBeGreaterThan(10);
    for (const lang of ['en', 'ar']) {
      expect(keys.filter(k => typeof value(translations(lang), k) !== 'string'), lang).toEqual([]);
    }
  });

  it('points only at anchors that exist in a template', () => {
    const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : /\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
    });
    const text = sources(join(process.cwd(), 'src', 'app')).map(path => readFileSync(path, 'utf-8')).join('\n');
    const targets = [...new Set(FIRST_RUN.flatMap(c => c.tour.steps).flatMap(s => (s.target ? [s.target] : [])))];
    expect(targets.filter(t => !text.includes(`data-tour="${t}"`))).toEqual([]);
  });

  it('begins every chapter with a step it can wait for, so it knows its screen has drawn', () => {
    for (const chapter of FIRST_RUN) {
      expect(chapter.tour.steps[0].target, chapter.key).toBeTruthy();
    }
  });
});

describe('FirstRunService', () => {
  let api: { mine: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let outcomes: TourOutcome[];
  let tours: { run: ReturnType<typeof vi.fn> };
  let url: string;
  let router: { url: string; navigateByUrl: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> };
  let voiceActive: ReturnType<typeof signal<boolean>>;

  const anchors = (...targets: string[]) => {
    document.body.innerHTML = targets.map(t => `<div data-tour="${t}">x</div>`).join('');
  };

  const setup = (progress: GuideProgress[] | Error = [], can = true) => {
    api = {
      mine: vi.fn(async () => { if (progress instanceof Error) throw progress; return progress; }),
      save: vi.fn(async (key: string, status: string, version: number, lastStep: string | null) => ({ key, status, version, snoozeCount: 0, lastStep, updatedAt: '' })),
    };
    tours = { run: vi.fn(async () => outcomes.shift() ?? { shown: 0, completed: false, lastStep: null }) };
    router = {
      get url() { return url; },
      navigateByUrl: vi.fn(async (to: string) => { url = to; return true; }),
      navigate: vi.fn(async (parts: string[]) => { url = parts.join('/'); anchors('dossier-banner', 'dossier-tabs', 'dossier-chart', 'dossier-consult'); return true; }),
    } as never;
    voiceActive = signal(false);
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: FirstRunApi, useValue: api },
        { provide: TourService, useValue: tours },
        { provide: Router, useValue: router },
        { provide: PermissionService, useValue: { ready: async () => undefined, can: () => can } },
        { provide: VoiceSessionService, useValue: { isActive: voiceActive, reviewing: signal(false) } },
        { provide: ConsultationService, useValue: { visible: signal(false) } },
        { provide: PatientService, useValue: { patients: signal([]) } },
        { provide: PatientApiService, useValue: { getPatients: () => of([{ id: 'old', updatedAt: '2026-01-01' }, { id: 'recent', updatedAt: '2026-11-01' }]) } },
        { provide: ScheduleService, useValue: { appointments: signal([]) } },
      ],
    });
    return TestBed.inject(FirstRunService);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    url = '/';
    outcomes = [];
    anchors('dash-kpis', 'dash-today', 'dash-attention');
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    // The test DOM lays nothing out; the guide only waits for what has a place on screen.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as never);
  });

  it('offers itself once on the dashboard of someone who has not seen it', async () => {
    const service = setup();
    await service.consider('/');
    expect(service.offer()).toBe('start');
    service.offer.set(null);
    await service.consider('/');
    expect(service.offer()).toBeNull();
    expect(api.mine).toHaveBeenCalledTimes(1);
  });

  it('shows nothing, and never fails, when the server has no guide', async () => {
    const service = setup(new Error('404'));
    await service.consider('/');
    expect(service.offer()).toBeNull();
  });

  it('is not offered to someone who does not write in the clinical record', async () => {
    const service = setup([], false);
    await service.consider('/');
    expect(service.offer()).toBeNull();
  });

  it('runs the chapters in order, saving each one, and opens a real patient for the file', async () => {
    const service = setup();
    await service.consider('/');
    outcomes = [
      { shown: 4, completed: true, lastStep: 'search' },
      { shown: 4, completed: true, lastStep: 'consult' },
      { shown: 4, completed: true, lastStep: 'review' },
    ];
    await service.accept();
    expect(api.save.mock.calls.map(c => [c[0], c[1]])).toEqual([
      ['FIRST_RUN_DASHBOARD', 'COMPLETED'], ['FIRST_RUN_DOSSIER', 'COMPLETED'], ['FIRST_RUN_VOICE', 'COMPLETED'],
    ]);
    expect(router.navigate).toHaveBeenCalledWith(['/patients', 'recent']);
    // the voice chapter ends with "Try it now", which only opens the menu
    expect(tours.run.mock.calls[2][1].finalAction).toBeTruthy();
  });

  it('counts a tour closed early as "later" and stops there', async () => {
    const service = setup();
    await service.consider('/');
    outcomes = [{ shown: 4, completed: false, lastStep: 'today' }];
    await service.accept();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith('FIRST_RUN_DASHBOARD', 'SNOOZED', 1, 'today');
    expect(tours.run).toHaveBeenCalledTimes(1);
  });

  it('records "later" and "don\'t show again" for every chapter still to do', async () => {
    let service = setup([row('FIRST_RUN_DASHBOARD', 'COMPLETED')]);
    await service.consider('/');
    await service.later();
    expect(api.save.mock.calls.map(c => [c[0], c[1]])).toEqual([['FIRST_RUN_DOSSIER', 'SNOOZED'], ['FIRST_RUN_VOICE', 'SNOOZED']]);

    TestBed.resetTestingModule();
    service = setup();
    await service.consider('/');
    await service.never();
    expect(api.save.mock.calls.map(c => c[1])).toEqual(['DISMISSED', 'DISMISSED', 'DISMISSED']);
  });

  it('stops before a chapter when a dictation has started', async () => {
    const service = setup();
    await service.consider('/');
    outcomes = [{ shown: 4, completed: true, lastStep: 'search' }];
    tours.run.mockImplementationOnce(async () => { voiceActive.set(true); return outcomes.shift()!; });
    await service.accept();
    expect(tours.run).toHaveBeenCalledTimes(1);
  });

  it('a replay runs everything and leaves what was saved alone when closed early', async () => {
    const service = setup(FIRST_RUN.map(c => row(c.key, 'COMPLETED')));
    outcomes = [{ shown: 4, completed: false, lastStep: 'kpis' }];
    await service.replay();
    expect(tours.run).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
  });
});
