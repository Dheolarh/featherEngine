#!/usr/bin/env node
/**
 * Builds the bundled asset-store catalog: a set of `.nfpack` packages plus the `catalog.json`
 * index that the Asset Store panel reads.
 *
 * The packages here are authored the same way an outside publisher would author them — plain JSON,
 * no engine imports — so this script doubles as the reference for what an upload must look like.
 * Output is byte-stable (fixed ids and timestamps) so rebuilding doesn't churn git.
 *
 * Run: node scripts/build-store-catalog.mjs
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'store');
const PACKAGES_DIR = join(OUT_DIR, 'packages');

const PACKAGE_FORMAT = 'nodeforge-package';
const PACKAGE_VERSION = '1.0.0';
const ENGINE_VERSION = '0.7.0'; // PROJECT_VERSION in src/types/project.ts
const CATALOG_FORMAT = 'feather-store-catalog';
/** Fixed so regenerating the catalog produces identical bytes. */
const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');
const ISO = new Date(EPOCH).toISOString();

// ------------------------------------------------------------------------------------------------
// Authoring helpers — the minimum valid shape of each entity (see src/types/).
// ------------------------------------------------------------------------------------------------

const transform = (position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => ({
  position,
  rotation,
  scale,
});

const renderer = (mesh, { color = '#5B8CFF', materialId, metalness = 0.1, roughness = 0.65 } = {}) => ({
  enabled: true,
  mesh,
  color,
  metalness,
  roughness,
  ...(materialId ? { materialId } : {}),
});

/** A scene object inside a prefab. Ids are prefab-local; every install re-ids them. */
const object = (id, name, kind, opts = {}) => ({
  id,
  name,
  kind,
  transform: transform(opts.position, opts.rotation, opts.scale),
  ...(kind === 'empty' ? {} : { renderer: renderer(kind, opts) }),
  ...(opts.parentId ? { parentId: opts.parentId } : {}),
  ...(opts.physics ? { physics: physics(opts.physics) } : {}),
});

const physics = ({ bodyType = 'dynamic', collider = 'box', mass = 1 } = {}) => ({
  enabled: true,
  bodyType,
  collider,
  materialPreset: 'default',
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass,
  gravityScale: 1,
  friction: 0.6,
  restitution: 0.05,
  linearDamping: 0,
  angularDamping: 0.05,
  windInfluence: 0,
});

const material = (id, name, props) => ({
  id,
  name,
  description: 'Reusable material asset.',
  color: '#5B8CFF',
  metalness: 0.1,
  roughness: 0.65,
  emissiveColor: '#000000',
  emissiveIntensity: 0,
  createdAt: EPOCH,
  ...props,
});

const prefab = (id, name, objects) => ({
  id,
  name,
  objects,
  rootId: objects[0].id,
  createdAt: EPOCH,
});

/** A flat-gradient SVG card used as the store thumbnail — keeps the catalog binary-free. */
const thumbnail = (from, to, glyph) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="128" height="128" rx="16" fill="url(#g)"/>` +
    `<text x="64" y="82" font-family="system-ui,sans-serif" font-size="56" font-weight="700" ` +
    `text-anchor="middle" fill="#ffffff" fill-opacity="0.92">${glyph}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
};

/**
 * Reference a file served by the app as an EXTERNAL package asset: the `.nfpack` carries only the
 * hash and URL, and the installer downloads + verifies the bytes. This is how a package stays a
 * small manifest instead of ballooning into base64 — a 22 MB model would become ~29 MB of JSON.
 */
async function externalAsset(id, publicPath, type) {
  const absolute = join(ROOT, 'public', publicPath);
  const bytes = await readFile(absolute);
  const { size } = await stat(absolute);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    id,
    name: publicPath.split('/').pop(),
    type,
    size,
    hash: sha256,
    createdAt: EPOCH,
    source: { url: publicPath, sha256, bytes: size },
  };
}

