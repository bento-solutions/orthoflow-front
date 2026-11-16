/** @type {import('tailwindcss').Config} */

/* Every colour here reads its value from a CSS custom property defined in
   `src/tokens.css`. That file is the single source of truth: this config
   only teaches Tailwind the names, so `bg-petrol-600` and
   `rgb(var(--petrol-600))` can never drift apart.

   The `<alpha-value>` placeholder is what keeps opacity modifiers working
   (`bg-petrol-600/10`, `border-ink-900/5`). */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const ramp = (prefix, steps) =>
  Object.fromEntries(steps.map((s) => [s, token(`${prefix}-${s}`)]));

const FULL = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const STATUS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/* Status ramps have no 950 step; fold it onto 900 so a stray `-950`
   utility still resolves instead of silently generating nothing. */
const statusRamp = (prefix) => ({
  ...ramp(prefix, STATUS),
  950: token(`${prefix}-900`),
});

module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}', './index.html'],
  theme: {
    extend: {
      colors: {
        petrol: ramp('petrol', FULL),
        ink: ramp('ink', FULL),
        positive: statusRamp('positive'),
        caution: statusRamp('caution'),
        critical: statusRamp('critical'),

        /* Semantic shorthands for the most common utility cases. */
        surface: token('white'),
        'app-bg': token('ink-50'),

        /* No Tailwind stock palettes (slate, gray, emerald, red…) and no ortho-* names: every
           screen names the token ramps above, and design-language.spec.ts keeps it so (UI V2 audit M4). */
      },

      fontFamily: {
        sans: ['Manrope', 'IBM Plex Sans Arabic', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      /* 14px UI base — a dense clinical screen, not a marketing page. */
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1.4' }], // the 12 px floor (UX audit P2-4)
        xs: ['0.75rem', { lineHeight: '1.4' }],
        sm: ['0.8125rem', { lineHeight: '1.5' }],
        base: ['0.875rem', { lineHeight: '1.55' }],
        md: ['1rem', { lineHeight: '1.55' }],
        lg: ['1.125rem', { lineHeight: '1.4' }],
        xl: ['1.375rem', { lineHeight: '1.3' }],
        '2xl': ['1.75rem', { lineHeight: '1.2' }],
        '3xl': ['2.25rem', { lineHeight: '1.1' }],
      },

      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-xl)',
      },

      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        /* Kept: referenced by the landing page. */
        soft: 'var(--shadow-lg)',
        lift: 'var(--shadow-xl)',
      },

      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        spring: 'var(--ease-spring)',
      },

      transitionDuration: {
        1: '120ms',
        2: '180ms',
        3: '240ms',
        4: '320ms',
      },

      keyframes: {
        /* Entrances rise a short distance — enough to show direction,
           not far enough to read as an effect. */
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        /* The only permitted infinite animations: both mean "the system is
           working right now", and both stop when the work stops. */
        'skeleton-sweep': {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--petrol-500) / 0.35)' },
          '70%': { boxShadow: '0 0 0 10px rgb(var(--petrol-500) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--petrol-500) / 0)' },
        },
      },

      animation: {
        rise: 'rise var(--dur-3) var(--ease-out) both',
        fade: 'fade var(--dur-2) var(--ease-out) both',
        'scale-in': 'scale-in var(--dur-2) var(--ease-out) both',
        'skeleton-sweep': 'skeleton-sweep 1.4s var(--ease-in-out) infinite',
        'pulse-ring': 'pulse-ring 2s var(--ease-out) infinite',
      },
    },
  },
  plugins: [],
};
