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

spec('Timeline nodes expose an editable curve and controllable playback', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    const nodeId = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const id = store.addGraphNodeToBlueprint(store.activeBlueprintId, 'Timeline', 'Runtime', {}, { x: 420, y: 360 });
      store.selectGraphNode(id);
      return id;
    })()`);
    assert.ok(nodeId, 'Timeline node was created');
    await app.waitFor(`document.querySelector('.timeline-curve-editor')`, { label: 'Timeline curve editor' });
    assert.equal(await app.count('.timeline-curve-key'), 2, 'fresh Timelines start with a two-key curve');
    assert.equal(await app.count('.node-port.source[data-handleid="exec-update"]'), 1, 'Timeline exposes Update');
    assert.equal(await app.count('.node-port.source[data-handleid="exec-done"]'), 1, 'Timeline exposes Finished');

    await app.evaluate(`document.querySelector('.timeline-curve-presets button:nth-child(2)')?.scrollIntoView({ block: 'center' })`);
    await delay(150);
    await app.realClick('.timeline-curve-presets button:nth-child(2)');
    await app.waitFor(
      `window.__featherStore.selectedGraphNode().data.tweenCurve.every((key) => key.interpolation === 'linear')`,
      { label: 'Linear preset persisted to graph data' },
    );

    // Use real browser input for the editor's double-click-to-add interaction.
    await app.evaluate(`document.querySelector('.timeline-curve-graph')?.scrollIntoView({ block: 'center' })`);
    await delay(150);
    const point = await app.boxOf('.timeline-curve-graph');
    assert.ok(point, 'curve graph is visible');
    const mouse = { x: point.x, y: point.y, button: 'left', buttons: 1 };
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mouseMoved', buttons: 0 });
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mousePressed', clickCount: 1 });
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mouseReleased', buttons: 0, clickCount: 1 });
    await delay(40);
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mousePressed', clickCount: 2 });
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mouseReleased', buttons: 0, clickCount: 2 });
    await app.waitFor(`window.__featherStore.selectedGraphNode().data.tweenCurve.length === 3`, {
      label: 'double-click added a Timeline key',
    });
    assert.equal(await app.count('.timeline-curve-key'), 3, 'the added key renders in the editor');

    const controlId = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const id = store.addGraphNodeToBlueprint(store.activeBlueprintId, 'Timeline Control', 'Runtime', {}, { x: 700, y: 360 });
      store.selectGraphNode(id);
      return id;
    })()`);
    assert.ok(controlId, 'Timeline Control node was created');
    await app.waitFor(`document.querySelector('select[aria-label="Timeline to control"]')`, {
      label: 'Timeline selector visible',
    });
    assert.equal(
      await app.evaluate(`(() => {
        const store = window.__featherStore;
        const graph = store.activeGraph();
        const timeline = graph.nodes.find((node) => node.id === ${JSON.stringify(nodeId)});
        return store.selectedGraphNode().data.timelineRefId === (timeline.data.timelineId || timeline.id);
      })()`),
      true,
      'a fresh Control targets the existing Timeline',
    );
    await app.evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Timeline command"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'reverse');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await app.waitFor(`window.__featherStore.selectedGraphNode().data.timelineCommand === 'reverse'`, {
      label: 'Reverse command persisted to graph data',
    });
  } finally {
    await app.dispose();
  }
});

