import type { GraphNodeKind, GraphValueType } from '../../types';

/** Static output type of a value-producing node, used to color ports and validate wires. */
export const outputTypeOf: Partial<Record<GraphNodeKind, GraphValueType>> = {
  'value.number': 'number',
  'value.random': 'number',
  'math.add': 'number',
  'math.subtract': 'number',
  'math.multiply': 'number',
  'math.divide': 'number',
  'math.modulo': 'number',
  'math.clamp': 'number',
  'math.lerp': 'number',
  'math.distance': 'number',
  'math.mapRange': 'number',
  'math.floor': 'number',
  'math.vectorLength': 'number',
  'math.dot': 'number',
  'animator.getParam': 'number',
  'query.vehicleSpeed': 'number',
  'event.receiveDamage': 'number',
  'event.land': 'number',
  'value.string': 'string',
  'animator.getState': 'string',
  'value.boolean': 'boolean',
  'logic.compare': 'boolean',
  'logic.and': 'boolean',
  'logic.or': 'boolean',
  'logic.not': 'boolean',
  'query.grounded': 'boolean',
  'save.has': 'boolean',
  'query.getTimeOfDay': 'number',
  'query.raycast': 'boolean',
  'query.overlapSphere': 'boolean',
  'query.cableTension': 'number',
  'math.abs': 'number',
  'math.min': 'number',
  'math.max': 'number',
  'math.round': 'number',
  'math.power': 'number',
  'math.sin': 'number',
  'math.cos': 'number',
  'string.append': 'string',
  'value.vector3': 'vector3',
  'ai.playerLocation': 'vector3',
  'input.move': 'vector3',
  'input.driveInput': 'vector3',
  'math.vectorAdd': 'vector3',
  'math.vectorSubtract': 'vector3',
  'math.vectorScale': 'vector3',
  'math.normalize': 'vector3',
  'math.makeVector': 'vector3',
  'action.getPosition': 'vector3',
  'action.getRotation': 'vector3',
  'action.getScale': 'vector3',
  'query.velocity': 'vector3',
  'ai.hasLineOfSight': 'boolean',
  'query.sphereCast': 'boolean',
};

/** Resolve the data type leaving a specific source handle (multi-out nodes differ per pin). */
export const outputTypeForHandle = (
  kind: GraphNodeKind,
  sourceHandle?: string | null,
  fallback?: GraphValueType,
): GraphValueType | 'any' | 'exec' => {
  if ((sourceHandle ?? '').startsWith('exec')) return 'exec';
  if (kind === 'query.raycast' || kind === 'query.sphereCast' || kind === 'query.overlapSphere') {
    if (sourceHandle === 'actor') return 'any';
    if (sourceHandle === 'point' || sourceHandle === 'normal') return 'vector3';
    if (sourceHandle === 'distance' || sourceHandle === 'count') return 'number';
    return 'boolean';
  }
  if (
    kind === 'event.collisionEnter' ||
    kind === 'event.collisionExit' ||
    kind === 'event.triggerEnter' ||
    kind === 'event.triggerExit'
  ) {
    if (sourceHandle === 'normal' || sourceHandle === 'point') return 'vector3';
    if (sourceHandle === 'speed') return 'number';
    return 'any';
  }
  return outputTypeOf[kind] ?? fallback ?? 'any';
};

/** Expected type for a value input pin (handle id + owning kind). Exec pins return 'exec'. */
export const inputTypeForHandle = (
  kind: GraphNodeKind,
  targetHandle?: string | null,
  nodeValueType?: GraphValueType,
): GraphValueType | 'any' | 'exec' => {
  const handle = targetHandle ?? 'exec-in';
  if (handle.startsWith('exec') || handle === 'exec-in') return 'exec';
  if (handle === 'condition' || handle === 'on') return 'boolean';
  if (
    handle === 'vector' ||
    handle === 'position' ||
    handle === 'rotation' ||
    handle === 'scale' ||
    handle === 'point' ||
    handle === 'location' ||
    handle === 'direction' ||
    handle === 'normal' ||
    handle === 'torque'
  ) {
    return 'vector3';
  }
  if (handle === 'message' || handle === 'text' || handle === 'rowKey') return 'string';
  if (handle === 'target' || handle === 'object' || handle === 'actor') return 'any';
  if (kind === 'variable.set' || kind === 'variable.setObject') return nodeValueType ?? 'any';
  if (kind === 'string.append') return 'string';
  if (
    kind === 'math.vectorAdd' ||
    kind === 'math.vectorSubtract' ||
    kind === 'math.distance' ||
    kind === 'math.dot'
  ) {
    if (handle === 'a' || handle === 'b') return 'vector3';
  }
  if (kind === 'logic.select' && (handle === 'a' || handle === 'b')) return 'any';
  if (kind === 'logic.compare' && (handle === 'a' || handle === 'b')) return 'any';
  return 'number';
};

/** True when a value wire from `source` may land on `target`. `any` is a wild card on either side. */
export const valueTypesCompatible = (
  source: GraphValueType | 'any' | 'exec',
  target: GraphValueType | 'any' | 'exec',
): boolean => {
  if (source === 'exec' || target === 'exec') return source === target;
  if (source === 'any' || target === 'any') return true;
  return source === target;
};
