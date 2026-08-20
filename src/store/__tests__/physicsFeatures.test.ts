import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { getActivePhysics, initRapier } from '../../runtime/physicsWorld';
import type { GraphNodeCategory, Vector3Tuple } from '../../types';

/**
 * Behavioural tests for the rigid-body features that `tsc` can't say anything about: axis locks, the
 * Collision/Trigger Stay events, angular-velocity set/read-back, and scene gravity. Each one drives the
 * REAL Rapier world through `tickRuntime` and asserts on the simulated result, because every one of
 * these can compile perfectly while doing nothing at all (a lock never applied, a Stay event never
 * replayed, a gravity vector never pushed across the WASM boundary).
 */

const tick = (frames: number, dt = 1 / 60) => {
  for (let i = 0; i < frames; i += 1) useEditorStore.getState().tickRuntime(dt);
};

/**
 * Enter Play and wait for the physics world to come up — `startPhysics` activates in a microtask, so
 * ticking straight after `setPlaying` runs against a null world where every body silently stays put.
 */
const startPlay = async () => {
  useEditorStore.getState().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getActivePhysics()).toBeTruthy();
};

const objectById = (id: string) => selectActiveObjects(useEditorStore.getState()).find((o) => o.id === id);
const positionOf = (id: string) => objectById(id)!.transform.position;
const rotationOf = (id: string) => objectById(id)!.transform.rotation;

/** Wipe the starter scene so stray default objects can't collide with the fixtures under test. */
const clearScene = () => {
  const store = useEditorStore.getState();
  for (const object of selectActiveObjects(useEditorStore.getState())) store.deleteObject(object.id);
};

/**
 * Remove the scene's authored gravity. `updateSceneEnvironment` runs its patch through `stripUndefined`,
 * so gravity can only be OVERWRITTEN through it, never cleared — without this, one test's sideways
 * gravity silently leaks into the next and bodies drift out of the fixtures under test. Clearing the key
 * outright is also what lets the test below exercise the real "no gravity authored" fallback.
 */
const clearAuthoredGravity = () => {
  useEditorStore.setState((state) => ({
    scenes: state.scenes.map((scene) => {
      if (scene.id !== state.activeSceneId || !scene.environment) return scene;
      const { gravity: _gravity, ...rest } = scene.environment;
      return { ...scene, environment: rest as typeof scene.environment };
    }),
  }));
};

/** A floor wide enough that nothing under test can walk off it. */
const addFloor = () => {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', {
    name: 'Floor',
    position: [0, -0.5, 0],
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(id, 'scale', [60, 1, 60]);
  return id;
};

beforeAll(async () => {
  // The world is null until the WASM lands, and a null world silently no-ops every assertion below.
  await initRapier();
});

beforeEach(() => {
  useEditorStore.getState().setPlaying(false);
  clearScene();
  clearAuthoredGravity();
});

afterEach(() => {
  useEditorStore.getState().setPlaying(false);
});

describe('scene gravity', () => {
  it('falls along a custom gravity vector instead of the hardcoded -Y', async () => {
    const store = useEditorStore.getState();
    // Gravity pointing along -Z: a free body should travel in Z, which the old hardcoded world could not do.
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [0, 0, -20] });
    const ball = store.createObjectWithProps('sphere', {
      name: 'Ball',
      position: [0, 20, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });

    await startPlay();
    tick(60);

    const [, y, z] = positionOf(ball);
    expect(z).toBeLessThan(-1);
    // And it should NOT have fallen: all of gravity is on Z now.
    expect(Math.abs(y - 20)).toBeLessThan(0.5);
  });

  it('defaults to Earth gravity when the scene authors none', async () => {
    // beforeEach removed the gravity key entirely, so this exercises the `?? EARTH_GRAVITY` fallback.
    const store = useEditorStore.getState();
    const ball = store.createObjectWithProps('sphere', {
      name: 'Ball',
      position: [0, 20, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });

    await startPlay();
    tick(60); // one simulated second

    // ½·9.81·1² ≈ 4.9m. Asserting the DISTANCE (not just "it moved") pins the magnitude to real Earth
    // gravity — a fallback of, say, -1 would still move the ball but fail here.
    const dropped = 20 - positionOf(ball)[1];
    expect(dropped).toBeGreaterThan(4.0);
    expect(dropped).toBeLessThan(6.0);
  });
});

