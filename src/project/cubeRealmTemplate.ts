import { getPlatform } from '../platform';
import { DEFAULT_TREE_IDS } from '../tree/treeSpec';
import { useProjectStore } from '../store/projectStore';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { inspectModel } from '../three/inspectModel';
import { sampleTerrainLocalHeight, withTerrainDefaults } from '../terrain/terrain';
import type { AssetItem, GraphNodeCategory, TerrainComponent, Vector3Tuple } from '../types';

const TEMPLATE_URL = 'templates/UAL1.glb';
const TEMPLATE_NAME = 'UAL1.glb';

function categoryFor(label: string): GraphNodeCategory {
  if (['Start', 'Update', 'Trigger Enter', 'Collision Enter', 'Key Down'].includes(label)) return 'Events';
  if (['Branch', 'AND', 'OR', 'NOT', 'Do Once'].includes(label)) return 'Logic';
  if (['Get Variable', 'Set Variable', 'Get Object Var', 'Set Object Var'].includes(label)) return 'Variables';
  if (['Number', 'Boolean', 'String', 'Vector3'].includes(label)) return 'Values';
  return 'Runtime';
}

/**
 * "Cube Realm" — Cubelands-inspired action slice built entirely from Feather engine options:
 * day cycle, melee combo + hitstop + roll i-frames, lock-on, destructible crates, chase enemies,
 * and a pressure-plate → gate shrine puzzle. Everything is Inspector-tunable after creation.
 */
