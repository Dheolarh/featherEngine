import { describe, expect, it } from 'vitest';
import type { AssetItem, NodeForgeProject } from '../../types';
import { buildGameBundle, stripUnusedAssets } from '../exportGame';
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
