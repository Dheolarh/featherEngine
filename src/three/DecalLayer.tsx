import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { clearDecals, decals, decalTexture, MAX_DECALS, type DecalKind } from '../runtime/decalBus';

// Module-scope scratch — no per-frame allocation.
const dummy = new THREE.Object3D();
const normalVec = new THREE.Vector3();
const quat = new THREE.Quaternion();
const rollQuat = new THREE.Quaternion();
const colorScratch = new THREE.Color();
const PLANE_NORMAL = new THREE.Vector3(0, 0, 1); // PlaneGeometry faces +Z

const KINDS: DecalKind[] = ['bullet', 'blood', 'scorch'];

/**
 * Pooled decal render layer — one InstancedMesh of normal-oriented quads per preset, fed by the
 * decalBus ring buffer. Mirrors SkidMarks.tsx (shared quad geometry, depthWrite:false + polygonOffset to
 * sit on the surface without z-fighting, per-instance matrix set each frame, count-capped recycling).
 * Play-only; cleared on Play start/stop.
 */
export function DecalLayer() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  useEffect(() => {
    if (isPlaying) clearDecals();
    return () => clearDecals();
  }, [isPlaying]);

  const bulletRef = useRef<THREE.InstancedMesh>(null);
  const bloodRef = useRef<THREE.InstancedMesh>(null);
  const scorchRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const materials = useMemo(() => {
    const make = (kind: DecalKind) =>
      new THREE.MeshBasicMaterial({
        map: decalTexture(kind),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
        toneMapped: true,
      });
    return { bullet: make('bullet'), blood: make('blood'), scorch: make('scorch') };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      materials.bullet.dispose();
      materials.blood.dispose();
      materials.scorch.dispose();
    },
    [geometry, materials],
  );

  useFrame((_, delta) => {
    const refs: Record<DecalKind, THREE.InstancedMesh | null> = {
      bullet: bulletRef.current,
      blood: bloodRef.current,
      scorch: scorchRef.current,
    };
    const counts: Record<DecalKind, number> = { bullet: 0, blood: 0, scorch: 0 };
    const items = decals.items;
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      if (!d) continue;
      if (d.life !== Infinity) {
        d.life -= delta;
        if (d.life <= 0) continue;
      }
      const mesh = refs[d.kind];
      if (!mesh) continue;
      const idx = counts[d.kind];
      if (idx >= MAX_DECALS) continue;

      normalVec.set(d.nx, d.ny, d.nz);
      quat.setFromUnitVectors(PLANE_NORMAL, normalVec);
      rollQuat.setFromAxisAngle(normalVec, d.roll);
      quat.premultiply(rollQuat);

      const fade = d.life === Infinity ? 1 : Math.min(1, d.life / (d.maxLife * 0.25));
      const s = d.size * 2 * (0.6 + 0.4 * fade);
      // Lift slightly off the surface (plus polygonOffset) to avoid z-fighting.
      dummy.position.set(d.x + d.nx * 0.02, d.y + d.ny * 0.02, d.z + d.nz * 0.02);
      dummy.quaternion.copy(quat);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      mesh.setColorAt(idx, colorScratch.set(d.color ?? '#ffffff'));
      counts[d.kind] = idx + 1;
    }
    for (const k of KINDS) {
      const mesh = refs[k];
      if (!mesh) continue;
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  if (!isPlaying) return null;
  return (
    <>
      <instancedMesh ref={bulletRef} args={[geometry, materials.bullet, MAX_DECALS]} frustumCulled={false} />
      <instancedMesh ref={bloodRef} args={[geometry, materials.blood, MAX_DECALS]} frustumCulled={false} />
      <instancedMesh ref={scorchRef} args={[geometry, materials.scorch, MAX_DECALS]} frustumCulled={false} />
    </>
  );
}
