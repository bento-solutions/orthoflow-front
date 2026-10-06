import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The translations are three hand-edited files, which is how a key ends up in
 * French and missing in Arabic, or typed one letter differently in a template and
 * shown to a patient as `FINANCE.DEBT_LISRT`. These tests make both fail the build.
 */

const root = join(process.cwd(), 'public', 'i18n');
const load = (lang: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, `${lang}.json`), 'utf-8'));
const LANGS = ['fr', 'en', 'ar'] as const;

type Leaf = { path: string; value: string };

function leaves(node: unknown, path: string[] = []): Leaf[] {
  if (typeof node === 'string') {
    return [{ path: path.join('.'), value: node }];
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
  }
  return [{ path: path.join('.'), value: String(node) }];
}

const flat = Object.fromEntries(LANGS.map(lang => [lang, new Map(leaves(load(lang)).map(l => [l.path, l.value]))]));

describe('translation files', () => {
  it('have exactly the same keys in French, English and Arabic', () => {
    const fr = new Set(flat['fr'].keys());
    for (const lang of ['en', 'ar'] as const) {
      const other = new Set(flat[lang].keys());
      expect([...fr].filter(k => !other.has(k)), `in fr but missing from ${lang}`).toEqual([]);
      expect([...other].filter(k => !fr.has(k)), `in ${lang} but missing from fr`).toEqual([]);
    }
  });

  it('never leave a translation empty', () => {
    for (const lang of LANGS) {
      const empty = [...flat[lang]].filter(([, value]) => value.trim() === '').map(([key]) => key);
      expect(empty, `empty in ${lang}`).toEqual([]);
    }
  });

  it('use the same {{placeholders}} in every language', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]).sort();
    const mismatched: string[] = [];
    for (const [key, fr] of flat['fr']) {
      for (const lang of ['en', 'ar'] as const) {
        const other = flat[lang].get(key);
        if (other !== undefined && placeholders(fr).join() !== placeholders(other).join()) {
          mismatched.push(`${key} (${lang})`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('translation keys used in the code', () => {
  // 'NAMESPACE.KEY' used as a static string with the translate pipe or service.
  const usage = [
    /'([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)'\s*\|\s*translate/g,
    /\.(?:instant|get|stream)\(\s*'([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)'/g,
  ];

  it('all exist in the translation files', () => {
    const known = flat['fr'];
    const missing: string[] = [];
    for (const file of sources(join(process.cwd(), 'src', 'app'))) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of usage) {
        for (const match of text.matchAll(pattern)) {
          if (!known.has(match[1])) {
            missing.push(`${file.replace(process.cwd() + '/', '')}: ${match[1]}`);
          }
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
