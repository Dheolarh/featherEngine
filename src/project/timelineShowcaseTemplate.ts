import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { RigidBodyType, SceneObjectKind, Vector3Tuple } from '../types';

/**
 * "Timeline Mechanics" — a primitive-only, walkable gallery for curve-driven runtime animation.
 *
 * Each bay teaches one reusable pattern:
 *  1. Vault Door    — a reusable prefab, local-space Play/Reverse, Update + Finished outputs.
 *  2. Elevator      — an absolute world-space Timeline.
 *  3. Drawbridge    — a parent pivot with relative local rotation.
 *  4. Security Gate — Restart and Stop on a kinematic mover.
 *  5. Crusher       — autoplaying loop + ping-pong, with Play/Stop interaction.
 *  6. Chest         — Restart plus a Finished-driven material change.
 *
 * No imported assets are required, so the project is portable and opens immediately. The returned
 * id is the gallery pawn. The moving Vault Door assembly is also captured as an editable prefab and
 * the scene contains a real instance, which keeps it inside project-package dependency closure.
 */

type PartOptions = {
  rotation?: Vector3Tuple;
  parentId?: string;
  bodyType?: RigidBodyType;
  emissive?: string;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  opacity?: number;
};

function part(
  kind: SceneObjectKind,
  name: string,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  color: string,
  options: PartOptions = {},
): string {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps(kind, {
    name,
    position,
    color,
    parentId: options.parentId,
    ...(options.bodyType && kind !== 'empty' && kind !== 'light' && kind !== 'camera'
      ? { physics: { enabled: true, bodyType: options.bodyType, collider: kind === 'sphere' ? 'sphere' : kind === 'capsule' ? 'capsule' : 'box' } }
      : {}),
  });
  store.updateTransform(id, 'scale', scale);
  if (options.rotation) store.updateTransform(id, 'rotation', options.rotation);
  if (kind !== 'empty' && kind !== 'light' && kind !== 'camera' && kind !== 'terrain') {
    store.updateRenderer(id, {
      metalness: options.metalness ?? 0.55,
      roughness: options.roughness ?? 0.34,
      ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
      ...(options.emissive
        ? {
            materialOverrides: {
              emissiveColor: options.emissive,
              emissiveIntensity: options.emissiveIntensity ?? 1.8,
            },
          }
        : {}),
    });
  }
  return id;
}

function fixedBlock(
  name: string,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  color: string,
  options: Omit<PartOptions, 'bodyType'> = {},
): string {
  return part('cube', name, position, scale, color, { ...options, bodyType: 'fixed' });
}

function stationHeader(index: number, title: string, x: number, accent: string): void {
  fixedBlock(`0${index} — ${title}`, [x, 5.9, 3.75], [7.8, 0.7, 0.18], '#091019', {
    emissive: accent,
    emissiveIntensity: 1.35,
  });
  fixedBlock(`${title} Bay Marker`, [x, 0.04, -3.7], [7.8, 0.08, 0.22], accent, {
    emissive: accent,
    emissiveIntensity: 2.2,
  });
}

