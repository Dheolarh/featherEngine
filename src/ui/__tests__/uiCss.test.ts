/**
 * The CSS scoper is what makes raw CSS safe to inject: an installed UI kit ships a full page
 * stylesheet, and unscoped that repaints the entire editor. These tests pin the rewrites that keep
 * a kit inside its own widget.
 */
import { describe, expect, it } from 'vitest';
import type { UIDocument, UIElement } from '../../types';
import { buildUIDocumentCss, normalizeElementCss, scopeUICss, uiDocScope } from '../uiCss';

const SCOPE = '[data-uidoc="doc1"]';
const scope = (css: string, options?: Parameters<typeof scopeUICss>[2]) => scopeUICss(css, SCOPE, options);

const el = (id: string, patch: Partial<UIElement> = {}): UIElement => ({
  id,
  kind: 'panel',
  name: id,
  style: {},
  bindings: [],
  children: [],
  ...patch,
});

const doc = (root: UIElement, css?: string): UIDocument => ({
  id: 'doc1',
  name: 'Doc',
  surface: 'screen',
  root,
  css,
  visibleOnStart: true,
  createdAt: 0,
});

describe('scopeUICss — selectors', () => {
  it('prefixes ordinary selectors so they can only match inside the document', () => {
    expect(scope('.card { color: gold; }')).toBe(`${SCOPE} .card { color: gold; }`);
  });

  it('scopes every selector in a list, not just the first', () => {
    expect(scope('.a, .b > .c { gap: 4px }')).toBe(`${SCOPE} .a, ${SCOPE} .b > .c { gap: 4px }`);
  });

  it('does not split commas nested inside :is()/:has()', () => {
    const out = scope('.hud:not(.a, .b) { opacity: 1 }');
    expect(out).toBe(`${SCOPE} .hud:not(.a, .b) { opacity: 1 }`);
  });

  it('folds page-level selectors onto the document frame instead of the app', () => {
    // This is the exact rule that used to repaint the whole editor near-black.
    expect(scope('html, body { background: #101819; overflow: hidden }')).toBe(
      `${SCOPE}, ${SCOPE} { background: #101819; overflow: hidden }`,
    );
    expect(scope(':root { --accent: #6ff7ff }')).toBe(`${SCOPE} { --accent: #6ff7ff }`);
  });

  it('keeps qualifiers and descendants when folding a page selector', () => {
    expect(scope('body.dark .hud { color: red }')).toBe(`${SCOPE}.dark .hud { color: red }`);
    expect(scope('html body .hud { color: red }')).toBe(`${SCOPE} .hud { color: red }`);
  });

  it('applies a universal reset to the frame and its subtree only', () => {
    expect(scope('* { margin: 0 }')).toBe(`${SCOPE}, ${SCOPE} * { margin: 0 }`);
    expect(scope('*::before { content: "" }')).toBe(`${SCOPE}::before, ${SCOPE} *::before { content: "" }`);
    // A combinator only makes sense inside the subtree.
    expect(scope('* + * { margin-top: 4px }')).toBe(`${SCOPE} * + * { margin-top: 4px }`);
  });

  it('rewrites id selectors to the id-<name> class convention elements actually render', () => {
    expect(scope('#hud > * { position: absolute }')).toBe(`${SCOPE} .id-hud > * { position: absolute }`);
    expect(scope('#hud:not(:has(#target.show)) { opacity: .88 }')).toBe(
      `${SCOPE} .id-hud:not(:has(.id-target.show)) { opacity: .88 }`,
    );
  });

  it('leaves a # inside a quoted attribute value alone', () => {
    expect(scope('[href="#top"] { color: red }')).toBe(`${SCOPE} [href="#top"] { color: red }`);
  });

  it('resolves & to the scope root', () => {
    expect(scope('& { color: gold } &:hover { color: white }')).toBe(`${SCOPE} { color: gold }\n${SCOPE}:hover { color: white }`);
  });
});

