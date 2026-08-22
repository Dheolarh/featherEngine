import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateTree } from '../generateTree';
import { STYLIZED_TREE_PRESETS, getStylizedPreset, stylizedTreeSpec } from '../stylizedPresets';
import { TREE_ARCHETYPES } from '../treeSpec';

/**
 * The preset gallery is shipped art: every entry must build a real, deterministic tree. A preset
 * that normalizes into nonsense or generates NaN geometry would break the Arbor Forge plugin, the
 * AI's apply_tree_preset/plant_grove tools, and any store package that references it.
 */
describe('stylized tree presets', () => {
  it('has unique ids and known archetypes', () => {
    const ids = STYLIZED_TREE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of STYLIZED_TREE_PRESETS) {
      expect(TREE_ARCHETYPES[preset.archetype], `${preset.id} archetype`).toBeDefined();
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.tagline.length).toBeGreaterThan(0);
      expect(preset.art.from).toMatch(/^#/);
      expect(preset.art.to).toMatch(/^#/);
    }
  });

  it.each(STYLIZED_TREE_PRESETS.map((preset) => [preset.id] as const))(
    '%s normalizes into generator range and builds finite geometry',
    (presetId) => {
      const preset = getStylizedPreset(presetId)!;
      const spec = stylizedTreeSpec(preset, `spec-${presetId}`);
      // The same clamps the Tree Builder enforces must already hold — presets are not exempt.
      expect(spec.id).toBe(`spec-${presetId}`);
      expect(spec.name).toBe(preset.name);
      expect(spec.trunk.height).toBeGreaterThanOrEqual(0.2);
      expect(spec.trunk.height).toBeLessThanOrEqual(30);
      expect(spec.branches.countPerLevel).toHaveLength(spec.branches.levels);

      const generated = generateTree(spec, 7);
      expect(generated.triangles).toBeGreaterThan(0);
      const size = generated.bounds.getSize(new THREE.Vector3());
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Number.isFinite(size[axis]), `${presetId} bounds.${axis}`).toBe(true);
      }
    },
  );

  it('generates deterministically: same spec + seed = same tree', () => {
    const preset = getStylizedPreset('sakura')!;
    const spec = stylizedTreeSpec(preset, 'spec-determinism');
    const a = generateTree(spec, 42);
    const b = generateTree(spec, 42);
    expect(a.triangles).toBe(b.triangles);
    expect(a.bounds.min).toEqual(b.bounds.min);
    expect(a.bounds.max).toEqual(b.bounds.max);
    // A different seed must actually vary the tree, or the "seed strip" UX is a lie.
    const c = generateTree(spec, 43);
    expect(c.bounds.max.equals(a.bounds.max)).toBe(false);
  });
});
