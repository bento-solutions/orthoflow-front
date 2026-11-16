import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one design language of the 16 Nov 2026 UX audit (phase 5), held by the build: a screen that
 * writes money, dates, icons, type sizes or colours its own way fails here instead of drifting
 * back the way the audit found it (three money formats, sixteen date formats, two icon systems,
 * 58 text nodes under 12 px, 462 hex colours).
 */
const root = join(process.cwd(), 'src', 'app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return (name.endsWith('.ts') || name.endsWith('.css')) && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

const files = sources(root).map(path => ({ path: relative(root, path), text: readFileSync(path, 'utf-8') }));

/** Each line of every source matching `rx`, as `file:line: text`. */
function offending(rx: RegExp, skip: (path: string) => boolean = () => false): string[] {
  return files.filter(f => !skip(f.path)).flatMap(f => f.text.split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => rx.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line))
    .map(({ line, i }) => `${f.path}:${i + 1}: ${line.trim().slice(0, 120)}`));
}

/** Where a colour is data, not style: drawings, print, canvas and WebGL, chart series, colours people pick. */
const COLOUR_IS_DATA = /dental-chart-svg-data|perio-palette|consultation-documents|perio-print|agenda-config|theme\.service|dentition-engine|tooth-status\.ts|tooth-paint\.ts|perio-progression|perio-teeth|finance-dashboard|dashboard\.component|invoice-pdf|dental-chart\.component\.ts|dental-3d-chart\.component\.ts|treatment-chart\.component|team-settings|agenda-settings|absences|waiting-list|front-desk\.component|public-booking/;

describe('one design language', () => {
  it('writes money through the money pipe: no hand-written MAD or DH after an amount', () => {
    expect(offending(/\}\}\s*(MAD|DH)\b|\|\s*number[^}]*\}\}\s*(MAD|DH)|['`]\s*(MAD|DH)\s*['`]\s*\+|\$\{[^}]+\}\s*(MAD|DH)\b/)).toEqual([]);
  });

  it('writes dates through appDate, with the 24-hour clock', () => {
    // Kept on purpose: the seconds of a recording's clock, and the schedule's month names.
    expect(offending(/\|\s*date\s*(?:\}\}|\)|:\s*'(?!HH:mm:ss'|MMMM'))/)).toEqual([]);
    expect(offending(/hour12:\s*true/)).toEqual([]);
  });

  it('draws icons with app-icon only', () => {
    expect(offending(/class="[^"]*\bmaterial-icons\b/)).toEqual([]);
  });

  it('never sets text under 12 px', () => {
    const small = /font-size:\s*(0?\.(?:[0-6]\d*|7[0-4]\d*)rem|(?:[0-9]|1[01])(?:\.\d+)?px)\b|text-\[(?:[0-9]|1[01])px\]/;
    expect(offending(small, path => /svg-data|generated/.test(path))).toEqual([]);
  });

  it('takes colours from the tokens, not hex, wherever a colour is style', () => {
    // A declaration (`color: #fff`) or a Tailwind value (`bg-[#fff]`); SVG attributes and JS strings are data.
    const hexInStyle = /(?:^|[;{\s])[a-z-]+\s*:\s*[^;'"`]*#[0-9a-fA-F]{3,6}\b|-\[#[0-9a-fA-F]{3,6}\]/;
    expect(offending(hexInStyle, path => COLOUR_IS_DATA.test(path))).toEqual([]);
  });
});
