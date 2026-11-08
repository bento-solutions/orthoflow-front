/**
 * Presses the real keys on both dental charts, in a real browser, and checks where focus and the
 * chart end up after each. Needs what audit.mjs needs (see there), and leaves one tooth selected.
 *
 *   A11Y_EMAIL=… A11Y_PASSWORD=… A11Y_PATIENT=<adult id> A11Y_CHILD=<child id> node chart-keys.mjs
 *
 * A11Y_SHOTS names a folder for screenshots of each state.
 */
import { chromium } from 'playwright-core';

const env = process.env;
const BASE = env.A11Y_BASE ?? 'http://localhost:4200';
const API = env.A11Y_API ?? 'http://localhost:8080/api/v1';
const SHOTS = env.A11Y_SHOTS ?? '';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

const response = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.A11Y_EMAIL, password: env.A11Y_PASSWORD }),
});
const session = await response.json();

const open = async (args = []) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript((s) => {
    localStorage.setItem('orthoflow_lang', 'fr');
    localStorage.setItem('orthoflow_theme', 'light');
    localStorage.setItem('orthoflow_auth_token', s.token);
    localStorage.setItem('orthoflow_auth_user', JSON.stringify(s.user ?? s));
  }, session);
  return { browser, page: await context.newPage() };
};

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The tooth and role of whatever has focus. */
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { fdi: el?.dataset?.fdi ?? null, face: el?.dataset?.face ?? null, tag: el?.tagName.toLowerCase(), role: el?.getAttribute('role'), label: el?.getAttribute('aria-label') };
});

const tabUntilTooth = async (page) => {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const now = await focused(page);
    if (now.role === 'gridcell') return i + 1;
  }
  return -1;
};

const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
};

/** Whether what has focus can be seen: its ring is drawn and its middle is inside the stage. */
const focusIsVisible = (page, stage) => page.evaluate((selector) => {
  const el = document.activeElement;
  const box = el.getBoundingClientRect();
  const frame = document.querySelector(selector).getBoundingClientRect();
  const style = getComputedStyle(el);
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
    && x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
}, stage);

/** A tooth with no place on the drawing would take focus where nobody could see it. */
const everyToothPlaced = (page) => page.evaluate(() => [...document.querySelectorAll('app-dental-chart .tooth-cell')]
  .filter((cell) => { const box = cell.getBoundingClientRect(); return box.width < 4 || box.height < 4; })
  .map((cell) => cell.dataset.fdi));

