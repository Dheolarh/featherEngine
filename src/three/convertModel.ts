import {
  AnimationClip,
  Box3,
  BufferAttribute,
  ClampToEdgeWrapping,
  LoadingManager,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Color,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
  type Vector2,
} from 'three';

/**
 * Convert a dropped FBX file into a self-contained binary GLB, in the browser.
 *
 * The rest of the asset pipeline (storage in `assets/`, rendering via `useGLTF`, and the
 * export-to-data-URL bundling) only ever deals with glTF. Converting FBX on import keeps that
 * single-format invariant: we load the FBX with `FBXLoader`, re-export the scene as a binary GLB
 * with `GLTFExporter`, and hand back a `.glb` File as if the user had dropped one.
 *
 * This path is the Unreal-style import: keep skeletal clips, convert DCC centimetres to metres,
 * resolve sidecar textures (including TGA), turn Phong/Lambert into PBR, and drop DCC lights/cameras
 * so the asset is a mesh/rig rather than a whole Maya scene.
 *
 * Textures: FBX usually references *external* image files (a sibling .png/.tga). Pass those alongside
 * the .fbx in `siblings` and they're resolved from memory and embedded into the GLB. Any texture
 * that still can't be resolved is dropped (rather than failing the whole export), so the model
 * always imports — just untextured if its images are missing.
 */
const IMAGE_RE = /\.(png|jpe?g|webp|bmp|gif|tga)$/i;

/** 1×1 transparent PNG — used so FBXLoader never tries to fetch a DCC absolute path like `C:\...`. */
const PLACEHOLDER_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
] as const;

type TextureSlot = (typeof TEXTURE_SLOTS)[number];
type MaterialWithTextureSlots = Material & Partial<Record<TextureSlot, Texture | null>>;
type FbxSourceMaterial = MaterialWithTextureSlots & {
  color?: Color;
  emissive?: Color;
  emissiveIntensity?: number;
  shininess?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: Vector2;
  displacementScale?: number;
  isMeshBasicMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
};

type AnimatedObject = Object3D & { animations?: AnimationClip[] };

const COLOR_TEXTURE_SLOTS = new Set<string>(['map', 'emissiveMap', 'specularMap']);
const DATA_TEXTURE_SLOTS = new Set<string>([
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
]);

const basename = (path: string) => {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const file = clean.split(/[\\/]/).pop() ?? clean;
  try {
    return decodeURIComponent(file).toLowerCase();
  } catch {
    return file.toLowerCase();
  }
};

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/** A texture is usable only once its image has decoded to non-zero dimensions. */
function hasValidImage(texture: unknown): boolean {
  const img = (texture as { image?: { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number; src?: string } } | null)?.image;
  if (!img) return false;
  if (img.src === PLACEHOLDER_PIXEL) return false;
  const w = img.width ?? img.naturalWidth ?? 0;
  const h = img.height ?? img.naturalHeight ?? 0;
  return w > 0 && h > 0;
}

/** Null out any material map whose image didn't load, so GLTFExporter won't choke on it. */
function stripUnresolvedTextures(root: Object3D): number {
  let dropped = 0;
  root.traverse((node) => {
    const mesh = node as { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh || !mesh.material) return;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Array<Record<string, unknown>>;
    for (const material of materials) {
      for (const slot of TEXTURE_SLOTS) {
        if (material[slot] && !hasValidImage(material[slot])) {
          material[slot] = null;
          material.needsUpdate = true;
          dropped += 1;
        }
      }
    }
  });
  return dropped;
}

const textureChannel = (texture: Texture | null | undefined) =>
  typeof texture?.channel === 'number' && Number.isFinite(texture.channel) ? texture.channel : 0;

const uvAttributeName = (channel: number) => (channel === 0 ? 'uv' : `uv${channel}`);

const hasUvChannel = (geometry: BufferGeometry, channel: number) => Boolean(geometry.getAttribute(uvAttributeName(channel)));

const setTextureChannel = (texture: Texture, channel: number) => {
  texture.channel = channel;
  texture.needsUpdate = true;
};

const maybeDuplicateUv = (geometry: BufferGeometry, targetChannel: number) => {
  if (targetChannel <= 0 || hasUvChannel(geometry, targetChannel)) return;
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  geometry.setAttribute(uvAttributeName(targetChannel), new BufferAttribute(uv.array.slice(0), uv.itemSize, uv.normalized));
};

