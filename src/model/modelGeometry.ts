import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import type { ModelPart, ModelPartShape, ModelSpec, ModelStyle } from '../types';

/**
 * Geometry + material layer for prototype models.
 *
 * Every part renders a SHARED unit geometry scaled by the part's transform, so a scene full of
 * kit-bashed props costs five geometries total. Materials are flat-shaded MeshStandardMaterials
 * shared per palette color — the "flat stylized" look is per-face normals + solid colors, no maps.
 */

/**
 * A right-triangle prism ramp in the unit cube: bottom at y=-0.5, vertical back wall at z=-0.5,
 * slope from the front-bottom edge up to the back-top edge. Non-indexed with per-face normals so it
 * shades faceted like the rest of the kit. Material groups: 0 slope, 1 bottom, 2 back, 3 left, 4 right.
 */
function buildWedgeGeometry(): THREE.BufferGeometry {
  const h = 0.5;
  // Corner shorthand: F/B front/back (+z/-z), L/R left/right (-x/+x), D/U down/up (-y/+y).
  const FLD = [-h, -h, h], FRD = [h, -h, h], BLD = [-h, -h, -h], BRD = [h, -h, -h];
  const BLU = [-h, h, -h], BRU = [h, h, -h];
  const slopeNormal = new THREE.Vector3(0, 1, 1).normalize();
  const faces: Array<{ tris: number[][][]; normal: [number, number, number] }> = [
    { tris: [[FLD, FRD, BRU], [FLD, BRU, BLU]], normal: [0, slopeNormal.y, slopeNormal.z] }, // 0 slope
    { tris: [[FLD, BLD, BRD], [FLD, BRD, FRD]], normal: [0, -1, 0] }, // 1 bottom
    { tris: [[BRD, BLD, BLU], [BRD, BLU, BRU]], normal: [0, 0, -1] }, // 2 back
    { tris: [[FLD, BLU, BLD]], normal: [-1, 0, 0] }, // 3 left
    { tris: [[FRD, BRD, BRU]], normal: [1, 0, 0] }, // 4 right
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const geometry = new THREE.BufferGeometry();
  let cursor = 0;
  faces.forEach((face, materialIndex) => {
    const start = cursor;
    for (const tri of face.tris) {
      for (const [x, y, z] of tri) {
        positions.push(x, y, z);
        normals.push(...face.normal);
        // Planar-ish projection; prototype parts are solid colors, so uv only needs to exist.
        uvs.push(x + h, (y + z) * 0.5 + h);
        cursor += 1;
      }
    }
    geometry.addGroup(start, cursor - start, materialIndex);
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

const unitGeometries = new Map<ModelPartShape, THREE.BufferGeometry>();

/** Shared unit geometry for a shape. Never dispose these — every model part in the app uses them. */
export function getModelPartGeometry(shape: ModelPartShape): THREE.BufferGeometry {
  let geometry = unitGeometries.get(shape);
  if (!geometry) {
    switch (shape) {
      case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20); break;
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 24, 16); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 20); break;
      case 'wedge': geometry = buildWedgeGeometry(); break;
      default: geometry = new THREE.BoxGeometry(1, 1, 1);
    }
    unitGeometries.set(shape, geometry);
  }
  return geometry;
}

const quantize = (value: number, step: number): number => Math.round(value / step) * step;

// Rounded boxes are built per (dims, radius) so the corner radius is TRUE under non-uniform part
// scale, then normalized back to unit space so the mesh keeps using part.scale like every other
// shape (which is what keeps the scale gizmo and the GLB bake contract unchanged). Quantized keys
// keep the cache bounded; entries are shared by every instance with the same dimensions.
const roundedBoxCache = new Map<string, THREE.BufferGeometry>();

function getRoundedUnitBox(scale: readonly number[], bevel: number): THREE.BufferGeometry {
  const w = Math.max(0.02, quantize(Math.abs(scale[0]), 0.01));
  const h = Math.max(0.02, quantize(Math.abs(scale[1]), 0.01));
  const d = Math.max(0.02, quantize(Math.abs(scale[2]), 0.01));
  const radius = Math.min(quantize(bevel, 0.005), Math.min(w, h, d) / 2 - 1e-3);
  if (radius <= 0) return getModelPartGeometry('box');
  const key = `${w}|${h}|${d}|${radius}`;
  let geometry = roundedBoxCache.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, 3, radius);
    // Bake the inverse dimensions into positions (unit space) and forward dimensions into normals:
    // the render-time normal matrix of the part's scale then restores the true world normals.
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const normals = geometry.attributes.normal as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      positions.setXYZ(i, positions.getX(i) / w, positions.getY(i) / h, positions.getZ(i) / d);
      n.set(normals.getX(i) * w, normals.getY(i) * h, normals.getZ(i) * d).normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
    }
    roundedBoxCache.set(key, geometry);
  }
  return geometry;
}