spec('Timeline Mechanics ships a reusable door that opens and reverses through interaction', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=timeline' });
  try {
    await app.waitFor(
      `window.__featherStore.prefabs.some((prefab) => prefab.name === 'Interactive Vault Door')`,
      { label: 'Timeline Mechanics gallery and prefab built' },
    );
    const setup = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const prefab = store.prefabs.find((item) => item.name === 'Interactive Vault Door');
      const root = store.activeScene().objects.find(
        (object) => object.prefabSourceId === prefab.id && object.prefabObjectId === prefab.rootId,
      );
      return {
        prefabId: prefab.id,
        rootId: root.id,
        blueprints: store.blueprints.filter((item) => item.folderId === prefab.folderId).length,
      };
    })()`);
    assert.ok(setup.prefabId, 'the reusable prefab exists');
    assert.ok(setup.rootId, 'the scene contains a placed prefab root');
    assert.equal(setup.blueprints, 6, 'all six inspectable mechanism Blueprints exist');

    await app.realClick('.run-button');
    await app.waitFor(`window.__featherStore.runtimeInteractFocusId === ${JSON.stringify(setup.rootId)}`, {
      label: 'player focused the Vault Door',
    });
    const pressInteract = async () => {
      await app.page.call('Input.dispatchKeyEvent', {
        type: 'keyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69,
      });
      await delay(45);
      await app.page.call('Input.dispatchKeyEvent', {
        type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69,
      });
    };

    await pressInteract();
    await app.waitFor(
      `Math.abs(window.__featherStore.activeScene().objects.find((object) => object.id === ${JSON.stringify(setup.rootId)}).transform.rotation[1]) > 0.25`,
      { label: 'Vault Door opened along its Timeline curve' },
    );
    const openAngle = await app.evaluate(
      `Math.abs(window.__featherStore.activeScene().objects.find((object) => object.id === ${JSON.stringify(setup.rootId)}).transform.rotation[1])`,
    );

    await pressInteract();
    await app.waitFor(
      `Math.abs(window.__featherStore.activeScene().objects.find((object) => object.id === ${JSON.stringify(setup.rootId)}).transform.rotation[1]) < ${openAngle - 0.05}`,
      { label: 'Vault Door reversed without snapping' },
    );
  } finally {
    await app.dispose();
  }
});

spec('the graph canvas has no large near-white slab on a dark theme', async () => {
  // Regression guard for the minimap rendering as a white rectangle over the canvas: xyflow's
  // MiniMap defaults to a light bgColor/maskColor, and those are SVG paint attributes that the
  // dark CSS on .react-flow__minimap could never reach.
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script&theme=nova' });
  try {
    await openScripting(app);
    await app.waitFor(`document.querySelector('.react-flow__minimap')`, { label: 'minimap present' });
    const canvas = await app.pixelStats('.flow-shell');
    assert.ok(
      canvas.brightRatio < 0.08,
      `graph canvas is ${(canvas.brightRatio * 100).toFixed(1)}% near-white — something light is covering it`,
    );
    const minimap = await app.pixelStats('.react-flow__minimap');
    assert.ok(
      minimap.meanLuminance < 120,
      `minimap mean luminance ${minimap.meanLuminance.toFixed(0)} is too light for a dark theme`,
    );
  } finally {
    await app.dispose();
  }
});

spec('Inspector controls do not collide at their docked width', async () => {
  // Regression guard for panels squeezed past their usable width — the Tree editor's labels sat on
  // top of its own sliders when it was tabbed into the ~330px Inspector column.
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script&theme=nova' });
  try {
    await app.waitFor(`document.querySelector('.inspector-panel .inspector-section')`, { label: 'inspector rendered' });
    const collisions = await app.overlaps('.inspector-panel', '.field-row, .inspector-section-head, .full-button');
    assert.deepEqual(collisions, [], `overlapping Inspector controls: ${collisions.join(' | ')}`);
  } finally {
    await app.dispose();
  }
});

spec('play and stop round-trips without leaving runtime state behind', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await app.waitFor(`document.querySelector('.run-button')`, { label: 'run button' });
    assert.equal(await app.count("[title^='Pause preview']"), 0, 'pause/step hidden while stopped');

    await app.realClick('.run-button');
    await app.waitFor(`document.querySelectorAll("[title^='Pause preview']").length === 1`, { label: 'Play started' });

    await app.realClick('.run-button');
    await app.waitFor(`document.querySelectorAll("[title^='Pause preview']").length === 0`, { label: 'Play stopped' });
    assert.equal(await app.count('.exec-broke'), 0, 'no stale breakpoint marker after Stop');
  } finally {
    await app.dispose();
  }
});

/** Boot the editor with a UI Kit installed from the store and its document open in the UI panel. */
async function openInstalledKit(kit) {
  const app = await openEditor({ baseUrl: BASE_URL, query: `?demo=uikit&kit=${kit}` });
  await app.waitFor(`document.querySelector('.ui-edit-layer [data-uiel-id]')`, { label: `${kit} rendered in the design canvas` });
  return app;
}

spec('an installed UI kit renders styled in the design canvas', async () => {
  // The reported bug: a kit installed from the Asset Store previewed as "all black, no colours".
  // Its look lives entirely in doc.css (every element ships an empty style object), and the design
  // canvas never injected that stylesheet — so it drew a few hundred transparent divs.
  const app = await openInstalledKit('pkg-feather-ui-arcade-hud');
  try {
    await app.waitFor(`document.querySelector('style[data-ui-css]')`, { label: 'document stylesheet injected' });

    // Every selector must have been rewritten to the document scope; an unscoped rule is the bug.
    const unscoped = await app.evaluate(`(() => {
      const sheet = document.querySelector('style[data-ui-css]');
      const rules = [...sheet.sheet.cssRules].filter((r) => r.type === CSSRule.STYLE_RULE);
      return rules.filter((r) => !r.selectorText.split(',').every((s) => s.trim().startsWith('[data-uidoc'))).length;
    })()`);
    assert.equal(unscoped, 0, 'every style rule must be scoped to the document');

    // And the rules must actually be landing on elements — not just present.
    const painted = await app.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('.ui-edit-layer [data-uiel-id]')];
      const colours = new Set();
      for (const el of nodes) {
        const s = getComputedStyle(el);
        if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') colours.add(s.backgroundColor);
        if (s.backgroundImage && s.backgroundImage !== 'none') colours.add(s.backgroundImage.slice(0, 40));
      }
      return { nodes: nodes.length, colours: colours.size };
    })()`);
    assert.ok(painted.nodes > 20, `expected the kit's element tree, got ${painted.nodes} nodes`);
    assert.ok(painted.colours >= 5, `kit renders unstyled — only ${painted.colours} distinct backgrounds across ${painted.nodes} elements`);
  } finally {
    await app.dispose();
  }
});

