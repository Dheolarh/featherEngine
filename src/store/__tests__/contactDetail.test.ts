import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
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

  it('a script reads impact detail from the collision that fired its event', async () => {
    const sceneId = useEditorStore.getState().createScene('Contact Script');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();
    store.createObjectWithProps('plane', { position: [0, 0, 0], physics: { enabled: true, bodyType: 'fixed' } });
    const cubeId = store.createObjectWithProps('cube', { position: [0, 4, 0], physics: { enabled: true, bodyType: 'dynamic' } });
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Crash Probe');
    const compiled = useEditorStore.getState().applyBlueprintFeatherSource(
      blueprintId,
      [
        'blueprint Crash_Probe',
        '',
        'on collision_enter(other):',
        '    self.hit_speed = impact_speed()',
        '    self.hit_normal = contact_normal()',
      ].join('\n'),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')).toEqual([]);
    useEditorStore.getState().attachScript(cubeId, blueprintId);

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let vars: Record<string, unknown> = {};
    for (let frame = 0; frame < 150 && vars.hit_speed === undefined; frame += 1) {
      useEditorStore.getState().tickRuntime(1 / 60);
      vars = useEditorStore.getState().runtimeObjectVariables[cubeId] ?? {};
    }
    expect(vars.hit_speed, 'script never saw the impact').toBeDefined();
    const normal = vars.hit_normal as number[];
    expect(Array.isArray(normal)).toBe(true);
    expect(normal[1], 'contact normal must point up at the falling cube').toBeGreaterThan(0.9);
  });

  it('set_joint_motor spins a hinged body via script', async () => {
    const sceneId = useEditorStore.getState().createScene('Joint Motor');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();
    const wheelId = store.createObjectWithProps('cube', { position: [0, 3, 0], physics: { enabled: true, bodyType: 'dynamic' } });
    useEditorStore.getState().addJoint(wheelId, 'hinge');
    useEditorStore.getState().updateJoint(wheelId, { axis: [0, 1, 0], connectedObjectId: undefined });
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Spinner');
    const compiled = useEditorStore.getState().applyBlueprintFeatherSource(
      blueprintId,
      // Joints are created on the first physics frame, AFTER the first script tick — re-apply on a
      // throttled update so the motor command lands once the joint exists (the documented pattern).
      ['blueprint Spinner', '', 'on update every 0.2s:', '    set_joint_motor(self, velocity: 3)'].join('\n'),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')).toEqual([]);
    useEditorStore.getState().attachScript(wheelId, blueprintId);

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 1s only: at ~3 rad/s a longer run would spin past π and the Euler-wrapped yaw could read ~0.
    for (let frame = 0; frame < 60; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    const wheel = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === wheelId)!;
    // Motor commands land from ~0.2s (joints exist after the first physics frame) → ≥0.8 rad of yaw.
    expect(Math.abs(wheel.transform.rotation[1]), 'motor never spun the hinged body').toBeGreaterThan(0.8);
  });

  it('compound extra colliders collide and attribute hits to their object', async () => {
    const sceneId = useEditorStore.getState().createScene('Compound');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();
    // A fixed body whose MAIN box sits at the origin, with an EXTRA box welded 4 units along +X.
    const hammerId = store.createObjectWithProps('cube', {
      position: [0, 1, 0],
      physics: { enabled: true, bodyType: 'fixed', extraColliders: [{ shape: 'box', offset: [4, 0, 0], size: [0.5, 0.5, 0.5] }] },
    });

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const physics = getActivePhysics()!;
    useEditorStore.getState().tickRuntime(1 / 60);

    // A downward sphere cast above the EXTRA shape hits it — and reports the OWNING object's id.
    const onExtra = physics.castSphere([4, 5, 0], [0, -1, 0], 0.2, 10);
    expect(onExtra, 'the welded extra shape must be solid').toBeTruthy();
    expect(onExtra!.objectId).toBe(hammerId);
    // Between the two shapes there is nothing — the compound is two shapes, not one stretched box.
    expect(physics.castSphere([2, 5, 0], [0, -1, 0], 0.2, 3)).toBeNull();
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
    // Geometric identity: contact point = ball center at impact - normal * radius.
    expect(Math.abs(hit!.point[1] - (5 - hit!.distance - 0.5))).toBeLessThan(0.05);

    // A miss returns null.
    expect(physics.castSphere([100, 5, 100], [0, 1, 0], 0.5, 10)).toBeNull();
  });
});
