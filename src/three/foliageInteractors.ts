import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';

/**
 * Grass interaction registry — the engine's equivalent of a "grass manager + interactors" rig.
 *
 * Actors that should push grass aside (characters, vehicles) publish a world-space sphere here once per
 * frame; the stylized-grass vertex shader reads the list as a small uniform array and bends/flattens blades
 * inside each sphere. The array is a FIXED size so the shader compiles once — unused slots get radius 0.
 *
 * Kept deliberately tiny: grass runs at up to 60k instances, so every extra interactor is 60k more distance
 * tests per frame. We publish only the nearest few to the camera, which is all you can actually see bending.
 */
export const MAX_FOLIAGE_INTERACTORS = 8;

/** xyz = world position of the actor's base, w = influence radius in world units. */
const slots: THREE.Vector4[] = Array.from({ length: MAX_FOLIAGE_INTERACTORS }, () => new THREE.Vector4(0, 0, 0, 0));
let activeCount = 0;
let lastSyncAt = -1;

interface Candidate {
  x: number;
  y: number;
  z: number;
  radius: number;
  distSq: number;
}

const candidates: Candidate[] = [];

export function getFoliageInteractorSlots(): THREE.Vector4[] {
  return slots;
}

export function getFoliageInteractorCount(): number {
  return activeCount;
}

/**
 * Rebuild the interactor list from the live scene. Throttled to once per rendered frame — several grass draw
 * calls (one per terrain) share the result rather than each rescanning the store.
 *
 * Only runs during Play: in edit mode the actors are parked at their authored transforms, and grass
 * permanently crushed around them would misrepresent the scene.
 */
export function syncFoliageInteractors(elapsed: number, camera: THREE.Camera): void {
  if (elapsed === lastSyncAt) return;
  lastSyncAt = elapsed;

  const state = useEditorStore.getState();
  if (!state.isPlaying) {
    activeCount = 0;
    return;
  }

  candidates.length = 0;
  const camX = camera.position.x;
  const camZ = camera.position.z;
  for (const object of selectActiveObjects(state)) {
    const isActor = object.character?.enabled || object.vehicle?.enabled;
    if (!isActor) continue;
    const [x, y, z] = object.transform.position;
    const [sx, , sz] = object.transform.scale;
    // A character's capsule is roughly its footprint; widen it a little so grass parts ahead of the feet
    // instead of only directly under them. Vehicles sweep a wider path.
    const spread = Math.max(Math.abs(sx), Math.abs(sz));
    const radius = object.vehicle?.enabled ? Math.max(1.8, spread * 1.6) : Math.max(0.7, spread * 1.15);
    const dx = x - camX;
    const dz = z - camZ;
    candidates.push({ x, y, z, radius, distSq: dx * dx + dz * dz });
  }

  // Nearest-to-camera wins the limited slots — distant actors bend grass you cannot resolve anyway.
  candidates.sort((a, b) => a.distSq - b.distSq);
  activeCount = Math.min(candidates.length, MAX_FOLIAGE_INTERACTORS);
  for (let i = 0; i < MAX_FOLIAGE_INTERACTORS; i += 1) {
    const c = i < activeCount ? candidates[i] : null;
    if (c) slots[i].set(c.x, c.y, c.z, c.radius);
    else slots[i].set(0, 0, 0, 0);
  }
}
