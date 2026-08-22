import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { MaterialDefinition, SceneObjectKind, Vector3Tuple } from '../types';

type StudioPrimitive = Extract<SceneObjectKind, 'cube' | 'sphere' | 'capsule'>;

interface StudioPart {
  kind: StudioPrimitive;
  name: string;
  position: Vector3Tuple;
  scale: Vector3Tuple;
  materialId: string;
  rotation?: Vector3Tuple;
  parentId?: string;
}

/**
 * A model-free, editable showcase for the Spline-inspired render identity.
 *
 * It intentionally uses only built-in primitives and project materials: it opens instantly, ships with
 * no external assets, and every bevel, coating, light, color, and motion curve remains inspectable.
 */
export async function createSplineStudioTemplate(): Promise<string> {
  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;

  // Template exports start from a blank project, while the unsaved welcome state still has stable sample
  // ids. Clearing only those ids keeps this builder safe to run in either context without touching work
  // the user has already authored.
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  store.renameScene(sceneId, 'Spline Studio');
  store.applyRenderPreset(sceneId, 'spline-studio');
  store.updateRenderSettings({ quality: 'High', autoQuality: true });

  const materialsFolder = store.createFolder('Spline Studio Materials');
  const logicFolder = store.createFolder('Spline Studio Motion');

  const material = (
    name: string,
    description: string,
    patch: Partial<MaterialDefinition>,
  ): string => {
    const id = store.createMaterial(name, description, materialsFolder);
    store.updateMaterial(id, {
      color: '#ffffff',
      metalness: 0,
      roughness: 0.34,
      emissiveColor: '#000000',
      emissiveIntensity: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.22,
      sheen: 0.18,
      sheenColor: '#ffffff',
      transmission: 0,
      iridescence: 0,
      ...patch,
    });
    return id;
  };

  const graphite = material('Graphite Stage', 'Deep neutral stage with a restrained satin coat.', {
    color: '#17151F',
    roughness: 0.42,
    clearcoat: 0.28,
    clearcoatRoughness: 0.3,
    sheen: 0.08,
    sheenColor: '#6F62A8',
  });
  const midnight = material('Midnight Backdrop', 'Soft dark backdrop that keeps saturated forms readable.', {
    color: '#0E0D15',
    roughness: 0.58,
    clearcoat: 0.16,
    clearcoatRoughness: 0.38,
    sheen: 0.12,
    sheenColor: '#51447B',
  });
  const violet = material('Violet Candy', 'Clear-coated violet plastic with a cool fabric-soft sheen.', {
    color: '#9B7BFF',
    roughness: 0.22,
    clearcoat: 0.72,
    clearcoatRoughness: 0.16,
    sheen: 0.32,
    sheenColor: '#E8E2FF',
  });
  const coral = material('Coral Candy', 'Warm candy plastic for playful high-contrast accents.', {
    color: '#FF6FAE',
    roughness: 0.24,
    clearcoat: 0.66,
    clearcoatRoughness: 0.18,
    sheen: 0.28,
    sheenColor: '#FFE0EE',
  });
  const aqua = material('Aqua Candy', 'Cool aqua plastic for rim-lit secondary forms.', {
    color: '#59E1DF',
    roughness: 0.2,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
    sheen: 0.26,
    sheenColor: '#D8FFFF',
  });
  const pearl = material('Pearl White', 'Bright coated pearl with a subtle color-shifting highlight.', {
    color: '#F5F1FF',
    metalness: 0.04,
    roughness: 0.18,
    clearcoat: 0.86,
    clearcoatRoughness: 0.12,
    sheen: 0.38,
    sheenColor: '#DCD5FF',
    iridescence: 0.14,
  });

  const addPart = ({ kind, name, position, scale, rotation = [0, 0, 0], materialId, parentId }: StudioPart) => {
    const id = store.createObjectWithProps(kind, { name, position, parentId });
    store.updateTransform(id, 'rotation', rotation);
    store.updateTransform(id, 'scale', scale);
    store.setObjectMaterial(id, materialId);
    return id;
  };

  // A layered dark plinth gives contact shadows a deliberate home and reads like a product-design stage.
  addPart({ kind: 'cube', name: 'Studio Floor', position: [0, -0.35, 0], scale: [13, 0.55, 9.5], materialId: midnight });
  addPart({ kind: 'cube', name: 'Lower Plinth', position: [0, 0.02, 0], scale: [8.2, 0.34, 5.9], materialId: graphite });
  addPart({ kind: 'cube', name: 'Upper Plinth', position: [0, 0.32, 0], scale: [6.7, 0.28, 4.55], materialId: graphite });

  // A shallow arch frames the central cluster while keeping the scene primitive-only and editable.
  addPart({ kind: 'capsule', name: 'Arch Left', position: [-3.55, 2.5, -1.9], scale: [0.52, 3.8, 0.52], materialId: pearl });
  addPart({ kind: 'capsule', name: 'Arch Right', position: [3.55, 2.5, -1.9], scale: [0.52, 3.8, 0.52], materialId: pearl });
  addPart({ kind: 'cube', name: 'Arch Crown', position: [0, 4.48, -1.9], scale: [7.25, 0.46, 0.52], materialId: pearl });

  // One animated parent keeps the composition coherent: children orbit gently as a single kinetic toy.
  const sculptureId = store.createObjectWithProps('empty', {
    name: 'Kinetic Sculpture',
    position: [0, 0.72, 0.1],
  });
  addPart({ kind: 'sphere', name: 'Violet Hero Orb', position: [-1.35, 1.15, 0.35], scale: [2.35, 2.35, 2.35], materialId: violet, parentId: sculptureId });
  addPart({ kind: 'cube', name: 'Coral Soft Cube', position: [0.82, 1.0, 0.15], scale: [1.85, 1.85, 1.85], rotation: [0.22, -0.42, 0.16], materialId: coral, parentId: sculptureId });
  addPart({ kind: 'capsule', name: 'Aqua Capsule', position: [2.05, 1.36, -0.72], scale: [0.92, 1.72, 0.92], rotation: [0.46, 0.16, -0.54], materialId: aqua, parentId: sculptureId });
  addPart({ kind: 'sphere', name: 'Pearl Satellite', position: [2.32, 2.72, -0.18], scale: [0.72, 0.72, 0.72], materialId: pearl, parentId: sculptureId });
  addPart({ kind: 'sphere', name: 'Coral Satellite', position: [-2.62, 2.62, -0.55], scale: [0.48, 0.48, 0.48], materialId: coral, parentId: sculptureId });
  addPart({ kind: 'cube', name: 'Aqua Tile', position: [-0.08, 2.82, -1.18], scale: [0.72, 0.72, 0.22], rotation: [0.14, 0.42, -0.2], materialId: aqua, parentId: sculptureId });

  // Small foreground forms make the depth and soft shadow falloff legible at a glance.
  addPart({ kind: 'sphere', name: 'Violet Pebble', position: [-3.05, 0.65, 1.15], scale: [0.78, 0.78, 0.78], materialId: violet });
  addPart({ kind: 'capsule', name: 'Coral Pebble', position: [3.05, 0.72, 1.25], scale: [0.52, 0.72, 0.52], rotation: [0.2, 0, 0.35], materialId: coral });

  const violetLight = store.createObjectWithProps('light', { name: 'Violet Fill', position: [-4.8, 3.7, 3.5] });
  store.setObjectLight(violetLight, { type: 'point', color: '#8F7CFF', intensity: 18, distance: 13, castShadow: false });
  const aquaLight = store.createObjectWithProps('light', { name: 'Aqua Rim', position: [4.5, 3.2, -3.2] });
  store.setObjectLight(aquaLight, { type: 'point', color: '#72F3F0', intensity: 12, distance: 11, castShadow: false });

  // The authored camera makes Play mode a ready-framed interactive orbit/product shot.
  const cameraId = store.createObjectWithProps('camera', { name: 'Studio Camera', position: [8, 5.6, 10] });
  store.updateTransform(cameraId, 'rotation', [-0.3805063771, 0.6388651442, 0.2341393616]);

  const { blueprintId } = store.createBlueprintNamed(
    'Kinetic Sculpture',
    'Slow rotation plus a looping, ping-pong float — an editable Spline-style motion study.',
    logicFolder,
  );
  const compiled = store.applyBlueprintFeatherSource(
    blueprintId,
    [
      'blueprint Kinetic_Sculpture',
      '',
      'var spin_speed: number = 12',
      '',
      'on start:',
      '    timeline_control("studio-float", command: "play")',
      '',
      'on update(dt):',
      '    self.rotate(axis: "y", amount: self.spin_speed)',
      '',
      'detached:',
      '    timeline(self, id: "studio-float", name: "Studio Float", property: "position", to: vec3(0, 0.42, 0), duration: 2.8, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );
  if (!compiled.ok) {
    throw new Error(`Could not compile the Spline Studio motion blueprint: ${compiled.diagnostics.map((item) => item.message).join('; ')}`);
  }
  store.attachScript(sculptureId, blueprintId);
  store.selectObject(sculptureId);
  return sculptureId;
}
