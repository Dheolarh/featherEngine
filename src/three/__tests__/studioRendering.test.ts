import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { textureColorSpaceForSemantic } from '../ModelAsset';
import { findMaterialPreset, findRenderPreset, materialPresetPatch } from '../presets';

describe('studio rendering contracts', () => {
  it('keeps visible color textures in sRGB and normal/data textures linear', () => {
    expect(textureColorSpaceForSemantic('color')).toBe(THREE.SRGBColorSpace);
    expect(textureColorSpaceForSemantic('data')).toBe(THREE.NoColorSpace);
  });

  it('gives Plastic a physical clear coat and Spline Studio authored soft contact shadows', () => {
    const plastic = findMaterialPreset('plastic')!;
    expect(materialPresetPatch(plastic)).toMatchObject({
      metalness: 0,
      roughness: 0.36,
      clearcoat: 0.46,
      clearcoatRoughness: 0.24,
    });

    const studio = findRenderPreset('spline-studio')!;
    expect(studio.environment).toMatchObject({
      contactShadowBlur: 3.4,
      contactShadowFar: 5,
      contactShadowColor: '#120D20',
    });
  });
});
