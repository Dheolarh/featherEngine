import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ToonFinish } from '../types';
import type { ResolvedMaterial } from './materialResolve';

/**
 * Toon / cel-shading material factory — ported from the sibling three.js game's cartoonMaterials.ts.
 * Builds THREE.MeshToonMaterial with gradient-ramp banding + a Fresnel "candy rim" edge light. The
 * ramp DataTextures are module-cached and shared across every toon material (never disposed); only the
 * per-object MeshToonMaterial is disposed on unmount.
 */

const gradients = new Map<string, THREE.DataTexture>();

/** Soft toon ramp: a lifted shadow floor + linear filtering so bands read as gentle glossy gradients. */
function toonGradient(bands: number): THREE.DataTexture {
  const plateaus = Math.max(2, Math.min(6, Math.round(bands)));
  const key = `soft-bands-${plateaus}`;
  const cached = gradients.get(key);
  if (cached) return cached;

  const steps = plateaus * 16;
  const floor = 0.38;
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const eased = Math.pow(t, 0.85);
    let shade = floor + eased * (1 - floor);
    const spec = Math.exp(-Math.pow((t - 0.92) / 0.07, 2)) * 0.05;
    shade = Math.min(1, shade + spec);
    const v = Math.round(shade * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradients.set(key, tex);
  return tex;
}

/** Cached custom ramps for the special finishes (metal / rubber / pearl / hair / cloth). */
function rampTexture(key: string, sample: (t: number) => number, steps = 128): THREE.DataTexture {
  const cached = gradients.get(key);
  if (cached) return cached;
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const v = Math.round(THREE.MathUtils.clamp(sample(t), 0, 1) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradients.set(key, tex);
  return tex;
}

/** Anime-metal banding: dark→bright hot bands so toon "metal" reads as polished. */
const metalRamp = () =>
  rampTexture('finish-metal', (t) => {
    const base = 0.3 + t * 0.45;
    const band = Math.exp(-Math.pow((t - 0.52) / 0.05, 2)) * 0.45;
    const dip = -Math.exp(-Math.pow((t - 0.68) / 0.06, 2)) * 0.22;
    const hot = Math.exp(-Math.pow((t - 0.93) / 0.045, 2)) * 0.6;
    return base + band + dip + hot;
  });

/** Chalky matte: wide diffuse falloff with no specular ping. */
const rubberRamp = () => rampTexture('finish-rubber', (t) => 0.46 + Math.pow(t, 1.4) * 0.5);

/** Anime hair: soft diffuse body + one crisp bright shine band near the top. */
const hairRamp = () =>
  rampTexture('finish-hair', (t) => {
    const base = 0.42 + Math.pow(t, 0.9) * 0.5;
    const shine = Math.exp(-Math.pow((t - 0.82) / 0.075, 2)) * 0.3;
    return base + shine;
  });

/** Satin: high floor with one broad gentle sheen band. */
const pearlRamp = () =>
  rampTexture('finish-pearl', (t) => {
    const base = 0.5 + t * 0.42;
    const sheen = Math.exp(-Math.pow((t - 0.8) / 0.16, 2)) * 0.12;
    return base + sheen;
  });

/** Fabric: matte wide diffuse with a faint satin band. */
const clothRamp = () =>
  rampTexture('finish-cloth', (t) => {
    const base = 0.46 + Math.pow(t, 1.15) * 0.5;
    const sheen = Math.exp(-Math.pow((t - 0.85) / 0.12, 2)) * 0.055;
    return base + sheen;
  });

/** The shared, cached gradient DataTexture for a finish. Never dispose these — they outlive materials. */
export function gradientForFinish(finish: ToonFinish, bands: number): THREE.DataTexture {
  switch (finish) {
    case 'metal':
      return metalRamp();
    case 'rubber':
      return rubberRamp();
    case 'pearl':
      return pearlRamp();
    case 'hair':
      return hairRamp();
    case 'cloth':
      return clothRamp();
    case 'jelly':
    case 'flat':
    default:
      return toonGradient(bands);
  }
}

/**
 * Fresnel rim boost — a soft sky-tinted edge light patched into the toon shader so it composes with
 * ramps + maps + emissive. All rim materials share ONE compiled program (constant cache key); the
 * per-material rim uniforms live on the captured shader object.
 */
export function addCandyRim(mat: THREE.MeshToonMaterial, color: string | number = '#cfe8ff', strength = 0.16): THREE.MeshToonMaterial {
  const rim = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rim };
    shader.uniforms.rimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 rimColor;\nuniform float rimStrength;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        [
          'float rimT = 1.0 - saturate(dot(normalize(vViewPosition), normal));',
          'outgoingLight += rimColor * pow(rimT, 2.6) * rimStrength;',
          '#include <opaque_fragment>',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => 'toon-candy-rim';
  return mat;
}

/**
 * r3f hook: returns a memoized MeshToonMaterial for a cel-shaded surface, or null when the surface
 * isn't toon (so non-toon objects allocate nothing). Shader-affecting fields (finish/bands/rim/map)
 * key the memo; cheap fields (color/emissive/opacity) are synced per render without a recompile so the
 * hit-flash / focus-glow recolor doesn't rebuild the material. Attach via <primitive object={mat} attach="material" />.
 */
export function useToonMaterial(resolved: ResolvedMaterial, map: THREE.Texture | null): THREE.MeshToonMaterial | null {
  const { toon, toonFinish, toonBands, toonRimColor, toonRimStrength } = resolved;

  const material = useMemo(() => {
    if (!toon) return null;
    const m = new THREE.MeshToonMaterial({ gradientMap: gradientForFinish(toonFinish, toonBands) });
    if (map) m.map = map;
    if (toonRimStrength > 0) addCandyRim(m, toonRimColor, toonRimStrength);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toon, toonFinish, toonBands, toonRimColor, toonRimStrength, map]);

  if (material) {
    material.color.set(resolved.color);
    material.emissive.set(resolved.emissiveColor);
    material.emissiveIntensity = resolved.emissiveIntensity;
    material.opacity = resolved.opacity;
    material.transparent = resolved.opacity < 1;
    material.depthWrite = resolved.opacity >= 1;
  }

  useEffect(() => () => material?.dispose(), [material]);

  return material;
}
