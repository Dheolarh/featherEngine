import * as THREE from 'three';
import type { TreeSpec } from '../types';
import { treeRng } from './treeSpec';

/**
 * Parametric tree geometry generation: spec + seed -> BufferGeometry.
 *
 * Pipeline: buildSkeleton -> sweepBark -> emitFoliage. Bark and foliage come out as SEPARATE geometries
 * because they need different materials (opaque bark vs alpha-cut, translucent canopy).
 *
 * Every vertex carries three custom channels the tree material and the chop system rely on:
 *   aWind    0..n  how much this vertex sways — distance from the root, curved by the spec's stiffness
 *   aTrunkT  0..1  the height ALONG THE TRUNK that this vertex's branch is rooted at. This is what makes
 *                  felling work: severing at height h is just "vertices below h stay, above h fall", and
 *                  because a branch inherits its trunk attach height, a whole limb travels with the log
 *                  instead of being sliced through the middle.
 *   color    rgb   baked ramp + ambient occlusion (canopy interior darkening, trunk base darkening)
 */

const UP = new THREE.Vector3(0, 1, 0);

export interface TreeBranch {
  path: THREE.CatmullRomCurve3;
  length: number;
  radius: number;
  level: number;
  /** Arc length from the root along the parent chain — drives aWind. */
  distFromRoot: number;
  /** Height fraction along the TRUNK where this branch's chain attaches. Trunk itself spans 0..1. */
  trunkT: number;
  parent?: TreeBranch;
  children: TreeBranch[];
}

export interface GeneratedTree {
  bark: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry | null;
  /** Bounding box in local space (base of trunk at origin). */
  bounds: THREE.Box3;
  triangles: number;
  /** Trunk height in world units — break-point fractions multiply this. */
  trunkHeight: number;
}

// --- mesh accumulator ---------------------------------------------------------------------------------
// Building into flat arrays and indexing by hand beats merging N small BufferGeometries: no per-primitive
// allocation, and custom attributes can't silently mismatch between merge inputs.

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  wind: number[] = [];
  trunkT: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, w: number, t: number): number {
    const index = this.vertexCount;
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.colors.push(c.r, c.g, c.b);
    this.wind.push(w);
    this.trunkT.push(t);
    return index;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /**
   * Bake an existing geometry (a cone, an icosphere, a plane) in under a transform.
   *
   * `normalOverride` replaces every vertex normal with one shared direction. Leaf cards need this: lit by
   * their own face normals, each quad in a cluster shades independently and the canopy reads as confetti
   * rather than as one soft mass. Pointing them all outward from the canopy makes the cluster light as a
   * single volume.
   */
  addGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color, wind: number, trunkT: number, normalOverride?: THREE.Vector3): void {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const base = this.vertexCount;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      if (normalOverride) n.copy(normalOverride);
      else n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      this.vertex(p, n, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, color, wind, trunkT);
    }
    const idx = geo.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i += 1) this.indices.push(base + idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i += 1) this.indices.push(base + i);
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setAttribute('aTrunkT', new THREE.Float32BufferAttribute(this.trunkT, 1));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// --- skeleton -----------------------------------------------------------------------------------------

/** Rotate `dir` away from its axis by `pitch`, then spin that offset around `dir` by `yaw`. */
function offsetDirection(dir: THREE.Vector3, pitch: number, yaw: number): THREE.Vector3 {
  // Any vector not parallel to dir works as the reference for "sideways".
  const reference = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP;
  const side = new THREE.Vector3().crossVectors(dir, reference).normalize();
  return dir.clone().applyAxisAngle(side, pitch).applyAxisAngle(dir, yaw).normalize();
}

/**
 * Build the curved path of one branch. Curl bends it into an S rather than leaving it a straight stick,
 * and every consumer samples THIS curve — sampling a straight line for child placement while sweeping a
 * curved one for the bark is what makes branches visibly detach from the trunk.
 */
function branchPath(start: THREE.Vector3, dir: THREE.Vector3, length: number, curl: number, gravity: number, rand: () => number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const segments = 4;
  const side = offsetDirection(dir, Math.PI / 2, rand() * Math.PI * 2);
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const p = start.clone().addScaledVector(dir, length * t);
    // S-curve across the branch axis, plus gravity sagging (or lifting) the far end.
    p.addScaledVector(side, Math.sin(t * Math.PI) * curl * length * 0.28);
    p.y += -gravity * length * 0.3 * t * t;
    points.push(p);
  }
  return new THREE.CatmullRomCurve3(points);
}

