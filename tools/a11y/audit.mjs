/**
 * Scans every screen of a running OrthoFlow for WCAG 2.2 A/AA failures.
 *
 * axe-core finds what a machine can find. Beside it this checks what axe does not: that each
 * screen has its own title and one h1, that nothing clickable is out of reach of the keyboard,
 * that keyboard focus can be seen at every stop, that a dialog takes focus, lets go on Escape
 * and hands focus back, and that a phone-width screen does not scroll sideways.
 *
 * It drives the Chrome installed on the machine, so it downloads no browser.
 *
 *   A11Y_EMAIL=… A11Y_PASSWORD=… A11Y_PATIENT=<adult id> A11Y_CHILD=<child id> node audit.mjs
 *
 * Optional: A11Y_BASE (http://localhost:4200), A11Y_API (http://localhost:8080/api/v1),
 * A11Y_ONLY (a substring of the paths to scan), A11Y_THEMES (light,dark), A11Y_LANGS (fr,ar),
 * A11Y_DIALOGS (0 to skip opening dialogs), A11Y_TAB (0 to skip walking the page with Tab),
 * A11Y_NARROW (1 for the phone-width pass alone),
 * A11Y_OUT (report path). The dialogs it opens are real, and a scan may leave a draft behind,
 * so point it only at a throwaway database.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const env = process.env;
const BASE = env.A11Y_BASE ?? 'http://localhost:4200';
const API = env.A11Y_API ?? 'http://localhost:8080/api/v1';
const ONLY = env.A11Y_ONLY ?? '';
const THEMES = (env.A11Y_THEMES ?? 'light,dark').split(',');
const LANGS = (env.A11Y_LANGS ?? 'fr,ar').split(',');
const WITH_DIALOGS = env.A11Y_DIALOGS !== '0';
const WITH_TAB = env.A11Y_TAB !== '0';
const OUT = env.A11Y_OUT ?? 'a11y-report.json';
const ONLY_NARROW = env.A11Y_NARROW === '1';
const patient = env.A11Y_PATIENT ?? '';
const child = env.A11Y_CHILD ?? '';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const PUBLIC_ROUTES = [
  '/login', '/forgot-password', '/reset-password?token=none', '/landing',
  '/public/book/none', '/public/register/none', '/public/survey/none',
];

const ROUTES = [
  '/', '/patients', '/patients/register', '/patients/duplicates',
  ...(patient ? [`/patients/${patient}`, `/patients/${patient}/edit`] : []),
  ...(child ? [`/patients/${child}`] : []),
  '/recalls', '/front-desk', '/schedule',
  '/settings/practice', '/settings/hours', '/settings/team', '/settings/users', '/settings/agenda', '/settings/booking', '/settings/help-notes', '/settings/insurers',
  '/insurance-forms', '/prescription-templates', '/account', '/lab-orders', '/tasks', '/messages',
  '/communication/logs', '/communication/inbox', '/communication/templates', '/communication/settings',
  '/booking/requests', '/booking/registrations', '/surveys',
  '/retrocessions/simulation', '/retrocessions/statements', '/retrocessions/rules', '/retrocessions/advances',
  '/analytics/procedures', '/analytics/time', '/analytics/income', '/analytics/goals', '/analytics/tax', '/analytics/leakage', '/analytics/forecast',
  '/sterilization/dashboard', '/sterilization/scan', '/sterilization/items', '/sterilization/cycles', '/sterilization/trace', '/sterilization/endo',
  '/finance/dashboard', '/finance/collections', '/finance/cash', '/finance/debts', '/finance/instalments', '/finance/cheques', '/finance/expenses', '/finance/tax-documents',
  '/billing/invoices', '/billing/invoices/create', '/billing/quotes',
  '/stock', '/stock/procurement', '/stock/direct-sales', '/stock/treatment-sessions', '/stock/leakage', '/stock/forecast',
  '/treatments',
];

/** The dossier keeps its tabs in memory, so they are clicked rather than visited. */
const DOSSIER_TABS = ['overview', 'clinical', 'financial', 'documents', 'voice'];

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  // WCAG 2.5.3, which axe leaves out by default: a label must contain the words on the control.
  rules: { 'label-content-name-mismatch': { enabled: true } },
  resultTypes: ['violations'],
};

const OPENER = /^\s*(\+\s*)?(nouveau|nouvelle|ajouter|créer|cr[ée]ation|new|add|create|importer|import)\b/i;

const findings = [];
const record = (route, state, kind, id, detail) => findings.push({ route, state, kind, id, detail });

async function runAxe(page, route, state, selector) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async ([options, scope]) => {
    const results = await window.axe.run(scope ?? document, options);
    return results.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => /^wcag\d|best-practice/.test(t)),
      nodes: v.nodes.slice(0, 40).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 180), why: (n.any[0]?.message ?? n.all[0]?.message ?? n.none[0]?.message ?? '').slice(0, 180) })),
      count: v.nodes.length,
    }));
  }, [AXE_OPTIONS, selector]);
  for (const v of violations) record(route, state, 'axe', v.id, v);
}

