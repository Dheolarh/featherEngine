import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { initRapier, getActivePhysics } from '../../runtime/physicsWorld';

/**
 * Contact detail + sphere-cast conventions, proven against a real Rapier world:
 * - a falling cube landing on a floor gets a collision event whose `normal` points TOWARD the cube
 *   ([0, 1, 0] — the direction it would bounce) with a contact point near the floor plane;
 * - castSphere sweeping straight down reports the floor, the traveled distance, a contact point on
 *   the surface, and the upward surface normal.
 */
describe('contact detail and sphere casts', () => {
  beforeAll(async () => {
    await initRapier();
  });

  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it('collision events carry a toward-me normal and a surface contact point', async () => {
    const sceneId = useEditorStore.getState().createScene('Contact Detail');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();
    store.createObjectWithProps('plane', { position: [0, 0, 0], physics: { enabled: true, bodyType: 'fixed' } });
    const cubeId = store.createObjectWithProps('cube', { position: [0, 3, 0], physics: { enabled: true, bodyType: 'dynamic' } });

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getActivePhysics()).toBeTruthy();

    // Fall until the impact event shows up in runtimeCollisions (one-frame-delayed pipeline).
    let event: { objectId: string; normal?: number[]; point?: number[]; speed?: number } | undefined;
    for (let frame = 0; frame < 120 && !event; frame += 1) {
      useEditorStore.getState().tickRuntime(1 / 60);
      event = useEditorStore.getState().runtimeCollisions.find((item) => item.objectId === cubeId);
    }
    expect(event, 'cube never reported a collision').toBeDefined();
    expect(event!.normal, 'collision event should carry a contact normal').toBeDefined();
    expect(event!.normal![1], 'normal must point UP toward the falling cube').toBeGreaterThan(0.9);
    expect(event!.point, 'collision event should carry a contact point').toBeDefined();
    expect(Math.abs(event!.point![1])).toBeLessThan(0.8); // on/near the floor plane

    // The mirrored event (floor's perspective) carries the negated normal.
    const floorEvent = useEditorStore.getState().runtimeCollisions.find((item) => item.otherObjectId === cubeId);
    expect(floorEvent?.normal?.[1]).toBeLessThan(-0.9);
  });

  it('castSphere reports hit object, distance, point, and surface normal', async () => {
    const sceneId = useEditorStore.getState().createScene('Sphere Cast');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();
    const floorId = store.createObjectWithProps('plane', { position: [0, 0, 0], physics: { enabled: true, bodyType: 'fixed' } });

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const physics = getActivePhysics()!;
    useEditorStore.getState().tickRuntime(1 / 60); // one tick so bodies sync into the world

    const hit = physics.castSphere([0, 5, 0], [0, -1, 0], 0.5, 20);
    expect(hit, 'downward sphere cast must hit the floor').toBeTruthy();
    expect(hit!.objectId).toBe(floorId);
    expect(hit!.distance).toBeGreaterThan(3.5); // ~4.5 minus floor thickness slack
    expect(hit!.distance).toBeLessThan(5);
    expect(hit!.normal[1], 'surface normal must face the caster (up)').toBeGreaterThan(0.9);
    expect(Math.abs(hit!.point[1])).toBeLessThan(0.8); // contact on the floor surface

    // A miss returns null.
    expect(physics.castSphere([100, 5, 100], [0, 1, 0], 0.5, 10)).toBeNull();
  });
});
