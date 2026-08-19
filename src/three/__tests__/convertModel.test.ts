import { describe, expect, it } from 'vitest';
import {
  AnimationClip,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Texture,
  VectorKeyframeTrack,
} from 'three';
import {
  applyFbxImportScale,
  collectFbxClips,
  convertFbxMaterialToStandard,
  prepareFbxForGltfExport,
  pruneFbxSceneExtras,
  readFbxCentimetersPerUnit,
} from '../convertModel';

describe('FBX import (Unreal-style conversion)', () => {
  it('maps Phong shininess to PBR roughness and leaves metalness at 0', () => {
    const phong = new MeshPhongMaterial({ name: 'Body', shininess: 30 });
    const standard = convertFbxMaterialToStandard(phong) as MeshStandardMaterial;
    expect(standard.type).toBe('MeshStandardMaterial');
    expect(standard.metalness).toBe(0);
    expect(standard.roughness).toBeGreaterThan(0.08);
    expect(standard.roughness).toBeLessThan(1);
    expect(standard.userData.fbxOriginalMaterialType).toBe('MeshPhongMaterial');
  });

  it('duplicates UV0 onto UV1 for occlusion maps when the FBX only has one set', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.deleteAttribute('uv1');
    geometry.deleteAttribute('uv2');
    const ao = new Texture();
    ao.channel = 1;
    const mesh = new Mesh(geometry, new MeshPhongMaterial({ aoMap: ao }));
    const root = new Group();
    root.add(mesh);
    prepareFbxForGltfExport(root);
    expect(geometry.getAttribute('uv1')).toBeTruthy();
  });

  it('collects animation takes from the FBX root the way GLTFExporter requires', () => {
    const root = new Group();
    const clip = new AnimationClip('Walk', 1, [new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 1, 0])]);
    (root as Group & { animations: AnimationClip[] }).animations = [clip];
    expect(collectFbxClips(root).map((item) => item.name)).toEqual(['Walk']);
  });

  it('strips DCC lights and cameras so they are not baked into the GLB', () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry()));
    root.add(new DirectionalLight());
    root.add(new PerspectiveCamera());
    pruneFbxSceneExtras(root);
    expect(root.children).toHaveLength(1);
    expect((root.children[0] as Mesh).isMesh).toBe(true);
  });

  it('reads UnitScaleFactor from ASCII FBX (1 = centimetres)', () => {
    const ascii = 'P: "UnitScaleFactor", "double", "Number", "",1';
    const value = readFbxCentimetersPerUnit(new TextEncoder().encode(ascii).buffer);
    expect(value).toBe(1);
  });

  it('scales centimetre FBX into metres', () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(180, 180, 180));
    root.add(mesh);
    applyFbxImportScale(root, 1);
    expect(root.scale.x).toBeCloseTo(0.01);
  });

  it('leaves metre-scale meshes alone when the file has no unit tag', () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(2, 2, 2)));
    applyFbxImportScale(root, undefined);
    expect(root.scale.x).toBe(1);
  });
});
