/**
 * Raw-CSS support for game UI.
 *
 * A UI document carries a stylesheet (`doc.css`) and every element may carry its own snippet
 * (`element.css`). Both are authored as ordinary CSS — the whole point of the escape hatch is that
 * a browser-based engine should let you use the browser's own styling language: gradients,
 * pseudo-elements, `:hover`, media queries, keyframes — none of which the flat `UIStyle` model can
 * express.
 *
 * The catch is that a game's stylesheet lands in the same DOM as the editor. Injected raw, a kit's
 * `html, body { background: #101819 }` repaints the whole app and its `:root { --accent: … }` block
 * hijacks the editor's own design tokens. So every sheet is rewritten before it is injected:
 *
 *  - every selector is prefixed with the document's scope attribute, so a rule can only ever match
 *    inside that widget;
 *  - page-level selectors (`:root`, `html`, `body`, `:host`) collapse ONTO the scope, so a kit's
 *    custom-property block and page background style the widget frame instead of the editor;
 *  - a `*` reset covers the frame and its subtree, nothing else;
 *  - `#name` becomes `.id-name`, because elements render their `className` and never a DOM id
 *    (captured kits already ship their ids as `id-name` classes);
 *  - `position: fixed` becomes `absolute`, so a region anchored to the page anchors to the widget
 *    frame instead of escaping it;
 *  - `@keyframes` are namespaced per document, so two installed kits can both define `pulse`;
 *  - `@import` is hoisted to the top, where CSS requires it.
 *
 * The result is stable for a given input, so hosts can memoize on the document identity.
 */
import type { UIDocument, UIElement } from '../types';

/** Attribute stamped on a UI document's wrapper; the anchor every scoped selector hangs off. */
export const UI_DOC_SCOPE_ATTR = 'data-uidoc';
/** Attribute stamped on every rendered element; the anchor for per-element CSS (and editor hit-testing). */
export const UI_ELEMENT_ATTR = 'data-uiel-id';
/**
 * A component instance renders its component's ROOT, so that node's `data-uiel-id` is the
 * instance's. This carries the component root's own id alongside it, so CSS attached to the root
 * inside the component still matches when it is drawn as an instance.
 */
export const UI_ELEMENT_SRC_ATTR = 'data-uiel-src';

/** Selector matching one document's wrapper. */
export function uiDocScope(docId: string): string {
  return `[${UI_DOC_SCOPE_ATTR}="${cssAttrValue(docId)}"]`;
}

/**
 * Selector matching one element inside its document. A document's ROOT also matches through
 * `data-uiel-src`, because when the document is drawn as a component instance its root carries the
 * instance's id in `data-uiel-id`.
 */
export function uiElementScope(docId: string, elementId: string, isRoot = false): string {
  const scope = uiDocScope(docId);
  const own = `${scope} [${UI_ELEMENT_ATTR}="${cssAttrValue(elementId)}"]`;
  return isRoot ? `${own}, ${scope}[${UI_ELEMENT_SRC_ATTR}="${cssAttrValue(elementId)}"]` : own;
}

export interface ScopeOptions {
  /** Prefix applied to `@keyframes` names (and their references) so documents can't collide. */
  keyframePrefix?: string;
}

/**
 * Build the complete stylesheet for a document: its own CSS followed by every element's snippet.
 * Element rules come last so they win ties against document rules targeting the same node.
 *
 * Component instances pull their component's sheet in too. Each is emitted once, scoped to that
 * component's own doc scope — and since every instance wrapper carries that scope attribute, one
 * copy of the rules styles every instance.
 */
