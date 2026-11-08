import '@angular/compiler';
import {
  TmplAstBoundAttribute,
  TmplAstBoundEvent,
  TmplAstContent,
  TmplAstDeferredBlock,
  TmplAstElement,
  TmplAstForLoopBlock,
  TmplAstIfBlock,
  TmplAstNode,
  TmplAstSwitchBlock,
  TmplAstTemplate,
  TmplAstText,
  TmplAstBoundText,
  TmplAstTextAttribute,
  parseTemplate,
} from '@angular/compiler';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reads every template in the app and fails on what a keyboard or a screen reader cannot get past.
 *
 * A scan of the running app only sees what is on screen, and most forms here live in dialogs that
 * are closed until someone opens them. A template is all there, always, so these rules hold for
 * screens nobody has opened since they were last changed.
 */

const root = join(process.cwd(), 'src', 'app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

interface Template {
  readonly file: string;
  readonly source: string;
  /** Lines before the template, so a message can point at the line in the file. */
  readonly lineOffset: number;
}

/** Every inline template. Templates here hold no nested backticks, so the first closing one ends it. */
function templates(): Template[] {
  return sourceFiles(root).flatMap((path) => {
    const text = readFileSync(path, 'utf-8');
    const found: Template[] = [];
    const opening = /\btemplate:\s*`/g;
    for (let match = opening.exec(text); match; match = opening.exec(text)) {
      const start = match.index + match[0].length;
      const end = text.indexOf('`', start);
      found.push({
        file: relative(root, path),
        source: text.slice(start, end),
        lineOffset: text.slice(0, start).split('\n').length - 1,
      });
    }
    return found;
  });
}

const NATIVE_CONTROLS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label', 'option', 'details']);
const WIDGET_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'gridcell', 'row', 'combobox', 'slider', 'spinbutton', 'treeitem']);
const LABELLED_BY_ITS_OWN_TYPE = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

type Attrs = ReadonlyMap<string, string>;

function attributesOf(element: TmplAstElement): Attrs {
  const attrs = new Map<string, string>();
  for (const attr of element.attributes as TmplAstTextAttribute[]) attrs.set(attr.name, attr.value);
  for (const input of element.inputs as TmplAstBoundAttribute[]) {
    // `[attr.aria-label]` and `[aria-label]` alike: bound, and so present whatever its value.
    attrs.set(input.name, '{bound}');
  }
  return attrs;
}

const eventNames = (element: TmplAstElement) => (element.outputs as TmplAstBoundEvent[]).map((o) => o.name);

function isIcon(node: TmplAstNode): boolean {
  if (!(node instanceof TmplAstElement)) return false;
  if (node.name === 'app-icon' || node.name === 'svg') return true;
  return (attributesOf(node).get('class') ?? '').includes('material-icons');
}

/** Whether anything under the node would be read out as text. */
function hasText(nodes: readonly TmplAstNode[]): boolean {
  return nodes.some((node) => {
    if (node instanceof TmplAstBoundText) return true;
    if (node instanceof TmplAstText) return node.value.trim().length > 0;
    if (node instanceof TmplAstContent) return true;
    if (node instanceof TmplAstElement) {
      if (isIcon(node) || attributesOf(node).get('aria-hidden') === 'true') return false;
      if (node.name === 'img') return attributesOf(node).has('alt');
      if (attributesOf(node).has('ngTemplateOutlet')) return true;
      return attributesOf(node).has('aria-label') || hasText(node.children);
    }
    return childrenOf(node).some((list) => hasText(list));
  });
}

/** The lists of children under anything that is not an element. */
function childrenOf(node: TmplAstNode): (readonly TmplAstNode[])[] {
  if (node instanceof TmplAstTemplate) return [node.children];
  if (node instanceof TmplAstIfBlock) return node.branches.map((b) => b.children);
  if (node instanceof TmplAstForLoopBlock) return [node.children, ...(node.empty ? [node.empty.children] : [])];
  if (node instanceof TmplAstSwitchBlock) return node.groups.flatMap((c) => [c.children]);
  if (node instanceof TmplAstDeferredBlock) {
    return [node.children, node.loading?.children ?? [], node.placeholder?.children ?? [], node.error?.children ?? []];
  }
  return [];
}

function containsControl(nodes: readonly TmplAstNode[]): boolean {
  return nodes.some((node) => {
    if (node instanceof TmplAstElement) return node.name === 'button' || node.name === 'a' || containsControl(node.children);
    return childrenOf(node).some(containsControl);
  });
}

interface Finding {
  readonly rule: string;
  readonly at: string;
  readonly what: string;
}