describe('scopeUICss — at-rules', () => {
  it('recurses into conditional groups, keeping the group intact', () => {
    expect(scope('@media (max-width: 600px) { .card { gap: 2px } }')).toBe(
      `@media (max-width: 600px) {\n${SCOPE} .card { gap: 2px }\n}`,
    );
  });

  it('scopes @starting-style, whose body is a selector list', () => {
    expect(scope('@starting-style { .card { opacity: 0 } }')).toBe(`@starting-style {\n${SCOPE} .card { opacity: 0 }\n}`);
  });

  it('applies the id convention inside @supports selector(), but not to colours', () => {
    expect(scope('@supports selector(#hud:has(.show)) { .a { color: red } }')).toContain('@supports selector(.id-hud:has(.show))');
    expect(scope('@supports (color: #fff) { .a { color: red } }')).toContain('@supports (color: #fff)');
  });

  it('passes @font-face through untouched', () => {
    const css = '@font-face { font-family: "X"; src: url(data:font/woff2;base64,AA) }';
    expect(scope(css)).toBe('@font-face { font-family: "X"; src: url(data:font/woff2;base64,AA) }');
  });

  it('hoists @import above the rules, where CSS requires it', () => {
    const out = scope('.a { color: red } @import url("x.css");');
    expect(out).toBe(`@import url("x.css");\n${SCOPE} .a { color: red }`);
  });

  it('namespaces keyframes and the declarations that reference them', () => {
    const out = scope('@keyframes pulse { to { opacity: 0 } } .a { animation: pulse 2s linear infinite }', { keyframePrefix: 'k-' });
    expect(out).toContain('@keyframes k-pulse {');
    expect(out).toContain('animation: k-pulse 2s linear infinite');
  });

  it('namespaces animation-name and leaves unrelated animations alone', () => {
    const out = scope('@keyframes pulse { to { opacity: 0 } } .a { animation-name: pulse } .b { animation-name: other }', {
      keyframePrefix: 'k-',
    });
    expect(out).toContain('animation-name: k-pulse');
    expect(out).toContain('animation-name: other');
  });

  it('finds keyframes declared after the rule that uses them', () => {
    const out = scope('.a { animation: spin 1s } @keyframes spin { to { rotate: 1turn } }', { keyframePrefix: 'k-' });
    expect(out).toContain('animation: k-spin 1s');
  });
});

describe('scopeUICss — declarations', () => {
  it('turns position:fixed into absolute so a region cannot escape the widget frame', () => {
    expect(scope('.hud { position: fixed; inset: 0 }')).toBe(`${SCOPE} .hud { position: absolute; inset: 0 }`);
  });

  it('leaves other properties that take the value "fixed" alone', () => {
    expect(scope('.a { background-position: fixed; background-attachment: fixed }')).toContain('background-position: fixed');
    expect(scope('.a { background-attachment: fixed }')).toContain('background-attachment: fixed');
  });
});

describe('scopeUICss — robustness', () => {
  it('ignores braces inside comments and strings', () => {
    expect(scope('/* .x { y } */ .a { content: "}" }')).toBe(`${SCOPE} .a { content: "}" }`);
  });

  it('survives an unclosed block instead of throwing', () => {
    expect(() => scope('.a { color: red')).not.toThrow();
  });

  it('returns nothing for empty input', () => {
    expect(scope('')).toBe('');
  });
});