/** Wrap authored content in the NodeForgePackage envelope (mirrors buildPackage in package.ts). */
const buildPackage = (meta, content, assets = [], kind = 'module') => ({
  format: PACKAGE_FORMAT,
  formatVersion: PACKAGE_VERSION,
  kind,
  meta: { ...meta, createdAt: ISO, engineVersion: ENGINE_VERSION },
  content: {
    prefabs: [],
    blueprints: [],
    graphs: [],
    materials: [],
    particleSystems: [],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    dataAssets: [],
    uiDocuments: [],
    variables: [],
    ...content,
  },
  assets,
});

// ------------------------------------------------------------------------------------------------
// The seed catalogue. Primitives only — every pack is a few KB and works fully offline.
// ------------------------------------------------------------------------------------------------

const woodMat = material('mat-store-wood', 'Crate Wood', { color: '#A9743B', roughness: 0.85, metalness: 0 });
const metalMat = material('mat-store-metal', 'Banded Metal', { color: '#8C8F96', roughness: 0.35, metalness: 0.9 });
const stoneMat = material('mat-store-stone', 'Quarry Stone', { color: '#8A8A85', roughness: 0.95, metalness: 0 });

const neonPink = material('mat-store-neon-pink', 'Neon Pink', {
  color: '#FF3D8B',
  emissiveColor: '#FF3D8B',
  emissiveIntensity: 3.4,
  roughness: 0.3,
});
const neonCyan = material('mat-store-neon-cyan', 'Neon Cyan', {
  color: '#3DE8FF',
  emissiveColor: '#3DE8FF',
  emissiveIntensity: 3.4,
  roughness: 0.3,
});
const darkMetal = material('mat-store-dark-metal', 'Gantry Steel', {
  color: '#23262E',
  roughness: 0.45,
  metalness: 0.8,
});

