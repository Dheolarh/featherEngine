import type { TreeArchetype, TreeSpec } from '../types';
import { mergeTreeSpec, normalizeTreeSpec, treeSpecFromArchetype, type TreeSpecPatch } from './treeSpec';

/**
 * Hand-tuned stylized tree looks, layered over the neutral archetypes.
 *
 * These are ART DIRECTION, not new geometry: every preset is an ordinary TreeSpec patch, so a
 * preset dropped into the project library behaves exactly like a hand-built Tree Builder asset —
 * scatterable on terrain, choppable, wind-animated, and editable afterwards. That is what lets the
 * Arbor Forge plugin and the AI assistant share one list instead of each inventing their own trees.
 *
 * Tuning notes live next to the numbers they explain; the silhouette rules they follow come from
 * the archetype table in treeSpec.ts.
 */

export interface StylizedTreePreset {
  /** Stable id — referenced by the Arbor Forge plugin, AI tools, and store copy. Never renumber. */
  id: string;
  name: string;
  /** One-line pitch shown on the preset card. */
  tagline: string;
  archetype: TreeArchetype;
  /** Card / thumbnail gradient, from canopy-dark to canopy-light. */
  art: { from: string; to: string };
  patch: TreeSpecPatch;
}

export const STYLIZED_TREE_PRESETS: readonly StylizedTreePreset[] = [
  {
    id: 'sakura',
    name: 'Sakura',
    tagline: 'Cherry blossom over near-black bark — spring at full volume.',
    archetype: 'broadleaf',
    art: { from: '#d4749b', to: '#ffd3e4' },
    patch: {
      trunk: { height: 6, baseRadius: 0.42, curl: 0.38, gnarl: 0.34, flare: 0.4 },
      branches: { levels: 3, countPerLevel: [5, 3, 2], angle: 52, angleVariance: 20, gravity: -0.05, lengthRatio: 0.6 },
      // Lifted, moderately dense lobes — enough gaps that the black branches show through the
      // blossom, which is what makes a cherry read as a tree and not a candy-floss ball.
      foliage: { density: 2.2, size: 1.25, sizeVariance: 0.42, droop: 0.14, crownRadius: 0.5, crownLift: 0.76, crownFill: 0.55 },
      look: {
        barkRamp: ['#43303c', '#66494f'],
        foliageRamp: ['#d76d9e', '#ffd9e8'],
        // Petals glow warm pink with the sun behind them, not leaf-green.
        translucency: { color: '#ffc2d9', scale: 0.7, power: 2.0 },
        aoStrength: 0.35,
      },
    },
  },
  {
    id: 'autumn-maple',
    name: 'Autumn Maple',
    tagline: 'A crown on fire — ember red into gold.',
    archetype: 'broadleaf',
    art: { from: '#b33f1f', to: '#ffb52e' },
    patch: {
      trunk: { height: 8, baseRadius: 0.5, flare: 0.5, gnarl: 0.28 },
      branches: { levels: 3, countPerLevel: [6, 3, 2], angle: 44, gravity: 0.12 },
      foliage: { density: 3, size: 1.5, crownRadius: 0.68, crownFill: 0.82, droop: 0.22 },
      look: {
        barkRamp: ['#4d3a2c', '#6e5540'],
        foliageRamp: ['#b33f1f', '#ffb52e'],
        translucency: { color: '#ffa64d', scale: 0.75, power: 2.0 },
        aoStrength: 0.55,
      },
    },
  },
  {
    id: 'ghost-willow',
    name: 'Ghost Willow',
    tagline: 'Spectral pale strands for spirit glades and quiet graves.',
    archetype: 'willow',
    art: { from: '#8fb0aa', to: '#eefcf4' },
    patch: {
      trunk: { height: 6, curl: 0.5, gnarl: 0.4, lean: 6 },
      branches: { gravity: 0.6, lengthRatio: 0.75 },
      foliage: { strategy: 'strands', strandLength: 4.2, density: 9, droop: 1, crownRadius: 0.75 },
      look: {
        barkRamp: ['#525c5e', '#84928e'],
        foliageRamp: ['#a9cdc4', '#eefcf4'],
        translucency: { color: '#d9fff0', scale: 0.85, power: 1.6 },
        aoStrength: 0.25,
      },
    },
  },
  {
    id: 'ancient-oak',
    name: 'Ancient Oak',
    tagline: 'A centuries-old landmark — gnarled, vast, and deep green.',
    archetype: 'broadleaf',
    art: { from: '#24461f', to: '#5f8f3a' },
    patch: {
      trunk: { height: 11, baseRadius: 0.95, taper: 0.68, curl: 0.32, flare: 0.8, gnarl: 0.62, radialSegments: 10 },
      branches: { levels: 3, countPerLevel: [5, 3, 2], angle: 56, angleVariance: 24, gravity: 0.18, lengthRatio: 0.66 },
      // Wide but LIFTED: the crown must ride the branches, leaving trunk visible beneath — a huge
      // radius with high density previously buried the whole tree in a ground-level lobe pile.
      foliage: { density: 2.2, size: 1.6, crownRadius: 0.58, crownLift: 0.74, crownFill: 0.8, droop: 0.24 },
      look: { barkRamp: ['#3d2f22', '#5c4936'], foliageRamp: ['#24461f', '#5f8f3a'], aoStrength: 0.62 },
    },
  },
  {
    id: 'frost-spruce',
    name: 'Frost Spruce',
    tagline: 'Snow-dusted conifer tips straight off a winter ridge.',
    archetype: 'conifer',
    art: { from: '#2e4a44', to: '#bfe6e2' },
    patch: {
      trunk: { height: 15, baseRadius: 0.36 },
      foliage: { skirtRings: 11, skirtJagged: 0.52, droop: 0.62, size: 1.1 },
      look: {
        barkRamp: ['#463a33', '#6a5a4c'],
        // The ramp runs to frost, not to lighter green — the tips read as snow load.
        foliageRamp: ['#2e4a44', '#bfe6e2'],
        translucency: { color: '#d7f7f2', scale: 0.4, power: 2.6 },
        aoStrength: 0.5,
      },
    },
  },
  {
    id: 'savanna-acacia',
    name: 'Savanna Acacia',
    tagline: 'The flat umbrella crown of every safari horizon.',
    archetype: 'broadleaf',
    art: { from: '#5d7a2a', to: '#9fb04a' },
    patch: {
      trunk: { height: 6.5, baseRadius: 0.4, taper: 0.85, lean: 4, curl: 0.3, gnarl: 0.4 },
      // Branches reach UP and OUT (negative gravity) from high on the trunk — the canopy then sits
      // on top of them as a lifted, shallow disc rather than a ball.
      branches: { levels: 2, countPerLevel: [7, 3], startHeight: 0.55, angle: 72, angleVariance: 12, gravity: -0.38, lengthRatio: 0.62 },
      foliage: { density: 3, size: 1.2, droop: 0.04, crownRadius: 1.15, crownLift: 0.96, crownFill: 0.3 },
      look: { barkRamp: ['#5a4632', '#8a6c4a'], foliageRamp: ['#5d7a2a', '#9fb04a'], aoStrength: 0.45 },
    },
  },
  {
    id: 'jacaranda',
    name: 'Jacaranda',
    tagline: 'An airy cloud of violet bloom.',
    archetype: 'broadleaf',
    art: { from: '#7a5fd0', to: '#c4a6ff' },
    patch: {
      trunk: { height: 7.5, baseRadius: 0.4, curl: 0.3, gnarl: 0.2 },
      branches: { levels: 3, countPerLevel: [5, 3, 2], angle: 48, gravity: 0.05, lengthRatio: 0.66 },
      foliage: { density: 2.1, size: 1.35, sizeVariance: 0.45, droop: 0.2, crownRadius: 0.56, crownLift: 0.75, crownFill: 0.55 },
      look: {
        barkRamp: ['#4a4038', '#6e6152'],
        foliageRamp: ['#7a5fd0', '#c4a6ff'],
        translucency: { color: '#d3bcff', scale: 0.7, power: 1.9 },
        aoStrength: 0.4,
      },
    },
  },
  {
    id: 'baobab',
    name: 'Baobab',
    tagline: 'An upside-down giant: all trunk, a whisper of crown.',
    archetype: 'broadleaf',
    art: { from: '#8a6a52', to: '#b39274' },
    patch: {
      // The trunk IS the tree — barrel-wide, barely tapering, with stubby arms right at the top.
      trunk: { height: 9, baseRadius: 1.7, taper: 0.34, curl: 0.1, flare: 0.55, gnarl: 0.3, radialSegments: 11 },
      branches: { levels: 2, countPerLevel: [6, 2], startHeight: 0.86, endHeight: 1, angle: 58, angleVariance: 24, gravity: -0.15, lengthRatio: 0.28 },
      foliage: { density: 1.4, size: 0.75, droop: 0.08, crownRadius: 0.55, crownLift: 0.97, crownFill: 0.3 },
      look: { barkRamp: ['#8a6a52', '#b39274'], foliageRamp: ['#54702c', '#8ba448'], aoStrength: 0.4 },
      // Nobody axes a baobab in two swings; make felling one feel like an event.
      chop: { breakPoints: [{ height: 0.08, hits: 8, label: 'fell' }], topplePush: 6 },
    },
  },
  {
    id: 'golden-birch',
    name: 'Golden Birch',
    tagline: 'White paper bark under a shower of autumn gold.',
    archetype: 'birch',
    art: { from: '#c8901e', to: '#ffe066' },
    patch: {
      foliage: { density: 4, size: 0.55, cardsPerCluster: 8 },
      look: {
        barkRamp: ['#d8d2c4', '#f0ece1'],
        foliageRamp: ['#c8901e', '#ffe066'],
        translucency: { color: '#ffd970', scale: 0.8, power: 1.8 },
        aoStrength: 0.35,
      },
    },
  },
  {
    id: 'emerald-cypress',
    name: 'Emerald Cypress',
    tagline: 'A slim jewel-green spire for formal gardens and shrines.',
    archetype: 'conifer',
    art: { from: '#1d5c38', to: '#3fa060' },
    patch: {
      // Narrow everything: a cypress is a candle flame, not a Christmas tree.
      trunk: { height: 12, baseRadius: 0.24, taper: 0.94 },
      branches: { countPerLevel: [10], angle: 60, lengthRatio: 0.18 },
      foliage: { strategy: 'skirt', skirtRings: 12, skirtJagged: 0.22, droop: 0.35, size: 0.95, crownRadius: 0.2 },
      look: { barkRamp: ['#4c3b2a', '#6d5741'], foliageRamp: ['#1d5c38', '#3fa060'], aoStrength: 0.55 },
    },
  },
  {
    id: 'haunted-snag',
    name: 'Haunted Snag',
    tagline: 'A clawed black silhouette against a storm sky.',
    archetype: 'snag',
    art: { from: '#241f26', to: '#463c44' },
    patch: {
      trunk: { height: 9, lean: 18, curl: 0.75, gnarl: 0.85, taper: 0.55 },
      branches: { levels: 2, countPerLevel: [6, 3], angle: 70, angleVariance: 48, gravity: -0.3, lengthRatio: 0.5 },
      look: { barkRamp: ['#241f26', '#463c44'], aoStrength: 0.7 },
    },
  },
  {
    id: 'sunset-palm',
    name: 'Sunset Palm',
    tagline: 'Long lazy fronds catching the last warm light.',
    archetype: 'palm',
    art: { from: '#4f8f3f', to: '#c9e26a' },
    patch: {
      trunk: { height: 10, lean: 15, curl: 0.55 },
      foliage: { strategy: 'fronds', frondCount: 14, size: 3.8, droop: 0.78 },
      look: {
        barkRamp: ['#7a5f3c', '#a3854f'],
        foliageRamp: ['#4f8f3f', '#c9e26a'],
        translucency: { color: '#e8ff9e', scale: 0.75, power: 1.8 },
      },
    },
  },
  {
    id: 'candy-gum',
    name: 'Candy Gum Tree',
    tagline: 'Bubblegum blobs on a plum trunk — pure toy-box whimsy.',
    archetype: 'broadleaf',
    art: { from: '#ff7bb0', to: '#ffe3f2' },
    patch: {
      trunk: { height: 5.5, baseRadius: 0.45, curl: 0.42, flare: 0.3, gnarl: 0.1 },
      branches: { levels: 2, countPerLevel: [4, 2], angle: 42, gravity: -0.1 },
      foliage: { strategy: 'blob', density: 2.2, size: 1.9, sizeVariance: 0.3, droop: 0.05, crownRadius: 0.6, crownFill: 0.9 },
      look: {
        barkRamp: ['#6b3f5c', '#96628a'],
        foliageRamp: ['#ff7bb0', '#ffe3f2'],
        translucency: { color: '#ffd0e6', scale: 0.8, power: 1.6 },
        aoStrength: 0.3,
      },
    },
  },
] as const;

export function getStylizedPreset(presetId: string): StylizedTreePreset | undefined {
  return STYLIZED_TREE_PRESETS.find((preset) => preset.id === presetId);
}

/**
 * Materialize a preset as a full, normalized TreeSpec: archetype defaults, then the preset's art
 * direction, then the same clamps every Tree Builder edit goes through — so a preset can never
 * produce a spec the generator couldn't have built by hand.
 */
export function stylizedTreeSpec(preset: StylizedTreePreset, specId: string, name?: string): TreeSpec {
  const base = treeSpecFromArchetype(preset.archetype, specId, name ?? preset.name);
  return normalizeTreeSpec({ ...mergeTreeSpec(base, preset.patch), id: specId, name: name ?? preset.name });
}
