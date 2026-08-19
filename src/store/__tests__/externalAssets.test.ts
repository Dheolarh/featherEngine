import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';
import type { AssetItem } from '../../types';
import type { NodeForgePackage } from '../../project/package';

/**
 * Coverage for externally-referenced package assets: bytes that live outside the `.nfpack` and are
 * downloaded + hash-verified at install time.
 *
 * This is what keeps a store package a small manifest instead of megabytes of base64, so the tests
 * that matter here are integrity (a swapped file must be rejected) and dedupe (shared bytes must be
 * imported once) — plus one real multi-megabyte model pushed all the way through.
 */

const PUBLIC = join(process.cwd(), 'public');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Build a package whose single model asset is referenced by URL rather than inlined. */
function packageWithExternalModel(overrides: {
  assetId: string;
  prefabId: string;
  url: string;
  sha256: string;
  bytes: number;
  name: string;
}): NodeForgePackage {
  const asset: AssetItem = {
    id: overrides.assetId,
    name: overrides.name,
    type: 'model',
    size: overrides.bytes,
    hash: overrides.sha256,
    createdAt: 0,
    source: { url: overrides.url, sha256: overrides.sha256, bytes: overrides.bytes },
  };
  return {
    format: 'nodeforge-package',
    formatVersion: '1.0.0',
    kind: 'module',
    meta: {
      id: `meta-${overrides.prefabId}`,
      name: `Pack ${overrides.prefabId}`,
      version: '1.0.0',
      createdAt: new Date(0).toISOString(),
      engineVersion: '0.7.0',
    },
    content: {
      prefabs: [
        {
          id: overrides.prefabId,
          name: overrides.name,
          rootId: `${overrides.prefabId}-root`,
          createdAt: 0,
          objects: [
            {
              id: `${overrides.prefabId}-root`,
              name: overrides.name,
              kind: 'cube',
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              renderer: {
                enabled: true,
                mesh: 'cube',
                color: '#ffffff',
                metalness: 0.1,
                roughness: 0.65,
                modelAssetId: overrides.assetId,
              },
            },
          ],
        },
      ],
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
    },
    assets: [asset],
  };
}

/** Serve `public/**` off disk plus any in-memory packages, routed by URL path. */
function serve(packages: Record<string, NodeForgePackage>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const path = new URL(String(input), document.baseURI).pathname.replace(/^\//, '');
      const pkg = packages[path];
      if (pkg) return { ok: true, status: 200, statusText: 'OK', json: async () => pkg };
      try {
        const bytes = await readFile(join(PUBLIC, path));
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/octet-stream' },
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      } catch {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
      }
    }),
  );
}