export function buildUIDocumentCss(doc: UIDocument, resolveComponent?: (id: string) => UIDocument | undefined): string {
  const parts: string[] = [];
  const emitted = new Set<string>();

  const emit = (current: UIDocument) => {
    if (emitted.has(current.id)) return;
    emitted.add(current.id);
    const prefix = keyframePrefix(current.id);
    if (current.css && current.css.trim()) parts.push(scopeUICss(current.css, uiDocScope(current.id), { keyframePrefix: prefix }));
    forEachElement(current.root, (el) => {
      if (el.css && el.css.trim()) {
        const scope = uiElementScope(current.id, el.id, el.id === current.root.id);
        parts.push(scopeUICss(normalizeElementCss(el.css), scope, { keyframePrefix: prefix }));
      }
      // `emitted` doubles as the cycle guard: a component that reaches itself is already in the set.
      if (el.kind === 'component' && el.componentId) {
        const source = resolveComponent?.(el.componentId);
        if (source) emit(source);
      }
    });
  };

  emit(doc);
  return parts.join('\n');
}

/**
 * Element CSS is authored two ways: a bare declaration list (`color: gold; border-radius: 8px`)
 * that styles the element itself, or full rules where `&` means the element. Normalize the first
 * form into the second so the scoper only has to deal with rules.
 */
export function normalizeElementCss(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutComments.includes('{') ? css : `& { ${css} }`;
}

/** Namespace for a document's `@keyframes`. Ids are already ident-safe; sanitize anyway. */
export function keyframePrefix(docId: string): string {
  return `${docId.replace(/[^\w-]/g, '-')}--`;
}

/** Rewrite a stylesheet so nothing in it can match outside `scope`. */
export function scopeUICss(css: string, scope: string, options: ScopeOptions = {}): string {
  const nodes = parseNodes(css);
  // A scope may itself be a list (a component root matches by two different attributes), so every
  // rewritten selector has to be produced once per scope part.
  const scopes = splitSelectors(scope);
  const prefix = options.keyframePrefix ?? '';
  // Keyframe names must be collected across the whole sheet first: a rule may reference an
  // animation defined further down.
  const keyframes = prefix ? collectKeyframeNames(nodes) : new Set<string>();
  const hoisted: string[] = [];
  const body = emitNodes(nodes, scopes, { prefix, keyframes, hoisted });
  return [...hoisted, body].filter(Boolean).join('\n');
}

// --- Parsing -------------------------------------------------------------------------------

/** A statement: either `prelude { body }` or a body-less `prelude;` (e.g. `@import …`). */
interface CssNode {
  prelude: string;
  body: string | null;
}

interface EmitContext {
  prefix: string;
  keyframes: Set<string>;
  hoisted: string[];
}

/**
 * Split a stylesheet into top-level statements. Deliberately minimal — it only needs to find
 * balanced braces while ignoring braces that live inside comments or quoted strings.
 */
function parseNodes(css: string): CssNode[] {
  const nodes: CssNode[] = [];
  let prelude = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      prelude += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '{') {
      const end = matchBrace(css, i);
      nodes.push({ prelude: prelude.trim(), body: css.slice(i + 1, end) });
      prelude = '';
      i = end + 1;
      continue;
    }
    if (ch === ';') {
      if (prelude.trim()) nodes.push({ prelude: prelude.trim(), body: null });
      prelude = '';
      i += 1;
      continue;
    }
    prelude += ch;
    i += 1;
  }
  if (prelude.trim()) nodes.push({ prelude: prelude.trim(), body: null });
  return nodes;
}

/** Index of the `}` closing the `{` at `open`, skipping strings/comments. Unclosed → end of input. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return css.length;
}

/** Index just past the string literal starting at `start` (handles backslash escapes). */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') i += 2;
    else if (css[i] === quote) return i + 1;
    else i += 1;
  }
  return css.length;
}

// --- At-rule classification ---------------------------------------------------------------

/** At-rules whose body is another stylesheet — recurse, keeping the same scope. */
const NESTED_AT = /^@(-\w+-)?(media|supports|container|layer|scope|document|starting-style)\b/i;
/** At-rules whose body is NOT a selector list — pass the body through untouched. */
const VERBATIM_AT = /^@(-\w+-)?(font-face|page|property|counter-style|font-feature-values|viewport)\b/i;
const KEYFRAMES_AT = /^@(-[\w-]+-)?keyframes\s+(.+)$/i;

