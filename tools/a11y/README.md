# Accessibility checks

Run by hand against a local stack. Neither is part of the app build, and the Docker image leaves
this folder out. They drive the Chrome installed on the machine, so they download no browser.

```bash
npm ci
export A11Y_EMAIL=… A11Y_PASSWORD=… A11Y_PATIENT=<adult patient id> A11Y_CHILD=<child patient id>
export A11Y_BASE=http://localhost:4200 A11Y_API=http://localhost:8080/api/v1
```

Point them at a throwaway database: they open real dialogs and select real teeth.

## `audit.mjs`: every screen

```bash
node audit.mjs
```

Runs axe-core (WCAG 2.2 A and AA, plus its best-practice rules) on every route and dossier tab, in
light and dark, in French and Arabic, and at phone width. Beside that it checks what axe has no rule
for: each screen's title and h1, that focus can be seen at every Tab stop and never gets stuck, that
nothing with a pointer cursor is out of the keyboard's reach, that each dialog takes focus, closes on
Escape and gives focus back, and that nothing scrolls sideways at 320px.

`A11Y_ONLY=/stock` limits it to matching paths. `A11Y_THEMES`, `A11Y_LANGS`, `A11Y_DIALOGS=0` and
`A11Y_TAB=0` narrow it further. It writes every finding to `a11y-report.json` (`A11Y_OUT`).

`/billing/quotes` is reported as redirected on purpose: quotes are not built yet.

## `chart-keys.mjs`: both dental charts, from the keyboard

```bash
A11Y_SHOTS=/some/folder node chart-keys.mjs
```

Presses the real keys on the 3D chart, the 2D chart as a charting tool (with WebGL off, as the
fallback is) and the 2D chart in the treatment summary, and checks where focus and the chart end up
after each. `A11Y_SHOTS` saves a screenshot of each state.

## What these cannot tell you

Automated checks find perhaps a third of what goes wrong. Nothing here listens to a screen reader,
judges whether a label makes sense, or checks that a chart's description is any use. Those take a
person, with NVDA or VoiceOver, going through the main tasks with the mouse unplugged.

`src/app/testing/template-a11y.spec.ts` runs with the unit tests and covers what only a template can
show, such as the forms inside dialogs nobody has opened.