const phongShininessToRoughness = (shininess: number | undefined) => {
  if (typeof shininess !== 'number' || !Number.isFinite(shininess)) return 0.65;
  return Math.min(1, Math.max(0.08, Math.sqrt(2 / (Math.max(0, shininess) + 2))));
};

export function convertFbxMaterialToStandard(material: MaterialWithTextureSlots): MaterialWithTextureSlots {
  const source = material as FbxSourceMaterial;
  if (source.isMeshStandardMaterial || source.isMeshBasicMaterial) return material;

  const standard = new MeshStandardMaterial({
    name: source.name,
    color: source.color?.clone(),
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    roughnessMap: source.roughnessMap ?? null,
    metalnessMap: source.metalnessMap ?? null,
    emissive: source.emissive?.clone(),
    emissiveMap: source.emissiveMap ?? null,
    emissiveIntensity: source.emissiveIntensity ?? 1,
    aoMap: source.aoMap ?? null,
    alphaMap: source.alphaMap ?? null,
    bumpMap: source.bumpMap ?? null,
    displacementMap: source.displacementMap ?? null,
    displacementScale: source.displacementScale ?? 1,
    lightMap: source.lightMap ?? null,
    opacity: source.opacity,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    side: source.side,
    roughness: source.roughness ?? phongShininessToRoughness(source.shininess),
    // FBX Phong/Lambert is dielectric, not a metal — Unreal's importer makes the same assumption.
    metalness: source.metalness ?? 0,
    vertexColors: source.vertexColors,
  });
  standard.userData = { ...source.userData, fbxOriginalMaterialType: source.type };
  if (source.normalScale) standard.normalScale.copy(source.normalScale);
  return standard as MaterialWithTextureSlots;
}

/**
 * FBXLoader gives us a live three.js scene, then GLTFExporter serializes it. This bridge makes
 * that transient scene glTF-safe before export: texture transforms are flushed, impossible UV
 * channels are remapped to UV0, and AO/light maps get a secondary UV fallback when the FBX only
 * provides one UV set. That prevents the common "textures slide/stretch after FBX import" failure.
 */
export function prepareFbxForGltfExport(root: Object3D) {
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const originalMaterials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MaterialWithTextureSlots[];
    const materials = originalMaterials.map(convertFbxMaterialToStandard);
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];

    for (const material of materials) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (!texture) continue;

        const currentChannel = textureChannel(texture);
        if (!hasUvChannel(geometry, currentChannel)) {
          setTextureChannel(texture, 0);
        }

        // three.js/glTF expect occlusion/light textures to be able to use a secondary UV set. Many
        // FBX files only carry one UV set; duplicating it preserves the same alignment instead of
        // leaving the exporter/loader to sample an absent channel.
        if ((slot === 'aoMap' || slot === 'lightMap') && hasUvChannel(geometry, 0) && !hasUvChannel(geometry, 1)) {
          maybeDuplicateUv(geometry, 1);
          setTextureChannel(texture, 1);
        }

        if ((texture.repeat.x !== 1 || texture.repeat.y !== 1 || texture.offset.x !== 0 || texture.offset.y !== 0) && texture.wrapS === ClampToEdgeWrapping && texture.wrapT === ClampToEdgeWrapping) {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
        }
        if (COLOR_TEXTURE_SLOTS.has(slot)) texture.colorSpace = SRGBColorSpace;
        if (DATA_TEXTURE_SLOTS.has(slot)) texture.colorSpace = NoColorSpace;
        texture.updateMatrix();
        texture.needsUpdate = true;
      }
      material.needsUpdate = true;
    }
  });
}

/** FBXLoader stores clips on the root (and sometimes on a child Group). GLTFExporter only writes `options.animations`. */
export function collectFbxClips(root: Object3D): AnimationClip[] {
  const clips: AnimationClip[] = [];
  const seen = new Set<string>();
  const add = (list?: AnimationClip[]) => {
    for (const clip of list ?? []) {
      if (!(clip instanceof AnimationClip) || seen.has(clip.uuid)) continue;
      seen.add(clip.uuid);
      clips.push(clip);
    }
  };
  add((root as AnimatedObject).animations);
  root.traverse((node) => add((node as AnimatedObject).animations));
  return clips;
}