const PACKS = [
  {
    slug: 'starter-props',
    meta: {
      id: 'pkg-feather-starter-props',
      name: 'Starter Props',
      description:
        'Crates, a barrel and a stone block to dress a level with. Physics is switched on, so they tumble the moment you press Play.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['props', 'environment', 'physics'],
      thumbnail: thumbnail('#B4762F', '#6E4318', '\u{1F4E6}'),
    },
    content: {
      materials: [woodMat, metalMat, stoneMat],
      prefabs: [
        prefab('prefab-store-crate', 'Wooden Crate', [
          object('obj-crate', 'Wooden Crate', 'cube', {
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
        ]),
        prefab('prefab-store-barrel', 'Metal Barrel', [
          object('obj-barrel', 'Metal Barrel', 'capsule', {
            materialId: metalMat.id,
            color: metalMat.color,
            scale: [0.8, 0.7, 0.8],
            physics: { collider: 'capsule', mass: 22 },
          }),
        ]),
        prefab('prefab-store-crate-stack', 'Crate Stack', [
          object('obj-stack-root', 'Crate Stack', 'empty'),
          object('obj-stack-a', 'Crate A', 'cube', {
            parentId: 'obj-stack-root',
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-stack-b', 'Crate B', 'cube', {
            parentId: 'obj-stack-root',
            position: [0.12, 1.02, -0.08],
            rotation: [0, 0.35, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-stack-c', 'Capstone', 'cube', {
            parentId: 'obj-stack-root',
            position: [-0.05, 2.04, 0.05],
            rotation: [0, -0.2, 0],
            scale: [0.85, 0.85, 0.85],
            materialId: stoneMat.id,
            color: stoneMat.color,
            physics: { collider: 'box', mass: 30 },
          }),
        ]),
      ],
    },
  },
  {
    slug: 'neon-signage',
    meta: {
      id: 'pkg-feather-neon-signage',
      name: 'Neon Signage Kit',
      description:
        'Emissive pillars and a hanging sign for night-time city scenes. Drops straight into a scene with bloom enabled.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['props', 'lighting', 'cyberpunk'],
      thumbnail: thumbnail('#FF3D8B', '#3DE8FF', '\u{1F3AE}'),
    },
    content: {
      materials: [neonPink, neonCyan, darkMetal],
      prefabs: [
        prefab('prefab-store-neon-pillar', 'Neon Pillar', [
          object('obj-pillar-root', 'Neon Pillar', 'empty'),
          object('obj-pillar-post', 'Post', 'cube', {
            parentId: 'obj-pillar-root',
            position: [0, 1.6, 0],
            scale: [0.18, 3.2, 0.18],
            materialId: darkMetal.id,
            color: darkMetal.color,
          }),
          object('obj-pillar-tube', 'Neon Tube', 'cube', {
            parentId: 'obj-pillar-root',
            position: [0, 1.8, 0.12],
            scale: [0.06, 2.4, 0.06],
            materialId: neonPink.id,
            color: neonPink.color,
          }),
        ]),
        prefab('prefab-store-neon-sign', 'Hanging Sign', [
          object('obj-sign-root', 'Hanging Sign', 'empty'),
          object('obj-sign-bracket', 'Bracket', 'cube', {
            parentId: 'obj-sign-root',
            position: [0, 2.6, 0],
            scale: [1.4, 0.08, 0.08],
            materialId: darkMetal.id,
            color: darkMetal.color,
          }),
          object('obj-sign-panel', 'Panel', 'plane', {
            parentId: 'obj-sign-root',
            position: [0.5, 1.9, 0],
            rotation: [0, 0, 0],
            scale: [1.6, 1, 1],
            materialId: neonCyan.id,
            color: neonCyan.color,
          }),
        ]),
      ],
    },
  },
  {
    slug: 'physics-playground',
    meta: {
      id: 'pkg-feather-physics-playground',
      name: 'Physics Playground',
      description:
        'A ramp, a launch platform and a heavy ball — a ready-made rig for testing collisions, mass and restitution.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['physics', 'prototyping', 'kit'],
      thumbnail: thumbnail('#3D7BFF', '#153A8A', '\u{26BD}'),
    },
    content: {
      materials: [stoneMat],
      prefabs: [
        prefab('prefab-store-ramp', 'Test Ramp', [
          object('obj-ramp', 'Test Ramp', 'cube', {
            rotation: [0, 0, -0.32],
            scale: [6, 0.25, 2.4],
            materialId: stoneMat.id,
            color: stoneMat.color,
            physics: { bodyType: 'fixed', collider: 'box' },
          }),
        ]),
        prefab('prefab-store-platform', 'Launch Platform', [
          object('obj-platform', 'Launch Platform', 'cube', {
            scale: [3, 0.4, 3],
            materialId: stoneMat.id,
            color: stoneMat.color,
            physics: { bodyType: 'fixed', collider: 'box' },
          }),
        ]),
        prefab('prefab-store-ball', 'Heavy Ball', [
          object('obj-ball', 'Heavy Ball', 'sphere', {
            color: '#D8452F',
            physics: { collider: 'sphere', mass: 40 },
          }),
        ]),
      ],
    },
  },
];

/**
 * A pack whose model bytes live OUTSIDE the package. Built async because it hashes the real file.
 * The prefab references the asset by id exactly as an inlined one would — the only difference is
 * where the bytes come from at install time.
 */
async function buildWeaponPack() {
  const sword = await externalAsset('asset-store-sword', 'templates/Sword.glb', 'model');
  return {
    slug: 'blade-prop',
    meta: {
      id: 'pkg-feather-blade-prop',
      name: 'Blade Prop',
      description:
        'A sword model you can place, parent to a character, or attach to a weapon socket. The mesh downloads separately, so the package itself stays tiny.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['props', 'weapons', 'model'],
      thumbnail: thumbnail('#6E7A8F', '#2B3140', '\u{1F5E1}'),
    },
    assets: [sword],
    content: {
      prefabs: [
        prefab('prefab-store-sword', 'Sword', [
          {
            id: 'obj-sword',
            name: 'Sword',
            kind: 'cube',
            transform: transform(),
            renderer: { ...renderer('cube'), modelAssetId: sword.id },
          },
        ]),
      ],
    },
  };
}

/**
 * A `kind: 'project'` package — a whole world, not a component. Installing one creates a NEW project
 * and its scenes replace the blank starter, which is how templates ship through the store.
 */
const SANDBOX_TEMPLATE = {
  slug: 'sandbox-world',
  kind: 'project',
  meta: {
    id: 'pkg-feather-sandbox-world',
    name: 'Sandbox World',
    description:
      'A ready-to-play starter world: a ground plane, a stack of physics crates and a lit sky. Creates a new project you can build on.',
    author: 'Feather',
    version: '1.0.0',
    tags: ['template', 'world', 'physics'],
    thumbnail: thumbnail('#4C9F5A', '#1E5230', '\u{1F3DE}'),
  },
  content: {
    materials: [woodMat, stoneMat],
    scenes: [
      {
        id: 'scene-sandbox',
        name: 'Sandbox',
        objects: [
          object('obj-ground', 'Ground', 'plane', {
            scale: [40, 1, 40],
            materialId: stoneMat.id,
            color: '#6F7A6A',
            physics: { bodyType: 'fixed', collider: 'box' },
          }),
          object('obj-sun', 'Sun', 'empty', { position: [8, 12, 6] }),
          object('obj-crate-1', 'Crate', 'cube', {
            position: [0, 1, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-crate-2', 'Crate', 'cube', {
            position: [0.2, 2.05, -0.1],
            rotation: [0, 0.3, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-crate-3', 'Crate', 'cube', {
            position: [1.6, 1, 0.8],
            rotation: [0, -0.4, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------------------------------------

async function main() {
  await mkdir(PACKAGES_DIR, { recursive: true });

  const packs = [...PACKS, await buildWeaponPack(), SANDBOX_TEMPLATE];
  const entries = [];
  for (const pack of packs) {
    const pkg = buildPackage(pack.meta, pack.content, pack.assets ?? [], pack.kind ?? 'module');
    const json = `${JSON.stringify(pkg, null, 2)}\n`;
    const file = `${pack.slug}.nfpack`;
    await writeFile(join(PACKAGES_DIR, file), json, 'utf8');

    entries.push({
      id: pack.meta.id,
      slug: pack.slug,
      title: pack.meta.name,
      description: pack.meta.description,
      author: pack.meta.author,
      version: pack.meta.version,
      kind: pack.kind ?? 'module',
      tags: pack.meta.tags,
      license: 'CC0-1.0',
      priceCents: 0,
      thumbnail: pack.meta.thumbnail,
      // Total install footprint: the manifest plus any bytes fetched separately — otherwise a
      // manifest-only package would advertise a few KB while actually pulling down megabytes.
      sizeBytes:
        Buffer.byteLength(json, 'utf8') +
        pkg.assets.reduce((sum, asset) => sum + (asset.source?.bytes ?? 0), 0),
      downloadUrl: `packages/${file}`,
      engineVersion: ENGINE_VERSION,
      contents: {
        prefabs: pkg.content.prefabs.length,
        materials: pkg.content.materials.length,
        blueprints: pkg.content.blueprints.length,
        assets: pkg.assets.length,
        scenes: pkg.content.scenes?.length ?? 0,
      },
    });
    console.log(`  ${file} — ${(Buffer.byteLength(json, 'utf8') / 1024).toFixed(1)} KB`);
  }

  const catalog = {
    format: CATALOG_FORMAT,
    formatVersion: '1.0.0',
    updatedAt: ISO,
    packages: entries,
  };
  await writeFile(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${entries.length} packages + catalog.json to public/store/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
