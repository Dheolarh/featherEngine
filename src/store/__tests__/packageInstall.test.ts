import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';
import { buildPackage, type NodeForgePackage } from '../../project/package';
import { writePackageArchive } from '../../project/packageArchive';
import { dataUrlToBytes } from '../../utils/contentHash';

/**
 * Coverage for the asset store's install path: a package published behind a URL must download,
 * get fully re-id'd, and merge into a live project without disturbing what is already there.
 * This is the whole pipeline a remote store rides on, minus the catalog and auth.
 */

/** A real 1x1 transparent PNG — stands in for an asset's bytes on the wire. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Stub `fetch` with a duck-typed response so the test never touches the network. */
const stubFetch = (response: { ok?: boolean; status?: number; statusText?: string; body?: Uint8Array }) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      ...response,
      arrayBuffer: async () => (response.body ?? new Uint8Array()).buffer,
    }),
  );

/** Serve a package the way the store does: as a real `.nfpack` archive carrying its asset bytes. */
const servePackage = (pkg: NodeForgePackage, bytes = new Map<string, Uint8Array>()) =>
  stubFetch({ body: writePackageArchive(pkg, bytes) });

interface Published {
  pkg: NodeForgePackage;
  prefabId: string;
  blueprintId: string;
  assetId: string;
}

/**
 * Author a prefab (mesh + texture + attached blueprint) and publish it as a `.nfpack`, exactly the
 * way exportPrefabPackage does — minus embedAssets, whose only job is turning a url into a data URL.
 */
function publishTestPackage(): Published {
  const editor = () => useEditorStore.getState();

  const assetId = `asset-${crypto.randomUUID()}`;
  editor().addAssetItems([
    { id: assetId, name: 'brick.png', type: 'image', size: 70, url: PNG_DATA_URL, createdAt: Date.now() },
  ]);

  const objectId = editor().createObjectWithProps('cube', { name: 'Crate' });
  editor().updateRenderer(objectId, { textureAssetId: assetId });
  const { blueprintId } = editor().createBlueprintNamed('Crate Logic', 'asset store test');
  editor().attachScript(objectId, blueprintId);

  const prefabId = editor().createPrefabFromObject(objectId, 'Crate');
  if (!prefabId) throw new Error('failed to author the test prefab');

  const collected = editor().buildPrefabPackage(prefabId);
  if (!collected) throw new Error('failed to collect the test prefab');

  const embedded = editor()
    .assets.filter((asset) => collected.assetIds.includes(asset.id))
    .map((asset) => ({ ...asset, data: PNG_DATA_URL }));

  const pkg = buildPackage('module', collected.content, embedded, {
    id: crypto.randomUUID(),
    name: 'Crate Pack',
    version: '1.0.0',
    author: 'Feather Store',
  });

  return { pkg, prefabId, blueprintId, assetId };
}

describe('importPackageFromUrl — asset store transport', () => {
  beforeEach(() => {
    useProjectStore.getState().useDemo();
    useProjectStore.setState({ toast: null, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads a published package and merges it additively with fresh ids', async () => {
    const published = publishTestPackage();
    const prefabsBefore = useEditorStore.getState().prefabs.length;
    servePackage(published.pkg, new Map([[published.assetId, dataUrlToBytes(PNG_DATA_URL)]]));

    await useProjectStore.getState().importPackageFromUrl('https://store.example/packages/crate.nfpack');

    expect(useProjectStore.getState().toast).toMatchObject({ kind: 'success' });
    const after = useEditorStore.getState();
    expect(after.prefabs).toHaveLength(prefabsBefore + 1);

    // Additive: the authored prefab is still there, untouched...
    expect(after.prefabs.some((prefab) => prefab.id === published.prefabId)).toBe(true);
    // ...and the installed copy arrived under a brand-new id.
    const installed = after.prefabs.find((prefab) => prefab.id !== published.prefabId && prefab.name === 'Crate');
    expect(installed).toBeDefined();

    // Every cross-reference was rewired onto the new ids rather than left pointing at the publisher's.
    const object = installed!.objects.find((item) => item.id === installed!.rootId)!;
    expect(object.script?.blueprintId).toBeDefined();
    expect(object.script?.blueprintId).not.toBe(published.blueprintId);
    expect(after.blueprints.some((blueprint) => blueprint.id === object.script!.blueprintId)).toBe(true);

    expect(object.renderer?.textureAssetId).toBeDefined();
    expect(object.renderer?.textureAssetId).not.toBe(published.assetId);
    const asset = after.assets.find((item) => item.id === object.renderer!.textureAssetId);
    expect(asset).toBeDefined();
    // The bytes survived the trip and are renderable (on web the data URL doubles as the url).
    expect(asset!.url).toBe(PNG_DATA_URL);
    expect(asset!.unresolved).toBeFalsy();
  });

  it('surfaces an HTTP failure without touching the project', async () => {
    const prefabsBefore = useEditorStore.getState().prefabs.length;
    stubFetch({ ok: false, status: 404, statusText: 'Not Found' });

    await useProjectStore.getState().importPackageFromUrl('https://store.example/packages/missing.nfpack');

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useProjectStore.getState().toast?.message).toContain('404');
    expect(useEditorStore.getState().prefabs).toHaveLength(prefabsBefore);
  });

  it('rejects a URL that returns JSON which is not a package', async () => {
    const prefabsBefore = useEditorStore.getState().prefabs.length;
    stubFetch({ body: new TextEncoder().encode(JSON.stringify({ hello: 'world' })) });

    await useProjectStore.getState().importPackageFromUrl('https://store.example/not-a-package.json');

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useProjectStore.getState().toast?.message).toContain('Not a NodeForge package');
    expect(useEditorStore.getState().prefabs).toHaveLength(prefabsBefore);
  });

  it('reports an unreachable host as a network problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await useProjectStore.getState().importPackageFromUrl('https://offline.example/crate.nfpack');

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useProjectStore.getState().toast?.message).toContain('Could not reach');
  });

  it('does nothing when no project is open', async () => {
    useProjectStore.getState().closeProject();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await useProjectStore.getState().importPackageFromUrl('https://store.example/packages/crate.nfpack');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
