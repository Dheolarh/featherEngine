/**
 * Editor end-to-end harness: page helpers on top of the CDP driver.
 *
 * The important one is realClick(). It resolves an element's centre and dispatches genuine
 * mousePressed/mouseReleased input, which is what ReactFlow (and anything else using native pointer
 * listeners rather than React synthetic events) actually responds to.
 */
import assert from 'node:assert/strict';
import { delay, launch } from './cdp.mjs';

export async function openEditor({ baseUrl, query = '', timeoutMs = 60_000, width = 1600, height = 1000 } = {}) {
  const { page, dispose } = await launch({ width, height });
  const url = `${baseUrl}/${query}`;

  const evaluate = async (expression) => {
    const result = await page.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result?.value;
  };

  /** Poll a boolean expression until true. Far more reliable than fixed sleeps for an app that
   *  boots WebGL, WASM physics and a project before the editor is usable. */
  const waitFor = async (expression, { label = expression, timeout = timeoutMs } = {}) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(`Boolean(${expression})`);
        if (last) return true;
      } catch (error) {
        last = error.message;
      }
      await delay(250);
    }
    throw new Error(`Timed out waiting for: ${label}${last ? ` (last: ${last})` : ''}`);
  };

  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);

  /**
   * Centre coordinates of the first CLICKABLE match, in viewport pixels.
   *
   * `within` matters for the graph: ReactFlow renders every node in a transformed viewport, so
   * plenty of `.nodeforge-node` elements exist in the DOM while sitting outside the visible canvas
   * (their rects land over the palette, or off-screen entirely). Clicking querySelector's first
   * match therefore aims at whatever happens to be under those coordinates. Constraining to the
   * container's rect picks a node you can actually see.
   */
  const boxOf = (selector, { within } = {}) =>
    evaluate(`(() => {
      const bounds = ${within ? `document.querySelector(${JSON.stringify(within)})?.getBoundingClientRect()` : 'null'};
      if (${within ? 'true' : 'false'} && !bounds) return null;
      for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
        if (bounds && (cx < bounds.left || cx > bounds.right || cy < bounds.top || cy > bounds.bottom)) continue;
        // Only aim where this element (or a descendant of it) is genuinely on top.
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !el.contains(hit) && hit !== el) continue;
        return { x: cx, y: cy };
      }
      return null;
    })()`);

  /** A real mouse click at the element's centre — synthetic DOM clicks do not drive ReactFlow. */
  const realClick = async (selector, options) => {
    const box = await boxOf(selector, options);
    assert.ok(box, `Cannot click, no visible/unobstructed element for: ${selector}`);
    const base = { x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 };
    await page.call('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
    await page.call('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await delay(30);
    await page.call('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
    await delay(120);
  };

  const consoleErrors = [];
  await page.call('Log.enable').catch(() => {});

  await page.call('Page.navigate', { url });
  // The editor is ready once the toolbar exists; individual specs wait for what they need.
  await waitFor(`document.querySelector('.toolbar')`, { label: 'editor toolbar' });

  return { page, evaluate, waitFor, count, text, boxOf, realClick, consoleErrors, dispose, url };
}
