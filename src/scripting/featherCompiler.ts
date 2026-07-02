import type { Edge } from '@xyflow/react';
import { categoryByKind, makeNodeData } from '../store/editor/graph';
import { layoutGraphNodes } from '../store/editor/graphRuntime';
import { makeId } from '../store/editor/ids';
import type {
  BlueprintVariable,
  GraphNodeKind,
  GraphValue,
  GraphValueType,
  NodeForgeNode,
  NodeForgeNodeData,
  ProjectGraph,
  ProjectVariable,
  ScriptBlueprint,
  Vector3Tuple,
} from '../types';
import {
  parseFeatherScript,
  type FeatherDiagnostic,
  type FeatherExpression,
  type FeatherFunctionDeclaration,
  type FeatherStatement,
  type FeatherVariableDeclaration,
  type FeatherEventHandler,
} from './featherParser';

export interface FeatherCompileResult {
  ok: boolean;
  diagnostics: FeatherDiagnostic[];
  graph?: ProjectGraph;
  blueprint?: ScriptBlueprint;
}

interface FeatherCompileOptions {
  source: string;
  blueprint: ScriptBlueprint;
  graph: ProjectGraph;
  variables: ProjectVariable[];
  preserveSource?: boolean;
}

interface CompiledChain {
  first?: string;
  exits: string[];
}

interface ParsedCall {
  callee: string;
  positional: string[];
  named: Map<string, string>;
}

const VALID_TYPES = new Set<GraphValueType>(['number', 'string', 'boolean', 'vector3']);
const COMPARATORS = ['==', '!=', '>=', '<=', '>', '<'] as const;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A value source: a node plus the output pin to read from (event roots expose args on named pins). */
interface ValueRef {
  nodeId: string;
  sourceHandle: string;
}

/** Bare-identifier callees the language/printer owns — never treated as user Call Function targets. */
const RESERVED_CALLEES = new Set([
  'print', 'wait', 'destroy', 'fire_event', 'apply_damage', 'apply_force', 'apply_impulse', 'apply_torque',
  'set_var', 'get_var', 'set_position', 'set_rotation', 'set_scale', 'look_at', 'set_velocity', 'set_physics',
  'set_visible', 'set_active', 'spawn_object', 'spawn_prefab', 'explode', 'cooldown', 'do_once', 'cast',
  'find_actor', 'find_actors', 'raycast', 'overlap_sphere', 'velocity', 'cable_tension', 'position', 'rotation',
  'scale', 'node_value', 'last_spawned', 'cycle', 'vec3', 'min', 'max', 'clamp', 'lerp', 'distance', 'normalize',
  'length', 'dot', 'map_range', 'abs', 'round', 'floor', 'sin', 'cos', 'pow', 'random', 'random_int', 'range',
  'if', 'else', 'elif', 'for', 'while', 'match', 'return', 'pass', 'on', 'function', 'var', 'blueprint',
  'detached', 'none', 'true', 'false', 'self', 'other', 'payload',
]);

const sanitizeIdentifier = (value: string | undefined, fallback: string): string => {
  const cleaned = (value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const candidate = cleaned || fallback;
  return /^[A-Za-z_]/.test(candidate) ? candidate : `_${candidate}`;
};

const unquote = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!/^(['"]).*\1$/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed.replace(/^'|'$/g, '"'));
  } catch {
    return trimmed.slice(1, -1);
  }
};

const splitTopLevel = (value: string, delimiter = ','): string[] => {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
};

const findTopLevelToken = (value: string, token: string): number => {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i <= value.length - token.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && value.slice(i, i + token.length) === token) return i;
  }
  return -1;
};

const parseCall = (raw: string): ParsedCall | undefined => {
  const trimmed = raw.trim();
  const open = trimmed.indexOf('(');
  if (open <= 0 || !trimmed.endsWith(')')) return undefined;
  const callee = trimmed.slice(0, open).trim();
  const args = splitTopLevel(trimmed.slice(open + 1, -1));
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (const arg of args) {
    const colon = findTopLevelToken(arg, ':');
    if (colon > 0) named.set(arg.slice(0, colon).trim(), arg.slice(colon + 1).trim());
    else positional.push(arg);
  }
  return { callee, positional, named };
};