spec('an installed UI kit cannot restyle the editor around it', async () => {
  // The other half of the bug: the kit's own `html, body { background: #101819 }` and its `:root`
  // custom properties used to be injected raw, repainting the whole editor and hijacking the
  // editor's design tokens (--accent, --text, --panel).
  const app = await openInstalledKit('pkg-feather-ui-arcade-hud');
  try {
    const leaked = await app.evaluate(`(() => {
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return {
        bodyBackground: body.backgroundColor,
        bodyOverflow: body.overflow,
        accent: root.getPropertyValue('--accent').trim(),
        text: root.getPropertyValue('--text').trim(),
        // The kit's own frame SHOULD have picked those page-level rules up instead.
        frameBackground: getComputedStyle(document.querySelector('.ui-edit-layer')).backgroundColor,
        frameAccent: getComputedStyle(document.querySelector('.ui-edit-layer')).getPropertyValue('--accent').trim(),
      };
    })()`);

    assert.notEqual(leaked.bodyBackground, 'rgb(16, 24, 25)', 'the kit repainted the editor body');
    assert.notEqual(leaked.accent, '#6ff7ff', 'the kit overrode the editor --accent token');
    assert.notEqual(leaked.text, '#f5fff9', 'the kit overrode the editor --text token');
    // The rules did not vanish — they moved onto the widget frame, which is the point.
    assert.equal(leaked.frameAccent, '#6ff7ff', 'the kit tokens should apply inside the document');
    assert.equal(leaked.frameBackground, 'rgb(16, 24, 25)', 'page-level background should style the widget frame');

    // The toolbar must still be readable — a proxy for "the editor still looks like the editor".
    const toolbar = await app.pixelStats('.toolbar');
    assert.ok(toolbar.pixels > 0, 'toolbar still laid out');
  } finally {
    await app.dispose();
  }
});

spec('the RPG kit\'s id-based layout rules survive installation', async () => {
  // 54% of the RPG kit's rules use `#id` selectors, but capture rewrote ids into `id-<name>`
  // classes and elements never render a DOM id — so its entire layout backbone (`#hud > *
  // { position: absolute }`) was dead on arrival and every region stacked in normal flow.
  const app = await openInstalledKit('pkg-feather-ui-rpg-hud');
  try {
    const placed = await app.evaluate(`(() => {
      const hud = document.querySelector('.ui-edit-layer .id-hud');
      if (!hud) return null;
      const kids = [...hud.children];
      // #hud > * { position: absolute } — plus a few regions with their own stronger rule.
      return { kids: kids.length, positioned: kids.filter((k) => getComputedStyle(k).position !== 'static').length };
    })()`);
    assert.ok(placed, 'the #hud root should be reachable as .id-hud');
    assert.ok(placed.kids > 4, `expected the HUD regions, got ${placed.kids}`);
    assert.equal(placed.positioned, placed.kids, 'every HUD region should be positioned by the kit CSS, not stacked in flow');

    // The kit's bars are styled by its stylesheet; our unbound placeholder fill used to paint a
    // flat #5B8CFF rectangle over every one of them.
    const fills = await app.evaluate(`(() => {
      const el = document.querySelector('.ui-edit-layer .id-pHpFill');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, image: s.backgroundImage, placeholders: el.querySelectorAll('.ui-bar-fill').length };
    })()`);
    assert.ok(fills, "the kit's health-bar fill should be in the tree");
    assert.equal(fills.placeholders, 0, 'no placeholder fill should be painted over a stylesheet-driven bar');
    assert.ok(
      fills.image !== 'none' || fills.background !== 'rgb(91, 140, 255)',
      `health bar is still the default placeholder blue (${fills.background})`,
    );
  } finally {
    await app.dispose();
  }
});