export function buildSkeleton(spec: TreeSpec, rand: () => number): TreeBranch[] {
  const out: TreeBranch[] = [];
  const lean = THREE.MathUtils.degToRad(spec.trunk.lean);
  const dir = new THREE.Vector3(Math.sin(lean), Math.cos(lean), 0)
    .applyAxisAngle(UP, rand() * Math.PI * 2)
    .normalize();
  const trunk: TreeBranch = {
    path: branchPath(new THREE.Vector3(), dir, spec.trunk.height, spec.trunk.curl, 0, rand),
    length: spec.trunk.height,
    radius: spec.trunk.baseRadius,
    level: 0,
    distFromRoot: 0,
    trunkT: 0,
    children: [],
  };
  grow(trunk, spec, rand, out);
  return out;
}

function grow(branch: TreeBranch, spec: TreeSpec, rand: () => number, out: TreeBranch[]): void {
  out.push(branch);
  const b = spec.branches;
  if (branch.level >= b.levels) return;
  const count = b.countPerLevel[branch.level] ?? 0;

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? (b.startHeight + b.endHeight) / 2 : THREE.MathUtils.lerp(b.startHeight, b.endHeight, i / (count - 1));
    const start = branch.path.getPoint(t);
    const parentDir = branch.path.getTangent(t).normalize();

    const yaw = THREE.MathUtils.degToRad(b.twist * i + branch.level * 53 + rand() * 12);
    const pitch = THREE.MathUtils.degToRad(b.angle + (rand() - 0.5) * b.angleVariance * 2);
    const dir = offsetDirection(parentDir, pitch, yaw);
    // Lower branches droop harder — that gradient is most of what reads as a real canopy.
    dir.y += b.gravity * 0.45 * (1 - t);
    dir.normalize();

    const length = branch.length * b.lengthRatio * (0.75 + rand() * 0.5);
    const child: TreeBranch = {
      path: branchPath(start, dir, length, branch.level === 0 ? spec.trunk.curl * b.curlPerLevel : b.curlPerLevel * 0.5, b.gravity, rand),
      length,
      radius: branch.radius * b.radiusRatio,
      level: branch.level + 1,
      distFromRoot: branch.distFromRoot + branch.length * t,
      // Level-1 branches record where they meet the trunk; deeper levels inherit it, so a whole limb
      // shares one trunk height and therefore always falls (or stays) as a single piece when felled.
      trunkT: branch.level === 0 ? t : branch.trunkT,
      parent: branch,
      children: [],
    };
    branch.children.push(child);
    grow(child, spec, rand, out);
  }
}

// --- wind weight --------------------------------------------------------------------------------------

function windWeight(spec: TreeSpec, level: number, distFromRoot: number, maxDist: number): number {
  const t = maxDist > 0 ? THREE.MathUtils.clamp(distFromRoot / maxDist, 0, 1) : 0;
  const shaped = Math.pow(t, spec.wind.stiffnessCurve);
  const levelMul = spec.wind.levelMultiplier[Math.min(level, spec.wind.levelMultiplier.length - 1)] ?? 1;
  const stiffness = level === 0 ? 1 - spec.wind.trunkStiffness : 1;
  return shaped * levelMul * stiffness;
}

// --- bark ---------------------------------------------------------------------------------------------

function rampColor(ramp: string[], t: number, target: THREE.Color): THREE.Color {
  if (ramp.length === 1) return target.set(ramp[0]);
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(scaled), ramp.length - 2);
  return target.set(ramp[i]).lerp(new THREE.Color(ramp[i + 1]), scaled - i);
}

