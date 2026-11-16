import { Injectable, computed, inject } from '@angular/core';
import { ThemeService } from '../services/theme.service';

/** The light theme's values, for a test or a page with no stylesheet. */
const FALLBACK: Record<string, string> = {
  'petrol-500': '47 143 162', 'positive-500': '26 154 92', 'caution-500': '207 112 8',
  'ink-500': '99 116 122', 'ink-100': '234 238 240', 'ink-200': '213 221 224',
};

/** `rgb(…)` for a colour ramp step, read from the tokens as the page has them now. */
export function tokenColor(step: string): string {
  const raw = typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(`--${step}`).trim() : '';
  return `rgb(${raw || FALLBACK[step] || '0 0 0'})`;
}

export interface ChartPalette {
  action: string;
  positive: string;
  caution: string;
  /** Axis labels and legends. */
  muted: string;
  /** Grid lines. */
  grid: string;
}

/**
 * The colours a chart library needs as plain values (it cannot read CSS variables), read from the
 * tokens and read again when the theme changes, so a chart drawn in light does not keep light-theme
 * grid lines in dark (UI V2 audit M2). A chart's options depend on `palette()` and redraw with it.
 */
@Injectable({ providedIn: 'root' })
export class ChartColors {
  private readonly theme = inject(ThemeService);
  readonly palette = computed<ChartPalette>(() => {
    this.theme.effective();
    return {
      action: tokenColor('petrol-500'),
      positive: tokenColor('positive-500'),
      caution: tokenColor('caution-500'),
      muted: tokenColor('ink-500'),
      grid: tokenColor('ink-200'),
    };
  });
}
