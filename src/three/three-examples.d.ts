// Minimal type shim for the three.js examples modules we use (they ship no bundled .d.ts).
declare module 'three/examples/jsm/lights/LightProbeGenerator.js' {
  import type { LightProbe, WebGLRenderer, WebGLCubeRenderTarget, CubeTexture } from 'three';
  export const LightProbeGenerator: {
    fromCubeRenderTarget(renderer: WebGLRenderer, cubeRenderTarget: WebGLCubeRenderTarget): Promise<LightProbe>;
    fromCubeTexture(cubeTexture: CubeTexture): LightProbe;
  };
}
