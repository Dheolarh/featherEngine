/**
 * Capture a running game's UI into a Feather UIDocument.
 *
 * WHY CAPTURE INSTEAD OF PARSE: the source games build their UI imperatively — createElement and
 * innerHTML template strings spread across ~20 files, driven by game state. There is no static
 * markup to read. Parsing TypeScript for it would be fragile and would miss anything conditional.
 * Running the game and serialising the DOM it actually produces is robust to HOW the UI was
 * authored, and it captures the real computed result including whatever the game injected at
 * runtime.
 *
 *   node scripts/uikit/capture.mjs --dir <game dist> --selector "#hud" --name "RPG HUD" [--setup file.js]
 *
 * Emits a UIDocument JSON on stdout (or --out file) ready for import as a UI Kit package.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { launch, delay } from '../e2e/cdp.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const gameDir = resolve(arg('--dir', ''));
const selector = arg('--selector', 'body');
const docName = arg('--name', 'Captured UI');
const setupFile = arg('--setup');
const outFile = arg('--out');
const waitMs = Number(arg('--wait', '3500'));

assert.ok(gameDir && existsSync(join(gameDir, 'index.html')), `--dir must contain index.html (got ${gameDir})`);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

/** Serve the game's own dist so it loads exactly as shipped. */
function serve(root) {
  return createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    if (pathname === '' || pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(root, pathname.replace(/^\/+/, ''));
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    readFile(file)
      .then((bytes) => {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        });
        response.end(bytes);
      })
      .catch(() => response.writeHead(404).end('Not found'));
  });
}

/**
 * Runs INSIDE the page (stringified and evaluated there — NOT a template literal, so backslashes
 * in regexes and string escapes survive verbatim). Walks the chosen subtree into a Feather
 * UIElement tree and collects only the CSS that actually styles it.
 */
