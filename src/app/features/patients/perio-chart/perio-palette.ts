import { BooleanMode, PerioMode } from '../../../core/clinical/perio/perio.model';

/**
 * The chart is a clinical document, drawn on white paper in every theme: the tooth drawings have
 * dark outlines on a transparent background, and the colours that carry meaning (blue for what was
 * probed, red for the gum margin, red/violet/amber for bleeding, plaque and pus) are a convention
 * of periodontal charting, not of this product's palette.
 */
export const PERIO = {
  probing: '#2563eb',
  probingTint: '#dbeafe',
  recession: '#dc2626',
  recessionTint: '#fecaca',
  mobility: '#3b82f6',
  mobilityTint: '#dbeafe',
  mobilityText: '#1d4ed8',
  furcation: '#06b6d4',
  furcationTint: '#ecfeff',
  furcationText: '#0e7490',
  emptyFill: '#f9fafb',
  emptyStroke: '#d1d5db',
  emptyText: '#6b7280',
  focusFill: 'rgba(59, 130, 246, 0.08)',
  focusStroke: '#3b82f6',
  ruler: '#878787',
} as const;

export const FLAG_COLORS: Readonly<Record<BooleanMode, { base: string; ring: string }>> = {
  bleeding: { base: '#dc2626', ring: '#fca5a5' },
  plaque: { base: '#6d28d9', ring: '#c4b5fd' },
  suppuration: { base: '#d97706', ring: '#fcd34d' },
};

/** Row heights, in pixels. */
export const ROW_HEIGHT = { flag: 12, cells: 20, mobility: 24, furcation: 24, numbers: 24 } as const;

/** `pocketDepth` → `POCKET_DEPTH`: the key of a mode in the translation files. */
export const modeKey = (mode: PerioMode): string => mode.replace(/([A-Z])/g, '_$1').toUpperCase();
