import { makeId } from '../store/editor/ids';
import type { ModelPart, ModelPartShape, ModelSpec, ModelStyle, Vector3Tuple } from '../types';

/**
 * Model Forge data layer: the default palette, per-shape face-group metadata, spec normalization,
 * and the starter gallery. Geometry lives in modelGeometry.ts; this module is pure data so the
 * store and tests can use it without touching three.js.
 */

/** Flat stylized starter palette — warm props read against the engine's outdoor look. */
export const DEFAULT_MODEL_PALETTE: readonly string[] = [
  '#e8dcc5', // 0 cream
  '#c99860', // 1 light wood
  '#8a5c3b', // 2 dark wood
  '#9aa5ad', // 3 stone
  '#5d6d7e', // 4 slate
  '#c34a36', // 5 red
  '#e9b44c', // 6 yellow
  '#6ab04c', // 7 green
  '#4a90d9', // 8 blue
  '#3b3f46', // 9 charcoal
];

export const MODEL_PART_SHAPES: readonly ModelPartShape[] = ['box', 'cylinder', 'sphere', 'cone', 'wedge'];

/** The Spline-soft default: rounded corners, smooth shading, satin sheen. */
export const DEFAULT_MODEL_STYLE: ModelStyle = { finish: 'smooth', bevel: 0.02, roughness: 0.55 };
/** The crisp faceted Meshy alternative. */
export const FLAT_MODEL_STYLE: ModelStyle = { finish: 'flat', bevel: 0, roughness: 0.85 };

const clampNumber = (value: unknown, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value as number, lo), hi) : fallback;

export function normalizeModelStyle(style?: Partial<ModelStyle>): ModelStyle {
  const finish = style?.finish === 'flat' ? 'flat' : 'smooth';
  const defaults = finish === 'flat' ? FLAT_MODEL_STYLE : DEFAULT_MODEL_STYLE;
  return {
    finish,
    bevel: clampNumber(style?.bevel, 0, 0.25, defaults.bevel),
    roughness: clampNumber(style?.roughness, 0.05, 1, defaults.roughness),
  };
}

/**
 * Paintable face groups per shape, keyed by the geometry's material-group index. The keys follow
 * three.js primitive conventions (BoxGeometry orders +x,-x,+y,-y,+z,-z; cylinders side/top/bottom —
 * a cone keeps materialIndex 2 for its cap even though it has no top). Spheres have no groups, so
 * they paint as one surface.
 */
export const MODEL_FACE_GROUPS: Record<ModelPartShape, Record<number, string>> = {
  box: { 0: 'Right', 1: 'Left', 2: 'Top', 3: 'Bottom', 4: 'Front', 5: 'Back' },
  cylinder: { 0: 'Side', 1: 'Top', 2: 'Bottom' },
  cone: { 0: 'Side', 2: 'Bottom' },
  sphere: { 0: 'Surface' },
  wedge: { 0: 'Slope', 1: 'Bottom', 2: 'Back', 3: 'Left', 4: 'Right' },
};

/** Human names for the 8 box corners, by index (bit0=+X, bit1=+Y, bit2=+Z). */
export const BOX_CORNER_LABELS: readonly string[] = Array.from({ length: 8 }, (_, index) =>
  `${index & 2 ? 'Top' : 'Bottom'} ${index & 4 ? 'Front' : 'Back'} ${index & 1 ? 'Right' : 'Left'}`,
);

const SHAPE_SET: ReadonlySet<string> = new Set(MODEL_PART_SHAPES);

const vec = (value: unknown, fallback: Vector3Tuple): Vector3Tuple => {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback] as Vector3Tuple;
  return value.every((part) => Number.isFinite(part)) ? ([...value] as Vector3Tuple) : ([...fallback] as Vector3Tuple);
};