describe('element CSS', () => {
  it('treats a bare declaration list as styling the element itself', () => {
    expect(normalizeElementCss('color: gold; gap: 4px')).toBe('& { color: gold; gap: 4px }');
  });

  it('leaves authored rules alone', () => {
    expect(normalizeElementCss('& { color: gold }')).toBe('& { color: gold }');
  });

  it('applies declarations mixed in alongside rules — the shape people actually write', () => {
    const out = buildUIDocumentCss(doc(el('root', { children: [el('child', { css: 'padding: 7px; &:hover { opacity: .5 }' })] })));
    const target = `${uiDocScope('doc1')} [data-uiel-id="child"]`;
    expect(out).toBe(`${target} { padding: 7px }\n${target}:hover { opacity: .5 }`);
  });

  it('lets an explicit & rule override the loose declarations above it', () => {
    const out = buildUIDocumentCss(doc(el('root', { children: [el('child', { css: 'color: red; & { color: blue }' })] })));
    expect(out.indexOf('color: red')).toBeLessThan(out.indexOf('color: blue'));
  });

  it('scopes an element snippet under both the document and the element', () => {
    const out = buildUIDocumentCss(doc(el('root', { children: [el('child', { css: 'color: gold' })] })));
    expect(out).toBe(`${uiDocScope('doc1')} [data-uiel-id="child"] { color: gold }`);
  });

  it('emits element rules after document rules so they win ties', () => {
    const out = buildUIDocumentCss(doc(el('root', { children: [el('child', { className: 'card', css: 'color: gold' })] }), '.card { color: red }'));
    expect(out.indexOf('color: red')).toBeLessThan(out.indexOf('color: gold'));
  });

  it('targets descendants from an element snippet', () => {
    const out = buildUIDocumentCss(doc(el('root', { children: [el('child', { css: '.row { gap: 6px }' })] })));
    expect(out).toBe(`${uiDocScope('doc1')} [data-uiel-id="child"] .row { gap: 6px }`);
  });

  it('gives a ROOT element both anchors, since an instance replaces its data-uiel-id', () => {
    const out = buildUIDocumentCss(doc(el('root', { css: '.row { gap: 6px }' })));
    const scope = uiDocScope('doc1');
    expect(out).toBe(`${scope} [data-uiel-id="root"] .row, ${scope}[data-uiel-src="root"] .row { gap: 6px }`);
  });

  it('is empty when nothing carries CSS', () => {
    expect(buildUIDocumentCss(doc(el('root')))).toBe('');
  });
});

describe('component instances', () => {
  const slot: UIDocument = {
    id: 'comp1', name: 'Slot', surface: 'screen', visibleOnStart: false, createdAt: 0, isComponent: true,
    css: '.tile { background: gold }',
    root: el('c1'),
  };
  const resolve = (id: string) => (id === 'comp1' ? slot : undefined);

  it('pulls a referenced component stylesheet into the host sheet', () => {
    const host = doc(el('root', { children: [el('inst', { kind: 'component', componentId: 'comp1' })] }));
    const out = buildUIDocumentCss(host, resolve);
    // Scoped to the COMPONENT's id — every instance wrapper carries that attribute, so one copy
    // of the rules styles all of them.
    expect(out).toBe(`${uiDocScope('comp1')} .tile { background: gold }`);
  });

  it('emits a component sheet once no matter how many instances there are', () => {
    const host = doc(
      el('root', {
        children: [
          el('a', { kind: 'component', componentId: 'comp1' }),
          el('b', { kind: 'component', componentId: 'comp1' }),
        ],
      }),
    );
    const out = buildUIDocumentCss(host, resolve);
    expect(out.split('background: gold').length - 1).toBe(1);
  });

  it("matches CSS on a component's root, whose data-uiel-id is the instance's at render time", () => {
    const withRootCss: UIDocument = { ...slot, css: undefined, root: el('c1', { css: 'color: gold' }) };
    const host = doc(el('root', { children: [el('inst', { kind: 'component', componentId: 'comp1' })] }));
    const out = buildUIDocumentCss(host, (id) => (id === 'comp1' ? withRootCss : undefined));
    // The instance-rendered root carries data-uiel-src, so the rule has to accept both anchors.
    expect(out).toContain('[data-uiel-src="c1"]');
    expect(out).toContain('[data-uiel-id="c1"]');
  });

  it('terminates on a component that references itself', () => {
    const loop: UIDocument = { ...slot, root: el('c1', { children: [el('self', { kind: 'component', componentId: 'comp1' })] }) };
    const host = doc(el('root', { children: [el('inst', { kind: 'component', componentId: 'comp1' })] }));
    expect(() => buildUIDocumentCss(host, (id) => (id === 'comp1' ? loop : undefined))).not.toThrow();
  });
});
