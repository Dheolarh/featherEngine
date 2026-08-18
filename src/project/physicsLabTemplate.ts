import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { GraphNodeCategory, Vector3Tuple } from '../types';

/**
 * "Physics Lab" — a compact, model-free showcase of the rigid-body feature set, built as five
 * side-by-side stations you walk between. Every station demonstrates ONE capability end to end, with a
 * deliberate control object next to it so the difference is visible rather than described:
 *
 *  1. AXIS LOCKS      — a 2.5D lane where locked crates can't leave the play plane, and an upright
 *                       barrel that can't tip, next to unlocked twins that do both.
 *  2. COLLISION STAY  — a pressure plate that stays lit only while weight rests on it.
 *  3. TRIGGER STAY    — a hazard field that ticks damage-over-time while you stand in it.
 *  4. ANGULAR VELOCITY— a turntable spun at an exact rate, using axis locks as its bearing (no joint),
 *                       with its live spin rate read back into a HUD variable.
 *  5. SET GRAVITY     — 1/2/3 switch the whole scene between Earth, Moon, and zero-g.
 *
 * Uses only primitives, so it loads instantly with no asset fetch. Returns the pawn's id.
 */

function categoryFor(label: string): GraphNodeCategory {
  if (['Start', 'Update', 'Key Down', 'Collision Stay', 'Collision Exit', 'Trigger Stay', 'Trigger Exit'].includes(label)) return 'Events';
  if (['Cooldown', 'Branch'].includes(label)) return 'Logic';
  if (['Get Variable', 'Set Variable'].includes(label)) return 'Variables';
  if (['Number', 'Vector3'].includes(label)) return 'Values';
  if (['Add', 'Vector Length'].includes(label)) return 'Math';
  if (['Set Angular Velocity', 'Get Angular Velocity', 'Set Gravity', 'Apply Impulse'].includes(label)) return 'Physics';
  return 'Runtime';
}

/** Ground/wall/prop helpers — every station is built from these three. */
function fixedBlock(name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, emissive?: string): string {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', {
    name,
    position,
    color,
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(id, 'scale', scale);
  store.updateRenderer(id, {
    roughness: 0.85,
    ...(emissive ? { materialOverrides: { emissiveColor: emissive, emissiveIntensity: 1.8 } } : {}),
  });
  return id;
}

/** A label plate — a thin emissive slab standing behind a station so it reads at a glance. */
function signPost(name: string, position: Vector3Tuple, color: string): string {
  return fixedBlock(name, position, [3.4, 0.5, 0.12], '#0d1016', color);
}