export async function createCubeRealmTemplate(): Promise<string | undefined> {
  const editor = useEditorStore.getState();

  let modelAsset = editor.assets.find((asset) => asset.name === TEMPLATE_NAME && asset.type === 'model');
  const alreadySplit = modelAsset && editor.skeletalMeshes.some((mesh) => mesh.sourceAssetId === modelAsset!.id);
  if (!modelAsset || !alreadySplit) {
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error('Bundled template model not found.');
    const blob = await response.blob();
    const file = new File([blob], TEMPLATE_NAME, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name: TEMPLATE_NAME, type: 'model', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    const inspection = await inspectModel(file);
    useEditorStore.getState().registerImportedModel({ assetId, assetName: TEMPLATE_NAME, inspection });
    modelAsset = useEditorStore.getState().assets.find((asset) => asset.id === assetId);
  }
  if (!modelAsset) return undefined;

  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;

  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  // Day cycle on — sun/sky animate in Play; scrub Time of Day in Scene Settings to preview.
  store.applyRenderPreset(sceneId, 'stylized-nature');
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#6eb6ff',
    skyHorizonColor: '#e8f4ff',
    skyGroundColor: '#88b070',
    environmentIntensity: 1.2,
    sunColor: '#ffe1a3',
    sunIntensity: 1.35,
    sunAzimuth: 40,
    sunElevation: 42,
    fogEnabled: true,
    atmosphericFog: true,
    fogFar: 280,
    wind: [2.4, 0, 1.2],
    windTurbulence: 0.4,
    dayCycleEnabled: true,
    dayCycleDuration: 360,
    dayCycleTime: 0.38,
  });
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 0.55,
    bloomThreshold: 0.72,
    bloomRadius: 0.55,
  });

  const foliage: Partial<TerrainComponent['foliage']> = {
    enabled: true,
    mode: 'mixed',
    density: 0.85,
    treeDensity: 0.12,
    grassSource: 'builtin',
    treeSource: 'builtin',
    grassMesh: 'blade',
    treeMesh: 'fir',
    treeSpecId: DEFAULT_TREE_IDS.pine,
    grassColor: '#46a03c',
    treeColor: '#3f9a4e',
    trunkColor: '#5b3f2b',
    minScale: 0.8,
    maxScale: 1.3,
    windStrength: 0.9,
    interactStrength: 1,
    flowerDensity: 0.18,
  };
  const terrainId = store.createObjectWithProps('terrain', {
    name: 'Realm Hills',
    position: [0, 0, 0],
    terrain: {
      size: 220,
      heightScale: 4.5,
      frequency: 0.035,
      octaves: 3,
      materialLayers: [
        { id: 'terrain-grass', name: 'Grass', color: '#5aa848' },
        { id: 'terrain-meadow', name: 'Meadow', color: '#71ba52' },
        { id: 'terrain-rock', name: 'Rock', color: '#9a9482' },
      ],
      foliage,
    } as Partial<TerrainComponent>,
    physics: { enabled: true, bodyType: 'fixed', collider: 'mesh' },
  });

  const terrainObject = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === terrainId);
  const terrainComp = terrainObject?.terrain ? withTerrainDefaults(terrainObject.terrain) : undefined;
  const groundAt = (x: number, z: number) => (terrainComp ? sampleTerrainLocalHeight(terrainComp, x, z) : 0);

  // --- PLAYER with Cubelands combat feel (all Inspector-editable). ---
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Hero');
  if (!pawnId) return undefined;
  store.updateTransform(pawnId, 'position', [0, groundAt(0, 0) + 0.25, 0]);
  store.setObjectVariable(pawnId, 'health', 100);
  store.setObjectVariable(pawnId, 'maxHealth', 100);
  store.updateCharacterController(pawnId, {
    cameraOffset: [0, 2.8, -6.5],
    cameraPitch: 0.14,
    meleeDamage: 28,
    meleeRange: 2.6,
    meleeComboCount: 3,
    meleeComboWindow: 0.4,
    meleeHitstop: 0.09,
    meleeHitstopScale: 0.05,
    rollIFrameStart: 0.08,
    rollIFrameEnd: 0.42,
    rollDuration: 0.55,
    rollSpeed: 8,
    lockOnEnabled: true,
    lockOnRange: 18,
    lockOnBreakDistance: 24,
  });

  // Destructible crates — smash with melee / impact.
  const crateSpots: Vector3Tuple[] = [
    [4, 0, 3],
    [5.2, 0, 3.4],
    [-3.5, 0, 5],
  ];
  for (const [x, , z] of crateSpots) {
    const y = groundAt(x, z) + 0.45;
    const crateId = store.createObjectWithProps('cube', {
      name: 'Crate',
      position: [x, y, z],
      color: '#c4a574',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 2 },
    });
    store.updateTransform(crateId, 'scale', [0.9, 0.9, 0.9]);
    store.setObjectVariable(crateId, 'health', 30);
    store.setObjectFracture(crateId, {
      enabled: true,
      pattern: 'shatter',
      pieces: 3,
      jitter: 0.45,
      strength: 5,
      impactThreshold: 6,
      focusImpact: true,
    });
  }

  // Chase enemies (built-in AI via enemy tag + health).
  const foeSpots: Array<{ name: string; pos: Vector3Tuple; hp: number; color: string }> = [
    { name: 'Grunt', pos: [8, 0, -6], hp: 50, color: '#c45c5c' },
    { name: 'Grunt', pos: [11, 0, -4], hp: 50, color: '#c45c5c' },
    { name: 'Warden', pos: [0, 0, -28], hp: 160, color: '#7b4fcf' },
  ];
  for (const foe of foeSpots) {
    const [x, , z] = foe.pos;
    const id = store.createObjectWithProps('capsule', {
      name: foe.name,
      position: [x, groundAt(x, z) + 1, z],
      color: foe.color,
      physics: { enabled: true, bodyType: 'kinematic', collider: 'capsule' },
    });
    store.updateTransform(id, 'scale', foe.name === 'Warden' ? [1.4, 1.4, 1.4] : [1, 1, 1]);
    store.setObjectVariable(id, 'enemy', true);
    store.setObjectVariable(id, 'health', foe.hp);
    store.setObjectVariable(id, 'maxHealth', foe.hp);
    store.setObjectVariable(id, 'chaseRange', foe.name === 'Warden' ? 16 : 11);
    store.setObjectVariable(id, 'enemySpeed', foe.name === 'Warden' ? 2.2 : 2.8);
    store.setObjectVariable(id, 'enemyDamage', foe.name === 'Warden' ? 18 : 10);
    store.setObjectVariable(id, 'attackRange', foe.name === 'Warden' ? 2.0 : 1.6);
  }

  // --- Shrine puzzle: stand on plate → gate lifts (visual scripting). ---
  const plateX = -10;
  const plateZ = -12;
  const gateX = -10;
  const gateZ = -18;
  const plateY = groundAt(plateX, plateZ);
  const gateY = groundAt(gateX, gateZ);

  const plateId = store.createObjectWithProps('cube', {
    name: 'Shrine Plate',
    position: [plateX, plateY + 0.08, plateZ],
    color: '#5adcff',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  store.updateTransform(plateId, 'scale', [2.2, 0.16, 2.2]);

  const gateId = store.createObjectWithProps('cube', {
    name: 'Shrine Gate',
    position: [gateX, gateY + 1.6, gateZ],
    color: '#8b7355',
    physics: { enabled: true, bodyType: 'kinematic', collider: 'box' },
  });
  store.updateTransform(gateId, 'scale', [4.5, 3.2, 0.45]);

  const { blueprintId: shrineBp } = store.createBlueprintNamed(
    'Shrine Gate',
    'Stand on the plate to lift the shrine gate.',
  );
  store.attachScript(plateId, shrineBp);
  const add = (label: string, data?: Record<string, unknown>, pos?: { x: number; y: number }) =>
    store.addGraphNodeToBlueprint(shrineBp, label, categoryFor(label), data, pos);
  const ex = (a: string, b: string) => store.connectGraphNodes(shrineBp, a, b, 'exec-out', 'exec-in');
  const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(shrineBp, a, b, 'value-out', handle);
  const onEnter = add('Trigger Enter', { otherObjectId: pawnId }, { x: 80, y: 80 });
  const gatePos = add(
    'Vector3',
    { vectorValue: [gateX, gateY + 5.2, gateZ] as Vector3Tuple },
    { x: 80, y: 280 },
  );
  const openGate = add('Set Position', { targetObjectId: gateId }, { x: 360, y: 80 });
  const shake = add('Camera Shake', { shakeAmount: 0.35 }, { x: 640, y: 80 });
  ex(onEnter, openGate);
  vl(gatePos, openGate, 'position');
  ex(openGate, shake);

  // Landmark ring around the shrine so the plate reads from a distance.
  const ring = store.createObjectWithProps('cube', {
    name: 'Shrine Ring',
    position: [plateX, plateY + 0.04, plateZ],
    color: '#2a6a7a',
  });
  store.updateTransform(ring, 'scale', [3.4, 0.08, 3.4]);

  return pawnId;
}