function sweepBark(branches: TreeBranch[], spec: TreeSpec, maxDist: number, builder: MeshBuilder): void {
  const color = new THREE.Color();
  const p = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const branch of branches) {
    // Twigs get fewer sides — nobody resolves the tessellation on a level-2 branch.
    const radial = Math.max(3, Math.round(spec.trunk.radialSegments / (branch.level + 1)));
    const rings = branch.level === 0 ? spec.trunk.heightSegments : Math.max(3, Math.round(spec.trunk.heightSegments / 2));
    const frames = branch.path.computeFrenetFrames(rings, false);
    const ringStart: number[] = [];

    for (let r = 0; r <= rings; r += 1) {
      const t = r / rings;
      const center = branch.path.getPoint(t);
      const N = frames.normals[r];
      const B = frames.binormals[r];
      let radius = branch.radius * (1 - spec.trunk.taper * t);
      // Root flare: a trunk that meets the ground as a straight cylinder looks like a pipe.
      if (branch.level === 0) radius *= 1 + spec.trunk.flare * Math.pow(1 - t, 3);

      const dist = branch.distFromRoot + branch.length * t;
      const wind = windWeight(spec, branch.level, dist, maxDist);
      const trunkT = branch.level === 0 ? t : branch.trunkT;
      rampColor(spec.look.barkRamp, t * 0.6 + branch.level * 0.2, color);
      // Darken where the trunk meets the ground and inside the canopy — cheap contact occlusion.
      if (branch.level === 0) color.multiplyScalar(THREE.MathUtils.lerp(1 - spec.look.aoStrength * 0.5, 1, Math.min(1, t * 4)));

      const first = builder.vertexCount;
      for (let s = 0; s < radial; s += 1) {
        const a = (s / radial) * Math.PI * 2;
        normal.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
        p.copy(center).addScaledVector(normal, radius);
        builder.vertex(p, normal, s / radial, t, color, wind, trunkT);
      }
      ringStart.push(first);

      if (r > 0) {
        const prev = ringStart[r - 1];
        for (let s = 0; s < radial; s += 1) {
          const next = (s + 1) % radial;
          builder.quad(prev + s, prev + next, first + next, first + s);
        }
      }
    }

    // Cap the tip. An open tube end catches light wrong at grazing angles and shows the hollow interior.
    const tipT = 1;
    const tip = branch.path.getPoint(tipT);
    const tipDir = branch.path.getTangent(tipT).normalize();
    const tipDist = branch.distFromRoot + branch.length;
    const tipWind = windWeight(spec, branch.level, tipDist, maxDist);
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
    rampColor(spec.look.barkRamp, 0.6 + branch.level * 0.2, color);
    const apex = builder.vertex(tip, tipDir, 0.5, 1, color, tipWind, tipTrunkT);
    const last = ringStart[rings];
    for (let s = 0; s < radial; s += 1) builder.tri(last + s, last + ((s + 1) % radial), apex);
  }
}

// --- foliage ------------------------------------------------------------------------------------------

// Built once and reused for every cluster — these are baked into the accumulator, never rendered directly.
const BLOB_GEO = new THREE.IcosahedronGeometry(1, 1);
const CARD_GEO = new THREE.PlaneGeometry(1, 1);

function terminalBranches(branches: TreeBranch[]): TreeBranch[] {
  const tips = branches.filter((b) => b.children.length === 0);
  return tips.length ? tips : branches;
}

