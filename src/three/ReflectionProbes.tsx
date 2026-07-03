import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import type { ReflectionProbeComponent } from '../types';
import { probeForPosition, probeRegistry, registerProbe, type ActiveProbe } from './probeShared';

// Reused scratch vector — no per-frame allocation in the apply pass.
const worldPos = new THREE.Vector3();

/** How many frames a static probe keeps re-capturing after mount / a re-bake (lets the scene + models settle). */
const STATIC_BAKE_FRAMES = 8;
/** Realtime probes re-capture every Nth frame (a full scene re-render × 6 faces is expensive). */
const REALTIME_INTERVAL = 6;

/**
 * Per-probe capture. Rendered INSIDE the probe object's <group> (so it inherits the world transform),
 * one per enabled ReflectionProbeComponent. Each holds its own WebGLCubeRenderTarget + CubeCamera and,
 * on the frames it's "due", re-renders the scene from the probe position into the cubemap. The result is
 * published into the shared `probeRegistry` for ReflectionProbeApply to hand to nearby materials.
 *
 * Static probes bake a handful of frames after mount (and whenever `bakeNonce`/`resolution` changes) then
 * go idle — effectively free at runtime. Realtime probes re-bake on a throttle.
 */
export function ReflectionProbeCapture({
  objectId,
  probe,
  showHelper = false,
}: {
  objectId: string;
  probe: ReflectionProbeComponent;
  showHelper?: boolean;
}) {
  const { gl, scene } = useThree();
  const anchorRef = useRef<THREE.Group>(null);
  const resolution = Math.max(16, Math.min(512, Math.round(probe.resolution || 256)));

  const fbo = useMemo(() => {
    const target = new THREE.WebGLCubeRenderTarget(resolution, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      type: THREE.HalfFloatType,
    });
    target.texture.mapping = THREE.CubeReflectionMapping;
    return target;
  }, [resolution]);
  const cubeCamera = useMemo(() => new THREE.CubeCamera(0.1, 1000, fbo), [fbo]);
  // Diffuse GI: a spherical-harmonic ambient light derived from the captured cubemap. Added to the scene
  // only while giIntensity > 0. Applied scene-wide (three's LightProbe has no falloff) — one per area.
  const gi = probe.giIntensity ?? 0;
  const lightProbe = useMemo(() => new THREE.LightProbe(), []);
  const giBusy = useRef(false);
  useEffect(() => {
    lightProbe.intensity = gi;
  }, [lightProbe, gi]);

  // One shared registry entry for this probe; kept in sync with the component's tunables.
  const entry = useMemo<ActiveProbe>(
    () => ({ id: objectId, position: new THREE.Vector3(), radius: probe.radius, intensity: probe.intensity, texture: null }),
    [objectId],
  );
  useEffect(() => {
    entry.radius = probe.radius;
    entry.intensity = probe.intensity;
  }, [entry, probe.radius, probe.intensity]);
  useEffect(() => registerProbe(entry), [entry]);
  useEffect(() => () => fbo.dispose(), [fbo]);

  // Static bake budget — refilled on mount and whenever the user re-bakes or changes resolution.
  const pending = useRef(STATIC_BAKE_FRAMES);
  useEffect(() => {
    pending.current = STATIC_BAKE_FRAMES;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe.bakeNonce, resolution, probe.refresh]);
  const frame = useRef(0);

  useFrame(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchor.getWorldPosition(entry.position);
    cubeCamera.position.copy(entry.position);

    frame.current += 1;
    const realtime = probe.refresh === 'realtime';
    const due = realtime ? frame.current % REALTIME_INTERVAL === 0 : pending.current > 0;
    if (!due) return;
    if (!realtime) pending.current -= 1;

    const prevShadowAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false; // don't re-render shadow maps six times per capture
    // Hide this probe's own anchor/helper so it isn't baked into its reflection.
    const anchorWasVisible = anchor.visible;
    anchor.visible = false;
    cubeCamera.update(gl, scene); // renders all 6 faces and restores the render target itself
    anchor.visible = anchorWasVisible;
    gl.shadowMap.autoUpdate = prevShadowAuto;
    entry.texture = fbo.texture;

    // Derive diffuse GI (SH ambient) from the freshly captured cubemap. Async pixel readback, so guard
    // against overlapping generations; a slightly stale SH between updates is imperceptible.
    if (gi > 0 && !giBusy.current) {
      giBusy.current = true;
      LightProbeGenerator.fromCubeRenderTarget(gl, fbo)
        .then((generated) => {
          lightProbe.sh.copy(generated.sh);
          lightProbe.intensity = probe.giIntensity ?? 0;
        })
        .catch(() => undefined)
        .finally(() => {
          giBusy.current = false;
        });
    }
  });

  return (
    <group ref={anchorRef}>
      {gi > 0 && <primitive object={lightProbe} />}
      {showHelper && (
        <mesh>
          <sphereGeometry args={[Math.max(0.2, probe.radius), 20, 14]} />
          <meshBasicMaterial color="#66d9ff" wireframe transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function applyProbeEnvMap(material: THREE.Material, texture: THREE.Texture | null, intensity: number) {
  // Only PBR materials (MeshStandardMaterial + MeshPhysicalMaterial, which extends it) sample an envMap.
  const mat = material as THREE.MeshStandardMaterial & { userData: Record<string, unknown> };
  if (!(mat as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return;
  if (texture) {
    if (mat.envMap !== texture) {
      mat.envMap = texture;
      mat.needsUpdate = true; // envMap presence changes the compiled shader — recompile only on change
    }
    mat.envMapIntensity = intensity;
    mat.userData.__probeApplied = true;
  } else if (mat.userData.__probeApplied) {
    // Left all probe influence → fall back to the global scene.environment.
    mat.envMap = null;
    mat.envMapIntensity = 1;
    mat.needsUpdate = true;
    mat.userData.__probeApplied = false;
  }
}

/**
 * The single scene-wide pass that hands each reflective material the nearest covering probe's cubemap.
 * Mounted once per Canvas (beside WaterEnvCapture). Throttled and gated on "any probe exists", so when a
 * scene has no reflection probes it costs nothing beyond a cheap counter check. On the frame the last
 * probe is removed it does one cleanup traversal to restore materials to the global environment.
 */
export function ReflectionProbeApply() {
  const { scene } = useThree();
  const frame = useRef(0);
  const applied = useRef(false);

  useFrame(() => {
    frame.current += 1;
    if (frame.current % 10 !== 0) return;

    if (probeRegistry.length === 0) {
      if (applied.current) {
        scene.traverse((obj) => {
          const mat = (obj as THREE.Mesh).material;
          if (!mat) return;
          if (Array.isArray(mat)) mat.forEach((m) => applyProbeEnvMap(m, null, 1));
          else applyProbeEnvMap(mat, null, 1);
        });
        applied.current = false;
      }
      return;
    }

    applied.current = true;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.getWorldPosition(worldPos);
      const probe = probeForPosition(worldPos);
      const tex = probe?.texture ?? null;
      const intensity = probe?.intensity ?? 1;
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => applyProbeEnvMap(m, tex, intensity));
      else applyProbeEnvMap(mat, tex, intensity);
    });
  });

  return null;
}