function lint(template: Template): Finding[] {
  const findings: Finding[] = [];
  const parsed = parseTemplate(template.source, template.file, { preserveWhitespaces: false });
  const report = (rule: string, element: TmplAstElement) => {
    const line = template.lineOffset + element.sourceSpan.start.line + 1;
    findings.push({ rule, at: `${template.file}:${line}`, what: element.sourceSpan.toString().slice(0, 90).replace(/\s+/g, ' ') });
  };

  // Every `for` in the template, bound or not, as a control may be labelled from anywhere in it.
  const labelTargets = new Set<string>();
  const collect = (nodes: readonly TmplAstNode[]) => {
    for (const node of nodes) {
      if (node instanceof TmplAstElement) {
        if (node.name === 'label') {
          const label = node.attributes.find((a) => a.name === 'for')?.value;
          const bound = node.inputs.find((i) => i.name === 'for' || i.name === 'htmlFor');
          if (label) labelTargets.add(label);
          if (bound) labelTargets.add((bound.value as unknown as { source?: string }).source ?? '{bound}');
        }
        collect(node.children);
      } else {
        childrenOf(node).forEach(collect);
      }
    }
  };
  collect(parsed.nodes);

  const visit = (nodes: readonly TmplAstNode[], insideLabel: boolean) => {
    for (const node of nodes) {
      if (!(node instanceof TmplAstElement)) {
        childrenOf(node).forEach((list) => visit(list, insideLabel));
        continue;
      }
      check(node, insideLabel);
      visit(node.children, insideLabel || node.name === 'label');
    }
  };

  const check = (element: TmplAstElement, insideLabel: boolean) => {
    const attrs = attributesOf(element);
    const events = eventNames(element);
    const name = element.name;
    const role = attrs.get('role') ?? '';
    const classes = attrs.get('class') ?? '';
    const named = attrs.has('aria-label') || attrs.has('aria-labelledby') || attrs.has('appDialog');

    if (classes.split(/\s+/).includes('material-icons') && !attrs.has('aria-hidden') && !named) {
      report('icon-ligature-read-aloud', element);
    }

    if ((name === 'button' || name === 'a') && !named && !hasText(element.children)) {
      report('control-without-a-name', element);
    }

    if (name === 'button' && !attrs.has('type') && !attrs.has('attr.type')) {
      report('button-without-type', element);
    }

    if (events.includes('click') && !NATIVE_CONTROLS.has(name)) {
      const handler = element.outputs.find((o) => o.name === 'click')?.handlerSpan.toString() ?? '';
      const stopsOnly = /^\(click\)="\$event\.stopPropagation\(\)"$|stopPropagation\(\)"?$/.test(handler.trim());
      // A backdrop is a shortcut for the mouse: every dialog also closes on Escape and has a close button.
      const backdrop = attrs.get('aria-hidden') === 'true' || /backdrop|overlay|lightbox/.test(classes);
      // An option in a list that a field controls: focus stays in the field, whose arrows reach it.
      const keyboardToo = role === 'option' || (WIDGET_ROLES.has(role) && attrs.has('tabindex') && events.some((e) => e.startsWith('keydown')));
      // A row or a day is a larger target for the link or button inside it, which the keyboard uses.
      const controlInside = containsControl(element.children);
      if (!stopsOnly && !backdrop && !keyboardToo && !controlInside) report('click-without-keyboard', element);
    }

    if ((name === 'input' || name === 'select' || name === 'textarea') && !LABELLED_BY_ITS_OWN_TYPE.has(attrs.get('type') ?? '')) {
      const id = attrs.get('id');
      const boundId = attrs.get('attr.id') ?? attrs.get('id');
      const labelled = named || insideLabel || (id && id !== '{bound}' && labelTargets.has(id)) || (boundId === '{bound}' && labelTargets.size > 0);
      if (!labelled) report('field-without-a-label', element);
    }

    if (name === 'img' && !attrs.has('alt') && !attrs.has('attr.alt')) report('image-without-alt', element);

    if (name === 'th' && !attrs.has('scope') && !attrs.has('attr.scope')) report('header-without-scope', element);

    const tabindex = attrs.get('tabindex');
    if (tabindex && tabindex !== '{bound}' && Number(tabindex) > 0) report('positive-tabindex', element);

    if (attrs.has('autofocus')) report('autofocus', element);

    if (role === 'tab' && name === 'a') report('link-pretending-to-be-a-tab', element);

    if ((role === 'dialog' || role === 'alertdialog') && !named) report('dialog-without-a-name', element);

    if (name === 'a' && !attrs.has('href') && !attrs.has('routerLink') && !attrs.has('attr.href')) report('link-without-a-target', element);

    if (attrs.get('target') === '_blank' && !(attrs.get('rel') ?? '').includes('noopener')) report('new-window-without-noopener', element);
  };

  visit(parsed.nodes, false);
  return findings;
}

describe('every template in the app', () => {
  const all = templates();

  it('is found by this test', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('has nothing a keyboard or a screen reader cannot get past', () => {
    const findings = all.flatMap(lint);
    const report = findings.map((f) => `${f.rule}  ${f.at}  ${f.what}`).join('\n');
    expect(findings.length, `\n${report}\n`).toBe(0);
  });
});