function emitFoliage(branches: TreeBranch[], spec: TreeSpec, maxDist: number, rand: () => number, builder: MeshBuilder): void {
  const f = spec.foliage;
  if (f.strategy === 'none' || f.density <= 0) return;

  const tips = terminalBranches(branches);
  // Canopy centroid/radius drive ambient occlusion: clusters deep inside the crown are darker than the
  // ones catching sky at the silhouette edge.
  const centroid = new THREE.Vector3();
  for (const b of tips) centroid.add(b.path.getPoint(1));
  centroid.divideScalar(Math.max(1, tips.length));
  let canopyRadius = 0.001;
  for (const b of tips) canopyRadius = Math.max(canopyRadius, b.path.getPoint(1).distanceTo(centroid));

  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  const shade = (position: THREE.Vector3, edgeBias = 0) => {
    const d = position.distanceTo(centroid) / canopyRadius;
    const ao = THREE.MathUtils.lerp(1 - spec.look.aoStrength, 1, THREE.MathUtils.smoothstep(d + edgeBias, 0.15, 0.9));
    rampColor(spec.look.foliageRamp, THREE.MathUtils.clamp(d, 0, 1), color);
    color.multiplyScalar(ao);
    return color;
  };

  if (f.strategy === 'skirt') {
    // Stacked cones down the trunk. The two details that sell it: a jagged lower rim (a clean cone reads
    // as a traffic cone) and the outer ring sagging under `droop`.
    const trunk = branches[0];
    const rings = f.skirtRings ?? 8;
    for (let i = 0; i < rings; i += 1) {
      const t = THREE.MathUtils.lerp(spec.branches.startHeight, 0.98, i / Math.max(1, rings - 1));
      const center = trunk.path.getPoint(t);
      const shrink = 1 - i / rings;
      const radius = spec.trunk.height * 0.22 * f.size * (0.35 + shrink * 0.75);
      const height = spec.trunk.height * 0.17 * f.size * (0.5 + shrink * 0.6);
      const cone = new THREE.ConeGeometry(radius, height, Math.max(5, 7 - Math.floor(i / 3)), 1, true);
      const pos = cone.getAttribute('position');
      const v = new THREE.Vector3();
      for (let k = 0; k < pos.count; k += 1) {
        v.fromBufferAttribute(pos, k);
        if (v.y < 0) {
          const jag = 1 + (rand() - 0.5) * 2 * (f.skirtJagged ?? 0.35);
          v.x *= jag;
          v.z *= jag;
          v.y -= height * f.droop * 0.5;
        }
        pos.setXYZ(k, v.x, v.y, v.z);
      }
      cone.computeVertexNormals();
      matrix.compose(
        center.clone().setY(center.y + height * 0.3),
        quat.setFromAxisAngle(UP, THREE.MathUtils.degToRad(37 * i)),
        scale.set(1, 1, 1),
      );
      const dist = trunk.length * t;
      builder.addGeometry(cone, matrix, shade(center, 0.35), windWeight(spec, 1, dist, maxDist), t);
      cone.dispose();
    }
    return;
  }

  for (const branch of tips) {
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;

    if (f.strategy === 'blob') {
      for (let i = 0; i < Math.round(f.density); i += 1) {
        const t = 0.55 + rand() * 0.45;
        const center = branch.path.getPoint(t);
        center.x += (rand() - 0.5) * f.size;
        center.z += (rand() - 0.5) * f.size;
        center.y += (rand() - 0.5) * f.size * 0.6 - f.droop * f.size * 0.3;
        const s = f.size * (1 + (rand() - 0.5) * 2 * f.sizeVariance);
        matrix.compose(center, quat.setFromAxisAngle(UP, rand() * Math.PI * 2), scale.set(s, s * 0.85, s));
        const dist = branch.distFromRoot + branch.length * t;
        builder.addGeometry(BLOB_GEO, matrix, shade(center), windWeight(spec, branch.level + 1, dist, maxDist), tipTrunkT);
      }
    } else if (f.strategy === 'cards') {
      for (let i = 0; i < Math.round(f.density); i += 1) {
        const t = 0.5 + rand() * 0.5;
        const anchor = branch.path.getPoint(t);
        const dist = branch.distFromRoot + branch.length * t;
        const wind = windWeight(spec, branch.level + 1, dist, maxDist);
        for (let c = 0; c < (f.cardsPerCluster ?? 6); c += 1) {
          const center = anchor.clone();
          center.x += (rand() - 0.5) * f.size * 1.5;
          center.z += (rand() - 0.5) * f.size * 1.5;
          center.y += (rand() - 0.5) * f.size - f.droop * f.size * 0.5;
          const s = f.size * (1 + (rand() - 0.5) * 2 * f.sizeVariance);
          quat.setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI));
          matrix.compose(center, quat, scale.set(s, s, s));
          const outward = center.clone().sub(centroid);
          outward.setLength(1);
          if (!Number.isFinite(outward.x)) outward.copy(UP);
          builder.addGeometry(CARD_GEO, matrix, shade(center), wind, tipTrunkT, outward);
        }
      }
    } else if (f.strategy === 'fronds') {
      // Palm: long planes radiating from the crown, bent along their length.
      const crown = branch.path.getPoint(1);
      const count = f.frondCount ?? 9;
      for (let i = 0; i < count; i += 1) {
        const yaw = (i / count) * Math.PI * 2 + rand() * 0.3;
        const geo = buildFrond(f.size, f.droop, rand);
        matrix.compose(crown, quat.setFromAxisAngle(UP, yaw), scale.set(1, 1, 1));
        builder.addGeometry(geo, matrix, shade(crown), windWeight(spec, 1, branch.distFromRoot + branch.length, maxDist), tipTrunkT);
        geo.dispose();
      }
      break; // one crown only — palms have no branch tips to iterate
    } else if (f.strategy === 'strands') {
      for (let i = 0; i < Math.round(f.density); i += 1) {
        const t = 0.4 + rand() * 0.6;
        const anchor = branch.path.getPoint(t);
        anchor.x += (rand() - 0.5) * 0.6;
        anchor.z += (rand() - 0.5) * 0.6;
        const dist = branch.distFromRoot + branch.length * t;
        emitStrand(builder, spec, anchor, f.strandLength ?? 3.2, shade(anchor), windWeight(spec, branch.level + 1, dist, maxDist), tipTrunkT, rand);
      }
    }
  }
}