function collectKeyframeNames(nodes: CssNode[]): Set<string> {
  const names = new Set<string>();
  const walk = (list: CssNode[]) => {
    for (const node of list) {
      const match = KEYFRAMES_AT.exec(node.prelude);
      if (match) {
        names.add(unquote(match[2].trim()));
        continue;
      }
      if (node.body != null && NESTED_AT.test(node.prelude)) walk(parseNodes(node.body));
    }
  };
  walk(nodes);
  return names;
}

/** `prop: value` sitting outside any rule — an element snippet's own declarations. */
const BARE_DECLARATION = /^-{0,2}[a-zA-Z][\w-]*\s*:/;

function emitNodes(nodes: CssNode[], scopes: string[], ctx: EmitContext): string {
  const out: string[] = [];
  // Declarations written at the top level of an element snippet style the element itself. They
  // routinely appear mixed with rules ("padding: 7px; &:hover { … }"), where wrapping the whole
  // snippet is not an option — collected here and emitted as one rule on the scope.
  const bare: string[] = [];
  for (const node of nodes) {
    // `@import` / `@charset` and friends. Imports are legal only before any rule, so hoist them;
    // `@charset` is meaningless in an inline <style>, so drop it.
    if (node.body == null) {
      if (/^@charset\b/i.test(node.prelude)) continue;
      if (/^@import\b/i.test(node.prelude)) ctx.hoisted.push(`${node.prelude};`);
      else if (BARE_DECLARATION.test(node.prelude)) bare.push(node.prelude);
      else out.push(`${node.prelude};`);
      continue;
    }

    const keyframes = KEYFRAMES_AT.exec(node.prelude);
    if (keyframes) {
      const name = unquote(keyframes[2].trim());
      const at = node.prelude.slice(0, node.prelude.length - keyframes[2].length).trimEnd();
      out.push(`${at} ${ctx.prefix}${name} {${node.body}}`);
      continue;
    }

    if (VERBATIM_AT.test(node.prelude)) {
      out.push(`${node.prelude} {${node.body}}`);
      continue;
    }

    if (NESTED_AT.test(node.prelude)) {
      out.push(`${rewriteAtPrelude(node.prelude)} {\n${emitNodes(parseNodes(node.body), scopes, ctx)}\n}`);
      continue;
    }

    // Anything else with a body is a style rule.
    const selector = scopeSelectorList(node.prelude, scopes);
    if (!selector) continue;
    out.push(`${selector} {${rewriteDeclarations(node.body, ctx)}}`);
  }
  // First, so an explicit `& { … }` rule in the same snippet still wins.
  if (bare.length) out.unshift(`${scopes.join(', ')} { ${rewriteDeclarations(bare.join('; '), ctx)} }`);
  return out.join('\n');
}

/**
 * `@supports selector(#hud:has(.show))` feature-tests a selector, so the id convention has to be
 * applied there too — otherwise the test asks about a selector nothing can ever match and the whole
 * block is skipped. Scoped narrowly to `selector()`: elsewhere in a prelude `#fff` is a colour.
 */
function rewriteAtPrelude(prelude: string): string {
  if (!/^@(-\w+-)?supports\b/i.test(prelude)) return prelude;
  return prelude.replace(/\bselector\(([^)]*)\)/gi, (_, inner: string) => `selector(${rewriteIdSelectors(inner)})`);
}

/**
 * Rewrite declarations that only make sense against a page.
 *
 * `position: fixed` anchors to the viewport, so a captured HUD region escapes its widget entirely —
 * it renders over the whole editor in the design canvas and ignores the frame in Play. Inside a UI
 * document the document frame IS the viewport, so fixed becomes absolute; `inset`/`top`/`left` then
 * resolve against the frame, which is what the original page CSS meant.
 */
