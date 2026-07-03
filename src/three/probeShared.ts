import * as THREE from 'three';

/**
 * Shared state between the reflection-probe capture components and the single ReflectionProbeApply pass.
 *
 * Each enabled probe registers a live `ActiveProbe` (its world position, influence radius, intensity, and
 * the cubemap it last captured). The apply pass walks the scene and assigns the NEAREST covering probe's
 * cubemap to each reflective material's `envMap` — so surfaces reflect their local surroundings instead of
 * only the global scene environment. A probe with no captured texture yet is skipped.
 */
export interface ActiveProbe {
  id: string;
  /** World-space center of the probe (updated each capture frame). */
  position: THREE.Vector3;
  radius: number;
  intensity: number;
  /** The captured cubemap (a WebGLCubeRenderTarget.texture); null until the first bake completes. */
  texture: THREE.Texture | null;
}

export const probeRegistry: ActiveProbe[] = [];

export function registerProbe(probe: ActiveProbe): () => void {
  probeRegistry.push(probe);
  return () => {
    const i = probeRegistry.indexOf(probe);
    if (i >= 0) probeRegistry.splice(i, 1);
  };
}

/** Nearest probe whose influence sphere contains `pos` and which has a captured cubemap, or null. */
export function probeForPosition(pos: THREE.Vector3): ActiveProbe | null {
  let best: ActiveProbe | null = null;
  let bestDist = Infinity;
  for (const p of probeRegistry) {
    if (!p.texture) continue;
    const d = p.position.distanceTo(pos);
    if (d <= p.radius && d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
