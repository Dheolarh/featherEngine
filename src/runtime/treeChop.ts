import * as THREE from 'three';
import type { SceneObject, TreeChopState, TreeSpec, Vector3Tuple } from '../types';
import { generateTree } from '../tree/generateTree';
import { normalizeTreeSpec } from '../tree/treeSpec';
import { registerRawGeometry } from './meshGeometryCache';
import { defaultPhysics } from '../store/editor/defaults';

/**
 * Zelda-style tree felling.
 *
 * Chopping a tree does NOT cut geometry. Every vertex already carries `aTrunkT` — the trunk height its
 * limb is rooted at — so severing at height h is a pure partition: everything below h stays as the stump,
 * everything above falls as a log. Because a branch inherits its trunk attach height, a whole limb travels
 * with the log instead of being sliced through the middle, and the split costs one number.
 *
 * Progress lives HERE rather than in the editor store on purpose: a tree takes several hits, and routing
 * each one through the store would re-render every panel subscribed to the scene. Play/Stop wipes it, and
 * the store's own Play snapshot restores the objects, so a felled forest is whole again on Stop.
 */

const chopStates = new Map<string, TreeChopState>();
let version = 0;

/** Bumped on every chop so renderers can cheaply notice without subscribing to the store. */
export function treeChopVersion(): number {
  return version;
}

export function getTreeChopState(objectId: string): TreeChopState | undefined {
  return chopStates.get(objectId);
}

/** Stop clears felling progress — otherwise a tree chopped last session starts the next one already down. */
export function clearTreeChops(): void {
  chopStates.clear();
  version += 1;
}

export interface ChopResult {
  /** True when this hit severed the trunk (as opposed to just landing a hit). */
  severed: boolean;
  /** Index into spec.chop.breakPoints. */
  breakPointIndex: number;
  hitsLeft: number;
  /** World-space height the cut happened at, for VFX. */
  cutWorldY: number;
  /**
   * The felled pieces, ready to append to the tick's `spawned` list. Only set when `severed`.
   * Index 0 is the bark body (the physics body); a canopy piece, if any, follows parented to it.
   */
  logs?: SceneObject[];
}

/**
 * Resolve which break point a hit at `worldPoint` belongs to.
 *
 * Picks the nearest INTACT break point within tolerance. Nearest-not-lowest matters: bucking a felled
 * trunk means hitting the upper cut specifically, and snapping to the lowest would make that impossible.
 */
function resolveBreakPoint(spec: TreeSpec, tree: SceneObject, worldPoint: Vector3Tuple, state: TreeChopState): number {
  const baseY = tree.transform.position[1];
  const scaleY = tree.transform.scale[1] || 1;
  const trunkWorldHeight = spec.trunk.height * scaleY;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < spec.chop.breakPoints.length; i += 1) {
    if (state.severedAt !== undefined && i >= state.severedAt) continue; // already gone with the log
    const pointY = baseY + spec.chop.breakPoints[i].height * trunkWorldHeight;
    const dist = Math.abs(worldPoint[1] - pointY);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return bestDist <= spec.chop.tolerance * scaleY ? best : -1;
}

/**
 * Land one axe hit on a tree. Returns null when the hit misses every break point (or the tree is not
 * choppable), so the caller can fall back to a generic "thunk" response.
 */
export function chopTree(tree: SceneObject, worldPoint: Vector3Tuple, hitDirection: Vector3Tuple): ChopResult | null {
  const component = tree.tree;
  if (!component?.enabled || component.choppable === false) return null;
  const spec = normalizeTreeSpec(component.spec);
  if (!spec.chop.enabled || spec.chop.breakPoints.length === 0) return null;

  const state = chopStates.get(tree.id) ?? { hitsLeft: {} };
  const index = resolveBreakPoint(spec, tree, worldPoint, state);
  if (index < 0) return null;

  const breakPoint = spec.chop.breakPoints[index];
  const remaining = (state.hitsLeft[index] ?? breakPoint.hits) - 1;
  state.hitsLeft = { ...state.hitsLeft, [index]: Math.max(0, remaining) };

  const scaleY = tree.transform.scale[1] || 1;
  const cutWorldY = tree.transform.position[1] + breakPoint.height * spec.trunk.height * scaleY;

  if (remaining > 0) {
    chopStates.set(tree.id, state);
    version += 1;
    return { severed: false, breakPointIndex: index, hitsLeft: remaining, cutWorldY };
  }

  state.severedAt = index;
  chopStates.set(tree.id, state);
  version += 1;
  return {
    severed: true,
    breakPointIndex: index,
    hitsLeft: 0,
    cutWorldY,
    logs: makeFelledLog(tree, spec, index, hitDirection),
  };
}

/**
 * Build the falling half as a real dynamic SceneObject.
 *
 * The geometry is baked once into the raw-geometry cache, which the renderer reads through
 * `renderer.fragmentKey` and the physics layer reads through `renderer.modelAssetId` to build a convex
 * hull — so the log you see and the log you collide with are literally the same vertices.
 */
