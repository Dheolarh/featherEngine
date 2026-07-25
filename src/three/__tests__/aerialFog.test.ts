import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { UniformsUtils } from 'three';
import { aerialFogState, installAerialFog, resetAerialFog, setAerialFog } from '../aerialFog';

// Importing the module installs the override, but be explicit — these assertions are meaningless
// if the install silently no-ops.
installAerialFog();

describe('aerialFog chunk override', () => {
  it('replaces the four stock fog chunks', () => {
    expect(THREE.ShaderChunk.fog_vertex).toContain('vFogWorldPos');
    expect(THREE.ShaderChunk.fog_pars_vertex).toContain('varying vec3 vFogWorldPos');
    expect(THREE.ShaderChunk.fog_pars_fragment).toContain('uniform vec3 fogAerial');
    expect(THREE.ShaderChunk.fog_fragment).toContain('nfHeightFactor');
  });

  it('is idempotent', () => {
    const before = THREE.ShaderChunk.fog_fragment;
    installAerialFog();
    installAerialFog();
    expect(THREE.ShaderChunk.fog_fragment).toBe(before);
  });

  // The whole design rests on this: three clones ShaderLib uniforms per material via cloneUniforms,
  // which deep-clones Color/Vector3 but passes unrecognised plain objects through by reference. If a
  // future refactor turns these into THREE.Color/Vector3, every material silently gets a dead private
  // copy and setAerialFog() stops having any visible effect. This test is the tripwire for that.
  it('shares uniform objects by reference through three per-material uniform clone', () => {
    for (const shaderId of ['basic', 'lambert', 'phong', 'physical', 'toon', 'points', 'sprite']) {
      const lib = THREE.ShaderLib[shaderId as keyof typeof THREE.ShaderLib];
      expect(lib, `ShaderLib.${shaderId} should exist`).toBeDefined();
      expect(lib.uniforms.fogAerial, `ShaderLib.${shaderId} should carry the aerial uniforms`).toBeDefined();

      // This is exactly what WebGLPrograms.getUniforms() does for a built-in material.
      const perMaterial = UniformsUtils.clone(lib.uniforms);
      expect(perMaterial.fogAerial.value, shaderId).toBe(aerialFogState.params);
      expect(perMaterial.fogSunDir.value, shaderId).toBe(aerialFogState.sunDir);
      expect(perMaterial.fogSunColor.value, shaderId).toBe(aerialFogState.sunColor);
    }
  });

  it('keeps the vertex chunk free of `transformed`, which sprite shaders never declare', () => {
    expect(THREE.ShaderChunk.fog_vertex).not.toContain('transformed');
  });
});

describe('setAerialFog', () => {
  beforeEach(() => resetAerialFog());

  it('writes sun direction and linear-space color into the shared uniforms', () => {
    setAerialFog({
      sunDirection: new THREE.Vector3(0, 0.3, -1).normalize(),
      sunColor: '#FFE9C0',
      heightFalloff: 0.02,
      inscatterPower: 6,
      inscatter: 0.8,
    });

    expect(aerialFogState.sunDir.z).toBeCloseTo(-0.9578, 3);
    expect(aerialFogState.params.x).toBeCloseTo(0.02);
    expect(aerialFogState.params.z).toBeCloseTo(0.8);

    // sRGB #FFE9C0 must land in the linear working space, matching how three uploads fogColor.
    const expected = new THREE.Color('#FFE9C0');
    expect(aerialFogState.sunColor.x).toBeCloseTo(expected.r, 5);
    expect(aerialFogState.sunColor.y).toBeCloseTo(expected.g, 5);
    expect(aerialFogState.sunColor.z).toBeCloseTo(expected.b, 5);
    expect(aerialFogState.sunColor.y).toBeLessThan(0.914); // i.e. actually converted, not raw 233/255
  });

  it('clamps to the ranges the shader assumes', () => {
    setAerialFog({
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: '#ffffff',
      heightFalloff: -5,
      inscatterPower: 0,
      inscatter: 4,
    });
    expect(aerialFogState.params.x).toBe(0);
    expect(aerialFogState.params.y).toBe(1); // pow() exponent below 1 would invert the falloff
    expect(aerialFogState.params.z).toBe(1);
  });

  // The safety invariant: a scene that never opts in must render exactly like stock three.js fog.
  it('resets to a stock-equivalent state', () => {
    setAerialFog({
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: '#ff0000',
      heightFalloff: 0.5,
      inscatterPower: 9,
      inscatter: 1,
    });
    resetAerialFog();
    expect(aerialFogState.params.x).toBe(0); // no height falloff -> nfHeightFactor stays 1.0
    expect(aerialFogState.params.z).toBe(0); // no in-scatter -> fog color stays fogColor
  });
});
