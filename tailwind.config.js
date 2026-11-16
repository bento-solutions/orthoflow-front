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
        positive: ramp('positive', STATUS),
        caution: ramp('caution', STATUS),
        critical: ramp('critical', STATUS),

        /* Semantic shorthands for the most common utility cases. */
        surface: token('white'),
        'app-bg': token('ink-50'),

        /* ── Legacy-palette aliases ────────────────────────────────────
           ~530 utility references across the stock, settings, onboarding
           and treatments screens still name Tailwind's stock palettes
           (`text-emerald-600`, `bg-slate-50`, `text-red-600`). Those
           families are NOT part of this design system, and because
           `theme.extend` adds rather than replaces, they would otherwise
           keep resolving to Tailwind's defaults — which is how the product
           ended up running Tailwind slate and Tailwind gray side by side.

           Pointing the families at the token ramps brings every one of
           those screens onto the palette without editing a single
           template, and makes the neutral ramp singular by construction.
           New code should use `ink-*`, `petrol-*`, `positive-*`,
           `caution-*` and `critical-*` directly. */
        slate: ramp('ink', FULL),
        gray: ramp('ink', FULL),
        zinc: ramp('ink', FULL),
        neutral: ramp('ink', FULL),
        stone: ramp('ink', FULL),

        green: statusRamp('positive'),
        emerald: statusRamp('positive'),
        lime: statusRamp('positive'),

        amber: statusRamp('caution'),
        yellow: statusRamp('caution'),
        orange: statusRamp('caution'),

        red: statusRamp('critical'),
        rose: statusRamp('critical'),
        pink: statusRamp('critical'),

        blue: statusRamp('petrol'),
        sky: statusRamp('petrol'),
        cyan: statusRamp('petrol'),
        teal: statusRamp('petrol'),
        indigo: statusRamp('petrol'),
        violet: statusRamp('petrol'),
        purple: statusRamp('petrol'),

        /* Back-compat: the previous `ortho-*` names still resolve, mapped
           onto the new ramp, so the ~589 existing utility references keep
           rendering while screens are migrated one at a time. Do not use
           these in new code — they are aliases, not tokens. */
        ortho: {
          navy: token('petrol-900'),
          sky: token('petrol-400'),
          teal: token('petrol-600'),
          ice: token('petrol-50'),
          white: token('white'),
        },
      },

      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
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