function compileMechanism(
  objectId: string,
  name: string,
  description: string,
  folderId: string,
  source: string,
): { blueprintId: string; graphId: string } {
  const store = useEditorStore.getState();
  const created = store.createBlueprintNamed(name, description, folderId);
  const result = useEditorStore.getState().applyBlueprintFeatherSource(created.blueprintId, source);
  if (!result.ok) {
    const detail = result.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`).join('; ');
    throw new Error(`Could not compile ${name}: ${detail}`);
  }
  useEditorStore.getState().renameBlueprint(created.blueprintId, name);
  useEditorStore.getState().attachScript(objectId, created.blueprintId);
  return created;
}

function connectTimelineMaterialOutputs(
  blueprintId: string,
  timelineId: string,
  updateColor: string | undefined,
  finishedColor: string,
  targetObjectId?: string,
): void {
  const store = useEditorStore.getState();
  const blueprint = store.blueprints.find((item) => item.id === blueprintId);
  const graph = store.graphs.find((item) => item.id === blueprint?.graphId);
  const timeline = graph?.nodes.find(
    (node) => node.data.nodeKind === 'action.tweenProperty' && node.data.timelineId === timelineId,
  );
  if (!timeline) throw new Error(`Timeline definition "${timelineId}" was not generated.`);

  if (updateColor) {
    const updateNode = store.addGraphNodeToBlueprint(
      blueprintId,
      'Set Material Color',
      'Material',
      { materialColor: updateColor, materialColorTarget: 'emissive', targetObjectId },
      { x: timeline.position.x + 310, y: timeline.position.y - 55 },
    );
    store.connectGraphNodes(blueprintId, timeline.id, updateNode, 'exec-update', 'exec-in');
  }
  const finishedNode = store.addGraphNodeToBlueprint(
    blueprintId,
    'Set Material Color',
    'Material',
    { materialColor: finishedColor, materialColorTarget: 'emissive', targetObjectId },
    { x: timeline.position.x + 310, y: timeline.position.y + 150 },
  );
  store.connectGraphNodes(blueprintId, timeline.id, finishedNode, 'exec-done', 'exec-in');
}

function setInteractable(id: string, prompt: string, priority = 1): void {
  const store = useEditorStore.getState();
  store.setObjectVariable(id, 'interactable', true);
  store.setObjectVariable(id, 'interactPrompt', prompt);
  store.setObjectVariable(id, 'interactPriority', priority);
}

export async function createTimelineShowcaseTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;

  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  store.renameScene(sceneId, 'Timeline Mechanics');
  store.applyRenderPreset(sceneId, 'moody-cinematic');
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#07101d',
    skyHorizonColor: '#30445e',
    skyGroundColor: '#111923',
    environmentIntensity: 1.05,
    sunColor: '#8bcfff',
    sunIntensity: 0.95,
    sunAzimuth: 225,
    sunElevation: 28,
    fogEnabled: true,
    fogColor: '#08111d',
    fogNear: 28,
    fogFar: 105,
    volumetricFogEnabled: true,
    volumetricFogDensity: 0.022,
    volumetricFogColor: '#0b1a2b',
    volumetricFogHeight: 0,
    volumetricFogFalloff: 0.2,
    volumetricScattering: 0.52,
    volumetricSunStrength: 0.55,
    volumetricMaxDistance: 90,
    gravity: [0, -9.81, 0],
  });
  store.updateRenderSettings({
    quality: 'High',
    bloomEnabled: true,
    bloomIntensity: 0.82,
    bloomThreshold: 0.58,
    bloomRadius: 0.7,
    vignetteEnabled: true,
    colorGrade: { grade: 'custom', gradeIntensity: 1, contrast: 0.12, saturation: -0.04, temperature: -0.08 },
  });

  const mechanicsFolder = store.createFolder('Timeline Mechanics');

  // Gallery shell and navigation lane.
  fixedBlock('Timeline Gallery Floor', [0, -0.5, 0], [68, 1, 26], '#111721', { metalness: 0.25, roughness: 0.72 });
  fixedBlock('Timeline Gallery Back Wall', [0, 3.2, 4.8], [68, 7.4, 0.4], '#24384d', {
    metalness: 0.22,
    roughness: 0.68,
    emissive: '#0d2234',
    emissiveIntensity: 0.48,
  });
  for (const x of [-30, -20, -10, 0, 10, 20, 30]) {
    fixedBlock(`Gallery Floor Light ${x}`, [x, 0.03, -2.8], [0.18, 0.06, 2.8], '#39d8ff', {
      emissive: '#39d8ff',
      emissiveIntensity: 2.5,
    });
  }
  const galleryLights: Array<{ x: number; color: string }> = [
    { x: -25, color: '#67dcff' },
    { x: -15, color: '#8996ff' },
    { x: -5, color: '#ffc566' },
    { x: 5, color: '#ff7188' },
    { x: 15, color: '#c486ff' },
    { x: 25, color: '#6ff2b1' },
  ];
  for (const [index, lamp] of galleryLights.entries()) {
    fixedBlock(`Gallery Ceiling Fixture ${index + 1}`, [lamp.x, 6.15, -0.5], [7.6, 0.12, 0.3], '#d8e5ed', {
      emissive: lamp.color,
      emissiveIntensity: 2.8,
    });
    const lightId = store.createObjectWithProps('light', {
      name: `Gallery Fill Light ${index + 1}`,
      position: [lamp.x, 5.1, -1.4],
    });
    store.setObjectLight(lightId, {
      type: 'point',
      color: lamp.color,
      intensity: 16,
      distance: 18,
      angle: 0,
      castShadow: false,
    });
  }

  const pawnId = store.createObjectWithProps('capsule', {
    name: 'Timeline Gallery Pawn',
    position: [-25, 1.2, -5],
    color: '#67ddff',
  });
  store.toggleCharacterController(pawnId);
  store.updateCharacterController(pawnId, {
    enabled: true,
    moveSpeed: 7,
    jumpStrength: 7,
    interactRange: 6.5,
    cameraOffset: [0, 2.5, -8.5],
    cameraPitch: 0.05,
  });
  store.updateRenderer(pawnId, {
    metalness: 0.45,
    roughness: 0.25,
    materialOverrides: { emissiveColor: '#176c83', emissiveIntensity: 0.9 },
  });

  // =================================================================================================
  // 01 — INTERACTIVE VAULT DOOR PREFAB. Moving assembly is prefab-safe; the fixed jamb is scene dressing.
  // =================================================================================================
  const vaultX = -25;
  const vaultAccent = '#40dfff';
  stationHeader(1, 'VAULT DOOR — PLAY / REVERSE', vaultX, vaultAccent);
  fixedBlock('Vault Left Jamb', [vaultX - 2.65, 2.7, 0], [0.72, 5.4, 1.15], '#52677b', {
    emissive: '#172f42', emissiveIntensity: 0.8,
  });
  fixedBlock('Vault Right Jamb', [vaultX + 2.65, 2.7, 0], [0.72, 5.4, 1.15], '#52677b', {
    emissive: '#172f42', emissiveIntensity: 0.8,
  });
  fixedBlock('Vault Header', [vaultX, 5.45, 0], [6, 0.75, 1.15], '#52677b', {
    emissive: '#172f42', emissiveIntensity: 0.8,
  });
  fixedBlock('Vault Threshold', [vaultX, 0.15, 0], [6, 0.3, 1.35], '#1b222d');
  fixedBlock('Vault Recess', [vaultX, 2.75, 0.55], [4.75, 4.8, 0.18], '#05080d');

  const vaultPivot: Vector3Tuple = [vaultX - 2.25, 2.75, -0.15];
  const vaultRoot = part('cube', 'Vault Door Pivot', vaultPivot, [0.2, 5.15, 0.42], '#4e5d6f', {
    bodyType: 'kinematic',
    metalness: 0.88,
    roughness: 0.2,
    emissive: '#12384a',
    emissiveIntensity: 0.55,
  });
  part('cube', 'Vault Door Slab', [2.25, 0, 0], [4.5, 4.9, 0.48], '#405468', {
    parentId: vaultRoot,
    bodyType: 'kinematic',
    metalness: 0.9,
    roughness: 0.22,
    emissive: '#28566d',
    emissiveIntensity: 1.15,
  });
  part('cube', 'Vault Door Inner Plate', [2.25, 0, -0.29], [3.75, 4.1, 0.12], '#2b4054', {
    parentId: vaultRoot,
    metalness: 0.82,
    roughness: 0.25,
    emissive: '#1c627c',
    emissiveIntensity: 1.05,
  });
  part('sphere', 'Vault Wheel Hub', [2.25, 0, -0.55], [0.62, 0.62, 0.28], '#c4d2dc', {
    parentId: vaultRoot,
    metalness: 0.92,
    roughness: 0.16,
    emissive: '#78bed2',
    emissiveIntensity: 0.75,
  });
  for (let index = 0; index < 4; index += 1) {
    part('cube', `Vault Wheel Spoke ${index + 1}`, [2.25, 0, -0.58], [1.65, 0.13, 0.13], '#93a7b5', {
      parentId: vaultRoot,
      rotation: [0, 0, (Math.PI / 4) + index * (Math.PI / 2)],
      metalness: 0.94,
      roughness: 0.14,
      emissive: '#375f73',
      emissiveIntensity: 0.75,
    });
  }
  for (const [index, y] of [-1.55, -0.78, 0, 0.78, 1.55].entries()) {
    part('cube', `Vault Warning Stripe ${index + 1}`, [0.55, y, -0.56], [0.34, 0.42, 0.08], '#ffc247', {
      parentId: vaultRoot,
      rotation: [0, 0, -0.45],
      emissive: '#8b4c09',
      emissiveIntensity: 0.85,
    });
  }
  for (const [index, point] of ([
    [0.35, -1.85, -0.55],
    [0.35, 1.85, -0.55],
    [4.15, -1.85, -0.55],
    [4.15, 1.85, -0.55],
  ] as Vector3Tuple[]).entries()) {
    part('sphere', `Vault Lock Bolt ${index + 1}`, point, [0.22, 0.22, 0.12], '#d6e2e8', {
      parentId: vaultRoot,
      metalness: 0.96,
      roughness: 0.12,
    });
  }
  setInteractable(vaultRoot, 'E — Toggle Vault Door Timeline', 10);
  const vaultScript = compileMechanism(
    vaultRoot,
    'Vault Door Timeline',
    'Reusable prefab logic: an interact-driven local Timeline reverses smoothly without recapturing its endpoints.',
    mechanicsFolder,
    [
      'blueprint VaultDoorTimeline',
      '',
      'var open: boolean = false',
      '',
      'on interact(player):',
      '    if self.open:',
      '        self.open = false',
      '        timeline_control("vault-door-swing", command: "reverse")',
      '    else:',
      '        self.open = true',
      '        timeline_control("vault-door-swing", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "vault-door-swing", name: "Vault Door Swing", property: "rotation", to: vec3(0, -105, 0), duration: 1.35, curve: "smooth", space: "local", relative: true)',
    ].join('\n'),
  );
  connectTimelineMaterialOutputs(vaultScript.blueprintId, 'vault-door-swing', '#1fdcff', '#4dff9b');

  const vaultPrefabId = useEditorStore.getState().createPrefabFromObject(
    vaultRoot,
    'Interactive Vault Door',
    mechanicsFolder,
  );
  if (!vaultPrefabId) throw new Error('Could not capture the Interactive Vault Door prefab.');
  useEditorStore.getState().deleteObject(vaultRoot);
  const vaultInstanceId = useEditorStore.getState().instantiatePrefab(vaultPrefabId, { position: vaultPivot });
  if (!vaultInstanceId) throw new Error('Could not place the Interactive Vault Door prefab instance.');

  // =================================================================================================
  // 02 — ELEVATOR. Absolute world-space endpoint; reverse returns to the authored starting floor.
  // =================================================================================================
  const liftX = -15;
  const liftAccent = '#7c8cff';
  stationHeader(2, 'ELEVATOR — WORLD SPACE', liftX, liftAccent);
  fixedBlock('Elevator Left Tower', [liftX - 2.25, 2.8, 0], [0.38, 5.6, 0.6], '#202a39');
  fixedBlock('Elevator Right Tower', [liftX + 2.25, 2.8, 0], [0.38, 5.6, 0.6], '#202a39');
  fixedBlock('Elevator Top Beam', [liftX, 5.55, 0], [4.9, 0.38, 0.6], '#293548');
  const elevator = part('cube', 'World Space Elevator', [liftX, 0.35, 0], [4.1, 0.45, 3.6], '#5667c9', {
    bodyType: 'kinematic',
    emissive: '#26368f',
    emissiveIntensity: 0.9,
  });
  setInteractable(elevator, 'E — Play / Reverse World-Space Elevator');
  compileMechanism(
    elevator,
    'Elevator World Timeline',
    'An absolute world-space position Timeline: useful when a lift must land at a known level coordinate.',
    mechanicsFolder,
    [
      'blueprint ElevatorWorldTimeline',
      '',
      'var raised: boolean = false',
      '',
      'on interact(player):',
      '    if self.raised:',
      '        self.raised = false',
      '        timeline_control("elevator-world-lift", command: "reverse")',
      '    else:',
      '        self.raised = true',
      '        timeline_control("elevator-world-lift", command: "play")',
      '',
      'detached:',
      `    timeline(self, id: "elevator-world-lift", name: "Elevator World Lift", property: "position", to: vec3(${liftX}, 4.9, 0), duration: 2.2, curve: "smooth", space: "world")`,
    ].join('\n'),
  );

  // =================================================================================================
  // 03 — DRAWBRIDGE. A pivot object rotates locally; the deck is a child and inherits the motion.
  // =================================================================================================
  const bridgeX = -5;
  const bridgeAccent = '#ffb84a';
  stationHeader(3, 'DRAWBRIDGE — LOCAL PIVOT', bridgeX, bridgeAccent);
  fixedBlock('Drawbridge Left Bank', [bridgeX, 0.55, 2.8], [6.8, 1.1, 2.1], '#232b36');
  fixedBlock('Drawbridge Far Bank', [bridgeX, 0.55, -2.8], [6.8, 1.1, 2.1], '#232b36');
  const bridgePivot = part('cube', 'Drawbridge Pivot', [bridgeX, 1.05, 1.75], [4.8, 0.28, 0.36], '#73808e', {
    bodyType: 'kinematic',
    metalness: 0.9,
    roughness: 0.18,
  });
  part('cube', 'Drawbridge Deck', [0, 0, -2.25], [4.3, 0.32, 4.5], '#8d592f', {
    parentId: bridgePivot,
    bodyType: 'kinematic',
    metalness: 0.22,
    roughness: 0.68,
  });
  part('cube', 'Drawbridge Left Rail', [-2.05, 0.45, -2.25], [0.16, 0.9, 4.5], '#d18a3c', {
    parentId: bridgePivot,
    emissive: '#7e3c10',
    emissiveIntensity: 0.6,
  });
  part('cube', 'Drawbridge Right Rail', [2.05, 0.45, -2.25], [0.16, 0.9, 4.5], '#d18a3c', {
    parentId: bridgePivot,
    emissive: '#7e3c10',
    emissiveIntensity: 0.6,
  });
  setInteractable(bridgePivot, 'E — Raise / Lower Local-Space Drawbridge');
  compileMechanism(
    bridgePivot,
    'Drawbridge Local Timeline',
    'A parent pivot Timeline rotates a complete child assembly in relative local space.',
    mechanicsFolder,
    [
      'blueprint DrawbridgeLocalTimeline',
      '',
      'var raised: boolean = false',
      '',
      'on interact(player):',
      '    if self.raised:',
      '        self.raised = false',
      '        timeline_control("drawbridge-raise", command: "reverse")',
      '    else:',
      '        self.raised = true',
      '        timeline_control("drawbridge-raise", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "drawbridge-raise", name: "Drawbridge Raise", property: "rotation", to: vec3(-68, 0, 0), duration: 1.8, curve: "smooth", space: "local", relative: true)',
    ].join('\n'),
  );

  // =================================================================================================
  // 04 — SECURITY GATE. Interact alternates Restart and Stop so interruption/holding is easy to inspect.
  // =================================================================================================
  const gateX = 5;
  const gateAccent = '#ff5d78';
  stationHeader(4, 'SECURITY GATE — RESTART / STOP', gateX, gateAccent);
  fixedBlock('Security Gate Left Post', [gateX - 2.35, 2.6, 0], [0.55, 5.2, 0.75], '#3b2630');
  fixedBlock('Security Gate Right Post', [gateX + 2.35, 2.6, 0], [0.55, 5.2, 0.75], '#3b2630');
  fixedBlock('Security Gate Header', [gateX, 5.25, 0], [5.25, 0.52, 0.75], '#3b2630');
  const gate = part('cube', 'Restartable Security Gate', [gateX, 2.45, 0], [4.25, 4.7, 0.38], '#6d2638', {
    bodyType: 'kinematic',
    emissive: '#8f1734',
    emissiveIntensity: 1.05,
  });
  for (const [index, y] of [-1.55, -0.78, 0, 0.78, 1.55].entries()) {
    part('cube', `Security Gate Warning Bar ${index + 1}`, [0, y, -0.24], [3.75, 0.16, 0.08], '#ffb33b', {
      parentId: gate,
      emissive: '#8b4300',
      emissiveIntensity: 0.85,
    });
  }
  setInteractable(gate, 'E — Restart / Stop Security Gate');
  compileMechanism(
    gate,
    'Security Gate Control Timeline',
    'Restart begins from the authored start; Stop holds the gate exactly where it is.',
    mechanicsFolder,
    [
      'blueprint SecurityGateControlTimeline',
      '',
      'var moving: boolean = false',
      '',
      'on interact(player):',
      '    if self.moving:',
      '        self.moving = false',
      '        timeline_control("security-gate-lift", command: "stop")',
      '    else:',
      '        self.moving = true',
      '        timeline_control("security-gate-lift", command: "restart")',
      '',
      'detached:',
      '    timeline(self, id: "security-gate-lift", name: "Security Gate Lift", property: "position", to: vec3(0, 4.4, 0), duration: 2.6, curve: "smooth", space: "local", relative: true)',
    ].join('\n'),
  );

  // =================================================================================================
  // 05 — CRUSHER. Starts automatically, loops and ping-pongs; interaction pauses/resumes held time.
  // =================================================================================================
  const crusherX = 15;
  const crusherAccent = '#b66cff';
  stationHeader(5, 'CRUSHER — LOOP / PING-PONG', crusherX, crusherAccent);
  fixedBlock('Crusher Left Column', [crusherX - 2.5, 2.75, 0], [0.65, 5.5, 0.85], '#30263b');
  fixedBlock('Crusher Right Column', [crusherX + 2.5, 2.75, 0], [0.65, 5.5, 0.85], '#30263b');
  fixedBlock('Crusher Top Housing', [crusherX, 5.45, 0], [5.65, 0.8, 1.2], '#30263b');
  fixedBlock('Crusher Anvil', [crusherX, 0.32, 0], [4.5, 0.64, 3.8], '#292c35');
  const crusher = part('cube', 'Looping Crusher Head', [crusherX, 3.75, 0], [4.25, 0.85, 3.5], '#713da0', {
    bodyType: 'kinematic',
    emissive: '#541a83',
    emissiveIntensity: 1.25,
  });
  for (const offset of [-1.45, -0.48, 0.48, 1.45]) {
    part('cube', `Crusher Tooth ${offset}`, [offset, -0.65, 0], [0.48, 0.55, 2.8], '#b6a4c7', {
      parentId: crusher,
      metalness: 0.86,
      roughness: 0.18,
    });
  }
  setInteractable(crusher, 'E — Stop / Resume Looping Crusher');
  compileMechanism(
    crusher,
    'Looping Crusher Timeline',
    'An autoplaying local relative Timeline with loop and ping-pong enabled; Interact pauses and resumes.',
    mechanicsFolder,
    [
      'blueprint LoopingCrusherTimeline',
      '',
      'var running: boolean = true',
      '',
      'on start:',
      '    timeline_control("crusher-cycle", command: "play")',
      '',
      'on interact(player):',
      '    if self.running:',
      '        self.running = false',
      '        timeline_control("crusher-cycle", command: "stop")',
      '    else:',
      '        self.running = true',
      '        timeline_control("crusher-cycle", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "crusher-cycle", name: "Crusher Cycle", property: "position", to: vec3(0, -2.65, 0), duration: 1.15, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );

  // =================================================================================================
  // 06 — CHEST. Restartable lid; Timeline Finished lights a separate reward beacon.
  // =================================================================================================
  const chestX = 25;
  const chestAccent = '#53f0a4';
  stationHeader(6, 'CHEST — RESTART / FINISHED', chestX, chestAccent);
  fixedBlock('Chest Plinth', [chestX, 0.3, 0], [5.2, 0.6, 4.2], '#172820');
  fixedBlock('Chest Base', [chestX, 1.05, 0], [3.8, 1.45, 2.7], '#74542c', {
    metalness: 0.32,
    roughness: 0.52,
  });
  fixedBlock('Chest Front Band', [chestX, 1.05, -1.39], [0.45, 1.2, 0.12], '#d4b461', {
    metalness: 0.88,
    roughness: 0.18,
  });
  const chestBeacon = part('sphere', 'Chest Finished Beacon', [chestX, 3.85, 0], [0.45, 0.45, 0.45], '#18382b', {
    emissive: '#10281f',
    emissiveIntensity: 0.35,
    metalness: 0.45,
    roughness: 0.22,
  });
  const chestPivot = part('cube', 'Restartable Chest Lid Pivot', [chestX, 1.85, 1.18], [3.9, 0.22, 0.24], '#d4b461', {
    bodyType: 'kinematic',
    metalness: 0.9,
    roughness: 0.16,
  });
  part('cube', 'Chest Lid', [0, 0, -1.18], [3.8, 0.42, 2.6], '#8e6732', {
    parentId: chestPivot,
    bodyType: 'kinematic',
    metalness: 0.35,
    roughness: 0.48,
  });
  setInteractable(chestPivot, 'E — Restart Chest Timeline');
  const chestScript = compileMechanism(
    chestPivot,
    'Chest Finished Timeline',
    'Interact restarts the lid Timeline; its Finished output turns on the reward beacon.',
    mechanicsFolder,
    [
      'blueprint ChestFinishedTimeline',
      '',
      'on interact(player):',
      '    timeline_control("chest-open", command: "restart")',
      '',
      'detached:',
      '    timeline(self, id: "chest-open", name: "Chest Open", property: "rotation", to: vec3(-78, 0, 0), duration: 0.9, curve: "smooth", space: "local", relative: true)',
    ].join('\n'),
  );
  connectTimelineMaterialOutputs(chestScript.blueprintId, 'chest-open', undefined, '#53f0a4', chestBeacon);

  // Keep the reusable door selected in the scene and expose its graph as the first asset to inspect.
  useEditorStore.getState().selectObject('');
  useEditorStore.getState().setActiveBlueprint(vaultScript.blueprintId);
  return pawnId;
}