/** The geometry a part actually renders with under a style. Always pairs with mesh scale = part.scale. */
export function getPartRenderGeometry(part: ModelPart, style?: ModelStyle): THREE.BufferGeometry {
  if (part.shape === 'box' && style?.finish === 'smooth' && style.bevel > 0.0025) {
    return getRoundedUnitBox(part.scale, style.bevel);
  }
  return getModelPartGeometry(part.shape);
}

/** Which material group a raycast triangle belongs to — this is what face painting clicks resolve.
 *  Works for indexed and non-indexed geometry: group start/count are in index/vertex elements and
 *  triangles are sequential either way. */
export function faceGroupForFaceIndex(geometry: THREE.BufferGeometry, faceIndex: number): number {
  const groups = geometry.groups;
  if (!groups.length) return 0;
  const element = faceIndex * 3;
  for (const group of groups) {
    if (element >= group.start && element < group.start + group.count) return group.materialIndex ?? 0;
  }
  return 0;
}

const unitEdges = new Map<ModelPartShape, THREE.EdgesGeometry>();

/**
 * Shared unit edge geometry per shape — the hover/selection outlines in the Model Forge preview.
 * 20° threshold keeps boxes/wedges/cylinder rims crisp; a smooth sphere yields (correctly) almost
 * nothing, so spheres signal hover via the cursor instead.
 */
export function getModelPartEdges(shape: ModelPartShape): THREE.EdgesGeometry {
  let edges = unitEdges.get(shape);
  if (!edges) {
    edges = new THREE.EdgesGeometry(getModelPartGeometry(shape), 20);
    unitEdges.set(shape, edges);
  }
  return edges;
}

// Palette materials are shared per (color, finish, roughness) across every part and never disposed:
// the cache is bounded by the colors users actually paint with, so the whole prop system stays at a
// handful of materials regardless of scene size.
const paletteMaterials = new Map<string, THREE.Material>();

export function getStyledMaterial(color: string, style?: ModelStyle): THREE.Material {
  const finish = style?.finish ?? 'flat';
  const roughness = quantize(style?.roughness ?? (finish === 'smooth' ? 0.55 : 0.85), 0.05);
  const key = `${color}|${finish}|${roughness}`;
  let material = paletteMaterials.get(key);
  if (!material) {
    material =
      finish === 'smooth'
        ? // The Spline soft-plastic read: smooth shading plus a faint clearcoat over the flat color.
          new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.6 })
        : new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
    paletteMaterials.set(key, material);
  }
  return material;
}

const FALLBACK_COLOR = '#888888';

const slotColor = (palette: readonly string[], slot: number | undefined, fallback: number): string =>
  palette[slot ?? fallback] ?? palette[fallback] ?? FALLBACK_COLOR;

/**
 * The material (or per-group material array) for one part. Geometries with groups get one material
 * per `materialIndex`; holes in the index range (a cone has no top cap, index 1) are padded with the
 * part's base material so three.js never sees an undefined slot.
 */
export function getPartMaterials(part: ModelPart, palette: readonly string[], style?: ModelStyle): THREE.Material | THREE.Material[] {
  const base = getStyledMaterial(slotColor(palette, part.colorSlot, 0), style);
  const groups = getPartRenderGeometry(part, style).groups;
  if (!groups.length) return base;
  const materials: THREE.Material[] = [];
  const maxIndex = Math.max(...groups.map((group) => group.materialIndex ?? 0));
  for (let index = 0; index <= maxIndex; index += 1) materials.push(base);
  for (const group of groups) {
    const slot = part.faceColors?.[group.materialIndex ?? 0];
    if (slot !== undefined) materials[group.materialIndex ?? 0] = getStyledMaterial(slotColor(palette, slot, part.colorSlot), style);
  }
  return materials;
}

/**
 * Build a plain THREE.Group of the whole model — the imperative path used by GLB baking and
 * thumbnails. Fresh materials ARE shared (palette cache), geometries are the shared units; callers
 * must not dispose either.
 */
export function buildModelGroup(spec: ModelSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = spec.name;
  for (const part of spec.parts) {
    const mesh = new THREE.Mesh(getPartRenderGeometry(part, spec.style), getPartMaterials(part, spec.palette, spec.style));
    mesh.name = part.name;
    mesh.position.fromArray(part.position);
    mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    mesh.scale.fromArray(part.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** World-space bounds of a spec — used to frame previews and drop the model on the ground. */
export function modelSpecBounds(spec: ModelSpec): THREE.Box3 {
  const group = buildModelGroup(spec);
  return new THREE.Box3().setFromObject(group);
}
