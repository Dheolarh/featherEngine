import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObject, TreeSpec } from '../types';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import { generateTree } from '../tree/generateTree';
import { normalizeTreeSpec } from '../tree/treeSpec';
import { MAX_FOLIAGE_INTERACTORS, foliageInteractorUniforms } from './foliageInteractors';
import { getTreeChopState, treeChopVersion } from '../runtime/treeChop';

/**
 * Renders one parametric tree: bark + canopy, regenerated from the object's spec + seed.
 *
 * The material is patched from MeshLambertMaterial rather than MeshStandardMaterial on purpose — the same
 * reason foliageWind.tsx gives for grass: a PBR specular lobe plus IBL puts a broad plasticky sheen over
 * foliage that reads as wet rubber.
 *
 * Two custom vertex attributes come out of the generator. This IS a new convention for this codebase (the
 * grass/foliage path encodes everything in uv.y + vertex colour), and it earns its keep:
 *   aWind    per-vertex sway weight. uv.y can't express it — a twig at the top of a level-2 branch and a
 *            point halfway up the trunk can share a uv.y yet must move completely differently.
 *   aTrunkT  the trunk height this vertex's limb is rooted at, which is what makes felling a pure vertex
 *            partition instead of a CSG operation.
 */

/** Scattered trees are scenery — they must never swallow terrain sculpt/paint clicks. */
const ignoreFoliageRaycast = () => null;

interface TreeUniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector3 };
  uWindStrength: { value: number };
  uSwaySpeed: { value: number };
  /** x = sever height in aTrunkT space, y = 1 when this draw is the FALLING half, z = 1 when severed. */
  uSever: { value: THREE.Vector3 };
  uInteractors: { value: THREE.Vector4[] };
  uInteractorCount: { value: number };
  uInteractStrength: { value: number };
}

function makeTreeUniforms(): TreeUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uWindStrength: { value: 0 },
    uSwaySpeed: { value: 1 },
    uSever: { value: new THREE.Vector3(1, 0, 0) },
    uInteractors: foliageInteractorUniforms.uInteractors,
    uInteractorCount: foliageInteractorUniforms.uInteractorCount,
    uInteractStrength: { value: 1 },
  };
}

const VERTEX_HEAD = `
attribute float aWind;
attribute float aTrunkT;
uniform float uTime;
uniform vec3  uWind;
uniform float uWindStrength;
uniform float uSwaySpeed;
uniform vec3  uSever;
uniform vec4  uInteractors[${MAX_FOLIAGE_INTERACTORS}];
uniform int   uInteractorCount;
uniform float uInteractStrength;
varying float vTreeCut;
`;

const VERTEX_BODY = `
  // Discard-by-collapse: the standing half and the felled half are the SAME geometry drawn twice, each
  // hiding the vertices belonging to the other. Cheaper and far simpler than splitting buffers, and it
  // keeps one shared geometry for every instance of the spec.
  float nfAbove = step(uSever.x, aTrunkT);
  vTreeCut = 0.0;
  if (uSever.z > 0.5) {
    float nfMine = mix(1.0 - nfAbove, nfAbove, uSever.y);
    if (nfMine < 0.5) {
      transformed = vec3(0.0);
      vTreeCut = 1.0;
    }
  }

  // On an InstancedMesh modelMatrix is SHARED, so deriving the sway phase from it alone would make every
  // scattered tree sway in perfect unison — instantly and obviously wrong. Fold in instanceMatrix so each
  // trunk gets its own world position and therefore its own phase.
  #ifdef USE_INSTANCING
    vec3 nfWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 nfWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float nfPhase = uTime * uSwaySpeed + nfWorld.x * 0.3 + nfWorld.z * 0.3;
  // Two frequencies so the canopy never reads as a single rocking rigid body.
  float nfGust = sin(nfPhase) * 0.65 + sin(nfPhase * 2.3 + 1.7) * 0.35;
  vec2 nfLean = uWind.xz * uWindStrength * nfGust * aWind;
  transformed.x += nfLean.x;
  transformed.z += nfLean.y;
  // Twigs also flutter across the wind, which is most of what sells foliage as light and separate.
  transformed.y += sin(nfPhase * 1.9 + aTrunkT * 6.0) * aWind * 0.06;

  // Actors brushing past push the canopy aside; the trunk stays planted (aWind is ~0 down there).
  for (int i = 0; i < ${MAX_FOLIAGE_INTERACTORS}; i++) {
    if (i >= uInteractorCount) break;
    vec4 nfIt = uInteractors[i];
    if (nfIt.w <= 0.0) continue;
    #ifdef USE_INSTANCING
      vec3 nfV = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz - nfIt.xyz;
    #else
      vec3 nfV = (modelMatrix * vec4(transformed, 1.0)).xyz - nfIt.xyz;
    #endif
    float nfD = length(nfV.xz);
    float nfInfl = 1.0 - smoothstep(nfIt.w * 0.4, nfIt.w, nfD);
    if (nfInfl <= 0.0) continue;
    vec2 nfAway = nfD > 1e-4 ? nfV.xz / nfD : vec2(1.0, 0.0);
    transformed.xz += nfAway * nfInfl * uInteractStrength * aWind * 0.35;
  }
`;