const parseType = (typeName: string | undefined, fallback: GraphValueType): GraphValueType =>
  VALID_TYPES.has(typeName as GraphValueType) ? (typeName as GraphValueType) : fallback;

const inferLiteralType = (raw: string): GraphValueType => {
  const literal = parseLiteral(raw);
  if (Array.isArray(literal)) return 'vector3';
  if (typeof literal === 'boolean') return 'boolean';
  if (typeof literal === 'string') return 'string';
  return 'number';
};

const parseLiteral = (raw: string | undefined): GraphValue | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const quoted = unquote(trimmed);
  if (quoted !== undefined) return quoted;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const number = Number(trimmed);
  if (Number.isFinite(number)) return number;
  const vector = trimmed.match(/^vec3\((.*)\)$/);
  if (vector) {
    const [x = '0', y = '0', z = '0'] = splitTopLevel(vector[1]);
    return [Number(x) || 0, Number(y) || 0, Number(z) || 0] as Vector3Tuple;
  }
  return undefined;
};

const dataForLiteral = (value: GraphValue | undefined, fallbackType: GraphValueType): Partial<NodeForgeNodeData> => {
  const type = value === undefined ? fallbackType : Array.isArray(value) ? 'vector3' : typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'string' : 'number';
  if (type === 'string') return { valueType: 'string', stringValue: String(value ?? '') };
  if (type === 'boolean') return { valueType: 'boolean', booleanValue: Boolean(value) };
  if (type === 'vector3') return { valueType: 'vector3', vectorValue: (Array.isArray(value) ? value : [0, 0, 0]) as Vector3Tuple };
  return { valueType: 'number', numberValue: Number(value ?? 0) };
};

const literalNodeLabel = (value: GraphValue): string => {
  if (Array.isArray(value)) return 'Vector3';
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'string') return 'String';
  return 'Number';
};

class FeatherGraphBuilder {
  private readonly nodes: NodeForgeNode[] = [];
  private readonly edges: Edge[] = [];
  private readonly diagnostics: FeatherDiagnostic[] = [];
  private readonly projectVariableByName: Map<string, ProjectVariable>;
  /** The event/function root being compiled — binds its arg identifiers (payload/amount/a/b/c). */
  private currentRoot?: NodeForgeNode;
  private cursorY = 60;

  constructor(
    private readonly blueprint: ScriptBlueprint,
    variables: ProjectVariable[],
  ) {
    this.projectVariableByName = new Map(variables.map((variable) => [sanitizeIdentifier(variable.name, variable.id), variable]));
  }

  graph(name: string, id: string): ProjectGraph {
    return {
      id,
      name,
      nodes: layoutGraphNodes(this.nodes, this.edges),
      edges: this.edges,
    };
  }

  warning(loc: FeatherExpression['loc'] | FeatherStatement, message: string) {
    this.diagnostics.push({
      severity: 'warning',
      message,
      line: loc.line,
      column: loc.column,
      length: loc.length,
    });
  }

  compileHandler(handler: FeatherEventHandler) {
    const root = this.createEventNode(handler);
    this.currentRoot = root;
    const chain = this.compileStatements(handler.body);
    if (chain.first) this.exec(root.id, chain.first);
    this.currentRoot = undefined;
  }

  compileFunction(fn: FeatherFunctionDeclaration) {
    const root = this.addNode('event.functionEntry', { functionName: sanitizeIdentifier(fn.name, 'MyFunction') }, 0);
    this.currentRoot = root;
    const chain = this.compileStatements(fn.body);
    if (chain.first) this.exec(root.id, chain.first);
    this.currentRoot = undefined;
  }

  compileDetached(statements: FeatherStatement[]) {
    this.currentRoot = undefined;
    this.compileStatements(statements);
  }