export async function createPhysicsLabTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;

  // Clear the starter-scene defaults so the lab starts clean (the pawn is rebuilt below).
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  // A clean, evenly-lit studio look — this template is about motion, so nothing should compete with it.
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#121a26',
    skyHorizonColor: '#2a3444',
    skyGroundColor: '#161b23',
    fogEnabled: true,
    fogColor: '#151b25',
    fogNear: 30,
    fogFar: 130,
    // Explicitly Earth: station 5 flips this at runtime, so the authored value is the "reset" state.
    gravity: [0, -9.81, 0],
  });

  // Floor.
  fixedBlock('Lab Floor', [0, -0.5, 0], [64, 1, 34], '#1b2029');

  // --- Pawn: a plain capsule character controller (no rig — it slides, which is fine for a lab). ---
  const pawnId = store.createObjectWithProps('capsule', {
    name: 'Lab Pawn',
    position: [-24, 1.2, 8],
    color: '#4fd2e8',
  });
  // NOTE: the character controller integrates its OWN `gravity` value (it's kinematic, not solver-driven),
  // so station 5's Set Gravity deliberately does not change how the pawn falls — only the rigid bodies.
  store.updateCharacterController(pawnId, { enabled: true, moveSpeed: 7, jumpStrength: 8, cameraOffset: [0, 2.2, -8] });
  store.updateRenderer(pawnId, { materialOverrides: { emissiveColor: '#1d7f92', emissiveIntensity: 1.2 } });

  // HUD-facing project variables. Each station writes one so the effect is measurable, not just visual.
  const holdTimeVar = store.createVariable('PlateHoldTime', 'number', false);
  const hazardTicksVar = store.createVariable('HazardTicks', 'number', false);
  const spinRateVar = store.createVariable('TurntableSpin', 'number', false);

  // ============================================================================================
  // STATION 1 — AXIS LOCKS. Left: locked. Right: identical but unlocked. Shove both and compare.
  // ============================================================================================
  signPost('Sign — 1. Axis Locks', [-24, 2.6, -6], '#5adcff');
  fixedBlock('Lane Wall Back', [-24, 0.75, -4.4], [12, 1.5, 0.4], '#232a36');

  // LOCKED crates: translation frozen on Z, so no matter how they're hit they stay on the play plane.
  // This is the 2.5D side-scroller setup — the whole reason axis locks exist.
  for (let i = 0; i < 3; i += 1) {
    const id = store.createObjectWithProps('cube', {
      name: 'Crate (Z-locked)',
      position: [-27 + i * 1.3, 0.55 + i * 1.1, -1.5],
      color: '#4fd2e8',
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'box',
        mass: 2,
        lockedTranslation: [false, false, true],
      },
    });
    store.updateTransform(id, 'scale', [1, 1, 1]);
  }

  // UNLOCKED control crates — same mass and shape, free to scatter off the plane.
  for (let i = 0; i < 3; i += 1) {
    const id = store.createObjectWithProps('cube', {
      name: 'Crate (free)',
      position: [-20 + i * 1.3, 0.55 + i * 1.1, -1.5],
      color: '#8b93a4',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 2 },
    });
    store.updateTransform(id, 'scale', [1, 1, 1]);
  }

  // Upright barrel: rotation frozen about X and Z, so it can be shoved and slide but NEVER topples —
  // the standard fix for "my crate keeps tipping over", and how you keep a physics pawn on its feet.
  const uprightId = store.createObjectWithProps('capsule', {
    name: 'Barrel (upright-locked)',
    position: [-27, 1.4, 2],
    color: '#7ef0a8',
    physics: {
      enabled: true,
      bodyType: 'dynamic',
      collider: 'capsule',
      mass: 3,
      lockedRotation: [true, false, true],
    },
  });
  store.updateTransform(uprightId, 'scale', [1, 1.4, 1]);

  const tippyId = store.createObjectWithProps('capsule', {
    name: 'Barrel (free)',
    position: [-23, 1.4, 2],
    color: '#8b93a4',
    physics: { enabled: true, bodyType: 'dynamic', collider: 'capsule', mass: 3 },
  });
  store.updateTransform(tippyId, 'scale', [1, 1.4, 1]);

  // ============================================================================================
  // STATION 2 — COLLISION STAY. A plate that glows only while something is physically resting on it.
  // Collision ENTER fires once, so a "while weight is on me" light is only possible with Stay.
  // ============================================================================================
  signPost('Sign — 2. Collision Stay', [-10, 2.6, -6], '#ffd166');
  const plateId = fixedBlock('Pressure Plate', [-10, 0.12, 0], [4, 0.25, 4], '#2a2f3a', '#4a1f1f');

  // The weight the player pushes onto the plate.
  const weightId = store.createObjectWithProps('cube', {
    name: 'Plate Weight',
    position: [-13.5, 1.2, 0],
    color: '#ffd166',
    physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 6, friction: 0.9 },
  });
  store.updateTransform(weightId, 'scale', [1.6, 1.6, 1.6]);

  const { blueprintId: plateBp } = store.createBlueprintNamed(
    'Pressure Plate',
    'Collision Stay keeps the plate lit while weight rests on it; Collision Exit puts it out.',
  );
  store.attachScript(plateId, plateBp);
  {
    const add = (label: string, data?: Record<string, unknown>, pos?: { x: number; y: number }) =>
      store.addGraphNodeToBlueprint(plateBp, label, categoryFor(label), data, pos);
    const ex = (a: string, b: string) => store.connectGraphNodes(plateBp, a, b, 'exec-out', 'exec-in');
    const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(plateBp, a, b, 'value-out', handle);

    // Lit while held.
    const onStay = add('Collision Stay', undefined, { x: 60, y: 60 });
    const litColor = add('Set Material Color', { materialColor: '#38f08a', materialColorTarget: 'emissive' }, { x: 340, y: 60 });
    ex(onStay, litColor);

    // Stay runs ~60x/s, so the counter is gated behind a 1s Cooldown — the canonical Stay pattern.
    const holdGate = add('Cooldown', { numberValue: 1 }, { x: 600, y: 60 });
    const readHold = add('Get Variable', { variableId: holdTimeVar }, { x: 600, y: 260 });
    const oneMore = add('Add', {}, { x: 840, y: 200 });
    const one = add('Number', { numberValue: 1 }, { x: 600, y: 380 });
    const writeHold = add('Set Variable', { variableId: holdTimeVar }, { x: 1080, y: 60 });
    ex(litColor, holdGate);
    ex(holdGate, writeHold);
    vl(readHold, oneMore, 'a');
    vl(one, oneMore, 'b');
    vl(oneMore, writeHold, 'value');

    // Dark again the moment the weight leaves.
    const onExit = add('Collision Exit', undefined, { x: 60, y: 560 });
    const darkColor = add('Set Material Color', { materialColor: '#4a1f1f', materialColorTarget: 'emissive' }, { x: 340, y: 560 });
    ex(onExit, darkColor);
  }

  // ============================================================================================
  // STATION 3 — TRIGGER STAY. A hazard field that ticks while you stand in it, and stops when you leave.
  // ============================================================================================
  signPost('Sign — 3. Trigger Stay', [2, 2.6, -6], '#ff6b6b');
  const hazardId = store.createObjectWithProps('cube', {
    name: 'Hazard Field',
    position: [2, 1.5, 0],
    color: '#ff6b6b',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  store.updateTransform(hazardId, 'scale', [5, 3, 5]);
  store.updateRenderer(hazardId, { opacity: 0.3, materialOverrides: { emissiveColor: '#ff2d2d', emissiveIntensity: 1.4 } });

  const { blueprintId: hazardBp } = store.createBlueprintNamed(
    'Hazard Field',
    'Trigger Stay ticks damage-over-time while a body is inside; Trigger Enter alone could only fire once.',
  );
  store.attachScript(hazardId, hazardBp);
  {
    const add = (label: string, data?: Record<string, unknown>, pos?: { x: number; y: number }) =>
      store.addGraphNodeToBlueprint(hazardBp, label, categoryFor(label), data, pos);
    const ex = (a: string, b: string) => store.connectGraphNodes(hazardBp, a, b, 'exec-out', 'exec-in');
    const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(hazardBp, a, b, 'value-out', handle);

    const onStay = add('Trigger Stay', { otherObjectId: pawnId }, { x: 60, y: 60 });
    // Half-second ticks rather than 60 ticks a second — always gate a Stay body behind a Cooldown.
    const tickGate = add('Cooldown', { numberValue: 0.5 }, { x: 340, y: 60 });
    const readTicks = add('Get Variable', { variableId: hazardTicksVar }, { x: 340, y: 300 });
    const bump = add('Add', {}, { x: 600, y: 240 });
    const one = add('Number', { numberValue: 1 }, { x: 340, y: 420 });
    const writeTicks = add('Set Variable', { variableId: hazardTicksVar }, { x: 860, y: 60 });
    const shake = add('Camera Shake', { shakeAmount: 0.18 }, { x: 1120, y: 60 });
    ex(onStay, tickGate);
    ex(tickGate, writeTicks);
    ex(writeTicks, shake);
    vl(readTicks, bump, 'a');
    vl(one, bump, 'b');
    vl(bump, writeTicks, 'value');
  }

  // ============================================================================================
  // STATION 4 — ANGULAR VELOCITY. A turntable spun at an exact rate, with axis locks AS the bearing:
  // all translation frozen (it can't be knocked off its spot) and X/Z rotation frozen (it can only
  // spin about Y). That is a hinge joint's behaviour with no joint to configure.
  // ============================================================================================
  signPost('Sign — 4. Angular Velocity', [14, 2.6, -6], '#c58bff');
  const tableId = store.createObjectWithProps('cube', {
    name: 'Turntable',
    position: [14, 0.6, 0],
    color: '#c58bff',
    physics: {
      enabled: true,
      bodyType: 'dynamic',
      collider: 'box',
      mass: 40,
      friction: 1,
      lockedTranslation: [true, true, true],
      lockedRotation: [true, false, true],
    },
  });
  store.updateTransform(tableId, 'scale', [6, 0.4, 6]);
  store.updateRenderer(tableId, { metalness: 0.4, roughness: 0.3, materialOverrides: { emissiveColor: '#5a2f8f', emissiveIntensity: 0.8 } });

  // Passengers — they get carried, then flung, by friction alone.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const id = store.createObjectWithProps('cube', {
      name: 'Turntable Rider',
      position: [14 + Math.cos(angle) * 2, 1.2, Math.sin(angle) * 2],
      color: '#f0f2f5',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1, friction: 0.9 },
    });
    store.updateTransform(id, 'scale', [0.7, 0.7, 0.7]);
  }

  const { blueprintId: tableBp } = store.createBlueprintNamed(
    'Turntable',
    'Set Angular Velocity holds an exact spin rate; Get Angular Velocity reads it back for the HUD.',
  );
  store.attachScript(tableId, tableBp);
  {
    const add = (label: string, data?: Record<string, unknown>, pos?: { x: number; y: number }) =>
      store.addGraphNodeToBlueprint(tableBp, label, categoryFor(label), data, pos);
    const ex = (a: string, b: string) => store.connectGraphNodes(tableBp, a, b, 'exec-out', 'exec-in');
    const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(tableBp, a, b, 'value-out', handle);

    // Held every frame, not kicked once: Apply Torque would be fought by friction from the riders and
    // the rate would sag. Set Angular Velocity pins it at exactly 2.5 rad/s regardless of load.
    const onUpdate = add('Update', {}, { x: 60, y: 60 });
    const spin = add('Set Angular Velocity', { axis: 'y', amount: 2.5 }, { x: 340, y: 60 });
    ex(onUpdate, spin);

    // Read the true post-step spin back out and publish its magnitude for a HUD binding.
    const readSpin = add('Get Angular Velocity', {}, { x: 340, y: 300 });
    const magnitude = add('Vector Length', {}, { x: 620, y: 300 });
    const writeSpin = add('Set Variable', { variableId: spinRateVar }, { x: 880, y: 60 });
    ex(spin, writeSpin);
    vl(readSpin, magnitude, 'vector');
    vl(magnitude, writeSpin, 'value');
  }

  // ============================================================================================
  // STATION 5 — SET GRAVITY. 1 = Earth, 2 = Moon, 3 = zero-g. Watch the tower behave differently.
  // ============================================================================================
  signPost('Sign — 5. Gravity  [1] [2] [3]', [26, 2.6, -6], '#7ef0a8');
  for (let i = 0; i < 10; i += 1) {
    const id = store.createObjectWithProps('sphere', {
      name: 'Gravity Ball',
      position: [26 + ((i % 3) - 1) * 1.2, 1 + i * 1.3, ((i % 2) - 0.5) * 1.2],
      color: i % 2 === 0 ? '#7ef0a8' : '#f0f2f5',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1, restitution: 0.45 },
    });
    store.updateTransform(id, 'scale', [0.8, 0.8, 0.8]);
  }
  // A bowl so the balls stay in the station instead of rolling across the lab.
  fixedBlock('Gravity Pit Wall +X', [30, 0.75, 0], [0.4, 1.5, 8], '#232a36');
  fixedBlock('Gravity Pit Wall -X', [22, 0.75, 0], [0.4, 1.5, 8], '#232a36');
  fixedBlock('Gravity Pit Wall +Z', [26, 0.75, 4], [8, 1.5, 0.4], '#232a36');
  fixedBlock('Gravity Pit Wall -Z', [26, 0.75, -4], [8, 1.5, 0.4], '#232a36');

  const consoleId = store.createObjectWithProps('empty', { name: 'Gravity Console', position: [26, 0, -6] });
  const { blueprintId: gravityBp } = store.createBlueprintNamed(
    'Gravity Console',
    'Press 1 / 2 / 3 during Play to switch the whole scene between Earth, Moon, and zero gravity.',
  );
  store.attachScript(consoleId, gravityBp);
  {
    const add = (label: string, data?: Record<string, unknown>, pos?: { x: number; y: number }) =>
      store.addGraphNodeToBlueprint(gravityBp, label, categoryFor(label), data, pos);
    const ex = (a: string, b: string) => store.connectGraphNodes(gravityBp, a, b, 'exec-out', 'exec-in');

    const presets: Array<{ key: string; label: string; gravity: Vector3Tuple }> = [
      { key: 'Digit1', label: 'Earth', gravity: [0, -9.81, 0] },
      { key: 'Digit2', label: 'Moon', gravity: [0, -1.62, 0] },
      { key: 'Digit3', label: 'Zero G', gravity: [0, 0, 0] },
    ];
    presets.forEach((preset, index) => {
      const onKey = add('Key Down', { keyCode: preset.key }, { x: 60, y: 60 + index * 220 });
      const setG = add('Set Gravity', { vectorValue: preset.gravity }, { x: 340, y: 60 + index * 220 });
      const say = add('Print', { message: `Gravity → ${preset.label}` }, { x: 640, y: 60 + index * 220 });
      ex(onKey, setG);
      ex(setG, say);
    });
  }

  useEditorStore.getState().selectObject(pawnId);
  return pawnId;
}
