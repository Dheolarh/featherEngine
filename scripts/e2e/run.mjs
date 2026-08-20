/**
 * Editor end-to-end suite.
 *
 * Covers the visual scripting graph — the highest-value, least-covered surface in the editor. The
 * jsdom unit suite cannot render it and the MCP screenshot harness cannot click its nodes, so until
 * now the node editor's primary interactions had NO automated coverage at all.
 *
 * Run against an already-running dev server:  npm run test:e2e
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';

const specs = [];
const spec = (name, fn) => specs.push({ name, fn });

/** Reveal the Scripting panel through the View menu (it is not docked by default). */
async function openScripting(app) {
  await app.evaluate(`(() => {
    const menu = document.querySelector('[data-menu=view] .file-menu-trigger');
    menu?.click();
  })()`);
  await app.waitFor(`document.querySelector('[data-menu=view] .file-menu-popover')`, { label: 'view menu open' });
  await app.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-menu=view] .file-menu-popover button')];
    items.find((b) => b.textContent.trim() === 'Scripting')?.click();
  })()`);
  await app.waitFor(`document.querySelector('.nodeforge-node')`, { label: 'graph nodes rendered' });
}

spec('graph nodes respond to a real click by selecting', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    assert.equal(await app.count('.react-flow__node.selected'), 0, 'nothing should be selected initially');
    await app.realClick('.nodeforge-node .nfn-label', { within: '.flow-shell' });
    await app.waitFor(`document.querySelectorAll('.react-flow__node.selected').length === 1`, {
      label: 'a node became selected',
    });
  } finally {
    await app.dispose();
  }
});

spec('breakpoint dot arms and disarms on click', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    assert.equal(await app.count('.nfn-breakpoint.on'), 0, 'no breakpoints at rest');
    assert.ok((await app.count('.nfn-breakpoint')) > 0, 'exec nodes expose a breakpoint toggle');

    await app.realClick('.nfn-breakpoint', { within: '.flow-shell' });
    await app.waitFor(`document.querySelectorAll('.nfn-breakpoint.on').length === 1`, { label: 'breakpoint armed' });

    await app.realClick('.nfn-breakpoint.on', { within: '.flow-shell' });
    await app.waitFor(`document.querySelectorAll('.nfn-breakpoint.on').length === 0`, { label: 'breakpoint cleared' });
  } finally {
    await app.dispose();
  }
});

spec('an armed breakpoint pauses Play and reveals the blueprint', async () => {
  // ?bp=1 arms a breakpoint on a node that runs every frame (rotating-prop's Update).
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script&bp=1' });
  try {
    await app.waitFor(`document.querySelector('.run-button')`, { label: 'run button' });
    await app.realClick('.run-button');
    await app.waitFor(`document.querySelector("[title^='Pause preview']")?.classList.contains('active')`, {
      label: 'Play paused on the breakpoint',
    });
    await app.waitFor(`document.querySelector('.scripting-panel')`, { label: 'Scripting panel auto-revealed' });
    await app.waitFor(`document.querySelector('.exec-broke')`, { label: 'stopped node marked' });
  } finally {
    await app.dispose();
  }
});

spec('node search offers to build from a plain-English description', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    await app.realClick('.flow-add-node');
    await app.waitFor(`document.querySelector('.node-search')`, { label: 'node search opened' });

    // A real node name still wins the top slot (the pre-existing behaviour must not regress).
    await app.evaluate(`(() => {
      const input = document.querySelector('.node-search-field input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Branch');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await app.waitFor(`document.querySelector('.node-search-list button.active')`, { label: 'node match highlighted' });

    // A description that matches no node offers the AI row instead of a dead end.
    await app.evaluate(`(() => {
      const input = document.querySelector('.node-search-field input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'when the player touches this add ten score');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await app.waitFor(`document.querySelector('.node-search-ask.active')`, { label: 'AI build row is the active option' });
    assert.equal(await app.count('.node-search-empty'), 0, 'no dead-end empty state while the AI row is offered');
  } finally {
    await app.dispose();
  }
});

async function serverUp() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  let devServer;
  if (!(await serverUp())) {
    process.stdout.write(`Starting dev server for e2e…\n`);
    devServer = spawn('npm', ['run', 'dev'], { stdio: 'ignore', detached: false });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !(await serverUp())) await delay(1000);
    if (!(await serverUp())) {
      devServer.kill();
      throw new Error(`Dev server never came up at ${BASE_URL}`);
    }
  }

  let failed = 0;
  try {
    for (const { name, fn } of specs) {
      const started = Date.now();
      try {
        await fn();
        process.stdout.write(`  ✓ ${name} (${Date.now() - started}ms)\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`  ✕ ${name}\n    ${error.message}\n`);
      }
    }
  } finally {
    if (devServer) devServer.kill();
  }

  process.stdout.write(`\n${specs.length - failed}/${specs.length} e2e specs passed\n`);
  process.exit(failed ? 1 : 0);
}

await main();