function captureInPage(selector) {
  const KINDS = { IMG: 'image', BUTTON: 'button', INPUT: 'input', SELECT: 'dropdown', TEXTAREA: 'input', PROGRESS: 'bar' };
  const TEXT_TAGS = new Set(['SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'STRONG', 'EM', 'SMALL', 'LI', 'TD', 'TH']);
  let seq = 0;
  const nextId = (prefix) => prefix + '-' + (seq += 1);

  const kindOf = (el) => {
    if (KINDS[el.tagName]) {
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return 'toggle';
      if (el.tagName === 'INPUT' && el.type === 'range') return 'slider';
      return KINDS[el.tagName];
    }
    const cls = String(el.className || '').toLowerCase();
    // Bars are conventionally a track element with a width-driven fill child.
    if (/\b(bar|meter|gauge|fill|progress)\b/.test(cls)) return 'bar';
    if (TEXT_TAGS.has(el.tagName)) return 'text';
    return 'panel';
  };

  /** Direct text of this element, ignoring text owned by descendants. */
  const ownText = (el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();

  /**
   * Subtrees dropped for being hidden at capture time. A game sitting on its main menu hides the
   * screen you actually meant to capture, and the kit then ships without the HUD it promises —
   * silently. Reported so the operator sees it and re-runs with --setup on the right screen.
   */
  const skipped = [];

  const walk = (el, depth) => {
    if (depth > 12) return null;
    if (getComputedStyle(el).display === 'none') {
      skipped.push({
        name: el.id || String(el.className || '').split(' ')[0] || el.tagName.toLowerCase(),
        descendants: el.querySelectorAll('*').length,
      });
      return null;
    }
    const node = {
      id: nextId('uiel'),
      kind: kindOf(el),
      name: String(el.id || String(el.className || '').split(' ')[0] || el.tagName.toLowerCase()).slice(0, 40),
      className: [el.id ? 'id-' + el.id : '', String(el.className || '')].filter(Boolean).join(' ').trim() || undefined,
      style: {},
      bindings: [],
      children: [],
    };
    // The inline style attribute is how a running game expresses its CURRENT state — a menu the
    // script revealed with `el.style.display = 'flex'` reads as `display: none` from the sheet
    // alone. Dropping it is how a capture ends up rendering nothing. Element CSS preserves it.
    const inline = el.getAttribute('style');
    if (inline && inline.trim()) node.css = inline.trim();
    const text = ownText(el);
    if (text) node.text = text.slice(0, 400);
    if (el.tagName === 'IMG' && el.getAttribute('src')) node.srcHint = el.getAttribute('src');
    if (el.tagName === 'INPUT' && el.placeholder) node.placeholder = el.placeholder;
    for (const child of el.children) {
      const built = walk(child, depth + 1);
      if (built) node.children.push(built);
    }
    return node;
  };

  const root = document.querySelector(selector);
  if (!root) return { error: 'selector matched nothing: ' + selector };

  // Only rules that actually style this subtree. Shipping the whole game stylesheet would make
  // every kit ~300KB of unrelated screens; a kit should carry its own look and nothing else.
  const subtree = [root].concat(Array.from(root.querySelectorAll('*')));
  const matchesSubtree = (selectorText) =>
    selectorText.split(',').some((part) => {
      // Drop pseudo-classes/elements that can never match a static probe (:hover, ::before, ...).
      const probe = part.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
      if (!probe) return true; // a bare pseudo rule still belongs to something
      try {
        return subtree.some((el) => el.matches(probe));
      } catch (error) {
        return true; // unparseable selector: keep it rather than silently drop styling
      }
    });

  const css = [];
  let seen = 0;
  const collect = (rules) => {
    for (const rule of rules) {
      seen += 1;
      if (rule.type === CSSRule.STYLE_RULE) {
        if (matchesSubtree(rule.selectorText)) css.push(rule.cssText);
      } else if (rule.type === CSSRule.MEDIA_RULE) {
        const inner = Array.from(rule.cssRules).filter(
          (r) => r.type !== CSSRule.STYLE_RULE || matchesSubtree(r.selectorText),
        );
        if (inner.length) {
          css.push('@media ' + rule.conditionText + ' {' + inner.map((r) => r.cssText).join(' ') + '}');
        }
      } else {
        // @keyframes / @font-face / @property: referenced by name, so always keep.
        css.push(rule.cssText);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      collect(sheet.cssRules);
    } catch (error) {
      /* cross-origin sheet */
    }
  }

  const tree = walk(root, 0);
  const countKinds = (n, acc) => {
    acc[n.kind] = (acc[n.kind] || 0) + 1;
    n.children.forEach((c) => countKinds(c, acc));
    return acc;
  };
  return {
    tree,
    css: css.join('\n'),
    skipped: skipped.sort((a, b) => b.descendants - a.descendants).slice(0, 10),
    stats: { kinds: countKinds(tree, {}), cssRules: css.length, cssRulesSeen: seen },
  };
}

async function main() {
  const server = serve(gameDir);
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const port = server.address().port;
  const { page, dispose } = await launch({ width: 1600, height: 900 });

  try {
    await page.call('Page.enable');
    await page.call('Runtime.enable');
    await page.call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await delay(waitMs);

    // Optional setup script: click through to the screen you actually want captured.
    if (setupFile) {
      const source = await readFile(resolve(setupFile), 'utf8');
      const setup = await page.call('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
      if (setup.exceptionDetails) throw new Error(`--setup threw: ${setup.exceptionDetails.exception?.description}`);
      await delay(800);
    }

    const result = await page.call('Runtime.evaluate', {
      expression: `(${captureInPage.toString()})(${JSON.stringify(selector)})`,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'capture failed');
    const payload = result.result.value;
    assert.ok(!payload.error, payload.error);

    const doc = {
      id: `uidoc-${Date.now().toString(36)}`,
      name: docName,
      surface: 'screen',
      renderMode: 'dom',
      root: payload.tree,
      css: payload.css,
      visibleOnStart: false,
      createdAt: Date.now(),
    };

    // Loud, because a kit that quietly ships without the screen it advertises looks like an engine
    // bug to whoever installs it. If the big skips are the HUD you wanted, re-run with --setup.
    if (payload.skipped.length) {
      const summary = payload.skipped.map((s) => `${s.name} (${s.descendants} nodes)`).join(', ');
      process.stderr.write(`  ! hidden at capture time, so NOT included: ${summary}\n`);
    }

    const json = JSON.stringify(doc, null, 2);
    if (outFile) {
      await writeFile(resolve(outFile), json);
      process.stderr.write(
        `Captured "${docName}": ${JSON.stringify(payload.stats.kinds)} · ${payload.stats.cssRules}/${payload.stats.cssRulesSeen} CSS rules kept (${(doc.css.length / 1024).toFixed(0)}KB) → ${outFile}\n`,
      );
    } else {
      process.stdout.write(json);
    }
  } finally {
    await dispose();
    await new Promise((done) => server.close(done));
  }
}

await main();
