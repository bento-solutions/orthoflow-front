import { describe, expect, it } from 'vitest';
import {
  FAMILY_PAINT,
  PLANNED_PAINT,
  TOKEN_MIRROR,
  TOOTH_STATUS_DEFINITIONS,
  TOOTH_STATUS_GROUPS,
  odontogramPatternDefs,
  toothOverlays,
  toothPaint,
} from './tooth-status';
import { ADULT_TEETH, ToothStatus } from '../models/patient.model';
import { ToothFinding } from '../models/clinical-record.model';

/**
 * The odontogram palette is written as literal rgb() triplets because the PDF
 * printed chart and the 3D chart cannot resolve CSS custom properties.
 * That is a deliberate duplication, and this test is what stops it from
 * becoming a drift.
 *
 * It cannot read `src/tokens.css` directly — the unit-test builder compiles
 * specs through the same browser-targeted esbuild pipeline as the app, which
 * has no `fs` and no loader for a raw CSS import — so the comparison values
 * below are a second, deliberate copy-paste of the same lines, not a parse
 * of the file. Whoever changes a ramp value in tokens.css must update both
 * `TOKEN_MIRROR` in tooth-status.ts and the values here; this test only
 * catches the case where one of those two was updated and the other forgotten.
 */
describe('odontogram palette mirrors tokens.css', () => {
  const TOKENS_CSS_VALUES: Readonly<Record<string, string>> = {
    'petrol-500': '47 143 162',
    'petrol-700': '33 94 111',
    'petrol-50': '240 249 250',
    'critical-500': '230 69 69',
    'critical-700': '175 32 32',
    'critical-50': '254 242 242',
    'caution-500': '207 112 8',
    'caution-600': '173 90 6',
    'caution-700': '140 71 8',
    'caution-50': '255 248 234',
    'ink-200': '213 221 224',
    'ink-400': '125 142 147',
    'ink-500': '99 116 122',
    'ink-700': '65 81 85',
    'ink-50': '246 248 248',
  };

  it('TOKEN_MIRROR declares exactly the tokens this palette depends on', () => {
    expect(Object.keys(TOKEN_MIRROR).sort()).toEqual(Object.keys(TOKENS_CSS_VALUES).sort());
  });

  for (const [name, mirrored] of Object.entries(TOKEN_MIRROR)) {
    it(`--${name} matches tokens.css`, () => {
      expect(mirrored).toBe(TOKENS_CSS_VALUES[name]);
    });
  }
});

describe('status coverage', () => {
  /* Every value of ToothStatus must have a definition. Listed explicitly
     rather than derived, so adding a status to the union without adding it
     here is itself the failure. */
  const ALL: ToothStatus[] = [
    'present', 'extracted', 'composite', 'amalgam', 'crown', 'bridge',
    'implant', 'veneer', 'root_canal', 'caries', 'fracture', 'impacted',
    'deciduous', 'missing', 'post',
  ];

  it('defines every tooth status exactly once', () => {
    const defined = TOOTH_STATUS_DEFINITIONS.map((d) => d.status);
    expect([...defined].sort()).toEqual([...ALL].sort());
    expect(new Set(defined).size).toBe(defined.length);
  });

  it('groups every status except the baseline', () => {
    const grouped = TOOTH_STATUS_GROUPS.flatMap((g) => g.statuses);
    expect([...grouped].sort()).toEqual(ALL.filter((s) => s !== 'present').sort());
  });

  it('paints a sound tooth with nothing at all', () => {
    expect(toothPaint('present').fill).toBe('transparent');
  });

  it('paints absence grey, not red', () => {
    /* extracted and missing are CONDITION-kind findings, but painting them
       red would read as "treat this". See the note in tooth-status.ts. */
    for (const status of ['extracted', 'missing'] as ToothStatus[]) {
      expect(toothPaint(status).fill).toContain('absent');
    }
  });

  it('gives pathology and existing work different colour families', () => {
    expect(FAMILY_PAINT.condition.solid).toBe('rgb(230 69 69)');
    expect(FAMILY_PAINT.existing.solid).toBe('rgb(47 143 162)');
  });

  it('distinguishes statuses inside a family by geometry, not only colour', () => {
    /* WCAG 1.4.1 — the chart has to survive greyscale and colour deficiency. */
    const existing = TOOTH_STATUS_DEFINITIONS.filter((d) => d.family === 'existing');
    expect(new Set(existing.map((d) => d.geometry)).size).toBeGreaterThan(1);
    const condition = TOOTH_STATUS_DEFINITIONS.filter((d) => d.family === 'condition');
    expect(new Set(condition.map((d) => d.geometry)).size).toBe(condition.length);
  });
});

describe('pattern defs', () => {
  const defs = odontogramPatternDefs();

  it('emits a pattern for every geometry a status actually uses', () => {
    for (const def of TOOTH_STATUS_DEFINITIONS) {
      if (def.geometry === 'none' || def.geometry === 'solid') continue;
      expect(defs).toContain(`id="odo-${def.family}-${def.geometry}"`);
    }
  });

  it('references every pattern it emits from at least one status', () => {
    const emitted = [...defs.matchAll(/id="(odo-[a-z-]+)"/g)].map((m) => m[1]);
    const referenced = new Set(
      TOOTH_STATUS_DEFINITIONS.map((d) => toothPaint(d.status).fill)
        .filter((f) => f.startsWith('url(#'))
        .map((f) => f.slice(5, -1)),
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const id of emitted) expect(referenced.has(id)).toBe(true);
  });

  it('uses a fixed pattern pitch so a molar and an incisor read alike', () => {
    expect(defs).not.toContain('objectBoundingBox');
    expect([...defs.matchAll(/patternUnits="userSpaceOnUse"/g)].length)
      .toBe([...defs.matchAll(/<pattern /g)].length);
  });
});

