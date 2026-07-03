import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { isRagdoll } from '../runtime/ragdollState';
import type { AnimatorComponent, SceneObject } from '../types';

/**
 * Aim / look-at IK for skinned characters.
 *
 * After the animation mixer poses the skeleton, this rotates a chosen bone (the head by default) so its
 * "face" axis points at a target — an enemy that tracks the player, an NPC whose eyes follow you, a turret.
 * It's purely ADDITIVE on top of the clip and fully opt-in (animator.aimEnabled), clamped to a cone and
 * blended by weight, so it never fights or replaces the animation. Rig-axis differences are handled by the
 * `aimAxis` field (which local axis of the bone points out of the face). If the bone or target can't be
 * resolved it's a no-op. Play-only; suspended during ragdoll.
 */

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const bonePos = new THREE.Vector3();
const boneQuat = new THREE.Quaternion();
const parentQuat = new THREE.Quaternion();
const curForward = new THREE.Vector3();
const desiredDir = new THREE.Vector3();
const targetPos = new THREE.Vector3();
const deltaQuat = new THREE.Quaternion();
const desiredWorld = new THREE.Quaternion();
const identityQuat = new THREE.Quaternion();

const AXIS_VEC: Record<NonNullable<AnimatorComponent['aimAxis']>, THREE.Vector3> = {
  z: new THREE.Vector3(0, 0, 1),
  '-z': new THREE.Vector3(0, 0, -1),
  x: new THREE.Vector3(1, 0, 0),
  '-x': new THREE.Vector3(-1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  '-y': new THREE.Vector3(0, -1, 0),
};

function findAimBone(root: THREE.Object3D, override?: string): THREE.Bone | null {
  let head: THREE.Bone | null = null;
  let neck: THREE.Bone | null = null;
  let named: THREE.Bone | null = null;
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (!bone.isBone) return;
    if (override && !named && bone.name.toLowerCase() === override.toLowerCase()) named = bone;
    if (!head && /head/i.test(bone.name)) head = bone;
    else if (!neck && /neck/i.test(bone.name)) neck = bone;
  });
  return named ?? head ?? neck;
}

/** Resolve the world position the bone should look at (with a small head-height offset for object targets). */
function resolveTarget(objects: SceneObject[], targetId: string | undefined, self: string, camera: THREE.Camera, out: THREE.Vector3): boolean {
  if (targetId === '$camera') {
    out.copy(camera.position);
    return true;
  }
  let target: SceneObject | undefined;
  if (!targetId || targetId === '$player') {
    target = objects.find((o) => o.character?.enabled && o.character.cameraFollow) ?? objects.find((o) => o.character?.enabled);
  } else {
    target = objects.find((o) => o.id === targetId);
  }
  if (!target || target.id === self) return false;
  out.set(target.transform.position[0], target.transform.position[1] + 1.5, target.transform.position[2]);
  return true;
}

/** Hook: drive aim/look-at IK for the character rendered by `model` (identified by `registerId`). */
export function useAimIK(model: THREE.Object3D, registerId?: string) {
  const boneRef = useRef<THREE.Bone | null>(null);
  const lastOverride = useRef<string | undefined>(undefined);

  useEffect(() => {
    boneRef.current = null;
    lastOverride.current = undefined;
  }, [model, registerId]);

  useFrame((rtState) => {
    if (!registerId) return;
    const state = useEditorStore.getState();
    if (!state.isPlaying || isRagdoll(registerId)) return;
    const objects = selectActiveObjects(state);
    const self = objects.find((o) => o.id === registerId);
    const animator = self?.animator;
    if (!animator?.enabled || !animator.aimEnabled) return;

    // (Re)resolve the bone if the override changed or it hasn't been found yet.
    if (!boneRef.current || lastOverride.current !== animator.aimBone) {
      boneRef.current = findAimBone(model, animator.aimBone);
      lastOverride.current = animator.aimBone;
    }
    const bone = boneRef.current;
    if (!bone) return;

    if (!resolveTarget(objects, animator.aimTargetObjectId, registerId, rtState.camera, targetPos)) return;

    bone.getWorldPosition(bonePos);
    bone.getWorldQuaternion(boneQuat);
    const axis = AXIS_VEC[animator.aimAxis ?? 'z'];
    curForward.copy(axis).applyQuaternion(boneQuat).normalize();
    desiredDir.copy(targetPos).sub(bonePos);
    if (desiredDir.lengthSq() < 1e-6) return;
    desiredDir.normalize();

    // Delta that rotates the current facing onto the target, clamped to the cone and scaled by weight.
    deltaQuat.setFromUnitVectors(curForward, desiredDir);
    const maxAngle = ((animator.aimMaxAngle ?? 80) * Math.PI) / 180;
    const weight = clamp(animator.aimWeight ?? 1, 0, 1);
    let angle = 2 * Math.acos(clamp(Math.abs(deltaQuat.w), -1, 1));
    const limit = Math.min(maxAngle, angle) * weight;
    if (angle < 1e-4 || limit < 1e-4) return;
    // Rescale the delta to the allowed angle: slerp toward identity by (1 - t) == slerp(identity, delta, t).
    // (Done in-place to avoid the this===qb aliasing bug of slerpQuaternions.)
    deltaQuat.slerp(identityQuat, 1 - limit / angle);

    desiredWorld.copy(deltaQuat).multiply(boneQuat); // newWorld = delta * current
    if (bone.parent) {
      bone.parent.getWorldQuaternion(parentQuat).invert();
      bone.quaternion.copy(parentQuat).multiply(desiredWorld);
    } else {
      bone.quaternion.copy(desiredWorld);
    }
    bone.updateMatrixWorld(true);
  });
}