spec('an installed UI kit ships reusable components, not one hardcoded tree', async () => {
  const app = await openInstalledKit('pkg-feather-ui-rpg-hud');
  try {
    const shape = await app.evaluate(`(() => {
      const s = window.__featherStore;
      const count = (el, k) => (el.kind === k ? 1 : 0) + el.children.reduce((n, c) => n + count(c, k), 0);
      const hud = s.uiDocuments.find((d) => !d.isComponent);
      return {
        components: s.uiDocuments.filter((d) => d.isComponent).length,
        instances: count(hud.root, 'component'),
        parameterised: (() => {
          let n = 0;
          const walk = (el) => { if (el.componentParams) n += 1; el.children.forEach(walk); };
          walk(hud.root);
          return n;
        })(),
      };
    })()`);
    assert.ok(shape.components >= 3, `expected repeated widgets to be components, got ${shape.components}`);
    assert.ok(shape.instances >= 20, `expected many instances, got ${shape.instances}`);
    assert.equal(shape.instances, shape.parameterised, 'every instance should carry its own data as params');

    // Params are what stop one component flattening ten slots into ten copies of the first.
    const labels = await app.evaluate(`(() => {
      const els = [...document.querySelectorAll('.ui-edit-layer .buildTile')];
      return [...new Set(els.map((e) => e.textContent.trim()))].filter(Boolean).slice(0, 8);
    })()`);
    assert.ok(labels.length > 3, `component instances all render the same label: ${JSON.stringify(labels)}`);

    const broken = await app.evaluate(`document.body.innerText.includes('Missing component')`);
    assert.equal(broken, false, 'no instance should render as a missing-component placeholder');
  } finally {
    await app.dispose();
  }
});

spec('editing a component updates every instance at once', async () => {
  const app = await openInstalledKit('pkg-feather-ui-rpg-hud');
  try {
    // The payoff of instancing by reference: one edit, N places, no propagation step.
    const result = await app.evaluate(`(() => {
      const s = window.__featherStore;
      const component = s.uiDocuments.find((d) => d.isComponent);
      s.setUIElementCss(component.id, component.root.id, 'outline: 2px solid rgb(7, 231, 99);');
      return component.id;
    })()`);
    assert.ok(result, 'a component to edit');
    // Every instance renders that component's root in place, so the edit lands on all of them at
    // once — there is no propagation step to wait for beyond the re-render.
    await app.waitFor(
      `[...document.querySelectorAll('.ui-edit-layer [data-uidoc="${result}"]')].filter((e) => getComputedStyle(e).outlineColor === 'rgb(7, 231, 99)').length > 3`,
      { label: 'one component edit reached every instance' },
    );
  } finally {
    await app.dispose();
  }
});

spec('the hand-authored kit assembles three screens from three components', async () => {
  const app = await openInstalledKit('pkg-feather-ui-party-royale');
  try {
    const kit = await app.evaluate(`(() => {
      const s = window.__featherStore;
      const count = (el, k) => (el.kind === k ? 1 : 0) + el.children.reduce((n, c) => n + count(c, k), 0);
      const screens = s.uiDocuments.filter((d) => !d.isComponent);
      return {
        screens: screens.length,
        components: s.uiDocuments.filter((d) => d.isComponent).length,
        instances: screens.reduce((n, d) => n + count(d.root, 'component'), 0),
        // The kit ships the variables its HUD is already bound to.
        vars: s.variables.map((v) => v.name).sort(),
      };
    })()`);
    assert.equal(kit.screens, 3, 'menu + HUD + results');
    assert.equal(kit.components, 3, 'jelly button + stat pill + qualifier row');
    assert.ok(kit.instances >= 10, `expected the screens to be built from instances, got ${kit.instances}`);
    assert.deepEqual(kit.vars, ['Crowns', 'Kudos', 'PlayersLeft', 'Qualified', 'RoundName', 'TimeLeft']);

    // One component, many looks: each instance differs only by params and a tone class.
    const rows = await app.evaluate(`(() => {
      const s = window.__featherStore;
      s.setActiveUIDocument(s.uiDocuments.find((d) => d.name.includes('Results')).id);
      return true;
    })()`);
    assert.ok(rows);
    await app.waitFor(`document.querySelectorAll('.ui-edit-layer .pr-slot').length === 4`, { label: 'four qualifier rows' });
    const distinct = await app.evaluate(`(() => {
      const els = [...document.querySelectorAll('.ui-edit-layer .pr-slot')];
      return {
        names: [...new Set(els.map((e) => e.querySelector('.pr-slot-name').textContent.trim()))].length,
        toned: els.filter((e) => e.className.includes('is-you') || e.className.includes('is-out')).length,
      };
    })()`);
    assert.equal(distinct.names, 4, 'each instance renders its own name from params');
    assert.equal(distinct.toned, 2, 'instance classes reach the component root');
  } finally {
    await app.dispose();
  }
});