export function makeModelPart(shape: ModelPartShape, init: Partial<Omit<ModelPart, 'id' | 'shape'>> = {}): ModelPart {
  return {
    id: makeId('part'),
    name: init.name ?? shape.charAt(0).toUpperCase() + shape.slice(1),
    shape,
    position: vec(init.position, [0, 0.5, 0]),
    rotation: vec(init.rotation, [0, 0, 0]),
    scale: vec(init.scale, [1, 1, 1]),
    colorSlot: init.colorSlot ?? 1,
    ...(init.faceColors ? { faceColors: { ...init.faceColors } } : {}),
    ...(init.corners ? { corners: { ...init.corners } } : {}),
  };
}

const clampSlot = (slot: unknown, paletteSize: number): number => {
  const index = Number.isFinite(slot) ? Math.trunc(slot as number) : 0;
  return Math.min(Math.max(index, 0), Math.max(paletteSize - 1, 0));
};

/** Backfill defaults so specs from older saves, packages, or the AI always render safely. */
export function normalizeModelSpec(spec: ModelSpec): ModelSpec {
  const palette = Array.isArray(spec.palette) && spec.palette.length
    ? spec.palette.map((color) => (typeof color === 'string' && color.trim() ? color : '#888888'))
    : [...DEFAULT_MODEL_PALETTE];
  const parts = (Array.isArray(spec.parts) ? spec.parts : []).map((part, index): ModelPart => {
    const shape = SHAPE_SET.has(part?.shape) ? part.shape : 'box';
    const faceColors = part?.faceColors && typeof part.faceColors === 'object'
      ? Object.fromEntries(
          Object.entries(part.faceColors)
            .filter(([group]) => MODEL_FACE_GROUPS[shape][Number(group)] !== undefined)
            .map(([group, slot]) => [group, clampSlot(slot, palette.length)]),
        )
      : undefined;
    // Corner offsets only mean something on box hulls; reshaping a part sheds them.
    const corners = part?.corners && typeof part.corners === 'object' && shape === 'box'
      ? Object.fromEntries(
          Object.entries(part.corners)
            .filter(([key, offset]) => {
              const index = Number(key);
              return (
                Number.isInteger(index) && index >= 0 && index < 8 &&
                Array.isArray(offset) && offset.length === 3 &&
                offset.every((component) => Number.isFinite(component)) &&
                offset.some((component) => Math.abs(component as number) > 1e-4)
              );
            })
            .map(([key, offset]) => [
              key,
              (offset as number[]).map((component) => Math.min(2, Math.max(-2, component))) as Vector3Tuple,
            ]),
        )
      : undefined;
    return {
      id: part?.id || makeId('part'),
      name: part?.name?.trim() || `Part ${index + 1}`,
      shape,
      position: vec(part?.position, [0, 0.5, 0]),
      rotation: vec(part?.rotation, [0, 0, 0]),
      scale: vec(part?.scale, [1, 1, 1]),
      colorSlot: clampSlot(part?.colorSlot, palette.length),
      ...(faceColors && Object.keys(faceColors).length ? { faceColors } : {}),
      ...(corners && Object.keys(corners).length ? { corners } : {}),
    };
  });
  return { id: spec.id, name: spec.name?.trim() || 'Model', palette, parts, style: normalizeModelStyle(spec.style) };
}

// ------------------------------------------------------------------------------------------------
// Starter gallery — small kit-bashed props that both seed the library and teach the tool. Every
// starter sits ON the ground (origin at the model's base) so placing one never buries it.

export interface ModelStarter {
  id: string;
  name: string;
  tagline: string;
  build: () => ModelPart[];
}

const P = (shape: ModelPartShape, name: string, position: Vector3Tuple, scale: Vector3Tuple, colorSlot: number, rotation: Vector3Tuple = [0, 0, 0]): ModelPart =>
  makeModelPart(shape, { name, position, rotation, scale, colorSlot });