function makeFelledLog(
  tree: SceneObject,
  spec: TreeSpec,
  breakIndex: number,
  hitDirection: Vector3Tuple,
): SceneObject[] {
  const cutHeight = spec.chop.breakPoints[breakIndex].height;
  const generated = generateTree(spec, tree.tree?.seed ?? 1);
  // Bark and canopy are sliced SEPARATELY and spawned as two objects. The raw-geometry cache stores only
  // positions and indices (it exists for fracture shards), so a single merged log would have to pick one
  // flat colour for the whole thing — and a felled tree with brown leaves is the first thing you notice.
  // The canopy rides along as a physics-less child of the bark body.
  const barkSlice = sliceAboveTrunkT(generated.bark, null, cutHeight);
  const foliageSlice = generated.foliage ? sliceAboveTrunkT(generated.foliage, null, cutHeight) : null;

  const key = `treelog_${tree.id}_${breakIndex}_${version}`;
  registerRawGeometry(key, barkSlice.vertices, barkSlice.indices);

  // Topple AWAY from the swing, with a shove proportional to how much tree is above the cut — felling a
  // tall pine at the base should go over hard, snapping a sapling should barely move.
  const above = Math.max(0.15, 1 - cutHeight);
  const push = spec.chop.topplePush * above;
  const dir = new THREE.Vector3(hitDirection[0], 0, hitDirection[2]);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize();

  const logId = `${tree.id}__log_${breakIndex}`;
  const bark: SceneObject = {
    id: logId,
    name: `${tree.name} Log`,
    kind: 'empty',
    parentId: undefined,
    transform: {
      // The sliced geometry is authored in the tree's local space, so the log spawns on the tree's origin
      // and its own vertices place it at the cut — no offset maths to get subtly wrong.
      position: [...tree.transform.position] as Vector3Tuple,
      rotation: [...tree.transform.rotation] as Vector3Tuple,
      scale: [...tree.transform.scale] as Vector3Tuple,
    },
    renderer: {
      enabled: true,
      mesh: 'cube',
      color: spec.look.barkRamp[0] ?? '#6b4a2f',
      metalness: 0,
      roughness: 0.9,
      modelAssetId: key,
      fragmentKey: key,
    },
    physics: {
      ...defaultPhysics('dynamic', 'convex'),
      enabled: true,
      mass: Math.max(1, spec.trunk.baseRadius * spec.trunk.height * 12),
      friction: 0.9,
      restitution: 0.05,
      linearDamping: 0.15,
      angularDamping: 0.35,
    },
    // Picked up the frame the body first exists (editorStore drains __impulse into physicsImpulses).
    variables: {
      __impulse: [dir.x * push, push * 0.25, dir.z * push] as Vector3Tuple,
      // Keeps the felled piece self-describing, so bucking it later can find its parent tree.
      __cutFromTree: tree.id,
    },
  };

  const out: SceneObject[] = [bark];
  if (foliageSlice && foliageSlice.indices.length > 0) {
    const leafKey = `${key}_leaf`;
    registerRawGeometry(leafKey, foliageSlice.vertices, foliageSlice.indices);
    out.push({
      id: `${logId}__canopy`,
      name: `${tree.name} Canopy`,
      kind: 'empty',
      // Parented to the bark body, with an identity local transform: the canopy was sliced in the same
      // local space, so it stays welded to the trunk as the log tumbles, with no second body to sync.
      parentId: logId,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: {
        enabled: true,
        mesh: 'cube',
        color: spec.look.foliageRamp[spec.look.foliageRamp.length - 1] ?? '#4f8544',
        metalness: 0,
        roughness: 0.95,
        modelAssetId: leafKey,
        fragmentKey: leafKey,
      },
    });
  }
  return out;
}

/**
 * Extract everything above `cutHeight` from the generated geometry into one flat vertex/index pair.
 *
 * Triangles are kept whole — a triangle counts as "above" when its centroid's aTrunkT is above the cut.
 * Splitting triangles exactly on the plane would leave a cleaner cut face, but a stylized tree hides the
 * seam behind its own bark silhouette and this keeps the operation allocation-cheap.
 */
function sliceAboveTrunkT(
  bark: THREE.BufferGeometry,
  foliage: THREE.BufferGeometry | null,
  cutHeight: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const geo of [bark, foliage]) {
    if (!geo) continue;
    const pos = geo.getAttribute('position');
    const trunkT = geo.getAttribute('aTrunkT');
    const idx = geo.getIndex();
    if (!pos || !trunkT || !idx) continue;
    const remap = new Map<number, number>();
    const take = (i: number) => {
      const existing = remap.get(i);
      if (existing !== undefined) return existing;
      const next = vertices.length / 3;
      vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      remap.set(i, next);
      return next;
    };
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const centroid = (trunkT.getX(a) + trunkT.getX(b) + trunkT.getX(c)) / 3;
      if (centroid < cutHeight) continue;
      indices.push(take(a), take(b), take(c));
    }
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