spec('each instance of a shared button fires its own event', async () => {
  // A reusable button cannot hard-code what clicking it does, so the instance supplies the event.
  const app = await openInstalledKit('pkg-feather-ui-party-royale');
  try {
    await app.evaluate(`(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      window.__events = [];
      useEditorStore.setState({ fireCustomEvent: (name) => window.__events.push(name) });
      useEditorStore.getState().setPlaying(true);
    })()`);
    await app.waitFor(`document.querySelectorAll('.pr-btn').length === 3`, { label: 'menu buttons live in Play' });
    for (const label of ['PLAY', 'PARTY', 'SHOP']) {
      await app.evaluate(`[...document.querySelectorAll('.pr-btn')].find((b) => b.textContent.trim() === '${label}').click()`);
    }
    const events = await app.evaluate(`JSON.stringify(window.__events)`);
    assert.deepEqual(JSON.parse(events), ['startMatch', 'openParty', 'openShop']);
  } finally {
    await app.dispose();
  }
});

spec('per-element CSS applies in the design canvas and in Play', async () => {
  // Reuse the kit demo purely because it leaves the UI panel docked and open.
  const app = await openInstalledKit('pkg-feather-ui-arcade-hud');
  try {
    // Build a screen HUD with one element styled purely through element CSS.
    const ids = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const docId = store.createUIDocument('CSS Test', 'screen');
      store.updateUIDocument(docId, { visibleOnStart: true });
      const elId = store.addUIElement(docId, undefined, 'text');
      store.updateUIElement(docId, elId, { text: 'styled' });
      store.setUIElementCss(docId, elId, 'background: rgb(9, 200, 77); padding: 11px;');
      store.setActiveUIDocument(docId);
      return { docId, elId };
    })()`);
    await app.waitFor(`document.querySelector('.ui-edit-layer [data-uiel-id="${ids.elId}"]')`, { label: 'test element in the canvas' });

    const previewBg = await app.evaluate(
      `getComputedStyle(document.querySelector('.ui-edit-layer [data-uiel-id="${ids.elId}"]')).backgroundColor`,
    );
    assert.equal(previewBg, 'rgb(9, 200, 77)', 'element CSS should apply in the design canvas');

    await app.realClick('.run-button');
    await app.waitFor(`document.querySelector('[data-uidoc="${ids.docId}"] [data-uiel-id="${ids.elId}"]')`, {
      label: 'HUD element rendered in Play',
    });
    const playStyle = await app.evaluate(`(() => {
      const el = document.querySelector('[data-uidoc="${ids.docId}"] [data-uiel-id="${ids.elId}"]');
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, padding: s.paddingTop };
    })()`);
    assert.equal(playStyle.background, 'rgb(9, 200, 77)', 'element CSS should apply in Play');
    assert.equal(playStyle.padding, '11px', 'element CSS declarations should all apply in Play');
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
  const requested = process.env.E2E_GREP?.trim().toLowerCase();
  const selectedSpecs = requested ? specs.filter(({ name }) => name.toLowerCase().includes(requested)) : specs;
  if (!selectedSpecs.length) throw new Error(`No e2e spec matched E2E_GREP=${JSON.stringify(process.env.E2E_GREP)}`);
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
    for (const { name, fn } of selectedSpecs) {
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

  process.stdout.write(`\n${selectedSpecs.length - failed}/${selectedSpecs.length} e2e specs passed\n`);
  process.exit(failed ? 1 : 0);
}

await main();