describe('externally-referenced package assets', () => {
  beforeEach(() => {
    useProjectStore.getState().useDemo();
    useProjectStore.setState({ toast: null, error: null });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('downloads, verifies and installs a model referenced by URL', async () => {
    const file = join(PUBLIC, 'templates', 'Sword.glb');
    const bytes = await readFile(file);
    const hash = sha256(bytes);
    const pkg = packageWithExternalModel({
      assetId: 'asset-sword',
      prefabId: 'prefab-sword',
      url: 'templates/Sword.glb',
      sha256: hash,
      bytes: bytes.length,
      name: 'Sword.glb',
    });
    serve({ 'store/sword.nfpack': pkg });

    const ok = await useProjectStore.getState().importPackageFromUrl('store/sword.nfpack');
    expect(ok).toBe(true);

    const editor = useEditorStore.getState();
    const installed = editor.assets.find((asset) => asset.hash === hash);
    expect(installed).toBeDefined();
    expect(installed!.unresolved).toBeFalsy();
    // The bytes really arrived — not a placeholder — and the prefab points at them.
    expect(installed!.url).toContain('base64,');
    const prefab = editor.prefabs.find((entry) => entry.name === 'Sword.glb')!;
    expect(prefab.objects[0].renderer?.modelAssetId).toBe(installed!.id);
  });

  it('rejects a download whose bytes do not match the declared hash', async () => {
    const bytes = await readFile(join(PUBLIC, 'templates', 'Sword.glb'));
    const pkg = packageWithExternalModel({
      assetId: 'asset-tampered',
      prefabId: 'prefab-tampered',
      url: 'templates/Sword.glb',
      sha256: 'deadbeef'.repeat(8), // not the real digest
      bytes: bytes.length,
      name: 'Sword.glb',
    });
    serve({ 'store/tampered.nfpack': pkg });

    await useProjectStore.getState().importPackageFromUrl('store/tampered.nfpack');

    // The install still completes, but the asset is flagged rather than silently trusted.
    const asset = useEditorStore.getState().assets.find((entry) => entry.name === 'Sword.glb' && entry.unresolved);
    expect(asset).toBeDefined();
    expect(asset!.url).toBeUndefined();
  });

  it('imports shared bytes once when two packages reference the same asset', async () => {
    // A model no other test in this file touches, so the counts below are this test's alone.
    const bytes = await readFile(join(PUBLIC, 'templates', 'Pistol.glb'));
    const hash = sha256(bytes);
    const common = { url: 'templates/Pistol.glb', sha256: hash, bytes: bytes.length, name: 'Pistol.glb' };
    serve({
      'store/a.nfpack': packageWithExternalModel({ ...common, assetId: 'asset-a', prefabId: 'prefab-a' }),
      'store/b.nfpack': packageWithExternalModel({ ...common, assetId: 'asset-b', prefabId: 'prefab-b' }),
    });
    const prefabsBefore = useEditorStore.getState().prefabs.length;

    await useProjectStore.getState().importPackageFromUrl('store/a.nfpack');
    const afterFirst = useEditorStore.getState().assets.filter((asset) => asset.hash === hash);
    await useProjectStore.getState().importPackageFromUrl('store/b.nfpack');
    const afterSecond = useEditorStore.getState().assets.filter((asset) => asset.hash === hash);

    // One asset, not two — the 2nd package's prefab points at the asset the 1st already installed.
    expect(afterFirst).toHaveLength(1);
    expect(afterSecond).toHaveLength(1);

    // Both packages still contributed their own prefab, and both resolve to that single asset.
    const added = useEditorStore.getState().prefabs.slice(prefabsBefore);
    expect(added).toHaveLength(2);
    expect(added.every((prefab) => prefab.objects[0].renderer?.modelAssetId === afterSecond[0].id)).toBe(true);
  });

  it('refuses a download that declares an absurd size before fetching it', async () => {
    const pkg = packageWithExternalModel({
      assetId: 'asset-huge',
      prefabId: 'prefab-huge',
      url: 'templates/Sword.glb',
      sha256: 'a'.repeat(64),
      bytes: 2 * 1024 * 1024 * 1024, // 2 GB
      name: 'Huge.glb',
    });
    serve({ 'store/huge.nfpack': pkg });

    await useProjectStore.getState().importPackageFromUrl('store/huge.nfpack');

    const asset = useEditorStore.getState().assets.find((entry) => entry.name === 'Huge.glb');
    expect(asset?.unresolved).toBe(true);
  });

  it('installs a real 22 MB character model end to end', async () => {
    const file = join(PUBLIC, 'templates', 'UAL1.glb');
    const { size } = await stat(file);
    expect(size).toBeGreaterThan(20 * 1024 * 1024); // guard: this test is only meaningful on the real file
    const bytes = await readFile(file);
    const hash = sha256(bytes);

    const pkg = packageWithExternalModel({
      assetId: 'asset-hero',
      prefabId: 'prefab-hero',
      url: 'templates/UAL1.glb',
      sha256: hash,
      bytes: size,
      name: 'UAL1.glb',
    });
    serve({ 'store/hero.nfpack': pkg });

    const ok = await useProjectStore.getState().importPackageFromUrl('store/hero.nfpack');
    expect(ok).toBe(true);

    const installed = useEditorStore.getState().assets.find((asset) => asset.hash === hash);
    expect(installed).toBeDefined();
    expect(installed!.unresolved).toBeFalsy();
    expect(installed!.size).toBe(size);
  }, 60_000);
});
