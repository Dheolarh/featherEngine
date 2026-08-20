import { describe, expect, it } from 'vitest';
import { PROJECT_VERSION, type AssetItem, type NodeForgeProject } from '../../types';
import { GAME_BUNDLE_VERSION, buildGameBundle, readGameBundle, stripUnusedAssets } from '../exportGame';
import { collectReferencedAssetIds, verifyGameBundle } from '../verifyBundle';
import currentProjectFixture from './fixtures/project-v0.7.0.json';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const projectWith = (assets: AssetItem[]): NodeForgeProject => ({
  ...(copy(currentProjectFixture) as unknown as NodeForgeProject),
  assets,
});

const referenceModel = (project: NodeForgeProject, assetId: string): void => {
  project.scenes[0]!.objects[0]!.renderer = {
    enabled: true,
    mesh: 'cube',
    color: '#ffffff',
    metalness: 0,
    roughness: 1,
    modelAssetId: assetId,
  };
};

const dataUrl = (document: unknown): string =>
  `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(document)).toString('base64')}`;

describe('production bundle asset verification', () => {
  it('preserves filename-resolved lap audio when stripping unused assets', () => {
    const project = projectWith([
      { id: 'audio-lap', name: 'lap_complete.mp3', type: 'audio', size: 1, data: 'data:audio/mpeg;base64,AA==', createdAt: 1 },
      { id: 'audio-checkpoint', name: 'checkpoint.mp3', type: 'audio', size: 1, data: 'data:audio/mpeg;base64,AA==', createdAt: 1 },
      { id: 'audio-unused', name: 'unused.mp3', type: 'audio', size: 1, data: 'data:audio/mpeg;base64,AA==', createdAt: 1 },
    ]);
    project.variables.push({
      id: 'var-lap',
      name: 'Lap',
      type: 'number',
      defaultValue: 0,
      persistent: true,
      createdAt: 1,
    });

    const scan = collectReferencedAssetIds(project);
    const stripped = stripUnusedAssets(buildGameBundle(project), [...scan.referenced]);

    expect(scan.scanFailed).toBe(false);
    expect(scan.referenced).toEqual(new Set(['audio-lap', 'audio-checkpoint']));
    expect(stripped.project.assets.map((asset) => asset.id)).toEqual(['audio-lap', 'audio-checkpoint']);
  });

  it('does not retain convention audio when lap timing is not enabled', () => {
    const project = projectWith([
      { id: 'audio-lap', name: 'lap_complete.mp3', type: 'audio', size: 1, data: 'data:audio/mpeg;base64,AA==', createdAt: 1 },
    ]);

    expect(collectReferencedAssetIds(project).referenced).toEqual(new Set());
  });

  it('accepts a self-contained embedded glTF', () => {
    const asset: AssetItem = {
      id: 'asset-gltf',
      name: 'self-contained.gltf',
      type: 'model',
      size: 1,
      data: dataUrl({
        asset: { version: '2.0' },
        buffers: [{ uri: 'data:application/octet-stream;base64,AA==', byteLength: 1 }],
        images: [{ bufferView: 0, mimeType: 'image/png' }],
      }),
      createdAt: 1,
    };
    const project = projectWith([asset]);
    referenceModel(project, asset.id);

    expect(verifyGameBundle(buildGameBundle(project)).errors).toEqual([]);
  });

  it('blocks embedded glTF files which still reference sibling dependencies', () => {
    const asset: AssetItem = {
      id: 'asset-gltf',
      name: 'external.gltf',
      type: 'model',
      size: 1,
      data: dataUrl({
        asset: { version: '2.0' },
        buffers: [{ uri: 'mesh.bin', byteLength: 1 }],
        images: [{ uri: 'textures/albedo.png' }],
      }),
      createdAt: 1,
    };
    const project = projectWith([asset]);
    referenceModel(project, asset.id);

    const report = verifyGameBundle(buildGameBundle(project));

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/External glTF dependencies/);
    expect(report.errors[0]).toContain('mesh.bin');
    expect(report.errors[0]).toContain('textures/albedo.png');
    expect(report.errors[0]).toContain('self-contained .glb');
  });

  it('blocks a referenced resource whose bytes are not embedded', () => {
    const asset: AssetItem = {
      id: 'asset-missing',
      name: 'missing.glb',
      type: 'model',
      size: 1,
      unresolved: true,
      createdAt: 1,
    };
    const project = projectWith([asset]);
    referenceModel(project, asset.id);

    expect(verifyGameBundle(buildGameBundle(project)).errors).toEqual([
      expect.stringMatching(/Missing resource.*missing\.glb.*used by the game/),
    ]);
  });
});

describe('legacy game bundles', () => {
  // Collections added after v0.2 are legitimately absent from bundles exported by older engine
  // versions. The player must migrate them back to empty arrays; leaving them `undefined` crashes
  // anything that reads `project.materials.length` (the production preflight report, for one).
  const LATE_COLLECTIONS = [
    'folders',
    'dataAssets',
    'materials',
    'particleSystems',
    'skeletons',
    'skeletalMeshes',
    'animations',
    'animatorControllers',
    'prefabs',
    'treeSpecs',
  ] as const;

  const legacyBundle = () => {
    const bundle = buildGameBundle(projectWith([])) as unknown as {
      startSceneId: string;
      project: Record<string, unknown> & { version: string };
    };
    bundle.project.version = '0.2.0';
    for (const collection of LATE_COLLECTIONS) delete bundle.project[collection];
    return bundle;
  };

  it('restores collections that postdate the exporting engine version', () => {
    const { project } = readGameBundle(legacyBundle());

    for (const collection of LATE_COLLECTIONS) {
      expect(Array.isArray(project[collection]), `project.${collection} was not restored`).toBe(true);
    }
    expect(project.version).toBe(PROJECT_VERSION);
  });

  it('verifies a migrated legacy bundle instead of throwing', () => {
    const { project, startSceneId } = readGameBundle(legacyBundle());
    const report = verifyGameBundle({ bundleVersion: GAME_BUNDLE_VERSION, startSceneId, project });

    expect(report.errors).toEqual([]);
    expect(report.summary.join('\n')).toContain('Materials: 0');
  });

  it('honors the bundle start scene over the saved active scene', () => {
    const bundle = legacyBundle();
    bundle.project.scenes = [
      { id: 'scene-a', name: 'A', objects: [] },
      { id: 'scene-b', name: 'B', objects: [] },
    ];
    bundle.project.activeSceneId = 'scene-a';
    bundle.startSceneId = 'scene-b';

    expect(readGameBundle(bundle).startSceneId).toBe('scene-b');
  });
});