const FRAGMENT_HEAD = 'varying float vTreeCut;\n';
// Collapsed vertices land on the origin as degenerate triangles, but a stray interpolated fragment can
// still slip through; discarding them outright is cheaper than reasoning about it.
const FRAGMENT_BODY = `  if (vTreeCut > 0.5) discard;`;

function makeTreeMaterial(kind: 'bark' | 'foliage', uniforms: TreeUniforms): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: kind === 'foliage' ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: kind === 'foliage',
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader =
      FRAGMENT_HEAD + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_BODY}`);
  };
  // Must distinguish the variants or three reuses one compiled program for both.
  material.customProgramCacheKey = () => `nf-tree-${kind}-v1`;
  return material;
}

/** The standing part of a tree (or the whole tree when it has not been felled). */
export function TreeMesh({ object }: { object: SceneObject }) {
  const tree = object.tree;
  const env = useEditorStore(selectActiveSceneEnvironment);
  // Re-read when a chop lands. The chop bus bumps a version rather than living in the store, so felling
  // never triggers a scene-wide React re-render.
  const chopVersion = treeChopVersion();
  const windVec = env?.wind ?? [0, 0, 0];

  const spec = useMemo(() => (tree ? normalizeTreeSpec(tree.spec) : null), [tree]);
  const generated = useMemo(() => (spec ? generateTree(spec, tree?.seed ?? 1) : null), [spec, tree?.seed]);

  const uniforms = useRef<TreeUniforms>(makeTreeUniforms());
  const barkMaterial = useMemo(() => makeTreeMaterial('bark', uniforms.current), []);
  const foliageMaterial = useMemo(() => makeTreeMaterial('foliage', uniforms.current), []);

  useFrame((_, delta) => {
    const u = uniforms.current;
    u.uTime.value += Math.min(delta, 1 / 20);
    u.uWind.value.set(windVec[0], 0, windVec[2]);
    u.uWindStrength.value = 0.045;
    u.uInteractorCount.value = foliageInteractorUniforms.uInteractorCount.value;
    const chop = getTreeChopState(object.id);
    const severedIndex = chop?.severedAt;
    if (severedIndex !== undefined && spec) {
      u.uSever.value.set(spec.chop.breakPoints[severedIndex]?.height ?? 1, 0, 1);
    } else {
      u.uSever.value.set(1, 0, 0);
    }
  });

  if (!tree?.enabled || !generated) return null;
  // chopVersion is read so the memo above re-evaluates on a chop; referencing it keeps the lint honest.
  void chopVersion;

  return (
    <group>
      <mesh geometry={generated.bark} material={barkMaterial} castShadow receiveShadow />
      {generated.foliage && <mesh geometry={generated.foliage} material={foliageMaterial} castShadow receiveShadow />}
    </group>
  );
}

/**
 * Terrain-scattered parametric trees: one InstancedMesh per seed variant, so a forest of hundreds is a
 * handful of draw calls rather than one per tree.
 *
 * A few seeds is all it takes — every instance also gets a random yaw and scale from its matrix, so the
 * repetition never reads.
 */
export function ScatteredTrees({
  spec,
  matrices,
  seedVariants = 4,
}: {
  spec: TreeSpec;
  matrices: THREE.Matrix4[];
  seedVariants?: number;
}) {
  const normalized = useMemo(() => normalizeTreeSpec(spec), [spec]);
  const variants = useMemo(
    () => Array.from({ length: seedVariants }, (_, i) => generateTree(normalized, 1013 + i * 7717)),
    [normalized, seedVariants],
  );
  // Split the placements round-robin so each variant gets a roughly even share.
  const buckets = useMemo(() => {
    const out: THREE.Matrix4[][] = Array.from({ length: seedVariants }, () => []);
    matrices.forEach((m, i) => out[i % seedVariants].push(m));
    return out;
  }, [matrices, seedVariants]);

  const uniforms = useRef<TreeUniforms>(makeTreeUniforms());
  const barkMaterial = useMemo(() => makeTreeMaterial('bark', uniforms.current), []);
  const foliageMaterial = useMemo(() => makeTreeMaterial('foliage', uniforms.current), []);
  const env = useEditorStore(selectActiveSceneEnvironment);
  const windVec = env?.wind ?? [0, 0, 0];

  useFrame((_, delta) => {
    const u = uniforms.current;
    u.uTime.value += Math.min(delta, 1 / 20);
    u.uWind.value.set(windVec[0], 0, windVec[2]);
    u.uWindStrength.value = 0.045;
    u.uInteractorCount.value = foliageInteractorUniforms.uInteractorCount.value;
    // Scattered trees are scenery — they are never individually felled, so the sever uniform stays off.
    u.uSever.value.set(1, 0, 0);
  });

  if (matrices.length === 0) return null;
  return (
    <>
      {variants.map((variant, i) =>
        buckets[i].length === 0 ? null : (
          <group key={i}>
            <TreeInstances geometry={variant.bark} material={barkMaterial} matrices={buckets[i]} />
            {variant.foliage && <TreeInstances geometry={variant.foliage} material={foliageMaterial} matrices={buckets[i]} />}
          </group>
        ),
      )}
    </>
  );
}

function TreeInstances({
  geometry,
  material,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // lets the forest frustum-cull as a whole
  }, [matrices]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, matrices.length]}
      castShadow
      receiveShadow
      raycast={ignoreFoliageRaycast}
      userData={{ nfGround: true }}
    />
  );
}
