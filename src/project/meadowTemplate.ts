import { getPlatform } from '../platform';
import { DEFAULT_TREE_IDS } from '../tree/treeSpec';
import { useProjectStore } from '../store/projectStore';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { inspectModel } from '../three/inspectModel';
import { sampleTerrainLocalHeight, withTerrainDefaults } from '../terrain/terrain';
import type { AssetItem, TerrainComponent, Vector3Tuple } from '../types';

/** The same bundled Quaternius rig the third-person template uses (public/templates). */
const TEMPLATE_URL = 'templates/UAL1.glb';
const TEMPLATE_NAME = 'UAL1.glb';

/**
 * "Meadows" — a playable slice that shows off the interactive vegetation stack end to end: a
 * third-person character you walk through a rolling meadow of dense grass + wildflowers that PART and
 * flatten around you (BOTW-style), scattered swaying trees, a gentle breeze, sky-dissolving atmospheric
 * fog, and the Stylized Nature render look.
 *
 * The hills are PROCEDURAL (noise fields), never seeded height/paint overrides — those freeze load for
 * minutes (see the terrain-override perf trap). Returns the player's id.
 */
export async function createMeadowTemplate(): Promise<string | undefined> {
  const editor = useEditorStore.getState();

  // Reuse the rig if it's already imported + split; otherwise fetch + import + rig it once.
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

  // Clear the starter-scene defaults so the meadow starts clean.
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  // --- ENVIRONMENT: the bright, high-key, pale-cool stylized-outdoors look from the reference — a near-
  //     white blown sun high in a pale cyan sky, airy fill, and sky-sampled haze so the distant hills melt
  //     into the sky. Apply the lush render preset first, then push it toward the reference. ---
  store.applyRenderPreset(sceneId, 'stylized-nature');
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#7ec2ff',      // bright cyan zenith
    skyHorizonColor: '#ecf7ff',  // pale, near-white hazy horizon (blown, atmospheric)
    skyGroundColor: '#a6d488',   // soft green ground bounce
    environmentIntensity: 1.35,  // airy ambient fill
    sunColor: '#fffaf0',         // near-white sun
    sunIntensity: 1.75,          // bright, near-blown highlight
    sunAzimuth: 40,
    sunElevation: 52,            // high bright day
    fogEnabled: true,
    atmosphericFog: true,
    fogFar: 380,                // distant hills dissolve into the pale sky (clear enough to read bright)
    toneMappingExposure: 1.16,  // lift the whole image for the high-key read
    wind: [3, 0, 1.6],
    windTurbulence: 0.5,
  });
  // A brighter blooming sun + a clean high-key grade (slightly cool, gently saturated — not warm).
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 0.72,
    bloomThreshold: 0.66,
    bloomRadius: 0.72,
    colorGrade: { grade: 'custom', gradeIntensity: 1, exposure: 0.05, contrast: 0.05, saturation: 0.12, temperature: -0.015 },
  });

  // --- TERRAIN: a big rolling meadow with PROCEDURAL gentle hills, carpeted in tall dense interactive
  //     grass + wildflowers + scattered STYLIZED CONIFER (fir) trees — the hero of the reference look. ---
  const foliage: Partial<TerrainComponent['foliage']> = {
    enabled: true,
    mode: 'mixed',
    density: 1,
    treeDensity: 0.18,
    grassSource: 'builtin',
    treeSource: 'builtin',
    grassMesh: 'blade',
    treeMesh: 'fir',
    // Scatter the project's Pine ASSET rather than the simple stacked-cone crown: same one-click meadow,
    // but every tree is a real parametric tree the Tree Builder can restyle (and an axe can fell).
    treeSpecId: DEFAULT_TREE_IDS.pine,
    grassColor: '#46a03c',
    treeColor: '#3f9a4e',
    trunkColor: '#5b3f2b',
    minScale: 0.85,
    maxScale: 1.4,
    windStrength: 1,
    interactStrength: 1,
    flowerDensity: 0.28,
  };
  const terrainId = store.createObjectWithProps('terrain', {
    name: 'Meadow',
    position: [0, 0, 0],
    terrain: {
      size: 600,
      heightScale: 7,
      frequency: 0.03,
      octaves: 4,
      // Fresh bright-green ground — the blades borrow these colors, so the whole surface (turf + grass)
      // reads as one lush field rather than dark grass on dark dirt.
      materialLayers: [
        { id: 'terrain-grass', name: 'Grass', color: '#5aa848' },
        { id: 'terrain-meadow', name: 'Meadow', color: '#71ba52' },
        { id: 'terrain-rock', name: 'Rock', color: '#9a9482' },
      ],
      foliage,
    } as Partial<TerrainComponent>,
    physics: { enabled: true, bodyType: 'fixed', collider: 'mesh' },
  });

  // Sample the terrain surface so props + the player sit ON the hills instead of falling from the sky.
  const terrainObject = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === terrainId);
  const terrainComp = terrainObject?.terrain ? withTerrainDefaults(terrainObject.terrain) : undefined;
  const groundAt = (x: number, z: number) => (terrainComp ? sampleTerrainLocalHeight(terrainComp, x, z) : 0);

  // A handful of mossy BOULDERS for BOTW-style verticality and landmarks to walk between.
  const boulderSpots: Array<{ pos: Vector3Tuple; scale: Vector3Tuple }> = [
    { pos: [15, 0, -11], scale: [2.0, 1.4, 1.7] },
    { pos: [-19, 0, 9], scale: [2.6, 1.8, 2.2] },
    { pos: [7, 0, 23], scale: [1.6, 1.1, 1.5] },
    { pos: [-10, 0, -22], scale: [2.2, 1.5, 1.9] },
  ];
  for (const { pos, scale } of boulderSpots) {
    const boulderId = store.createObjectWithProps('sphere', {
      name: 'Boulder',
      position: [pos[0], groundAt(pos[0], pos[2]) + scale[1] * 0.35, pos[2]],
      color: '#8d877a',
      physics: { enabled: true, bodyType: 'fixed', collider: 'sphere' },
    });
    store.updateTransform(boulderId, 'scale', scale);
  }

  // A few LOOSE dynamic boulders the player can shove around — they rest ON the grass (flattening it) and
  // part a trail as they roll, showing that PHYSICS bodies interact with the foliage, not just the player.
  const looseSpots: Vector3Tuple[] = [[3, 0, 6], [-4, 0, 7.5], [1, 0, 10]];
  for (const [lx, , lz] of looseSpots) {
    const looseId = store.createObjectWithProps('sphere', {
      name: 'Loose Boulder',
      position: [lx, groundAt(lx, lz) + 0.8, lz],
      color: '#b7a98f',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 5 },
    });
    store.updateTransform(looseId, 'scale', [1.2, 1.2, 1.2]);
  }

  // --- PLAYER: the bundled rig with locomotion + a behind-the-character camera, dropped onto the hill. ---
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Player');
  if (!pawnId) return undefined;
  store.updateTransform(pawnId, 'position', [0, groundAt(0, 0) + 0.2, 0]);
  // Frame the vista: a slightly higher, pulled-back camera looking near-level across the meadow (so the
  // firs, sky and dissolving hills read) rather than the default steeper down-tilt into the grass.
  store.updateCharacterController(pawnId, { cameraOffset: [0, 3.0, -7], cameraPitch: 0.12 });

  return pawnId;
}
