import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeForgePackage } from '../../project/package';
import type { SceneObject } from '../../types';
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';
import { useMarketplaceStore } from '../marketplaceStore';

/**
 * End-to-end coverage for the bundled store: load the REAL catalog and install the REAL `.nfpack`
 * files from `public/store/`, through the real install pipeline.
 *
 * This is deliberately not a mock of the seed content — it is the seed content. If
 * `scripts/build-store-catalog.mjs` ever emits something the engine can't import, this fails.
 */

const PUBLIC_STORE = join(process.cwd(), 'public', 'store');

/** Serve `public/store/**` off disk, routed by URL path, so no network is involved. */
function serveBundledStore() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const path = new URL(String(input), document.baseURI).pathname;
      const relative = path.slice(path.indexOf('/store/') + '/store/'.length);
      try {
        const body = await readFile(join(PUBLIC_STORE, relative), 'utf8');
        return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(body) };
      } catch {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
      }
    }),
  );
}

const resetMarketplace = () =>
  useMarketplaceStore.setState({
    status: 'idle',
    error: null,
    packages: [],
    query: '',
    tag: null,
    installingId: null,
    installedIds: [],
  });

describe('bundled asset store — catalog to installed content', () => {
  beforeEach(() => {
    useProjectStore.getState().useDemo();
    useProjectStore.setState({ toast: null, error: null });
    resetMarketplace();
    serveBundledStore();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads the shipped catalog', async () => {
    await useMarketplaceStore.getState().load();
    const state = useMarketplaceStore.getState();
    expect(state.status).toBe('ready');
    expect(state.packages.length).toBeGreaterThan(0);
    // Every listing must be installable: a resolvable URL and something actually in it.
    for (const listing of state.packages) {
      expect(listing.downloadUrl).toMatch(/^https?:/);
      expect(listing.title.length).toBeGreaterThan(0);
      // Something must actually arrive on install. A template's content lives in its scenes, a
      // module's in prefabs/materials — so count them all rather than assuming a shape.
      const { scenes, prefabs, materials, blueprints } = listing.contents;
      expect(scenes + prefabs + materials + blueprints, `${listing.slug} installs nothing`).toBeGreaterThan(0);
    }
  });

  it('installs every shipped module package into a real project', async () => {
    await useMarketplaceStore.getState().load();
    // Templates are excluded on purpose: a kind:project package REPLACES the world, so mixing it in
    // here would wipe the very prefabs this test is counting.
    const listings = useMarketplaceStore.getState().packages.filter((entry) => entry.kind === 'module');
    expect(listings.length).toBeGreaterThan(0);

    const prefabsBefore = useEditorStore.getState().prefabs.length;
    const materialsBefore = useEditorStore.getState().materials.length;
    let expectedPrefabs = 0;
    let expectedMaterials = 0;

    for (const listing of listings) {
      await useMarketplaceStore.getState().install(listing);
      expectedPrefabs += listing.contents.prefabs;
      expectedMaterials += listing.contents.materials;
    }

    const editor = useEditorStore.getState();
    // The catalog's advertised counts must match what actually landed, or the store lies to users.
    expect(editor.prefabs).toHaveLength(prefabsBefore + expectedPrefabs);
    expect(editor.materials).toHaveLength(materialsBefore + expectedMaterials);
    expect(useMarketplaceStore.getState().installedIds).toEqual(listings.map((entry) => entry.id));
    expect(useMarketplaceStore.getState().installingId).toBeNull();
  });

  it('creates a new project with its own world from a shipped template', async () => {
    await useMarketplaceStore.getState().load();
    const template = useMarketplaceStore.getState().packages.find((entry) => entry.kind === 'project');
    expect(template).toBeDefined();

    await useMarketplaceStore.getState().install(template!);

    const editor = useEditorStore.getState();
    expect(useProjectStore.getState().projectName).toBe(template!.title);
    // The template's scenes ARE the project now, not extras appended to a blank one.
    expect(editor.scenes).toHaveLength(template!.contents.scenes);
    expect(editor.activeSceneId).toBe(editor.scenes[0].id);
    expect(editor.scenes[0].objects.length).toBeGreaterThan(0);
    // Materials the scene objects reference came along and resolve.
    const materialIds = new Set(editor.materials.map((material) => material.id));
    const referenced = editor.scenes[0].objects
      .map((object) => object.renderer?.materialId)
      .filter((id): id is string => !!id);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(materialIds.has(id)).toBe(true);
  });

  it('keeps every material reference inside an installed prefab resolvable', async () => {
    await useMarketplaceStore.getState().load();
    const [listing] = useMarketplaceStore.getState().packages;
    await useMarketplaceStore.getState().install(listing);

    const editor = useEditorStore.getState();
    const materialIds = new Set(editor.materials.map((material) => material.id));
    const installedPrefabs = editor.prefabs.slice(-listing.contents.prefabs);
    expect(installedPrefabs.length).toBe(listing.contents.prefabs);

    // A dangling materialId after re-id'ing would render the prefab untextured — check every one.
    const referenced = installedPrefabs
      .flatMap((prefab) => prefab.objects)
      .map((object) => object.renderer?.materialId)
      .filter((id): id is string => !!id);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(materialIds.has(id)).toBe(true);
  });

  it('installs a second, independent copy when the same package is installed twice', async () => {
    await useMarketplaceStore.getState().load();
    const [listing] = useMarketplaceStore.getState().packages;

    await useMarketplaceStore.getState().install(listing);
    const afterFirst = useEditorStore.getState().prefabs.map((prefab) => prefab.id);
    await useMarketplaceStore.getState().install(listing);
    const afterSecond = useEditorStore.getState().prefabs.map((prefab) => prefab.id);

    expect(afterSecond).toHaveLength(afterFirst.length + listing.contents.prefabs);
    // No id is reused, so editing one copy can never mutate the other.
    expect(new Set(afterSecond).size).toBe(afterSecond.length);
  });

  it('refuses to install with no project open, and says why', async () => {
    await useMarketplaceStore.getState().load();
    const [listing] = useMarketplaceStore.getState().packages;
    useProjectStore.getState().closeProject();

    await useMarketplaceStore.getState().install(listing);

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useProjectStore.getState().toast?.message).toContain('project');
    expect(useMarketplaceStore.getState().installedIds).toEqual([]);
  });

  it('surfaces a missing package file without marking it installed', async () => {
    await useMarketplaceStore.getState().load();
    const listing = useMarketplaceStore.getState().packages[0];

    await useMarketplaceStore
      .getState()
      .install({ ...listing, downloadUrl: new URL('store/packages/nope.nfpack', document.baseURI).toString() });

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useMarketplaceStore.getState().installedIds).toEqual([]);
    expect(useMarketplaceStore.getState().installingId).toBeNull();
  });
});

