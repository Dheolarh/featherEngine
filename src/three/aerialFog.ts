import * as THREE from 'three';

/**
 * Aerial-perspective fog — a global override of three.js's built-in fog ShaderChunks.
 *
 * Stock `THREE.Fog`/`FogExp2` lerp toward one flat color, which reads as a grey veil. Real outdoor
 * haze does two extra things this adds:
 *
 *  - **Height falloff** — the atmosphere is dense in the valley and thin up high, so distant peaks
 *    stay legible while the ground plane washes out. Uses the standard analytic integral of an
 *    exponential density profile along the view ray, not a per-camera constant, so looking *up* at a
 *    mountain correctly picks up less fog than looking *across* at one the same distance away.
 *  - **Sun in-scattering** — fog warms toward the sun, giving the bright halo around it and the warm
 *    wash over far terrain. This is most of why low-poly background ridges read as "distant" for free.
 *
 * Overriding the chunks (rather than patching materials) means every `MeshStandardMaterial`,
 * `MeshToonMaterial`, terrain and foliage material in the project inherits it with zero per-material
 * work, in the editor viewport as well as during Play. Note this is deliberately NOT the volumetric
 * fog in `VolumetricFog.tsx` — that's a raymarched depth post-pass that only mounts while playing and
 * is disabled on Low quality. This is the cheap always-on layer; `SceneEnvironment` already suppresses
 * the scene `<fog>` when volumetric fog is on, so the two never double up.
 *
 * ## Why the uniforms are plain `{x,y,z}` objects
 *
 * The tempting approach — `Object.assign(THREE.UniformsLib.fog, { myUniform: { value: new Color() } })`
 * — does NOT work. `ShaderLib` is built from `UniformsUtils.merge(...)` at three's *import* time, and
 * `WebGLPrograms.getUniforms()` then does `UniformsUtils.clone(shader.uniforms)` per material.
 * `cloneUniforms` deep-clones anything with `.isColor`/`.isVector3`, so each material would get a dead
 * private copy and mutating the shared one would update nothing.
 *
 * But `cloneUniforms` passes values it doesn't recognise through **by reference**, and three's
 * `setValueV3f` accepts any `{x, y, z}` shape. So holding our state in plain objects gets genuinely
 * shared, live-updatable uniforms across every material — which is exactly the property we want.
 * Floats are packed into a vec3 (`fogAerial`) for the same reason: a bare `number` would be copied.
 *
 * ## Safety invariant
 *
 * **All-zero uniforms must render byte-identically to stock three.js fog.** This override touches every
 * fogged material in the engine, so any material that somehow misses the uniforms (defaulting to 0)
 * degrades to the stock look rather than turning black. Keep this true when editing the chunks below.
 */

/** Direction pointing *toward* the sun, world space. Matches `sunDirectionFromEnvironment`. */
const fogSunDir = { x: 0, y: 1, z: 0 };
/** Linear-space RGB the fog tints toward when looking into the sun. */
const fogSunColor = { x: 1, y: 1, z: 1 };
/**
 * Packed scalars, so they survive `cloneUniforms` by reference:
 *   x = height falloff rate per world unit (0 = uniform density, i.e. stock behaviour)
 *   y = in-scatter exponent (higher = tighter halo around the sun)
 *   z = in-scatter strength 0..1 (0 = no sun tint, i.e. stock behaviour)
 */
const fogAerial = { x: 0, y: 6, z: 0 };

