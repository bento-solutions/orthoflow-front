import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { helpPageKey } from './help-pages';

export interface TourStep {
  /**
   * The `data-tour` value of the element to point at. A step whose element is not on the screen is
   * skipped. Without one, the step is a card in the middle of the screen and always shows.
   */
  target?: string;
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

/** The steps of a tour that can be shown right now: those whose element is on the page, and those that point at nothing. */
export function visibleSteps(tour: Tour, exists: (selector: string) => boolean): TourStep[] {
  return tour.steps.filter(step => !step.target || exists(tourSelector(step.target)));
}

/** A short name for a step, saved as where someone stopped: the last part of its key. */
export const stepId = (step: TourStep): string => step.key.split('.').pop()!.toLowerCase();

/** What happened to a tour: how many steps it showed, whether the person went to the end, and the last step they saw. */
export interface TourOutcome {
  shown: number;
  completed: boolean;
  lastStep: string | null;
}

export interface TourOptions {
  /** An extra button on the last step, which ends the tour as finished and then runs. */
  finalAction?: { label: string; run: () => void };
}

const onScreen = (selector: string): boolean => {
  const el = document.querySelector<HTMLElement>(selector);
  return !!el && el.getClientRects().length > 0;
};

/**
 * Resolves true once `selector` is on screen, or false after `timeoutMs`: for a step on a screen
 * that is still loading after a navigation.
 */
export function waitForElement(selector: string, timeoutMs = 6000): Promise<boolean> {
  if (onScreen(selector)) {
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (onScreen(selector)) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
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
    const shown = visibleSteps(tour, onScreen).length;
    if (shown > 0) {
      void this.run(tour);
    }
    return shown;
  }

  /**
   * Runs `tour` and resolves when it is closed, saying whether the person reached the end. Closing
   * it early (the cross, Escape, a click outside) is not finishing it.
   */
  async run(tour: Tour, options: TourOptions = {}): Promise<TourOutcome> {
    // Hidden things (the wide search box on a phone) cannot be pointed at: only what has a place on screen counts.
    const steps = visibleSteps(tour, onScreen);
    if (steps.length === 0) {
      return { shown: 0, completed: false, lastStep: null };
    }
    const { driver } = await import('driver.js');
    const t = (key: string) => this.translate.instant(key);
    return new Promise<TourOutcome>(resolve => {
      let completed = false;
      let index = 0;
      const instance = driver({
        showProgress: true,
        allowClose: true,
        nextBtnText: t('TOUR.NEXT'),
        prevBtnText: t('TOUR.PREVIOUS'),
        doneBtnText: t('TOUR.DONE'),
        closeBtnLabel: t('COMMON.CLOSE'),
        progressText: '{{current}} / {{total}}',
        popoverClass: 'of-tour',
        steps: steps.map(step => ({
          element: step.target ? tourSelector(step.target) : undefined,
          popover: { title: t(`${step.key}.TITLE`), description: t(`${step.key}.TEXT`), side: step.side ?? 'bottom' },
        })),
        onPopoverRender: (popover, { driver: d }) => {
          index = d.getActiveIndex() ?? index;
          // The popover is a dialog: say so, and name it by its title, for a screen reader.
          popover.wrapper.setAttribute('role', 'dialog');
          popover.title.id = 'of-tour-title';
          popover.wrapper.setAttribute('aria-labelledby', 'of-tour-title');
          if (options.finalAction && d.isLastStep()) {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'of-tour-action';
            action.textContent = options.finalAction.label;
            action.addEventListener('click', () => {
              completed = true;
              d.destroy();
              options.finalAction!.run();
            });
            popover.footerButtons.prepend(action);
          }
        },
        onDoneClick: (_el, _step, { driver: d }) => {
          completed = true;
          d.destroy();
        },
        onDestroyed: () => resolve({ shown: steps.length, completed, lastStep: stepId(steps[index]) }),
      });
      instance.drive();
    });
  }
}
