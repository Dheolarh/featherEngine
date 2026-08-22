import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { ModelPart, ModelSpec, ModelStyle, SceneObject } from '../types';
import { useEditorStore } from '../store/editorStore';
import { getPartMaterials, getPartRenderGeometry } from '../model/modelGeometry';

/**
 * Renders one prototype model (Model Forge): a group of flat-shaded primitive parts.
 *
 * The spec is resolved from the project's model library LIVE — every placed instance subscribes to
 * its own library entry, so an edit in the Model Forge restyles the whole scene at once (the tree
 * system's "one asset, many instances" promise, without the inline-copy indirection). The inline
 * `model.spec` only exists as the keep-alive copy stamped in when the library entry was deleted.
 *
 * Geometry is shared per shape and materials shared per palette color (src/model/modelGeometry.ts),
 * so a street of kit-bashed props costs five geometries and a handful of materials. Parts raycast
 * normally — clicks bubble to SceneObjectView's group handler, which is what makes placed props
 * click-selectable in the editor for free.
 */

export interface ModelPartMeshProps {
  part: ModelPart;
  palette: readonly string[];
  /** The owning spec's finish (smooth/flat + bevel). Absent = the crisp flat look. */
  style?: ModelStyle;
  /** Render at identity transform (a gizmo group carries the real transform) while geometry and
   *  materials still derive from the part's TRUE dimensions (bevel radius, deformation). */
  neutralTransform?: boolean;
  /** Forge-preview hooks (paint/select/hover); scene rendering leaves them undefined. */
  onPartPointerDown?: (part: ModelPart, event: ThreeEvent<PointerEvent>) => void;
  onPartPointerOver?: (part: ModelPart, event: ThreeEvent<PointerEvent>) => void;
  onPartPointerOut?: (part: ModelPart) => void;
}

const ZERO: [number, number, number] = [0, 0, 0];
const ONE: [number, number, number] = [1, 1, 1];

export function ModelPartMesh({ part, palette, style, neutralTransform, onPartPointerDown, onPartPointerOver, onPartPointerOut }: ModelPartMeshProps) {
  // Cached per (shape | dims+bevel); beveled boxes bake true-radius rounding back into unit space,
  // so mesh scale stays part.scale for every shape.
  const geometry = getPartRenderGeometry(part, style);
  const materials = useMemo(() => getPartMaterials(part, palette, style), [part, palette, style]);
  return (
    <mesh
      geometry={geometry}
      material={materials}
      position={neutralTransform ? ZERO : part.position}
      rotation={neutralTransform ? ZERO : part.rotation}
      scale={neutralTransform ? ONE : part.scale}
      castShadow
      receiveShadow
      onPointerDown={onPartPointerDown ? (event) => onPartPointerDown(part, event) : undefined}
      onPointerOver={onPartPointerOver ? (event) => onPartPointerOver(part, event) : undefined}
      onPointerOut={onPartPointerOut ? () => onPartPointerOut(part) : undefined}
    />
  );
}

export function resolveModelSpec(object: SceneObject, librarySpec: ModelSpec | undefined): ModelSpec | null {
  if (!object.model?.enabled) return null;
  return librarySpec ?? object.model.spec ?? null;
}

export function ModelMesh({ object }: { object: SceneObject }) {
  const specId = object.model?.specId;
  const librarySpec = useEditorStore((state) =>
    specId ? state.modelSpecs.find((entry) => entry.id === specId) : undefined,
  );
  const spec = resolveModelSpec(object, librarySpec);
  if (!spec) return null;
  return (
    <group>
      {spec.parts.map((part) => (
        <ModelPartMesh key={part.id} part={part} palette={spec.palette} style={spec.style} />
      ))}
    </group>
  );
}