  diagnosticsList(): FeatherDiagnostic[] {
    return this.diagnostics;
  }

  private compileStatements(statements: FeatherStatement[]): CompiledChain {
    let first: string | undefined;
    let exits: string[] = [];

    for (const statement of statements) {
      const compiled = this.compileStatement(statement);
      if (!compiled.first) continue;
      if (!first) first = compiled.first;
      for (const exit of exits) this.exec(exit, compiled.first);
      exits = compiled.exits;
    }

    return { first, exits };
  }

  private compileStatement(statement: FeatherStatement): CompiledChain {
    switch (statement.kind) {
      case 'PassStatement':
        return { exits: [] };
      case 'ExpressionStatement':
        return this.compileExpressionStatement(statement.expression);
      case 'AssignmentStatement':
        return this.compileAssignment(statement);
      case 'ReturnStatement':
        return this.compileReturn(statement);
      case 'IfStatement':
        return this.compileIf(statement);
      case 'ForStatement':
      case 'WhileStatement':
      case 'MatchStatement':
      case 'LabelBlock':
      case 'ErrorStatement':
        return this.comment(statement, `Unsupported FeatherScript block: ${statement.kind}`);
      default:
        return { exits: [] };
    }
  }

  private compileIf(statement: Extract<FeatherStatement, { kind: 'IfStatement' }>): CompiledChain {
    const branch = this.addNode('logic.branch', { booleanValue: true }, 1);
    const condition = this.compileValueExpression(statement.test.raw, 'boolean', 0);
    if (condition) this.value(condition, branch.id, 'condition');
    const consequent = this.compileStatements(statement.consequent);
    if (consequent.first) this.exec(branch.id, consequent.first);
    if (statement.alternates.length) {
      this.warning(statement, 'Else/elif blocks are preserved as comments until FeatherScript gets a false-path graph pin.');
      this.addNode('comment.note', { message: 'Unsupported else/elif branch from FeatherScript apply.' }, 1);
    }
    return { first: branch.id, exits: consequent.exits.length ? consequent.exits : [branch.id] };
  }

  private compileReturn(statement: Extract<FeatherStatement, { kind: 'ReturnStatement' }>): CompiledChain {
    const node = this.addNode('logic.functionReturn', {}, 1);
    if (statement.value && statement.value.raw !== 'none') {
      const valueRef = this.compileValueExpression(statement.value.raw, inferLiteralType(statement.value.raw), 0);
      if (valueRef) this.value(valueRef, node.id, 'value');
    }
    return { first: node.id, exits: [] };
  }