async function threeD() {
  console.log('\n3D chart, adult');
  const { browser, page } = await open(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  await page.goto(`${BASE}/patients/${env.A11Y_PATIENT}`);
  await page.waitForSelector('.d3-stage', { timeout: 30000 }).catch(() => undefined);
  await page.locator('.d3-stage').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('.d3-overlay') && document.querySelector('.d3-label[data-fdi="18"]')?.style.transform.includes('px'), null, { timeout: 60000 });
  await page.waitForTimeout(300);

  const stops = await page.locator('.d3-label[tabindex="0"]').count();
  check('exactly one tooth is a tab stop', stops === 1, `${stops}`);

  await page.evaluate(() => document.querySelector('.d3-toolbar button').focus());
  const presses = await tabUntilTooth(page);
  let now = await focused(page);
  check('Tab reaches the teeth', presses > 0 && !!now.fdi, JSON.stringify(now));
  check('the first tooth is where Tab lands', now.fdi === '18', JSON.stringify(now));
  check('its name and what is on it are read out', /18/.test(now.label ?? ''), now.label);
  check('focus can be seen on the stage', await focusIsVisible(page, '.d3-stage'));
  await shot(page, '3d-1-focus-18');

  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  now = await focused(page);
  check('Right goes along the arch', now.fdi === '16', JSON.stringify(now));
  check('a tooth with findings says so', /carie/i.test(now.label ?? ''), now.label);
  await press(page, 'ArrowDown');
  check('Down goes to the opposing tooth', (await focused(page)).fdi === '46');
  await press(page, 'ArrowDown');
  check('Down stops at the bottom row', (await focused(page)).fdi === '46');
  await press(page, 'ArrowUp');
  await press(page, 'Home');
  check('Home goes to the start of the row', (await focused(page)).fdi === '18');
  await press(page, 'ArrowLeft');
  check('Left stops at the end of the row', (await focused(page)).fdi === '18');
  await press(page, 'End');
  check('End goes to the end of the row', (await focused(page)).fdi === '28');
  await press(page, '1');
  await press(page, '6');
  check('typing 16 goes to tooth 16', (await focused(page)).fdi === '16');
  const panelTooth = await page.locator('.d3-panel-fdi').innerText().catch(() => '');
  check('typing a number selects the tooth', panelTooth === '16', panelTooth);

  await press(page, 'Enter');
  await page.waitForTimeout(150);
  check('Enter closes in on the tooth', await page.locator('.d3-back').count() === 1);
  now = await focused(page);
  check('focus stays on the tooth', now.fdi === '16', JSON.stringify(now));
  check('the zoomed tooth\'s number is on the stage', await focusIsVisible(page, '.d3-stage'));
  check('its name shows', await page.locator('.d3-label[data-fdi="16"] .d3-name').count() === 1);
  await page.waitForTimeout(150);
  const live = await page.locator('app-live-region [role=status]').innerText();
  check('the zoom is announced', /16/.test(live), live);
  await shot(page, '3d-2-close-up-16');

  await press(page, 'ArrowRight');
  now = await focused(page);
  check('Right in close-up goes to the next tooth', now.fdi === '15', JSON.stringify(now));
  check('the camera comes along', await page.locator('.d3-label[data-fdi="15"] .d3-name').count() === 1);
  check('the panel follows', (await page.locator('.d3-panel-fdi').innerText()) === '15');
  check('the new tooth\'s number is on the stage', await focusIsVisible(page, '.d3-stage'));
  await press(page, 'ArrowLeft');

  await press(page, 'm');
  check('M picks the mesial face', await page.locator('.d3-face[data-face="mesial"][aria-pressed="true"]').count() === 1);
  await press(page, 'm');
  check('M again takes it back', await page.locator('.d3-face[data-face="mesial"][aria-pressed="true"]').count() === 0);

  await press(page, 'Tab');
  now = await focused(page);
  check('Tab from the tooth goes to its faces', !!now.face, JSON.stringify(now));
  await press(page, 'ArrowRight');
  const second = await focused(page);
  check('arrows go between faces', !!second.face && second.face !== now.face, JSON.stringify(second));
  await press(page, 'Escape');
  check('Escape from a face goes back to the tooth', (await focused(page)).fdi === '16');
  check('and stays in close-up', await page.locator('.d3-back').count() === 1);

  await press(page, 'Enter');
  now = await focused(page);
  check('Enter in close-up goes to the panel\'s first field', now.tag === 'select', JSON.stringify(now));
  await shot(page, '3d-3-panel');
  await press(page, 'Escape');
  check('Escape from the panel goes back to the tooth', (await focused(page)).fdi === '16');
  check('the tooth stays selected', (await page.locator('.d3-label[data-fdi="16"]').getAttribute('aria-selected')) === 'true');

  await press(page, 'Shift+ArrowRight');
  await page.waitForTimeout(150);
  check('Shift and an arrow turn the tooth, focus staying on it', (await focused(page)).fdi === '16');

  await press(page, 'Escape');
  check('Escape returns to the whole mouth', await page.locator('.d3-back').count() === 0);
  check('focus is on the same tooth', (await focused(page)).fdi === '16');
  check('and can be seen', await focusIsVisible(page, '.d3-stage'));
  await shot(page, '3d-4-back');

  await press(page, 'Shift+ArrowRight');
  await page.waitForTimeout(200);
  check('turning the mouth enables Reset', !(await page.locator('.d3-tool[aria-label="Revenir à la vue de départ"]').isDisabled()));
  await press(page, 'Escape');
  await page.waitForTimeout(200);
  check('Escape after turning goes back to the starting view', await page.locator('.d3-tool[aria-label="Revenir à la vue de départ"]').isDisabled());
  check('focus is not lost with the button', (await focused(page)).fdi === '16');
  await press(page, 'Escape');
  check('Escape clears the selection', (await page.locator('.d3-label[data-fdi="16"]').getAttribute('aria-selected')) === 'false');

  const ariaOk = await page.evaluate(() => {
    const grid = document.querySelector('.d3-labels[role=grid]');
    return !!grid && grid.querySelectorAll('[role=row]').length === 2 && grid.querySelectorAll('[role=row] > [role=gridcell]').length === 32 && !!document.getElementById(grid.getAttribute('aria-describedby'))?.textContent.trim();
  });
  check('it is a grid of two rows of 32 teeth, with its keys described', ariaOk);
  await browser.close();
}