describe('axis locks', () => {
  it('freezes translation on locked axes only', async () => {
    const store = useEditorStore.getState();
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [0, 0, -20] });

    const locked = store.createObjectWithProps('cube', {
      name: 'Locked',
      position: [-4, 5, 0],
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'box',
        mass: 1,
        lockedTranslation: [false, false, true],
      },
    });
    const free = store.createObjectWithProps('cube', {
      name: 'Free',
      position: [4, 5, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1 },
    });

    await startPlay();
    tick(60);

    // The free twin is dragged along -Z; the locked one cannot move on Z at all.
    expect(positionOf(free)[2]).toBeLessThan(-1);
    expect(Math.abs(positionOf(locked)[2])).toBeLessThan(0.01);
  });

  it('freezes rotation on locked axes so an upright body cannot tip', async () => {
    const store = useEditorStore.getState();
    addFloor();
    // Sideways gravity while resting on the floor is what topples a tall body.
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [12, -9.81, 0] });

    const upright = store.createObjectWithProps('capsule', {
      name: 'Upright',
      position: [-6, 1.5, 0],
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'capsule',
        mass: 3,
        friction: 1,
        lockedRotation: [true, false, true],
      },
    });
    const tippy = store.createObjectWithProps('capsule', {
      name: 'Tippy',
      position: [6, 1.5, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'capsule', mass: 3, friction: 1 },
    });

    await startPlay();
    tick(150);

    const [ux, , uz] = rotationOf(upright);
    const tippyTilt = Math.abs(rotationOf(tippy)[2]);
    // The locked body holds its X/Z orientation exactly; the free one visibly rolls over.
    expect(Math.abs(ux)).toBeLessThan(0.01);
    expect(Math.abs(uz)).toBeLessThan(0.01);
    expect(tippyTilt).toBeGreaterThan(0.2);
  });
});

/** Wire a blueprint onto `objectId` and return helpers for adding/connecting its nodes. */
const scriptOn = (objectId: string, name: string) => {
  const store = useEditorStore.getState();
  const { blueprintId } = store.createBlueprintNamed(name, name);
  store.attachScript(objectId, blueprintId);
  return {
    add: (label: string, category: GraphNodeCategory, data?: Record<string, unknown>) =>
      useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, label, category, data),
    ex: (a: string, b: string) => useEditorStore.getState().connectGraphNodes(blueprintId, a, b, 'exec-out', 'exec-in'),
    vl: (a: string, b: string, handle: string) =>
      useEditorStore.getState().connectGraphNodes(blueprintId, a, b, 'value-out', handle),
  };
};

/** Build "<event> → counter = counter + 1" on `objectId`, returning the project variable's id. */
const countEventFires = (objectId: string, eventLabel: string, varName: string) => {
  const store = useEditorStore.getState();
  const varId = store.createVariable(varName, 'number', false);
  const { add, ex, vl } = scriptOn(objectId, `${varName} Counter`);
  const onEvent = add(eventLabel, 'Events');
  const read = add('Get Variable', 'Variables', { variableId: varId });
  const one = add('Number', 'Values', { numberValue: 1 });
  const sum = add('Add', 'Math');
  const write = add('Set Variable', 'Variables', { variableId: varId });
  ex(onEvent, write);
  vl(read, sum, 'a');
  vl(one, sum, 'b');
  vl(sum, write, 'value');
  return varId;
};

const varValue = (varId: string) => Number(useEditorStore.getState().runtimeVariableValues[varId] ?? 0);

