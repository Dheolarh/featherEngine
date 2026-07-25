import type { TreeArchetype, TreeBreakPoint, TreeSpec } from '../types';

/**
 * Deterministic PRNG (mulberry32) — small, fast, well-distributed.
 *
 * The generator must NEVER call Math.random(). A single leak and the same seed stops producing the same
 * tree, which silently breaks save games, replays and multiplayer peers that all assume spec+seed is
 * enough to rebuild the exact mesh.
 */
export function treeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampInt = (value: number, min: number, max: number) =>
  Math.trunc(clamp(Number.isFinite(value) ? value : min, min, max));

/** The neutral tree every archetype is a partial override of. */
export function baseTreeSpec(): TreeSpec {
  return {
    id: 'tree',
    name: 'Tree',
    archetype: 'broadleaf',
    trunk: {
      height: 7,
      baseRadius: 0.4,
      taper: 0.78,
      lean: 0,
      curl: 0.2,
      heightSegments: 7,
      radialSegments: 7,
      flare: 0.25,
    },
    branches: {
      levels: 2,
      countPerLevel: [5, 3],
      startHeight: 0.4,
      endHeight: 0.92,
      angle: 45,
      angleVariance: 14,
      lengthRatio: 0.6,
      radiusRatio: 0.55,
      gravity: 0.15,
      twist: 137.5,
      curlPerLevel: 0.8,
    },
    foliage: {
      strategy: 'blob',
      density: 3,
      size: 1.2,
      sizeVariance: 0.4,
      droop: 0.3,
      skirtRings: 8,
      skirtJagged: 0.35,
      cardsPerCluster: 6,
      strandLength: 3.2,
      frondCount: 9,
    },
    look: {
      barkRamp: ['#5a4130', '#7b5c40'],
      foliageRamp: ['#3f6b32', '#8fbe4a'],
      translucency: { color: '#9ed070', scale: 0.55, power: 2.4 },
      aoStrength: 0.45,
    },
    wind: {
      stiffnessCurve: 1.6,
      trunkStiffness: 0.85,
      levelMultiplier: [1, 1.5, 2.2, 2.8],
    },
    lod: { levels: 2, distances: [25, 60], billboardDistance: 0 },
    chop: {
      enabled: true,
      // Felling cut near the base, then one more so a downed trunk can be bucked into a log.
      breakPoints: [
        { height: 0.07, hits: 3, label: 'fell' },
        { height: 0.5, hits: 2, label: 'log' },
      ],
      tolerance: 0.9,
      topplePush: 3.5,
      logLifetime: 0,
    },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Partial overrides on {@link baseTreeSpec}. Values here are the ones that actually define the silhouette. */
export const TREE_ARCHETYPES: Record<TreeArchetype, DeepPartial<TreeSpec>> = {
  conifer: {
    trunk: { height: 12, baseRadius: 0.34, taper: 0.88, curl: 0.05, radialSegments: 6 },
    branches: { levels: 1, countPerLevel: [11], startHeight: 0.12, angle: 72, gravity: -0.45, lengthRatio: 0.32 },
    foliage: { strategy: 'skirt', skirtRings: 8, skirtJagged: 0.35, droop: 0.55, density: 1, size: 1 },
    look: { foliageRamp: ['#22402a', '#4f8544'] },
  },
  broadleaf: {
    trunk: { height: 7, baseRadius: 0.5, taper: 0.72, curl: 0.25, flare: 0.4 },
    branches: { levels: 3, countPerLevel: [4, 3, 3], startHeight: 0.45, angle: 42, angleVariance: 18, gravity: 0.25, lengthRatio: 0.62 },
    foliage: { strategy: 'blob', density: 2, size: 1.55, sizeVariance: 0.45 },
  },
  birch: {
    trunk: { height: 11, baseRadius: 0.16, taper: 0.9, lean: 5, curl: 0.35 },
    branches: { levels: 2, countPerLevel: [5, 3], startHeight: 0.55, angle: 55, gravity: -0.15, lengthRatio: 0.5 },
    foliage: { strategy: 'cards', cardsPerCluster: 6, density: 4, size: 0.55, droop: 0.4 },
    look: { barkRamp: ['#d8d2c4', '#f0ece1'], foliageRamp: ['#5b8a35', '#a8cc55'] },
  },
  willow: {
    trunk: { height: 5.5, baseRadius: 0.6, taper: 0.65, curl: 0.4, flare: 0.5 },
    branches: { levels: 2, countPerLevel: [6, 4], startHeight: 0.3, angle: 35, gravity: 0.5, lengthRatio: 0.7 },
    foliage: { strategy: 'strands', strandLength: 3.2, density: 8, droop: 1 },
    look: { foliageRamp: ['#4a6b3a', '#9db95e'] },
  },
  palm: {
    trunk: { height: 9, baseRadius: 0.28, taper: 0.95, curl: 0.5, lean: 12 },
    branches: { levels: 0, countPerLevel: [] },
    foliage: { strategy: 'fronds', frondCount: 9, size: 3, droop: 0.7 },
    look: { barkRamp: ['#6b5636', '#8f7748'] },
  },
  shrub: {
    // The stems must be LONGER than the stubby trunk or every branch collapses into one lump at the base —
    // a bush is mostly splay, not trunk.
    trunk: { height: 0.9, baseRadius: 0.07, taper: 0.85, flare: 0.1 },
    branches: { levels: 2, countPerLevel: [6, 3], startHeight: 0, endHeight: 1, angle: 58, angleVariance: 22, gravity: 0.05, lengthRatio: 0.8 },
    foliage: { strategy: 'blob', density: 2, size: 0.5, sizeVariance: 0.5, droop: 0.1 },
    // A shrub has nothing to fell — one snap near the ground and it is gone.
    chop: { breakPoints: [{ height: 0.2, hits: 1, label: 'snap' }], topplePush: 1.2 },
  },
  snag: {
    trunk: { height: 8, baseRadius: 0.4, taper: 0.6, curl: 0.6, lean: 14 },
    branches: { levels: 2, countPerLevel: [5, 3], startHeight: 0.3, angle: 65, angleVariance: 35, gravity: -0.2, lengthRatio: 0.45 },
    foliage: { strategy: 'none' },
    look: { barkRamp: ['#4b4038', '#6d6055'] },
  },
};

/** Build a full spec for an archetype, applying its overrides over the neutral base. */
export function treeSpecFromArchetype(archetype: TreeArchetype, id: string, name?: string): TreeSpec {
  const base = baseTreeSpec();
  const merged = mergeSpec(base, TREE_ARCHETYPES[archetype] ?? {});
  return normalizeTreeSpec({ ...merged, id, name: name ?? capitalize(archetype), archetype });
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Recursive merge that treats ARRAYS as leaves — countPerLevel must be replaced, never element-merged. */
function mergeSpec<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as T;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const current = out[key];
    if (Array.isArray(value) || Array.isArray(current) || typeof value !== 'object' || value === null || current === null || typeof current !== 'object') {
      out[key] = value as T[keyof T];
    } else {
      out[key] = mergeSpec(current, value as DeepPartial<T[keyof T]>);
    }
  }
  return out;
}

function normalizeBreakPoints(points: TreeBreakPoint[] | undefined, fallback: TreeBreakPoint[]): TreeBreakPoint[] {
  const source = points?.length ? points : fallback;
  return source
    .map((point) => ({
      height: clamp(Number.isFinite(point.height) ? point.height : 0.1, 0.01, 0.98),
      hits: clampInt(point.hits ?? 1, 1, 20),
      label: point.label,
    }))
    // The chop resolver walks these in order to find the lowest intact cut, so they must stay sorted.
    .sort((a, b) => a.height - b.height)
    .slice(0, 8);
}

/** Clamp every field into a range the generator can actually build, and fill in anything missing. */
export function normalizeTreeSpec(spec: Partial<TreeSpec> & { id: string }): TreeSpec {
  const base = baseTreeSpec();
  const merged = mergeSpec(base, spec as DeepPartial<TreeSpec>);
  const levels = clampInt(merged.branches.levels, 0, 3);
  return {
    ...merged,
    id: spec.id,
    name: merged.name || 'Tree',
    trunk: {
      ...merged.trunk,
      height: clamp(merged.trunk.height, 0.2, 30),
      baseRadius: clamp(merged.trunk.baseRadius, 0.02, 4),
      taper: clamp(merged.trunk.taper, 0.05, 1),
      lean: clamp(merged.trunk.lean, -45, 45),
      curl: clamp(merged.trunk.curl, 0, 1),
      heightSegments: clampInt(merged.trunk.heightSegments, 3, 16),
      radialSegments: clampInt(merged.trunk.radialSegments, 3, 12),
      flare: clamp(merged.trunk.flare, 0, 1),
    },
    branches: {
      ...merged.branches,
      levels,
      // One entry per level, so the skeleton never reads past the end of the array.
      countPerLevel: Array.from({ length: levels }, (_, i) => clampInt(merged.branches.countPerLevel[i] ?? 3, 0, 24)),
      startHeight: clamp(merged.branches.startHeight, 0, 0.95),
      endHeight: clamp(Math.max(merged.branches.endHeight, merged.branches.startHeight + 0.02), 0.05, 1),
      angle: clamp(merged.branches.angle, 0, 120),
      angleVariance: clamp(merged.branches.angleVariance, 0, 60),
      lengthRatio: clamp(merged.branches.lengthRatio, 0.1, 0.95),
      radiusRatio: clamp(merged.branches.radiusRatio, 0.1, 0.95),
      gravity: clamp(merged.branches.gravity, -1, 1),
      twist: clamp(merged.branches.twist, 0, 360),
      curlPerLevel: clamp(merged.branches.curlPerLevel, 0, 2),
    },
    foliage: {
      ...merged.foliage,
      density: clamp(merged.foliage.density, 0, 12),
      size: clamp(merged.foliage.size, 0.05, 8),
      sizeVariance: clamp(merged.foliage.sizeVariance, 0, 1),
      droop: clamp(merged.foliage.droop, 0, 1),
      skirtRings: clampInt(merged.foliage.skirtRings ?? 8, 2, 16),
      skirtJagged: clamp(merged.foliage.skirtJagged ?? 0.35, 0, 1),
      cardsPerCluster: clampInt(merged.foliage.cardsPerCluster ?? 6, 1, 12),
      strandLength: clamp(merged.foliage.strandLength ?? 3.2, 0.2, 12),
      frondCount: clampInt(merged.foliage.frondCount ?? 9, 3, 20),
    },
    look: {
      ...merged.look,
      barkRamp: merged.look.barkRamp?.length ? merged.look.barkRamp.slice(0, 4) : base.look.barkRamp,
      foliageRamp: merged.look.foliageRamp?.length ? merged.look.foliageRamp.slice(0, 4) : base.look.foliageRamp,
      aoStrength: clamp(merged.look.aoStrength, 0, 1),
    },
    wind: {
      ...merged.wind,
      stiffnessCurve: clamp(merged.wind.stiffnessCurve, 0.2, 5),
      trunkStiffness: clamp(merged.wind.trunkStiffness, 0, 1),
      levelMultiplier: Array.from({ length: 4 }, (_, i) => clamp(merged.wind.levelMultiplier[i] ?? 1, 0, 6)),
    },
    lod: {
      ...merged.lod,
      levels: clampInt(merged.lod.levels, 1, 3),
      distances: merged.lod.distances?.length ? merged.lod.distances : base.lod.distances,
      billboardDistance: clamp(merged.lod.billboardDistance, 0, 4000),
    },
    chop: {
      ...merged.chop,
      enabled: merged.chop.enabled ?? true,
      breakPoints: normalizeBreakPoints(merged.chop.breakPoints, base.chop.breakPoints),
      tolerance: clamp(merged.chop.tolerance, 0.1, 8),
      topplePush: clamp(merged.chop.topplePush, 0, 40),
      logLifetime: clamp(merged.chop.logLifetime, 0, 600),
    },
  };
}

/**
 * Stable ids for the trees every new project ships with. The terrain foliage scatter and the meadow
 * template reference these by id, so "grow a forest of pines" works out of the box with nothing authored —
 * and because they are ordinary library entries, editing one in the Tree Builder restyles every instance
 * AND every scattered tree at once.
 */
export const DEFAULT_TREE_IDS = {
  oak: 'tree-oak',
  pine: 'tree-pine',
  birch: 'tree-birch',
  willow: 'tree-willow',
  palm: 'tree-palm',
  bush: 'tree-bush',
  deadwood: 'tree-deadwood',
} as const;

/** The starter tree library stamped into every new project. */
export function defaultTreeLibrary(): TreeSpec[] {
  return [
    treeSpecFromArchetype('broadleaf', DEFAULT_TREE_IDS.oak, 'Oak'),
    treeSpecFromArchetype('conifer', DEFAULT_TREE_IDS.pine, 'Pine'),
    treeSpecFromArchetype('birch', DEFAULT_TREE_IDS.birch, 'Birch'),
    treeSpecFromArchetype('willow', DEFAULT_TREE_IDS.willow, 'Willow'),
    treeSpecFromArchetype('palm', DEFAULT_TREE_IDS.palm, 'Palm'),
    treeSpecFromArchetype('shrub', DEFAULT_TREE_IDS.bush, 'Bush'),
    treeSpecFromArchetype('snag', DEFAULT_TREE_IDS.deadwood, 'Dead Tree'),
  ];
}

/**
 * Resolve the spec a tree object should render with: the shared library entry when it references one,
 * otherwise its own inline spec. Keeps "edit the asset, every instance updates" working while still
 * allowing a one-off tree that belongs to no library.
 */
export function resolveTreeSpec(component: { specId?: string; spec: TreeSpec }, library: TreeSpec[]): TreeSpec {
  if (component.specId) {
    const found = library.find((entry) => entry.id === component.specId);
    if (found) return found;
  }
  return component.spec;
}
