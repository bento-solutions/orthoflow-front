import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpPanelComponent } from '../../layout/help-panel/help-panel.component';
import { screenMocks } from '../../testing/screen-mocks';
import { HelpApi } from '../services/help-api.service';
import { HelpPanelService } from '../services/help-panel.service';
import { LanguageService } from '../services/language.service';
import { helpPageKey, noteBlocks } from './help-pages';
import { TOURS, TourService, tourFor, visibleSteps } from './tours';

describe('helpPageKey', () => {
  it('maps a screen to its note, longest prefix first, ignoring the query', () => {
    expect(helpPageKey('/finance/cheques?x=1')).toBe('finance');
    expect(helpPageKey('/patients/12/edit')).toBe('patients');
    expect(helpPageKey('/recalls')).toBe('patients');
    expect(helpPageKey('/front-desk')).toBe('agenda');
    expect(helpPageKey('/settings')).toBe('settings');
  });

  it('has no note for a screen that has none, rather than a wrong one', () => {
    expect(helpPageKey('/')).toBeNull();
    expect(helpPageKey('/account')).toBeNull();
    expect(helpPageKey('/patientsx')).toBeNull();
  });
});

describe('noteBlocks', () => {
  it('turns plain text into paragraphs and lists, never markup', () => {
    const blocks = noteBlocks('Première ligne\nsuite.\n\n- un\n- deux\n\nFin <b>gras</b>');
    expect(blocks).toEqual([
      { kind: 'p', text: 'Première ligne suite.' },
      { kind: 'ul', items: ['un', 'deux'] },
      { kind: 'p', text: 'Fin <b>gras</b>' },
    ]);
  });

  it('keeps a list that follows a sentence in the same chunk', () => {
    expect(noteBlocks('Pour cela :\n- ouvrir\n- fermer')).toEqual([{ kind: 'p', text: 'Pour cela :' }, { kind: 'ul', items: ['ouvrir', 'fermer'] }]);
  });

  it('copes with empty text and Windows line endings', () => {
    expect(noteBlocks('')).toEqual([]);
    expect(noteBlocks('a\r\n\r\nb')).toEqual([{ kind: 'p', text: 'a' }, { kind: 'p', text: 'b' }]);
  });
});

describe('tours', () => {
  const translations = (lang: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', `${lang}.json`), 'utf-8'));
  const has = (tree: Record<string, unknown>, key: string): boolean => {
    let node: unknown = tree;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null || !(part in node)) return false;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
  };

  it('has a title and a text for every step, in every language', () => {
    for (const lang of ['fr', 'en', 'ar']) {
      const tree = translations(lang);
      const missing = TOURS.flatMap(t => t.steps).flatMap(step => [`${step.key}.TITLE`, `${step.key}.TEXT`]).filter(k => !has(tree, k));
      expect(missing, `missing in ${lang}`).toEqual([]);
    }
  });

  it('finds the tour that belongs to a screen', () => {
    expect(tourFor('/finance/debts')?.id).toBe('finance');
    expect(tourFor('/sterilization/scan')?.id).toBe('sterilization');
    expect(tourFor('/patients')?.id).toBe('patients');
    expect(tourFor('/patients/12')).toBeNull();
    expect(tourFor('/settings')).toBeNull();
  });

  it('only keeps the steps whose element is on screen', () => {
    const tour = TOURS.find(t => t.id === 'welcome')!;
    const steps = visibleSteps(tour, selector => selector === '[data-tour="nav"]' || selector === '[data-tour="help"]');
    expect(steps.map(s => s.target)).toEqual(['nav', 'help']);
  });

  it('shows nothing when nothing it points at is on screen', async () => {
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()] });
    expect(await TestBed.inject(TourService).start(TOURS[0])).toBe(0);
  });
});