function rewriteDeclarations(body: string, ctx: EmitContext): string {
  const positioned = body.replace(/(^|[;{])(\s*)position(\s*:\s*)fixed\b/gi, '$1$2position$3absolute');
  if (!ctx.prefix || ctx.keyframes.size === 0) return positioned;
  return positioned.replace(/(^|[;{])(\s*)(-\w+-)?(animation(?:-name)?)(\s*:\s*)([^;}]*)/gi, (whole, lead, gap, vendor, prop, colon, value: string) => {
    let next = value;
    for (const name of ctx.keyframes) {
      next = next.replace(new RegExp(`(^|[\\s,])${escapeRegExp(name)}(?=$|[\\s,])`, 'g'), `$1${ctx.prefix}${name}`);
    }
    return next === value ? whole : `${lead}${gap}${vendor ?? ''}${prop}${colon}${next}`;
  });
}

// --- Selector scoping ----------------------------------------------------------------------

/** A leading `:root` / `html` / `body` / `:host` compound — the page-level selectors we fold onto the scope. */
const PAGE_LEAD = /^(?::root|:host(?:\([^)]*\))?|html|body)(?![\w-])/i;

function scopeSelectorList(list: string, scopes: string[]): string {
  const out: string[] = [];
  for (const selector of splitSelectors(list)) {
    for (const scope of scopes) out.push(...scopeSelector(selector, scope));
  }
  return out.join(', ');
}

function scopeSelector(raw: string, scope: string): string[] {
  let selector = rewriteIdSelectors(raw.trim());
  if (!selector) return [];

  // Nesting-style `&` explicitly means "the scope root".
  if (selector.includes('&')) return [selector.replace(/&/g, scope)];

  // `html body .x` — collapse the leading run of bare page selectors down to the last one.
  for (;;) {
    const lead = PAGE_LEAD.exec(selector);
    if (!lead) break;
    const rest = selector.slice(lead[0].length);
    if (!/^\s/.test(rest) || !PAGE_LEAD.test(rest.trimStart())) break;
    selector = rest.trimStart();
  }

  // `:root { --token: … }` / `body { background: … }` style the widget frame itself. Qualifiers
  // ride along, so `body.dark .hud` becomes `<scope>.dark .hud`.
  const lead = PAGE_LEAD.exec(selector);
  if (lead) return [`${scope}${selector.slice(lead[0].length)}`.trim()];

  // A universal reset has to cover the frame as well as its subtree.
  if (/^\*(?![\w-])/.test(selector)) {
    const rest = selector.slice(1);
    // `* + *`, `* > .x` etc. only make sense inside the subtree; a bare `*`/`*::before` also
    // applies to the frame.
    if (/^\s*($|::)/.test(rest)) return [`${scope}${rest}`.trimEnd(), `${scope} *${rest}`];
    return [`${scope} *${rest}`];
  }

  return [`${scope} ${selector}`];
}

/** Split a selector list on top-level commas (so `:is(a, b)` and `:has(.x, .y)` survive intact). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let i = 0;
  while (i < list.length) {
    const ch = list[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(list, i);
      current += list.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth <= 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Elements render `className` but never a DOM id, so an `#id` selector could never match. Captured
 * kits keep the original id as an `id-<name>` class — rewrite selectors to agree.
 */
function rewriteIdSelectors(selector: string): string {
  if (!selector.includes('#')) return selector;
  let out = '';
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(selector, i);
      out += selector.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '#') {
      const match = /^#(-?[_a-zA-Z][\w-]*)/.exec(selector.slice(i));
      if (match) {
        out += `.id-${match[1]}`;
        i += match[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

// --- Small helpers -------------------------------------------------------------------------

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function cssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function forEachElement(element: UIElement, visit: (el: UIElement) => void): void {
  visit(element);
  for (const child of element.children) forEachElement(child, visit);
}