/** A palm frond: a tapered plane bent downward along its length, with a serrated silhouette in geometry. */
function buildFrond(size: number, droop: number, rand: () => number): THREE.BufferGeometry {
  const segments = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const x = t * size;
    const y = -droop * size * t * t;
    const halfW = size * 0.16 * (1 - t * 0.8) * (1 + (rand() - 0.5) * 0.3);
    positions.push(x, y, -halfW, x, y, halfW);
    uvs.push(t, 0, t, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** A willow strand: a narrow ribbon hanging and curving under gravity, whipping hard at the free end. */
function emitStrand(
  builder: MeshBuilder,
  spec: TreeSpec,
  anchor: THREE.Vector3,
  length: number,
  color: THREE.Color,
  baseWind: number,
  trunkT: number,
  rand: () => number,
): void {
  const segments = 7;
  const width = 0.09 * spec.foliage.size;
  const drift = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(length * 0.3);
  const normal = new THREE.Vector3(0, 0, 1);
  const p = new THREE.Vector3();
  let prev = -1;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    p.copy(anchor).addScaledVector(drift, t * t).setY(anchor.y - length * t);
    // The free end sways far more than the attachment — that trailing whip is the whole willow read.
    const wind = baseWind + t * t * 2.2;
    const a = builder.vertex(p.clone().setX(p.x - width), normal, 0, t, color, wind, trunkT);
    const b = builder.vertex(p.clone().setX(p.x + width), normal, 1, t, color, wind, trunkT);
    if (prev >= 0) builder.quad(prev, prev + 1, b, a);
    prev = a;
  }
}

// --- entry point --------------------------------------------------------------------------------------

export interface GenerateTreeOptions {
  /** LOD level. 1 and 2 re-run the SAME seed with reduced params, so the silhouette stays put and the pop is small. */
  lod?: number;
}

export function generateTree(spec: TreeSpec, seed: number, options: GenerateTreeOptions = {}): GeneratedTree {
  const lod = options.lod ?? 0;
  const effective = lod === 0 ? spec : reduceForLod(spec, lod);
  const rand = treeRng(seed);

  const branches = buildSkeleton(effective, rand);
  let maxDist = 0;
  for (const b of branches) maxDist = Math.max(maxDist, b.distFromRoot + b.length);

  const barkBuilder = new MeshBuilder();
  sweepBark(branches, effective, maxDist, barkBuilder);
  const foliageBuilder = new MeshBuilder();
  emitFoliage(branches, effective, maxDist, rand, foliageBuilder);

  const bark = barkBuilder.toGeometry();
  const foliage = foliageBuilder.vertexCount > 0 ? foliageBuilder.toGeometry() : null;

  const bounds = bark.boundingBox?.clone() ?? new THREE.Box3();
  if (foliage?.boundingBox) bounds.union(foliage.boundingBox);

  return {
    bark,
    foliage,
    bounds,
    triangles: (barkBuilder.indices.length + foliageBuilder.indices.length) / 3,
    trunkHeight: effective.trunk.height,
  };
}

/** LOD is the generator re-run with cheaper params — not a decimator. Same seed keeps the silhouette. */
function reduceForLod(spec: TreeSpec, lod: number): TreeSpec {
  if (lod >= 2) {
    return {
      ...spec,
      trunk: { ...spec.trunk, radialSegments: Math.max(3, Math.round(spec.trunk.radialSegments / 2)), heightSegments: 4 },
      branches: { ...spec.branches, levels: 0, countPerLevel: [] },
      // A single merged blob stands in for the whole canopy at distance.
      foliage: { ...spec.foliage, strategy: spec.foliage.strategy === 'none' ? 'none' : 'blob', density: 1, size: spec.foliage.size * 2.6, sizeVariance: 0 },
    };
  }
  return {
    ...spec,
    trunk: { ...spec.trunk, radialSegments: Math.max(3, Math.round(spec.trunk.radialSegments / 2)) },
    branches: { ...spec.branches, levels: Math.min(spec.branches.levels, 1), countPerLevel: spec.branches.countPerLevel.slice(0, 1) },
    foliage: { ...spec.foliage, density: Math.max(1, spec.foliage.density * 0.4) },
  };
}