async function twoDInteractive() {
  console.log('\n2D chart, charting: the fallback when there is no WebGL');
  const { browser, page } = await open(['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis']);
  await page.goto(`${BASE}/patients/${env.A11Y_PATIENT}`);
  await page.waitForSelector('app-dental-chart .tooth-cell', { timeout: 30000 });
  await page.locator('app-dental-chart').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const stops = await page.locator('app-dental-chart .tooth-cell[tabindex="0"]').count();
  check('exactly one tooth is a tab stop', stops === 1, `${stops}`);
  const covered = await page.evaluate(() => {
    const cell = document.querySelector('app-dental-chart [data-fdi="16"]').getBoundingClientRect();
    const hit = document.querySelector('app-dental-chart path.tooth-16-parent').getBoundingClientRect();
    return Math.abs(cell.left - hit.left) < 2 && Math.abs(cell.top - hit.top) < 2 && cell.width > 8;
  });
  check('the button lies over its tooth', covered);
  const unplaced = await everyToothPlaced(page);
  check('every tooth has its place on the drawing', unplaced.length === 0, unplaced.join(' '));

  await page.evaluate(() => document.querySelector('app-dental-chart').querySelector('.tooth-cell[tabindex="0"]').focus());
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  let now = await focused(page);
  check('Right goes along the arch', now.fdi === '16', JSON.stringify(now));
  check('the tooth is named with what is on it', /16.*carie/i.test(now.label ?? ''), now.label);
  check('focus can be seen', await focusIsVisible(page, 'app-dental-chart .svg-container'));
  check('the header says which tooth', (await page.locator('app-dental-chart .tooth-num').innerText()) === '#16');
  await shot(page, '2d-1-focus-16');
  await press(page, 'ArrowDown');
  check('Down goes to the opposing tooth', (await focused(page)).fdi === '46');
  await press(page, 'ArrowUp');

  await press(page, 'Enter');
  await page.waitForTimeout(450);
  check('Enter closes in on the tooth', await page.locator('app-dental-chart .svg-container.close-up').count() === 1);
  const transform = await page.locator('app-dental-chart .svg-stage').evaluate((el) => getComputedStyle(el).transform);
  check('the drawing is enlarged', transform !== 'none', transform);
  check('the tooth is in the middle of the chart', await page.evaluate(() => {
    const cell = document.querySelector('app-dental-chart [data-fdi="16"]').getBoundingClientRect();
    const frame = document.querySelector('app-dental-chart .svg-container').getBoundingClientRect();
    return Math.abs(cell.left + cell.width / 2 - (frame.left + frame.width / 2)) < 12 && Math.abs(cell.top + cell.height / 2 - (frame.top + frame.height / 2)) < 12;
  }));
  check('focus stays on the tooth', (await focused(page)).fdi === '16');
  await shot(page, '2d-2-close-up-16');

  await press(page, 'ArrowRight');
  await page.waitForTimeout(450);
  check('Right in close-up goes to the next tooth, and the view with it', (await focused(page)).fdi === '15' && await page.evaluate(() => {
    const cell = document.querySelector('app-dental-chart [data-fdi="15"]').getBoundingClientRect();
    const frame = document.querySelector('app-dental-chart .svg-container').getBoundingClientRect();
    return Math.abs(cell.left + cell.width / 2 - (frame.left + frame.width / 2)) < 12;
  }));
  await press(page, 'ArrowLeft');
  await page.waitForTimeout(300);

  await press(page, 'Enter');
  await page.waitForTimeout(300);
  check('Enter in close-up opens the tooth as a dialog', await page.locator('[role=dialog]').count() === 1);
  now = await focused(page);
  check('focus moves into it', await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')), JSON.stringify(now));
  await shot(page, '2d-3-dialog');
  await press(page, 'Escape');
  await page.waitForTimeout(150);
  check('Escape closes it', await page.locator('[role=dialog]').count() === 0);
  check('focus goes back to the tooth', (await focused(page)).fdi === '16');
  check('still in close-up', await page.locator('app-dental-chart .svg-container.close-up').count() === 1);
  await press(page, 'Escape');
  await page.waitForTimeout(450);
  check('Escape returns to the whole mouth', await page.locator('app-dental-chart .svg-container.close-up').count() === 0);
  check('focus is on the same tooth', (await focused(page)).fdi === '16');

  await press(page, ' ');
  await page.waitForTimeout(250);
  check('Space opens the tooth directly', await page.locator('[role=dialog]').count() === 1);
  await press(page, 'Escape');
  await page.waitForTimeout(150);

  await page.locator('app-dental-chart path.tooth-17-parent').click({ force: true });
  await page.waitForTimeout(250);
  check('a click on the drawing still opens the tooth', await page.locator('[role=dialog]').count() === 1);
  await press(page, 'Escape');
  await page.waitForTimeout(150);
  check('and closing it leaves focus on that tooth', (await focused(page)).fdi === '17');

  const ariaOk = await page.evaluate(() => {
    const chart = document.querySelector('app-dental-chart');
    const grid = chart.querySelector('[role=grid]');
    return !!grid && grid.querySelectorAll('[role=row]').length === 2 && grid.querySelectorAll('[role=gridcell]').length === 32
      && chart.querySelector('.svg-drawing').getAttribute('aria-hidden') === 'true' && !chart.querySelector('svg [tabindex]');
  });
  check('the drawing is hidden from screen readers, the grid stands in for it', ariaOk);
  await browser.close();
}

async function twoDSummary() {
  console.log('\n2D chart, reading: the treatment summary');
  const { browser, page } = await open(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  await page.goto(`${BASE}/patients/${env.A11Y_PATIENT}`);
  await page.waitForSelector('#dossier-tab-clinical');
  await page.locator('#dossier-tab-clinical').click();
  await page.waitForTimeout(400);
  const subtab = page.locator('.clinical-subtabs [role=tab]', { hasText: /traitement/i }).first();
  if (await subtab.count()) await subtab.click();
  await page.waitForSelector('app-treatment-chart .tooth-cell', { timeout: 30000 });
  await page.locator('app-treatment-chart').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await page.evaluate(() => document.querySelector('app-treatment-chart .tooth-cell[tabindex="0"]').focus());
  await press(page, '1');
  await press(page, '6');
  let now = await focused(page);
  check('typing 16 goes to tooth 16', now.fdi === '16', JSON.stringify(now));
  check('the legend\'s words for the tooth are read out', (now.label ?? '').length > '16, Première molaire'.length, now.label);
  await press(page, 'Enter');
  await page.waitForTimeout(450);
  check('Enter closes in, on a chart that only reads', await page.locator('app-treatment-chart .svg-container.close-up').count() === 1);
  await press(page, 'Enter');
  await page.waitForTimeout(150);
  check('Enter again opens nothing', await page.locator('[role=dialog]').count() === 0);
  await shot(page, '2d-4-summary-close-up');
  await press(page, 'Escape');
  await page.waitForTimeout(450);
  check('Escape returns to the whole chart', await page.locator('app-treatment-chart .svg-container.close-up').count() === 0);
  await press(page, 'Escape');
  check('Escape with nothing to go back to does nothing to focus', (await focused(page)).fdi === '16');
  await browser.close();
}

async function child() {
  console.log('\nBoth charts, on a child');
  let { browser, page } = await open(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  await page.goto(`${BASE}/patients/${env.A11Y_CHILD}`);
  await page.waitForSelector('.d3-stage', { timeout: 30000 });
  await page.locator('.d3-stage').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('.d3-overlay') && document.querySelector('.d3-label[data-fdi="55"]')?.style.transform.includes('px'), null, { timeout: 60000 });
  check('the 3D grid has twenty teeth', await page.locator('.d3-labels [role=gridcell]').count() === 20);
  await page.evaluate(() => document.querySelector('.d3-label[tabindex="0"]').focus());
  check('Tab lands on the first of them', (await focused(page)).fdi === '55');
  await press(page, 'ArrowDown');
  check('Down goes to the opposing tooth', (await focused(page)).fdi === '85');
  await press(page, 'End');
  check('End goes to the end of the row', (await focused(page)).fdi === '75');
  await press(page, '1');
  await press(page, '6');
  check('a tooth this chart does not have goes nowhere', (await focused(page)).fdi === '75');
  await browser.close();

  ({ browser, page } = await open(['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis']));
  await page.goto(`${BASE}/patients/${env.A11Y_CHILD}`);
  await page.waitForSelector('app-dental-chart .tooth-cell', { timeout: 30000 });
  await page.waitForTimeout(500);
  check('the 2D grid has twenty teeth', await page.locator('app-dental-chart .tooth-cell').count() === 20);
  const lost = await everyToothPlaced(page);
  check('every one has its place on the drawing', lost.length === 0, lost.join(' '));
  await browser.close();
}

await threeD();
await twoDInteractive();
await twoDSummary();
await child();
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