describe('stay events', () => {
  it('fires Collision Stay every frame a body rests on another, not just once', async () => {
    const store = useEditorStore.getState();
    const plate = store.createObjectWithProps('cube', {
      name: 'Plate',
      position: [0, 0, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store.updateTransform(plate, 'scale', [4, 0.5, 4]);
    store.createObjectWithProps('cube', {
      name: 'Weight',
      position: [0, 1.2, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 5 },
    });
    const staysVar = countEventFires(plate, 'Collision Stay', 'Stays');

    await startPlay();
    tick(120);

    // Collision ENTER would leave this at 1. Resting contact must keep firing.
    expect(varValue(staysVar)).toBeGreaterThan(30);
  });

  it('fires Trigger Stay while overlapping and stops once the overlap ends', async () => {
    const store = useEditorStore.getState();
    addFloor();
    const zone = store.createObjectWithProps('cube', {
      name: 'Zone',
      position: [0, 3, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
    });
    store.updateTransform(zone, 'scale', [3, 3, 3]);
    // Dropped from above: it falls THROUGH the sensor, so the overlap starts and then genuinely ends.
    store.createObjectWithProps('sphere', {
      name: 'Faller',
      position: [0, 9, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });
    const staysVar = countEventFires(zone, 'Trigger Stay', 'ZoneStays');

    await startPlay();
    tick(90);
    const whileInside = varValue(staysVar);
    expect(whileInside).toBeGreaterThan(1);

    // Long past the fall-through, the counter must be frozen — Stay is not allowed to latch on.
    tick(120);
    expect(varValue(staysVar)).toBe(whileInside);
  });

  it('costs nothing when no graph listens for Stay', async () => {
    const store = useEditorStore.getState();
    const plate = store.createObjectWithProps('cube', {
      name: 'Plate',
      position: [0, 0, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store.updateTransform(plate, 'scale', [4, 0.5, 4]);
    store.createObjectWithProps('cube', {
      name: 'Weight',
      position: [0, 1.2, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 5 },
    });

    await startPlay();
    tick(60);

    // No Stay root anywhere, so physics must not have replayed a single resting contact.
    expect(useEditorStore.getState().runtimeCollisionsStay).toEqual([]);
  });
});

describe('angular velocity', () => {
  it('holds a commanded spin rate and reads it back through Get Angular Velocity', async () => {
    const store = useEditorStore.getState();
    const disc = store.createObjectWithProps('cube', {
      name: 'Turntable',
      position: [0, 2, 0],
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'box',
        mass: 20,
        // Locks act as the bearing: it can only spin about Y, and can't drift or fall.
        lockedTranslation: [true, true, true],
        lockedRotation: [true, false, true],
      },
    });
    store.updateTransform(disc, 'scale', [4, 0.4, 4]);

    const spinVar = store.createVariable('Spin', 'number', false);
    const { add, ex, vl } = scriptOn(disc, 'Turntable');
    const onUpdate = add('Update', 'Events');
    const setSpin = add('Set Angular Velocity', 'Physics', { axis: 'y', amount: 2.5 });
    const getSpin = add('Get Angular Velocity', 'Physics');
    const length = add('Vector Length', 'Math');
    const write = add('Set Variable', 'Variables', { variableId: spinVar });
    ex(onUpdate, setSpin);
    ex(setSpin, write);
    vl(getSpin, length, 'vector');
    vl(length, write, 'value');

    await startPlay();
    tick(60);

    // The body is actually turning about Y...
    expect(Math.abs(rotationOf(disc)[1])).toBeGreaterThan(0.5);
    // ...at the rate we asked for, read back out of the solver rather than echoed from the node.
    expect(varValue(spinVar)).toBeGreaterThan(2.0);
    expect(varValue(spinVar)).toBeLessThan(3.0);
    // And the locks held. Asserted on the angular VELOCITY, not Euler angles: once the Y rotation passes
    // 90° the XYZ decomposition legitimately flips X and Z to ±π on a body that never left its plane.
    const [avx, avy, avz] = useEditorStore.getState().runtimeAngularVelocities[disc]!;
    expect(Math.abs(avx)).toBeLessThan(0.01);
    expect(Math.abs(avz)).toBeLessThan(0.01);
    expect(Math.abs(avy)).toBeGreaterThan(2.0);
  });
});

describe('physics lab template', () => {
  it('builds and survives a Play session', async () => {
    const { createPhysicsLabTemplate } = await import('../../project/physicsLabTemplate');
    const pawnId = await createPhysicsLabTemplate();
    expect(pawnId).toBeTruthy();

    const store = useEditorStore.getState();
    await startPlay();
    expect(() => tick(180)).not.toThrow();
    expect(useEditorStore.getState().isPlaying).toBe(true);

    // The turntable station publishes a live spin rate — proof the graph wiring actually ran.
    const spinVar = useEditorStore.getState().variables.find((v) => v.name === 'TurntableSpin');
    expect(spinVar).toBeTruthy();
    expect(varValue(spinVar!.id)).toBeGreaterThan(2.0);
  });
});