/** Maya/Max default lights would otherwise land in the GLB and relight the whole editor scene. */
export function pruneFbxSceneExtras(root: Object3D) {
  const remove: Object3D[] = [];
  root.traverse((node) => {
    const extra = node as Object3D & { isLight?: boolean; isCamera?: boolean };
    if (extra.isLight || extra.isCamera) remove.push(node);
  });
  for (const node of remove) node.parent?.remove(node);
}

/**
 * FBX `UnitScaleFactor` is centimetres-per-unit (1 = cm, 100 = metres, 2.54 = inches). This engine
 * is metre-based, matching Unreal's "Convert Scene Unit" into our world scale rather than Unreal cm.
 */
export function readFbxCentimetersPerUnit(buffer: ArrayBuffer): number | undefined {
  const text = new TextDecoder('latin1').decode(buffer);
  const ascii = text.match(/P:\s*"UnitScaleFactor"\s*,\s*"double"\s*,\s*"Number"\s*,\s*"[^"]*"\s*,\s*([0-9.eE+-]+)/);
  if (ascii) {
    const value = Number(ascii[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  const legacy = text.match(/UnitScaleFactor:\s*([0-9.eE+-]+)/);
  if (legacy) {
    const value = Number(legacy[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (text.includes('UnitScaleFactor')) return 1;
  return undefined;
}

export function applyFbxImportScale(root: Object3D, centimetersPerUnit?: number) {
  let metersPerUnit: number | undefined;
  if (typeof centimetersPerUnit === 'number' && centimetersPerUnit > 0) {
    metersPerUnit = centimetersPerUnit / 100;
  } else {
    root.updateMatrixWorld(true);
    const size = new Box3().setFromObject(root).getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    // DCC FBX without a readable unit tag is almost always centimetres (Mixamo ~180). Leave metre-scale
    // props alone so a 2 m crate does not collapse.
    if (maxDim >= 20) metersPerUnit = 0.01;
  }
  if (!metersPerUnit || Math.abs(metersPerUnit - 1) < 1e-6) return;
  root.scale.multiplyScalar(metersPerUnit);
  root.updateMatrixWorld(true);
}

function lookupSiblingUrl(url: string, imageUrls: Map<string, string>): string | undefined {
  const key = basename(url);
  const direct = imageUrls.get(key);
  if (direct) return direct;
  const stem = stripExtension(key);
  for (const [name, blob] of imageUrls) {
    if (stripExtension(name) === stem) return blob;
  }
  return undefined;
}

export interface FbxConversion {
  file: File;
  /** Maps that couldn't be resolved and were dropped (model imported untextured for those). */
  droppedTextures: number;
  /** Animation takes written into the GLB (Mixamo / Unreal skeletal FBX). */
  clipCount: number;
}

export async function fbxToGlb(file: File, siblings: File[] = []): Promise<FbxConversion> {
  // Loaded lazily so the FBX/glTF toolchain stays out of the main bundle until it's needed.
  const { FBXLoader, GLTFExporter, TGALoader } = await import('three-stdlib');

  const imageUrls = new Map<string, string>();
  for (const sibling of siblings) {
    if (IMAGE_RE.test(sibling.name)) imageUrls.set(basename(sibling.name), URL.createObjectURL(sibling));
  }

  const manager = new LoadingManager();
  if ([...imageUrls.keys()].some((name) => name.endsWith('.tga'))) {
    manager.addHandler(/\.tga$/i, new TGALoader(manager));
  }
  manager.setURLModifier((url) => lookupSiblingUrl(url, imageUrls) ?? PLACEHOLDER_PIXEL);

  let queued = false;
  manager.onStart = () => {
    queued = true;
  };
  const allSettled = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });

  try {
    const buffer = await file.arrayBuffer();
    const group = new FBXLoader(manager).parse(buffer, '') as unknown as Object3D;

    if (queued) await allSettled;

    pruneFbxSceneExtras(group);
    const droppedTextures = stripUnresolvedTextures(group);
    prepareFbxForGltfExport(group);
    applyFbxImportScale(group, readFbxCentimetersPerUnit(buffer));

    const animations = collectFbxClips(group);
    const glb = (await new GLTFExporter().parseAsync(group, {
      binary: true,
      animations,
      onlyVisible: false,
    })) as ArrayBuffer;

    return {
      file: new File([glb], file.name.replace(/\.fbx$/i, '.glb'), { type: 'model/gltf-binary' }),
      droppedTextures,
      clipCount: animations.length,
    };
  } finally {
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  }
}