describe('findings overlays', () => {
  const finding = (over: Partial<ToothFinding>): ToothFinding => ({
    id: crypto.randomUUID(),
    fdi: '26',
    findingCode: 'caries',
    kind: 'CONDITION',
    status: 'ACTIVE',
    source: 'manual',
    createdAt: new Date().toISOString(),
    ...over,
  });

  it('surfaces planned work, which the derived status never paints', () => {
    /* Every TREATMENT_REQUIRED code has a null implied status in the backend
       FindingCatalog, so before this overlay "extraction required on 26" was
       recorded and then invisible on the chart. */
    const overlays = toothOverlays([
      finding({ findingCode: 'extraction_required', kind: 'TREATMENT_REQUIRED' }),
    ]);
    expect(overlays.get('26')?.planned).toEqual(['extraction_required']);
  });

  it('surfaces a defective crown, which paints identically to a sound one', () => {
    const overlays = toothOverlays([finding({ findingCode: 'crown_defective' })]);
    expect(overlays.get('26')?.unpaintedConditions).toEqual(['crown_defective']);
  });

  it('keeps planned work alongside the condition rather than replacing it', () => {
    const overlays = toothOverlays([
      finding({ findingCode: 'crown_defective' }),
      finding({ findingCode: 'crown_replacement_required', kind: 'TREATMENT_REQUIRED' }),
    ]);
    expect(overlays.get('26')).toEqual({
      planned: ['crown_replacement_required'],
      unpaintedConditions: ['crown_defective'],
    });
  });

  it('ignores findings the paint already shows', () => {
    /* caries drives the fill; drawing an alert marker on top of it would be
       telling the clinician something the tooth already says. */
    expect(toothOverlays([finding({ findingCode: 'caries' })]).size).toBe(0);
  });

  it('ignores retracted and resolved findings', () => {
    expect(toothOverlays([
      finding({ findingCode: 'extraction_required', kind: 'TREATMENT_REQUIRED', status: 'RETRACTED' }),
      finding({ findingCode: 'crown_required', kind: 'TREATMENT_REQUIRED', status: 'RESOLVED' }),
    ]).size).toBe(0);
  });
});

describe('contrast', () => {
  /* WCAG 2.1: non-text indicators need 3:1 against their ground; the legend's
     text step needs 4.5:1 on its own tint. Both are asserted rather than
     eyeballed, because "it looked fine on my monitor" is how the previous
     palette happened. */
  const parse = (css: string): [number, number, number] => {
    const [r, g, b] = css.replace(/[^\d\s.]/g, '').trim().split(/\s+/).map(Number);
    return [r, g, b];
  };

  const luminance = ([r, g, b]: [number, number, number]) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const ratio = (a: string, b: string) => {
    const [la, lb] = [luminance(parse(a)), luminance(parse(b))];
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  };

  const WHITE = 'rgb(255 255 255)';

  for (const [family, paint] of Object.entries(FAMILY_PAINT)) {
    if (family === 'sound') continue;
    it(`${family}: pattern ink clears 3:1 on white`, () => {
      expect(ratio(paint.ink, WHITE)).toBeGreaterThanOrEqual(3);
    });
    it(`${family}: legend text clears 4.5:1 on its own tint`, () => {
      expect(ratio(paint.text, paint.tint)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('planned overlay clears 3:1 on white', () => {
    expect(ratio(PLANNED_PAINT.ink, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it('planned overlay text clears 4.5:1 on its own tint', () => {
    expect(ratio(PLANNED_PAINT.text, PLANNED_PAINT.tint)).toBeGreaterThanOrEqual(4.5);
  });

  it('the four families are distinguishable from each other', () => {
    /* Not a WCAG rule, a legibility one. Luminance ratio is the wrong
       instrument here: petrol and ink are close in luminance by design (ink
       "carries a trace of the petrol hue", tokens.css) but read as clearly
       different colours because the hue differs. Euclidean RGB distance is a
       crude proxy, but it is the axis that actually distinguishes these
       four, and a real collision — two families sharing a hue — collapses
       it toward zero rather than toward some ratio-specific number. */
    const distance = (a: string, b: string) => {
      const [ar, ag, ab] = parse(a);
      const [br, bg, bb] = parse(b);
      return Math.hypot(ar - br, ag - bg, ab - bb);
    };
    const solids = Object.entries(FAMILY_PAINT)
      .filter(([f]) => f !== 'sound')
      .map(([, p]) => p.solid)
      .concat(PLANNED_PAINT.solid);
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        expect(distance(solids[i], solids[j])).toBeGreaterThan(40);
      }
    }
  });
});

describe('FDI coverage', () => {
  it('paints every adult tooth without throwing', () => {
    for (const fdi of ADULT_TEETH) {
      expect(fdi).toMatch(/^[1-4][1-8]$/);
    }
  });
});