/** Facts axe has no rule for. */
async function pageFacts(page, route, state, narrow) {
  const facts = await page.evaluate((isNarrow) => {
    const isVisible = (el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    const interactive = 'a[href],button,input,select,textarea,summary,label,[role],[tabindex],[contenteditable]';

    // What looks clickable and cannot be reached: a pointer cursor on something the keyboard skips.
    const mouseOnly = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!isVisible(el) || el.closest(interactive) || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer' && !el.parentElement.closest(interactive) && mouseOnly.includes(describe(el.parentElement))) continue;
      mouseOnly.push(describe(el));
    }
    // What runs past the edge of the window with nothing around it to scroll it, innermost last.
    const clipped = (el) => {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const overflow = getComputedStyle(up).overflowX;
        if (overflow !== 'visible' && overflow !== 'clip') return true;
      }
      return false;
    };
    const wide = !isNarrow ? [] : [...document.querySelectorAll('body *')]
      .filter((el) => isVisible(el) && el.getBoundingClientRect().right > window.innerWidth + 1 && !clipped(el))
      .map((el) => `${describe(el)} → ${Math.round(el.getBoundingClientRect().right)}`);
    return {
      wide: wide.slice(-3),
      title: document.title,
      h1: [...document.querySelectorAll('h1')].filter(isVisible).length,
      main: document.querySelectorAll('main,[role=main]').length,
      overflow: isNarrow ? Math.max(0, document.documentElement.scrollWidth - window.innerWidth) : 0,
      mouseOnly: mouseOnly.slice(0, 30),
    };
  }, narrow);
  if (!facts.title || facts.title.trim() === 'OrthoFlow') record(route, state, 'fact', 'page-title-generic', `"${facts.title}"`);
  if (facts.h1 !== 1) record(route, state, 'fact', 'h1-count', `${facts.h1} h1`);
  if (facts.main !== 1) record(route, state, 'fact', 'main-count', `${facts.main} main`);
  if (facts.overflow > 0) record(route, state, 'fact', 'reflow-overflow', `${facts.overflow}px sideways at 320px: ${facts.wide.join(' ; ')}`);
  for (const what of facts.mouseOnly) record(route, state, 'fact', 'mouse-only', what);
}

/** Walks the page with Tab: every stop must show that it has focus, and focus must never get stuck. */
async function walkTab(page, route, state, stops = 60) {
  await page.evaluate(() => { document.body.focus(); window.scrollTo(0, 0); });
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      // A date field's calendar button is its own focus stop inside the browser's shadow DOM, with its own ring.
      const insideField = !el.matches(':focus') && el.tagName === 'INPUT';
      const shown = insideField || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || (style.boxShadow !== 'none' && style.boxShadow !== '') || style.textDecorationLine === 'underline';
      // Counted per element: a date field takes several presses of Tab on its own, a trap takes many.
      const presses = el === window.__a11yLast ? (window.__a11yPresses ?? 0) + 1 : 0;
      window.__a11yLast = el;
      window.__a11yPresses = presses;
      return { what: `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`, shown, presses };
    });
    if (!stop) break;
    if (!stop.shown) record(route, state, 'fact', 'focus-not-visible', stop.what);
    if (stop.presses > 6) { record(route, state, 'fact', 'keyboard-trap', stop.what); break; }
  }
}

/** Opens what looks like it opens a dialog: it must be one, take focus, close on Escape and give focus back. */
async function tryDialogs(page, route, state) {
  const openers = page.locator('main button:visible');
  const count = Math.min(await openers.count(), 80);
  const labels = [];
  for (let i = 0; i < count; i++) {
    const text = ((await openers.nth(i).innerText().catch(() => '')) ?? '').trim();
    if (OPENER.test(text)) labels.push(text);
  }
  for (const label of [...new Set(labels)].slice(0, 4)) {
    const button = page.locator('main button:visible', { hasText: label }).first();
    const before = route + page.url();
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await button.focus().catch(() => undefined);
    await button.evaluate((el) => el.setAttribute('data-a11y-opener', '')).catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(350);
    if (page.url() + route !== before && !page.url().endsWith(route)) {
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(300);
      continue;
    }
    const opened = await page.evaluate(() => {
      const dialog = document.querySelector('[role=dialog],[role=alertdialog]');
      const bare = [...document.querySelectorAll('body *')].find((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.position === 'fixed' && box.width >= window.innerWidth - 2 && box.height >= window.innerHeight - 2 && el.children.length > 0 && !el.closest('app-sidebar');
      });
      if (!dialog && !bare) return null;
      const root = dialog ?? bare;
      return { semantic: !!dialog, focusInside: root.contains(document.activeElement) };
    });
    if (!opened) continue;
    const dialogState = `${state} › dialog "${label.slice(0, 30)}"`;
    if (!opened.semantic) record(route, dialogState, 'fact', 'dialog-no-role', label);
    if (!opened.focusInside) record(route, dialogState, 'fact', 'dialog-focus-outside', label);
    await runAxe(page, route, dialogState, opened.semantic ? '[role=dialog],[role=alertdialog]' : undefined);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closed = await page.evaluate(() => {
      const stillOpen = !!document.querySelector('[role=dialog],[role=alertdialog]') || [...document.querySelectorAll('body *')].some((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.position === 'fixed' && box.width >= window.innerWidth - 2 && box.height >= window.innerHeight - 2 && el.children.length > 0 && !el.closest('app-sidebar');
      });
      return { stillOpen, focusBack: !!document.activeElement?.hasAttribute('data-a11y-opener') };
    });
    if (closed.stillOpen) {
      record(route, dialogState, 'fact', 'dialog-no-escape', label);
      await page.goto(page.url());
      await settle(page);
    } else if (!closed.focusBack) {
      record(route, dialogState, 'fact', 'dialog-focus-not-returned', label);
    }
  }
}

