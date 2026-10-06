import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { helpPageKey } from './help-pages';

export interface TourStep {
  /** The `data-tour` value of the element to point at. A step whose element is not on the screen is skipped. */
  target: string;
  /** Translation keys, under `TOUR.<tour>.<step>`. */
  key: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export interface Tour {
  id: string;
  steps: TourStep[];
}

/** The guided tours. `welcome` is the same everywhere; the others belong to a screen. */
export const TOURS: Tour[] = [
  {
    id: 'welcome',
    steps: [
      { target: 'nav', key: 'TOUR.WELCOME.NAV', side: 'right' },
      { target: 'search', key: 'TOUR.WELCOME.SEARCH', side: 'bottom' },
      { target: 'bell', key: 'TOUR.WELCOME.BELL', side: 'bottom' },
      { target: 'theme', key: 'TOUR.WELCOME.THEME', side: 'bottom' },
      { target: 'help', key: 'TOUR.WELCOME.HELP', side: 'bottom' },
    ],
  },
  {
    id: 'patients',
    steps: [
      { target: 'patients-search', key: 'TOUR.PATIENTS.SEARCH', side: 'bottom' },
      { target: 'patients-add', key: 'TOUR.PATIENTS.ADD', side: 'bottom' },
      { target: 'patients-duplicates', key: 'TOUR.PATIENTS.DUPLICATES', side: 'bottom' },
    ],
  },
  {
    id: 'finance',
    steps: [
      { target: 'finance-tabs', key: 'TOUR.FINANCE.TABS', side: 'bottom' },
    ],
  },
  {
    id: 'sterilization',
    steps: [
      { target: 'ster-tabs', key: 'TOUR.STER.TABS', side: 'bottom' },
    ],
  },
];

/**
 * The tour that belongs to the screen at `url`, if it has one. The patients tour points at the
 * list's own controls, so it belongs to the list only, not to a patient's file; the finance and
 * sterilization tours point at the tabs their frame shows on every page.
 */
export function tourFor(url: string): Tour | null {
  const path = url.split(/[?#]/)[0].replace(/\/$/, '');
  if (path === '/patients') {
    return TOURS.find(t => t.id === 'patients') ?? null;
  }
  const key = helpPageKey(url);
  return key === 'finance' || key === 'sterilization' ? TOURS.find(t => t.id === key) ?? null : null;
}

export const tourSelector = (target: string): string => `[data-tour="${target}"]`;

/** The steps of a tour that can be shown right now: those whose element is on the page. */
export function visibleSteps(tour: Tour, exists: (selector: string) => boolean): TourStep[] {
  return tour.steps.filter(step => exists(tourSelector(step.target)));
}

/**
 * Runs a guided tour with driver.js, loaded the first time one is started so the rest of the app
 * does not carry it. A tour only points at what is actually on screen, and says nothing if
 * nothing is.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly translate = inject(TranslateService);

  /** Starts `tour`; returns how many steps it had to show (0 when nothing it points at is on the page). */
  async start(tour: Tour): Promise<number> {
    // Hidden things (the wide search box on a phone) cannot be pointed at: only what has a place on screen counts.
    const steps = visibleSteps(tour, selector => {
      const el = document.querySelector<HTMLElement>(selector);
      return !!el && el.getClientRects().length > 0;
    });
    if (steps.length === 0) {
      return 0;
    }
    const { driver } = await import('driver.js');
    const t = (key: string) => this.translate.instant(key);
    const instance = driver({
      showProgress: true,
      allowClose: true,
      nextBtnText: t('TOUR.NEXT'),
      prevBtnText: t('TOUR.PREVIOUS'),
      doneBtnText: t('TOUR.DONE'),
      progressText: '{{current}} / {{total}}',
      steps: steps.map(step => ({
        element: tourSelector(step.target),
        popover: { title: t(`${step.key}.TITLE`), description: t(`${step.key}.TEXT`), side: step.side ?? 'bottom' },
      })),
    });
    instance.drive();
    return steps.length;
  }
}
