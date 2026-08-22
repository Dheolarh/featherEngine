import { describe, it, expect } from 'vitest';
import { getPartRenderGeometry } from '../modelGeometry';
import { makeModelPart, DEFAULT_MODEL_STYLE, FLAT_MODEL_STYLE } from '../modelSpec';

/**
 * The vertex-edit deformation: corner offsets must actually move the hull, normals must stay unit
 * length (the Jacobian transform, not a refacet), and the bevel path must survive deformation.
 */
describe('model corner deformation', () => {
  it('moves the offset corner and leaves the opposite corner alone', () => {
    const part = makeModelPart('box', { corners: { 7: [0.2, 0.3, 0.1] } });
    const geometry = getPartRenderGeometry(part, FLAT_MODEL_STYLE);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Corner 7 = (+0.5,+0.5,+0.5) + offset; corner 0 stays at (-0.5,-0.5,-0.5).
    expect(box.max.x).toBeCloseTo(0.7, 3);
    expect(box.max.y).toBeCloseTo(0.8, 3);
    expect(box.max.z).toBeCloseTo(0.6, 3);
    expect(box.min.x).toBeCloseTo(-0.5, 3);
    expect(box.min.y).toBeCloseTo(-0.5, 3);
    expect(box.min.z).toBeCloseTo(-0.5, 3);
  });

  it('keeps normals unit-length under deformation, smooth bevel included', () => {
    for (const style of [FLAT_MODEL_STYLE, DEFAULT_MODEL_STYLE]) {
      const part = makeModelPart('box', { scale: [2, 1, 0.5], corners: { 2: [0.3, -0.2, 0.15], 5: [-0.1, 0.25, 0] } });
      const geometry = getPartRenderGeometry(part, style);
      const normals = geometry.attributes.normal;
      for (let i = 0; i < normals.count; i += 7) {
        const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
        expect(length).toBeGreaterThan(0.99);
        expect(length).toBeLessThan(1.01);
      }
    }
  });

  it('deformed geometry is cached per corners signature', () => {
    const part = makeModelPart('box', { corners: { 1: [0.1, 0, 0] } });
    expect(getPartRenderGeometry(part, FLAT_MODEL_STYLE)).toBe(getPartRenderGeometry({ ...part }, FLAT_MODEL_STYLE));
  });
});