/** The app polls for its counts, so the network never goes quiet: a few seconds is all that is worth waiting. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(200);
}

async function scan(page, route, state, narrow, extra) {
  await runAxe(page, route, state);
  await pageFacts(page, route, state, narrow);
  if (extra) {
    if (WITH_TAB) await walkTab(page, route, state);
    if (WITH_DIALOGS) await tryDialogs(page, route, state);
  }
}

async function login() {
  if (!env.A11Y_EMAIL) return null;
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.A11Y_EMAIL, password: env.A11Y_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  return response.json();
}

function summarise() {
  const byRule = new Map();
  for (const f of findings) {
    const key = `${f.kind}:${f.id}`;
    const entry = byRule.get(key) ?? { routes: new Set(), nodes: 0, impact: f.detail?.impact ?? '' };
    entry.routes.add(f.route);
    entry.nodes += f.detail?.count ?? 1;
    byRule.set(key, entry);
  }
  const rows = [...byRule.entries()].sort((a, b) => b[1].nodes - a[1].nodes);
  console.log('\nRule                                   Nodes  Screens  Impact');
  for (const [rule, e] of rows) console.log(`${rule.padEnd(38)} ${String(e.nodes).padStart(5)}  ${String(e.routes.size).padStart(7)}  ${e.impact}`);
  console.log(`\n${findings.length} findings across ${new Set(findings.map((f) => f.route)).size} screens. Details: ${OUT}`);
}

const session = await login();
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const contextFor = async (theme, lang, viewport, signedIn) => {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await context.addInitScript(([t, l, s]) => {
    localStorage.setItem('orthoflow_theme', t);
    localStorage.setItem('orthoflow_lang', l);
    if (s) {
      localStorage.setItem('orthoflow_auth_token', s.token);
      localStorage.setItem('orthoflow_auth_user', JSON.stringify(s.user ?? s));
    }
  }, [theme, lang, signedIn ? session : null]);
  return context;
};

const visit = async (page, route) => {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
};

// The fullest pass: light French at desktop width, with the keyboard walk and the dialogs.
const passes = [];
if (!ONLY_NARROW) for (const theme of THEMES) for (const lang of LANGS) {
  const first = theme === THEMES[0] && lang === LANGS[0];
  // Colours are what change between themes, and direction is what changes between languages,
  // so only the first pass walks every stop and opens every dialog.
  passes.push({ theme, lang, viewport: { width: 1366, height: 900 }, narrow: false, extra: first, name: `${theme}/${lang}` });
}
passes.push({ theme: THEMES[0], lang: LANGS[0], viewport: { width: 320, height: 720 }, narrow: true, extra: false, name: `${THEMES[0]}/${LANGS[0]}/320px` });

for (const pass of passes) {
  const started = Date.now();
  for (const signedIn of [false, true]) {
    if (signedIn && !session) continue;
    const context = await contextFor(pass.theme, pass.lang, pass.viewport, signedIn);
    const page = await context.newPage();
    for (const route of signedIn ? ROUTES : PUBLIC_ROUTES) {
      if (ONLY && !route.includes(ONLY)) continue;
      try {
        await visit(page, route);
        const landed = new URL(page.url()).pathname;
        if (landed !== route.split('?')[0] && route !== '/') record(route, pass.name, 'fact', 'redirected', landed);
        await scan(page, route, pass.name, pass.narrow, pass.extra);
        if (route === `/patients/${patient}` || route === `/patients/${child}`) {
          for (const tab of DOSSIER_TABS) {
            const button = page.locator(`#dossier-tab-${tab}`);
            if (!(await button.count())) continue;
            await button.click();
            await settle(page);
            await scan(page, route, `${pass.name} › tab ${tab}`, pass.narrow, false);
          }
        }
      } catch (err) {
        record(route, pass.name, 'fact', 'scan-error', String(err).slice(0, 200));
      }
    }
    await context.close();
  }
  console.log(`${pass.name}: done in ${Math.round((Date.now() - started) / 1000)}s, ${findings.length} findings so far`);
  writeFileSync(OUT, JSON.stringify(findings, null, 1));
}

await browser.close();
summarise();