  private compileAssignment(statement: Extract<FeatherStatement, { kind: 'AssignmentStatement' }>): CompiledChain {
    if (statement.operator !== '=') {
      return this.comment(statement, `Unsupported assignment operator "${statement.operator}" for ${statement.target}.`);
    }

    if (statement.target === 'Time.scale') {
      const node = this.addNode('action.setTimeScale', {}, 1);
      this.attachValueOrLiteral(node, 'scale', statement.value.raw, 'number', 'numberValue');
      return { first: node.id, exits: [node.id] };
    }

    const gameVariable = statement.target.match(/^Game\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (gameVariable) {
      const variable = this.projectVariableByName.get(gameVariable[1]);
      if (!variable) return this.comment(statement, `Unknown project variable "${gameVariable[1]}".`);
      const node = this.addNode('variable.set', { variableId: variable.id, valueType: variable.type }, 1);
      this.attachValueOrLiteral(node, 'value', statement.value.raw, variable.type);
      return { first: node.id, exits: [node.id] };
    }

    const objectVariable = statement.target.match(/^self\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (objectVariable) {
      const node = this.addNode('variable.setObject', { objectKey: objectVariable[1], targetObjectId: '$self' }, 1);
      this.attachValueOrLiteral(node, 'value', statement.value.raw, inferLiteralType(statement.value.raw));
      return { first: node.id, exits: [node.id] };
    }

    return this.comment(statement, `Unsupported assignment target "${statement.target}".`);
  }

  private compileExpressionStatement(expression: FeatherExpression): CompiledChain {
    const call = parseCall(expression.raw);
    if (!call) return this.comment(expression, `Unsupported expression: ${expression.raw}`);

    const node = this.nodeForCall(call);
    if (!node) return this.comment(expression, `Unsupported call: ${expression.raw}`);
    return { first: node.id, exits: [node.id] };
  }

  private nodeForCall(call: ParsedCall): NodeForgeNode | undefined {
    const stringArg = (name: string, index: number, fallback = '') => unquote(call.named.get(name) ?? call.positional[index] ?? '') ?? fallback;
    const rawArg = (name: string, index: number) => call.named.get(name) ?? call.positional[index];
    const numberArg = (name: string, index: number, fallback: number) => {
      const value = parseLiteral(rawArg(name, index));
      return typeof value === 'number' ? value : fallback;
    };

    switch (call.callee) {
      case 'print': {
        const node = this.addNode('action.print', {}, 1);
        this.attachValueOrLiteral(node, 'message', rawArg('message', 0) ?? '""', 'string', 'message');
        return node;
      }
      case 'self.translate': {
        const node = this.addNode('action.translate', { axis: stringArg('axis', 0, 'z') as 'x' | 'y' | 'z', amount: numberArg('amount', 1, -3.6) }, 1);
        // Positional arg 0 is the vector form only when it isn't the quoted axis shorthand.
        const positionalVector = call.positional[0] && unquote(call.positional[0]) === undefined ? call.positional[0] : undefined;
        this.attachWiredValue(node, 'vector', call.named.get('vector') ?? positionalVector, 'vector3');
        this.attachValueOrLiteral(node, 'amount', call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'self.rotate': {
        const node = this.addNode('action.rotate', { axis: stringArg('axis', 0, 'y') as 'x' | 'y' | 'z', amount: numberArg('amount', 1, 90) }, 1);
        this.attachValueOrLiteral(node, 'amount', call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'self.move': {
        const node = this.addNode('action.move', { amount: numberArg('speed', 1, 4) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 0), 'vector3');
        this.attachValueOrLiteral(node, 'speed', call.named.get('speed'), 'number', 'amount');
        return node;
      }
      case 'self.drive': {
        const node = this.addNode('action.drive', {}, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 0) ?? 'Input.drive()', 'vector3');
        return node;
      }
      case 'self.jump':
        return this.addNode('action.jump', {}, 1);
      case 'wait': {
        const node = this.addNode('logic.delay', { numberValue: numberArg('seconds', 0, 1) }, 1);
        this.attachValueOrLiteral(node, 'seconds', rawArg('seconds', 0), 'number', 'numberValue');
        return node;
      }
      case 'destroy':
        return this.addNode('action.destroyObject', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
      case 'fire_event': {
        const node = this.addNode('action.fireEvent', { eventName: stringArg('eventName', 0, 'CustomEvent') }, 1);
        const target = call.named.get('target');
        if (target) node.data = { ...node.data, targetObjectId: this.targetLiteral(target) };
        const payload = call.named.get('payload');
        if (payload) this.attachWiredValue(node, 'payload', payload, inferLiteralType(payload));
        return node;
      }
      case 'apply_damage': {
        const node = this.addNode('action.applyDamage', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 1), 'number', 'damageAmount');
        return node;
      }
      case 'apply_force': {
        const node = this.addNode('action.applyForce', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 2) ?? call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'apply_impulse': {
        const node = this.addNode('action.applyImpulse', { targetObjectId: this.targetLiteral(rawArg('target', 0)) }, 1);
        this.attachWiredValue(node, 'vector', rawArg('vector', 1), 'vector3');
        this.attachValueOrLiteral(node, 'amount', rawArg('amount', 2) ?? call.named.get('amount'), 'number', 'amount');
        return node;
      }
      case 'set_var': {
        const node = this.addNode('variable.setObject', { targetObjectId: this.targetLiteral(rawArg('target', 0)), objectKey: stringArg('key', 1, 'value') }, 1);
        this.attachValueOrLiteral(node, 'value', rawArg('value', 2), inferLiteralType(rawArg('value', 2) ?? '0'));
        return node;
      }
      default:
        // A bare-identifier callee we don't own = a user function → Call Function node (Blueprint
        // function-lite). Positional/named args wire into the A/B/C pins.
        if (IDENTIFIER.test(call.callee) && !RESERVED_CALLEES.has(call.callee)) return this.buildCallFunction(call, 1);
        return undefined;
    }
  }

  private buildCallFunction(call: ParsedCall, depth: number): NodeForgeNode {
    const node = this.addNode('logic.callFunction', { functionName: sanitizeIdentifier(call.callee, 'MyFunction') }, depth);
    (['a', 'b', 'c'] as const).forEach((handle, index) => {
      const raw = call.named.get(handle) ?? call.positional[index];
      if (raw !== undefined) this.attachWiredValue(node, handle, raw, 'number');
    });
    return node;
  }

  private attachValueOrLiteral(
    node: NodeForgeNode,
    handle: string,
    raw: string | undefined,
    fallbackType: GraphValueType,
    dataKey?: keyof NodeForgeNodeData,
  ) {
    if (!raw) return;
    const literal = parseLiteral(raw);
    if (literal !== undefined && dataKey) {
      node.data = { ...node.data, [dataKey]: literal };
      return;
    }
    if (literal !== undefined && !dataKey) {
      node.data = { ...node.data, ...dataForLiteral(literal, fallbackType) };
      return;
    }
    const valueRef = this.compileValueExpression(raw, fallbackType, 0);
    if (valueRef) this.value(valueRef, node.id, handle);
  }

  /** Always materialize the value as a wired node — for inputs the runtime ONLY reads via an edge
   *  (vectors on Translate/Move/Drive/Apply Force/Apply Impulse, Fire Event payload). */
  private attachWiredValue(node: NodeForgeNode, handle: string, raw: string | undefined, fallbackType: GraphValueType) {
    if (raw === undefined) return;
    const valueRef = this.compileValueExpression(raw, fallbackType, 0);
    if (valueRef) this.value(valueRef, node.id, handle);
  }

  private compileValueExpression(raw: string | undefined, fallbackType: GraphValueType, depth: number): ValueRef | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim().replace(/^\((.*)\)$/, '$1').trim();
    const ref = (node: NodeForgeNode): ValueRef => ({ nodeId: node.id, sourceHandle: 'value-out' });
    const literal = parseLiteral(trimmed);
    if (literal !== undefined) {
      return ref(this.addNode(makeNodeData(literalNodeLabel(literal), 'Values').nodeKind, dataForLiteral(literal, fallbackType), depth));
    }

    const variable = trimmed.match(/^Game\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (variable) {
      const found = this.projectVariableByName.get(variable[1]);
      if (!found) {
        this.warning({ line: 1, column: 1, length: 1 }, `Unknown project variable "${variable[1]}".`);
        return undefined;
      }
      return ref(this.addNode('variable.get', { variableId: found.id, valueType: found.type }, depth));
    }

    const objectVariable = trimmed.match(/^self\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (objectVariable) return ref(this.addNode('variable.getObject', { objectKey: objectVariable[1], targetObjectId: '$self' }, depth));

    // Identifiers bound by the enclosing event/function root: the custom-event payload, the
    // incoming damage amount, and function arguments read straight off the root's output pins.
    if (IDENTIFIER.test(trimmed) && this.currentRoot) {
      const rootKind = this.currentRoot.data.nodeKind;
      if (trimmed === 'payload' && rootKind === 'event.custom') return { nodeId: this.currentRoot.id, sourceHandle: 'value-out' };
      if (trimmed === 'amount' && rootKind === 'event.receiveDamage') return { nodeId: this.currentRoot.id, sourceHandle: 'value-out' };
      if ((trimmed === 'a' || trimmed === 'b' || trimmed === 'c') && rootKind === 'event.functionEntry') {
        return { nodeId: this.currentRoot.id, sourceHandle: `arg-${trimmed}` };
      }
    }

    if (trimmed === 'Input.move()') return ref(this.addNode('input.move', {}, depth));
    if (trimmed === 'Input.drive()') return ref(this.addNode('input.driveInput', {}, depth));
    if (trimmed === 'self.is_grounded()') return ref(this.addNode('query.grounded', {}, depth));
    if (trimmed === 'self.vehicle_speed()') return ref(this.addNode('query.vehicleSpeed', {}, depth));

    const call = parseCall(trimmed);
    if (call?.callee === 'vec3') {
      const values = call.positional.map((item) => Number(parseLiteral(item) ?? 0));
      return ref(this.addNode('value.vector3', { vectorValue: [values[0] || 0, values[1] || 0, values[2] || 0] as Vector3Tuple }, depth));
    }
    if (call?.callee === 'get_var') {
      const target = this.targetLiteral(call.named.get('target') ?? call.positional[0]) ?? '$self';
      const key = unquote(call.named.get('key') ?? call.positional[1] ?? '') ?? 'value';
      return ref(this.addNode('variable.getObject', { objectKey: key, targetObjectId: target }, depth));
    }
    if (call && IDENTIFIER.test(call.callee) && !RESERVED_CALLEES.has(call.callee)) {
      return ref(this.buildCallFunction(call, depth));
    }

    for (const op of COMPARATORS) {
      const index = findTopLevelToken(trimmed, op);
      if (index > 0) {
        const node = this.addNode('logic.compare', { compareOp: op }, depth);
        const a = this.compileValueExpression(trimmed.slice(0, index), 'number', depth);
        const b = this.compileValueExpression(trimmed.slice(index + op.length), 'number', depth);
        if (a) this.value(a, node.id, 'a');
        if (b) this.value(b, node.id, 'b');
        return ref(node);
      }
    }

    this.warning({ line: 1, column: 1, length: trimmed.length || 1 }, `Unsupported value expression "${trimmed}".`);
    return undefined;
  }

  private createEventNode(handler: FeatherEventHandler): NodeForgeNode {
    switch (handler.eventName) {
      case 'start':
        return this.addNode('event.start', {}, 0);
      case 'update': {
        const every = handler.detail?.match(/^every\s+([0-9.]+)s?$/);
        return this.addNode('event.update', every ? { numberValue: Number(every[1]) || 0 } : {}, 0);
      }
      case 'key_down':
        return this.addNode('event.keyDown', { keyCode: unquote(handler.args[0] ?? '') ?? 'KeyW' }, 0);
      case 'key_up':
        return this.addNode('event.keyUp', { keyCode: unquote(handler.args[0] ?? '') ?? 'KeyW' }, 0);
      case 'collision_enter':
        return this.addNode('event.collisionEnter', this.contactFilter(handler.args), 0);
      case 'collision_exit':
        return this.addNode('event.collisionExit', this.contactFilter(handler.args), 0);
      case 'trigger_enter':
        return this.addNode('event.triggerEnter', this.contactFilter(handler.args), 0);
      case 'trigger_exit':
        return this.addNode('event.triggerExit', this.contactFilter(handler.args), 0);
      case 'interact':
        return this.addNode('event.interact', {}, 0);
      case 'receive_damage':
        return this.addNode('event.receiveDamage', {}, 0);
      case 'timer':
        return this.addNode('event.timer', { numberValue: Number(handler.args[0] ?? 1) || 1 }, 0);
      default:
        return this.addNode('event.custom', { eventName: sanitizeIdentifier(handler.eventName, 'CustomEvent') }, 0);
    }
  }

  private targetLiteral(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const value = unquote(raw) ?? raw.trim();
    if (value === 'self') return '$self';
    if (value === 'Player') return '$player';
    if (value === 'other') return '$trigger';
    return value;
  }

  /** Parse the optional `other: "object-id"` filter on collision/trigger handlers. */
  private contactFilter(args: string[]): Partial<NodeForgeNodeData> {
    for (const arg of args) {
      const match = arg.match(/^other\s*:\s*(.+)$/);
      const id = match ? unquote(match[1]) : undefined;
      if (id) return { otherObjectId: id };
    }
    return {};
  }

  private addNode(kind: GraphNodeKind, data: Partial<NodeForgeNodeData>, depth: number): NodeForgeNode {
    const category = categoryByKind(kind);
    const node: NodeForgeNode = {
      id: makeId('node'),
      type: 'nodeforge',
      position: { x: 80 + depth * 260, y: this.cursorY },
      data: makeNodeData(data.label ?? kind, category, { nodeKind: kind, ...data }),
      ...(kind === 'comment.note' ? { width: 340, height: 140, zIndex: -1 } : {}),
    };
    this.cursorY += 116;
    this.nodes.push(node);
    return node;
  }

  private exec(source: string, target: string, sourceHandle = 'exec-out') {
    this.edges.push({
      id: makeId('edge'),
      source,
      target,
      sourceHandle,
      targetHandle: 'exec-in',
      animated: true,
      type: 'smoothstep',
    });
  }

  private value(source: ValueRef, target: string, targetHandle: string) {
    this.edges.push({
      id: makeId('edge'),
      source: source.nodeId,
      target,
      sourceHandle: source.sourceHandle,
      targetHandle,
      type: 'smoothstep',
      style: { stroke: '#3DD0DC', strokeWidth: 2 },
    });
  }

  private comment(loc: FeatherExpression | FeatherStatement, message: string): CompiledChain {
    this.warning('loc' in loc ? loc.loc : loc, message);
    const node = this.addNode('comment.note', { message }, 1);
    return { first: node.id, exits: [node.id] };
  }
}

const nextBlueprintVariables = (blueprint: ScriptBlueprint, declarations: FeatherVariableDeclaration[]): BlueprintVariable[] => {
  const existingByName = new Map((blueprint.variables ?? []).map((variable) => [sanitizeIdentifier(variable.name, variable.id), variable]));
  return declarations.map((declaration) => {
    const type = parseType(declaration.typeName, declaration.initializer ? inferLiteralType(declaration.initializer.raw) : 'number');
    const previous = existingByName.get(sanitizeIdentifier(declaration.name, 'value'));
    return {
      id: previous?.id ?? makeId('bpv'),
      name: declaration.name,
      type,
      defaultValue: parseLiteral(declaration.initializer?.raw) ?? previous?.defaultValue ?? (type === 'string' ? '' : type === 'boolean' ? false : type === 'vector3' ? [0, 0, 0] : 0),
    };
  });
};

export const compileFeatherScriptToGraph = (options: FeatherCompileOptions): FeatherCompileResult => {
  const parsed = parseFeatherScript(options.source);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length) return { ok: false, diagnostics: parsed.diagnostics };

  const builder = new FeatherGraphBuilder(options.blueprint, options.variables);
  for (const handler of parsed.program.handlers) builder.compileHandler(handler);
  for (const fn of parsed.program.functions) builder.compileFunction(fn);
  if (parsed.program.detached) builder.compileDetached(parsed.program.detached.body);

  const diagnostics = [...parsed.diagnostics, ...builder.diagnosticsList()];
  const nextBlueprint: ScriptBlueprint = {
    ...options.blueprint,
    name: parsed.program.blueprint?.name ? parsed.program.blueprint.name.replace(/_/g, ' ') : options.blueprint.name,
    variables: nextBlueprintVariables(options.blueprint, parsed.program.variables),
    featherSource: options.preserveSource ? options.source : undefined,
  };
  const graph = builder.graph(`${nextBlueprint.name} Graph`, options.graph.id);

  return {
    ok: true,
    diagnostics,
    graph,
    blueprint: nextBlueprint,
  };
};