export const MODEL_STARTERS: readonly ModelStarter[] = [
  {
    id: 'blank',
    name: 'Blank',
    tagline: 'One box to build from.',
    build: () => [P('box', 'Box', [0, 0.5, 0], [1, 1, 1], 1)],
  },
  {
    id: 'crate',
    name: 'Wooden Crate',
    tagline: 'The classic prop: body, frame rails, and cross braces.',
    build: () => [
      P('box', 'Body', [0, 0.5, 0], [1, 1, 1], 1),
      P('box', 'Top Rail', [0, 0.98, 0], [1.08, 0.1, 1.08], 2),
      P('box', 'Bottom Rail', [0, 0.05, 0], [1.08, 0.1, 1.08], 2),
      P('box', 'Brace A', [0, 0.5, 0.53], [1.3, 0.1, 0.05], 2, [0, 0, 0.785]),
      P('box', 'Brace B', [0, 0.5, 0.53], [1.3, 0.1, 0.05], 2, [0, 0, -0.785]),
    ],
  },
  {
    id: 'fence',
    name: 'Fence Segment',
    tagline: 'Two posts, two rails, capped — tile it along a path.',
    build: () => [
      P('box', 'Post Left', [-0.9, 0.55, 0], [0.14, 1.1, 0.14], 2),
      P('box', 'Post Right', [0.9, 0.55, 0], [0.14, 1.1, 0.14], 2),
      P('box', 'Rail Top', [0, 0.85, 0], [1.95, 0.1, 0.07], 1),
      P('box', 'Rail Bottom', [0, 0.38, 0], [1.95, 0.1, 0.07], 1),
      P('cone', 'Cap Left', [-0.9, 1.17, 0], [0.2, 0.14, 0.2], 2),
      P('cone', 'Cap Right', [0.9, 1.17, 0], [0.2, 0.14, 0.2], 2),
    ],
  },
  {
    id: 'barrel',
    name: 'Barrel',
    tagline: 'Cylinder body with banded hoops and a lid.',
    build: () => [
      P('cylinder', 'Body', [0, 0.55, 0], [0.9, 1.1, 0.9], 1),
      P('cylinder', 'Hoop Low', [0, 0.22, 0], [0.95, 0.08, 0.95], 9),
      P('cylinder', 'Hoop High', [0, 0.88, 0], [0.95, 0.08, 0.95], 9),
      P('cylinder', 'Lid', [0, 1.13, 0], [0.78, 0.07, 0.78], 2),
    ],
  },
  {
    id: 'tile',
    name: 'Floor Tile',
    tagline: 'A 2x2 stone tile with an inset face — snap them into floors.',
    build: () => [
      P('box', 'Base', [0, 0.05, 0], [2, 0.1, 2], 4),
      P('box', 'Inset', [0, 0.11, 0], [1.7, 0.04, 1.7], 3),
    ],
  },
  {
    id: 'arch',
    name: 'Stone Arch',
    tagline: 'Two pillars and a lintel — a doorway or ruin in one drop.',
    build: () => [
      P('box', 'Pillar Left', [-0.8, 1, 0], [0.4, 2, 0.4], 3),
      P('box', 'Pillar Right', [0.8, 1, 0], [0.4, 2, 0.4], 3),
      P('box', 'Lintel', [0, 2.2, 0], [2.4, 0.4, 0.5], 3),
      P('box', 'Cap', [0, 2.46, 0], [2.6, 0.12, 0.6], 4),
    ],
  },
];

export const getModelStarter = (starterId: string): ModelStarter | undefined =>
  MODEL_STARTERS.find((starter) => starter.id === starterId);

export function modelSpecFromStarter(starterId: string, id: string, name?: string): ModelSpec | null {
  const starter = getModelStarter(starterId);
  if (!starter) return null;
  return { id, name: name ?? starter.name, palette: [...DEFAULT_MODEL_PALETTE], parts: starter.build(), style: { ...DEFAULT_MODEL_STYLE } };
}

/** The one-crate library a fresh project starts with, so the Model Forge never opens empty. */
export function defaultModelLibrary(): ModelSpec[] {
  return [modelSpecFromStarter('crate', 'model-starter-crate')!];
}