describe('shipped package integrity', () => {
  /**
   * Every asset a package's content points at must actually be in the package. A dangling id means
   * an untextured model or a silent missing sound in someone's project — and the starter templates
   * are exported from the running editor, so nothing else catches it.
   */
  it('has no dangling asset references and no asset without bytes or a source', async () => {
    const dir = join(PUBLIC_STORE, 'packages');
    const files = (await readdir(dir)).filter((file) => file.endsWith('.nfpack'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const pkg = JSON.parse(await readFile(join(dir, file), 'utf8')) as NodeForgePackage;
      const available = new Set(pkg.assets.map((asset) => asset.id));
      const referenced = new Set<string>();
      const add = (id?: string) => {
        if (id) referenced.add(id);
      };
      const scanObject = (object: SceneObject) => {
        add(object.renderer?.modelAssetId);
        add(object.renderer?.textureAssetId);
        add(object.particles?.textureAssetId);
        const character = object.character;
        if (character) {
          [
            character.footstepSoundId,
            character.jumpSoundId,
            character.landSoundId,
            character.swimSoundId,
            character.attackSoundId,
            character.hurtSoundId,
          ].forEach(add);
        }
      };

      for (const scene of pkg.content.scenes ?? []) {
        scene.objects.forEach(scanObject);
        add(scene.ambientSoundId);
        add(scene.musicSoundId);
      }
      for (const prefab of pkg.content.prefabs) prefab.objects.forEach(scanObject);
      for (const material of pkg.content.materials) {
        add(material.textureAssetId);
        add(material.normalMapAssetId);
      }
      for (const animation of pkg.content.animations) add(animation.sourceAssetId);
      for (const skeleton of pkg.content.skeletons) add(skeleton.sourceAssetId);

      const missing = [...referenced].filter((id) => !available.has(id));
      expect(missing, `${file} references assets it does not ship`).toEqual([]);

      const bodiless = pkg.assets.filter((asset) => !asset.data && !asset.source);
      expect(bodiless.map((asset) => asset.name), `${file} has assets with no bytes`).toEqual([]);
    }
  });

  /**
   * Catches a package built from a doubled project.
   *
   * The template packages are produced by running a builder in a browser, and a re-entrant run
   * (React StrictMode double-invoking the export effect) once merged two builds into one package:
   * every object appeared twice at an identical transform and every model was imported twice. It
   * installed fine and looked plausible, so nothing flagged it. These two signatures do.
   *
   * Identical name + parent + FULL transform is the fingerprint — templates legitimately reuse a
   * name at one position (e.g. two pedestal rings crossed at 90°, distinguished by scale), so the
   * whole transform has to be part of the key or this false-positives.
   */
  it('contains no duplicated objects or duplicated asset bytes', async () => {
    const dir = join(PUBLIC_STORE, 'packages');
    for (const file of (await readdir(dir)).filter((entry) => entry.endsWith('.nfpack'))) {
      const pkg = JSON.parse(await readFile(join(dir, file), 'utf8')) as NodeForgePackage;

      for (const scene of pkg.content.scenes ?? []) {
        const seen = new Map<string, number>();
        for (const object of scene.objects) {
          const key = `${object.name}|${object.parentId ?? '-'}|${JSON.stringify(object.transform)}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key.split('|')[0]);
        expect(duplicated, `${file} scene "${scene.name}" looks doubled`).toEqual([]);
      }

      const byHash = new Map<string, number>();
      for (const asset of pkg.assets) {
        if (asset.hash) byHash.set(asset.hash, (byHash.get(asset.hash) ?? 0) + 1);
      }
      const repeated = [...byHash.entries()].filter(([, count]) => count > 1).length;
      expect(repeated, `${file} ships the same bytes under multiple asset ids`).toBe(0);
    }
  });
});

describe('catalog filters', () => {
  beforeEach(async () => {
    resetMarketplace();
    serveBundledStore();
    await useMarketplaceStore.getState().load();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('filters the shipped catalog by tag and search', () => {
    const store = useMarketplaceStore.getState();
    const tags = store.availableTags();
    expect(tags).toContain('physics');

    store.setTag('physics');
    const tagged = useMarketplaceStore.getState().visiblePackages();
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((listing) => listing.tags.includes('physics'))).toBe(true);

    useMarketplaceStore.getState().setTag(null);
    useMarketplaceStore.getState().setQuery('zzz-no-such-package');
    expect(useMarketplaceStore.getState().visiblePackages()).toEqual([]);
  });
});