describe('HelpPanelComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let events: Subject<unknown>;
  let url: string;
  let mocks: ReturnType<typeof screenMocks>;

  const setup = () => {
    mocks = screenMocks();
    events = new Subject();
    TestBed.configureTestingModule({
      imports: [HelpPanelComponent, TranslateModule.forRoot()],
      providers: [
        { provide: HelpApi, useValue: api },
        { provide: LanguageService, useValue: { currentLang: signal('fr') } },
        { provide: Router, useValue: { events, get url() { return url; } } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(HelpPanelComponent);
    document.body.appendChild(fixture.nativeElement);
    return fixture;
  };
  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const note = (pageKey: string, title: string, body = 'Texte.') => ({ pageKey, lang: 'fr', title, body, customised: false });

  beforeEach(() => {
    document.body.innerHTML = '';
    url = '/finance/cheques';
    api = {
      notes: vi.fn(async () => [note('finance', 'Finance'), note('patients', 'Patients')]),
      note: vi.fn(async (key: string) => { if (key === 'finance') return note('finance', 'Finance', 'Suivre la caisse.\n\n- clôturer\n- encaisser'); throw new Error('404'); }),
      ask: vi.fn(async () => ({ answer: 'Ouvrez Finance puis Chèques.', aiUsed: false, sources: [{ pageKey: 'finance', title: 'Finance' }], notice: '' })),
    };
  });

  it('draws nothing until it is opened', async () => {
    const fixture = setup();
    await flush(fixture);
    expect(document.querySelector('aside')).toBeNull();
    expect(api['note']).not.toHaveBeenCalled();
  });

  it('opens on the note for the screen the person is on, with the other topics listed', async () => {
    const fixture = setup();
    TestBed.inject(HelpPanelService).show();
    await flush(fixture);
    expect(api['note']).toHaveBeenCalledWith('finance', 'fr');
    const text = document.querySelector('aside')!.textContent!;
    expect(text).toContain('Suivre la caisse.');
    expect(text).toContain('clôturer');
    expect(document.querySelectorAll('aside ul')[document.querySelectorAll('aside ul').length - 1].textContent).toContain('Patients');
  });

  it('says there is no note when the screen has none', async () => {
    url = '/account';
    const fixture = setup();
    TestBed.inject(HelpPanelService).show();
    await flush(fixture);
    expect(document.querySelector('aside')!.textContent).toContain('HELP.NO_NOTE');
  });

  it('follows the person to another screen while it stays open', async () => {
    const fixture = setup();
    TestBed.inject(HelpPanelService).show();
    await flush(fixture);
    url = '/patients';
    events.next(new NavigationEnd(1, '/patients', '/patients'));
    await flush(fixture);
    expect(api['note']).toHaveBeenLastCalledWith('patients', 'fr');
  });

  it('asks a question with the language and the screen, and offers the notes it used', async () => {
    const fixture = setup();
    TestBed.inject(HelpPanelService).show();
    await flush(fixture);
    const box = document.querySelector('textarea[name=question]') as HTMLTextAreaElement;
    box.value = 'Comment clôturer la caisse ?';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(fixture);
    (document.querySelector('aside form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await flush(fixture);
    expect(api['ask']).toHaveBeenCalledWith('Comment clôturer la caisse ?', 'fr', 'finance');
    const text = document.querySelector('[role=status]')!.textContent!;
    expect(text).toContain('Ouvrez Finance puis Chèques.');
    expect(text).toContain('HELP.FROM_NOTES');
    expect([...document.querySelectorAll('[role=status] button')].map(b => b.textContent?.trim())).toContain('Finance');
  });

  it('will not send a question that is too short', async () => {
    const fixture = setup();
    TestBed.inject(HelpPanelService).show();
    await flush(fixture);
    const box = document.querySelector('textarea[name=question]') as HTMLTextAreaElement;
    box.value = 'a';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(fixture);
    expect((document.querySelector('aside form button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes on Escape', async () => {
    const fixture = setup();
    const help = TestBed.inject(HelpPanelService);
    help.show();
    await flush(fixture);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush(fixture);
    expect(help.open()).toBe(false);
  });
});
