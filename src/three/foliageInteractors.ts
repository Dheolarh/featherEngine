import * as THREE from 'three';
import type { Vector3Tuple } from '../types';

/**
 * Foliage interactors — the "who is wading through the grass right now" channel.
 *
 * BOTW-style vegetation parts and flattens around the player (and any moving actor). Rather than push
 * that per-blade on the CPU (there can be tens of thousands of blades), we hand the foliage shaders a
 * tiny fixed-size list of world-space interactor spheres (xyz = world position, w = influence radius).
 * Each vertex bends its tip radially away from — and presses down under — any interactor within range.
 *
 * These uniform objects are module singletons shared by EVERY foliage material (see foliageWind.tsx):
 * the runtime tick rewrites their `.value` in place each frame, so all draw calls see the update with
 * zero React churn and zero per-material bookkeeping. Play-only — `clearFoliageInteractors()` on Stop.
 */
export const MAX_FOLIAGE_INTERACTORS = 8;

export interface FoliageInteractor {
  /** World-space position of the actor's feet/base. */
  position: Vector3Tuple;
  /** Horizontal influence radius in world units — grass within this parts away from the actor. */
  radius: number;
}

/** Shared uniforms every wind-foliage material references. Updated in place; never reassigned. */
export const foliageInteractorUniforms = {
  uInteractors: {
    value: Array.from({ length: MAX_FOLIAGE_INTERACTORS }, () => new THREE.Vector4(0, 0, 0, 0)),
  },
  uInteractorCount: { value: 0 },
};

/**
 * Publish this frame's interactors (already prioritised/capped by the caller). Extra entries beyond
 * MAX_FOLIAGE_INTERACTORS are dropped — the caller should pass the nearest/most-important actors first.
 */
export function updateFoliageInteractors(interactors: FoliageInteractor[]): void {
  const slots = foliageInteractorUniforms.uInteractors.value;
  const count = Math.min(interactors.length, MAX_FOLIAGE_INTERACTORS);
  for (let i = 0; i < count; i += 1) {
    const it = interactors[i];
    slots[i].set(it.position[0], it.position[1], it.position[2], Math.max(0, it.radius));
  }
  foliageInteractorUniforms.uInteractorCount.value = count;
}

/** Stop clears the list so a static scene (edit mode / next Play) shows no phantom bending. */
export function clearFoliageInteractors(): void {
  foliageInteractorUniforms.uInteractorCount.value = 0;
}
