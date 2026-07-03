import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { initRapier, startPhysics, getActivePhysics } from '../../runtime/physicsWorld';
import { readTransform } from '../../runtime/transformBuffer';

/**
 * High-refresh-rate motion regression tests (the "car/character freezes then snaps forward at
 * speed" bug). The physics sim steps at a FIXED 1/60s; on displays faster than 60Hz many render
 * ticks run ZERO physics steps. Two things must hold on those 0-step ticks:
 *
 * 1. Kinematic movers (characters, script-driven bodies) must NOT lose or revert their per-tick
 *    movement — the readback returns the queued (collision-resolved) next-translation, not the
 *    stale stepped pose.
 * 2. Fast dynamic bodies/vehicles keep publishing their INTERPOLATED render pose into the buffer
 *    (climbing alpha), even though the store transform didn't change — dropping them from the
 *    publish on exactly those frames was the freeze/snap judder.
 */
describe('fixed-timestep motion at high refresh rates', () => {
  beforeAll(async () => {
    await initRapier();
  });

  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it('a scripted character keeps its movement on 0-step (120Hz) ticks', async () => {
    const sceneId = useEditorStore.getState().createScene('HighRefresh Char');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();

    // Ground so the character has something to stand on, plus a scripted walker.
    store.createObjectWithProps('plane', { position: [0, 0, 0], physics: { enabled: true, bodyType: 'fixed' } });
    const walkerId = useEditorStore.getState().createObjectWithProps('capsule', { position: [0, 1, 0] });
    useEditorStore.getState().toggleCharacterController(walkerId);
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Walker');
    useEditorStore.getState().applyBlueprintFeatherSource(
      blueprintId,
      ['blueprint Walker', '', 'on update(dt):', '    self.translate(axis: "z", amount: 4)'].join('\n'),
    );
    useEditorStore.getState().attachScript(walkerId, blueprintId);

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // startPhysics activates in a microtask
    expect(getActivePhysics()).toBeTruthy();
    // Settle: let the body/controller register and take a few full steps.
    for (let i = 0; i < 6; i += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const before = selectActiveObjects(useEditorStore.getState()).find((o) => o.id === walkerId)!.transform.position[2];

    // One 120Hz tick: banks 8.3ms — ZERO physics steps run. The scripted movement of this tick
    // must survive in the store (pre-fix it was reverted to the frozen body pose).
    useEditorStore.getState().tickRuntime(1 / 120);
    const after = selectActiveObjects(useEditorStore.getState()).find((o) => o.id === walkerId)!.transform.position[2];
    expect(after - before).toBeGreaterThan(4 * (1 / 120) * 0.5); // at least half the expected 1/120s stride

    // And across a full simulated second at 120Hz, distance ≈ speed (no half-speed movement loss).
    const start = after;
    for (let i = 0; i < 120; i += 1) useEditorStore.getState().tickRuntime(1 / 120);
    const end = selectActiveObjects(useEditorStore.getState()).find((o) => o.id === walkerId)!.transform.position[2];
    expect(end - start).toBeGreaterThan(4 * 0.8); // ≥80% of 4 u/s over 1s (controller/collision slack)
  });

  it('a fast dynamic body keeps publishing interpolated render poses on 0-step ticks', async () => {
    const sceneId = useEditorStore.getState().createScene('HighRefresh Body');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();
    // Free-falling dynamic cube — guaranteed continuous motion with no scripts involved.
    const cubeId = store.createObjectWithProps('cube', {
      position: [0, 40, 0],
      physics: { enabled: true, bodyType: 'dynamic' },
    });

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // startPhysics activates in a microtask
    expect(getActivePhysics()).toBeTruthy();
    for (let i = 0; i < 6; i += 1) useEditorStore.getState().tickRuntime(1 / 60); // fall for a few steps

    // 0-step tick: the STORE pose may not change, but the RENDER buffer must glide (climbing alpha).
    const bufferBefore = readTransform(cubeId)!.position[1];
    useEditorStore.getState().tickRuntime(1 / 120); // 0 steps
    const bufferAfter = readTransform(cubeId)!.position[1];
    expect(bufferAfter).not.toBe(bufferBefore); // pre-fix: identical → mesh froze, then snapped
    expect(bufferAfter).toBeLessThan(bufferBefore); // still falling, glide continues downward
  });
});

// startPhysics is re-exported through setPlaying; imported here only to keep the module referenced
// explicitly for readers hunting the physics lifecycle.
void startPhysics;