const uniforms = {
  fogSunDir: { value: fogSunDir },
  fogSunColor: { value: fogSunColor },
  fogAerial: { value: fogAerial },
};

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
#endif
`;

// `mvPosition` is the only position three guarantees at this point in EVERY fog-enabled vertex shader.
// `transformed` is NOT safe here: sprite.glsl.js never declares it, so using it would fail to compile
// every sprite material in the engine. Reconstructing world space from view space also gets instancing,
// batching and skinning for free, since those are all already folded into mvPosition.
// `vec * mat3` is GLSL's row-vector multiply, i.e. transpose(M) * vec — and the view matrix's upper 3x3
// is orthonormal, so its transpose is its inverse. That makes this an exact inverse-view transform.
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldPos = cameraPosition + ( mvPosition.xyz * mat3( viewMatrix ) );
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;

	uniform vec3 fogSunDir;
	uniform vec3 fogSunColor;
	uniform vec3 fogAerial;

	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG

	// Analytic integral of an exponential height-density profile along the view ray:
	//   density(y) = exp( -k * y )
	// Integrating from the camera to the fragment gives
	//   exp( -k * cameraY ) * ( 1 - exp( -k * dy ) ) / ( k * dy )
	// whose limit as dy -> 0 is exp( -k * cameraY ). Falls back to exactly 1.0 when k is 0, which is
	// what keeps the stock look intact for scenes that never opt in.
	float nfHeightFactor = 1.0;
	if ( fogAerial.x > 0.0 ) {
		float nfK = fogAerial.x;
		float nfT = nfK * ( vFogWorldPos.y - cameraPosition.y );
		// Clamped so a camera below y=0 can't drive density to absurd values.
		float nfBaseline = min( exp( - nfK * cameraPosition.y ), 4.0 );
		float nfIntegral = abs( nfT ) < 1e-4 ? 1.0 : ( 1.0 - exp( - nfT ) ) / nfT;
		nfHeightFactor = nfBaseline * nfIntegral;
	}

	#ifdef FOG_EXP2
		float nfDensity = fogDensity * nfHeightFactor;
		float fogFactor = 1.0 - exp( - nfDensity * nfDensity * vFogDepth * vFogDepth );
	#else
		// Linear fog has no density term to scale, so scale the effective distance instead.
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth * nfHeightFactor );
	#endif

	vec3 nfFogColor = fogColor;
	if ( fogAerial.z > 0.0 ) {
		vec3 nfRay = normalize( vFogWorldPos - cameraPosition );
		float nfSun = max( dot( nfRay, fogSunDir ), 0.0 );
		nfFogColor = mix( fogColor, fogSunColor, pow( nfSun, max( fogAerial.y, 1.0 ) ) * fogAerial.z );
	}

	gl_FragColor.rgb = mix( gl_FragColor.rgb, nfFogColor, fogFactor );

#endif
`;

let installed = false;

/**
 * Swap in the aerial-perspective fog chunks and register the extra uniforms.
 *
 * Must run before the first material compiles — programs bake the chunk text in at compile time, so
 * anything already on screen would keep the stock fog until it recompiles. Importing this module runs
 * it automatically; the export exists so callers can be explicit (and so it's testable). Idempotent.
 */
export function installAerialFog(): void {
  if (installed) return;
  installed = true;

  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;

  // For anything built later out of UniformsLib (custom ShaderMaterials, drei helpers).
  Object.assign(THREE.UniformsLib.fog, uniforms);

  // ShaderLib was already merged+cloned when three was imported, so the line above can't reach the
  // built-in materials — they have to be patched directly. Our values are plain objects, so the
  // per-material `cloneUniforms` in getUniforms() passes them through by reference and they stay live.
  for (const shader of Object.values(THREE.ShaderLib)) {
    if (shader.uniforms.fogColor) Object.assign(shader.uniforms, uniforms);
  }
}

const scratchColor = new THREE.Color();

export interface AerialFogParams {
  /** World-space direction pointing toward the sun (as returned by `sunDirectionFromEnvironment`). */
  sunDirection: THREE.Vector3;
  /** Sun/in-scatter tint as a hex string. Converted to the linear working space on the way in. */
  sunColor: string;
  /** Density falloff per world unit of height. 0 = uniform fog (stock behaviour). ~0.02 is a valley haze. */
  heightFalloff: number;
  /** In-scatter exponent — higher tightens the glow around the sun. ~6 is a broad warm wash. */
  inscatterPower: number;
  /** In-scatter strength, 0..1. 0 = no sun tint at all (stock behaviour). */
  inscatter: number;
}

/**
 * Push new values into the shared uniforms. Cheap enough to call every frame — it only writes six
 * floats, and because the uniform objects are shared by reference every fogged material in the scene
 * picks the change up at once.
 */
export function setAerialFog(params: AerialFogParams): void {
  fogSunDir.x = params.sunDirection.x;
  fogSunDir.y = params.sunDirection.y;
  fogSunDir.z = params.sunDirection.z;

  // `Color.set` converts sRGB hex into the linear working space, matching how three uploads fogColor.
  scratchColor.set(params.sunColor);
  fogSunColor.x = scratchColor.r;
  fogSunColor.y = scratchColor.g;
  fogSunColor.z = scratchColor.b;

  fogAerial.x = Math.max(0, params.heightFalloff);
  fogAerial.y = Math.max(1, params.inscatterPower);
  fogAerial.z = THREE.MathUtils.clamp(params.inscatter, 0, 1);
}

/** Return the fog to stock three.js behaviour (no height falloff, no sun tint). */
export function resetAerialFog(): void {
  fogAerial.x = 0;
  fogAerial.y = 6;
  fogAerial.z = 0;
}

/** Test/debug read-only view of the current uniform state. */
export const aerialFogState = { sunDir: fogSunDir, sunColor: fogSunColor, params: fogAerial };

installAerialFog();
