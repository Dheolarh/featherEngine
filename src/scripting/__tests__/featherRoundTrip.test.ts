import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { compileFeatherScriptToGraph, type FeatherCompileResult } from '../featherCompiler';
import { graphToFeatherScript } from '../featherScript';
import { parseFeatherScript } from '../featherParser';
import type {
  GraphNodeCategory,
  GraphNodeKind,
  GraphNodeTone,
  NodeForgeNode,
  ProjectGraph,
  ProjectVariable,
  ScriptBlueprint,
} from '../../types';

// The round-trip contract: for every script on the SUPPORTED surface (everything the compiler
// understands), text -> graph -> text is stable and lossless — compiling never emits warnings,
// the reprinted script compiles to the same node/edge structure, and printing that second graph
// reproduces the first print byte-for-byte. This is what makes the Script tab trustworthy as a
// second view of the visual graph rather than a lossy export.

const blueprint: ScriptBlueprint = {
  id: 'bp-test',
  name: 'Test',
  description: '',
  graphId: 'graph-test',
  color: '#3DDC97',
  variables: [],
  createdAt: 1,
};

const emptyGraph: ProjectGraph = { id: 'graph-test', name: 'Test Graph', nodes: [], edges: [] };

const variables: ProjectVariable[] = [
  { id: 'var-score', name: 'Score', type: 'number', defaultValue: 0, persistent: false, createdAt: 1 },
  { id: 'var-title', name: 'Title', type: 'string', defaultValue: '', persistent: false, createdAt: 1 },
];

const compile = (source: string): FeatherCompileResult =>
  compileFeatherScriptToGraph({ blueprint, graph: emptyGraph, variables, source });

const print = (result: FeatherCompileResult): string =>
  graphToFeatherScript({ blueprint: result.blueprint!, graph: result.graph!, variables, blueprints: [result.blueprint!] });

const warningsOf = (result: FeatherCompileResult): string[] =>
  result.diagnostics.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`);

const kindCounts = (graph: ProjectGraph): Record<string, number> =>
  graph.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.data.nodeKind] = (acc[node.data.nodeKind] ?? 0) + 1;
    return acc;
  }, {});

const nodeOf = (graph: ProjectGraph, kind: GraphNodeKind): NodeForgeNode => {
  const node = graph.nodes.find((item) => item.data.nodeKind === kind);
  expect(node, `expected a ${kind} node`).toBeDefined();
  return node!;
};

const valueEdgeInto = (graph: ProjectGraph, targetId: string, targetHandle: string): Edge | undefined =>
  graph.edges.find((edge) => edge.target === targetId && edge.targetHandle === targetHandle);

/** Compile, print, recompile, reprint — assert losslessness and stability at every step. */
const roundTrip = (source: string): { first: FeatherCompileResult; second: FeatherCompileResult; printed: string } => {
  const first = compile(source);
  expect(first.ok, `compile failed: ${warningsOf(first).join(' | ')}`).toBe(true);
  expect(warningsOf(first)).toEqual([]);

  const printed = print(first);
  const second = compile(printed);
  expect(second.ok, `recompile of printed script failed: ${warningsOf(second).join(' | ')}\n${printed}`).toBe(true);
  expect(warningsOf(second), `printed script lost semantics:\n${printed}`).toEqual([]);

  expect(print(second)).toBe(printed);
  expect(kindCounts(second.graph!)).toEqual(kindCounts(first.graph!));
  expect(second.graph!.edges.length).toBe(first.graph!.edges.length);
  return { first, second, printed };
};

describe('FeatherScript round-trip: text -> graph -> text', () => {
  it('events, typed variables, branch on a project variable', () => {
    const { printed } = roundTrip(
      [
        'blueprint Player',
        '',
        'var Health: number = 100',
        'var Label: string = "Knight"',
        'var Armed: boolean = true',
        'var Home: vector3 = vec3(0, 2, 0)',
        '',
        'on start:',
        '    print("Ready")',
        '    self.translate(axis: "x", amount: 2)',
        '',
        'on update(dt):',
        '    if (Game.Score > 10):',
        '        self.jump()',
      ].join('\n'),
    );

    expect(printed).toContain('var Health: number = 100');
    expect(printed).toContain('var Home: vector3 = vec3(0, 2, 0)');
    expect(printed).toContain('print("Ready")');
    expect(printed).toContain('self.translate(axis: "x", amount: 2)');
    expect(printed).toContain('if (Game.Score > 10):');
  });

  it('throttled update, wait chains, rotate', () => {
    const { printed } = roundTrip(
      ['blueprint Turret', '', 'on update every 0.5s:', '    wait(1.5)', '    self.rotate(axis: "y", amount: 90)'].join('\n'),
    );

    expect(printed).toContain('on update every 0.5s:');
    expect(printed).toContain('wait(1.5)');
  });

  it('vector arguments become wired value nodes the runtime actually reads', () => {
    const { first } = roundTrip(
      [
        'blueprint Pawn',
        '',
        'on key_down("KeyW"):',
        '    self.move(vec3(0, 0, 1), speed: 4)',
        '    self.translate(vec3(0, 1, 0))',
        '',
        'on key_up("KeyW"):',
        '    self.drive(Input.drive())',
        '    apply_impulse(self, vector: vec3(0, 6, 0), amount: 8)',
      ].join('\n'),
    );

    // The Play runtime reads these vectors ONLY from a wired edge (never from node data),
    // so the compiler must materialize literal vectors as wired Vector3 value nodes.
    const graph = first.graph!;
    for (const kind of ['action.move', 'action.translate', 'action.applyImpulse'] as GraphNodeKind[]) {
      const node = nodeOf(graph, kind);
      expect(valueEdgeInto(graph, node.id, 'vector'), `${kind} must have a wired vector input`).toBeDefined();
    }
    expect(valueEdgeInto(graph, nodeOf(graph, 'action.drive').id, 'vector')).toBeDefined();
  });

  it('collision filters and fire_event target/payload survive', () => {
    const { first, second, printed } = roundTrip(
      [
        'blueprint Bomb',
        '',
        'on collision_enter(other: "obj-wall"):',
        '    fire_event("Exploded", target: other, payload: Game.Score)',
        '    destroy(self)',
        '',
        'on trigger_enter(other):',
        '    apply_damage(other, 25)',
      ].join('\n'),
    );

    expect(printed).toContain('on collision_enter(other: "obj-wall"):');
    expect(printed).toContain('fire_event("Exploded", target: other, payload: Game.Score)');
    for (const result of [first, second]) {
      const graph = result.graph!;
      expect(nodeOf(graph, 'event.collisionEnter').data.otherObjectId).toBe('obj-wall');
      const fire = nodeOf(graph, 'action.fireEvent');
      expect(fire.data.targetObjectId).toBe('$trigger');
      expect(valueEdgeInto(graph, fire.id, 'payload')).toBeDefined();
      expect(nodeOf(graph, 'action.applyDamage').data.targetObjectId).toBe('$trigger');
    }
  });

  it('event payload and damage amount are usable as values', () => {
    const { first, printed } = roundTrip(
      [
        'blueprint Health',
        '',
        'on event Hit(payload):',
        '    print(payload)',
        '',
        'on receive_damage(amount):',
        '    if (amount > 20):',
        '        destroy(self)',
      ].join('\n'),
    );

    expect(printed).toContain('print(payload)');
    expect(printed).toContain('if (amount > 20):');
    const graph = first.graph!;
    const custom = nodeOf(graph, 'event.custom');
    const printNode = nodeOf(graph, 'action.print');
    expect(graph.edges.some((edge) => edge.source === custom.id && edge.target === printNode.id && edge.targetHandle === 'message')).toBe(true);
    const damage = nodeOf(graph, 'event.receiveDamage');
    const compare = nodeOf(graph, 'logic.compare');
    expect(graph.edges.some((edge) => edge.source === damage.id && edge.target === compare.id && edge.targetHandle === 'a')).toBe(true);
  });

  it('functions: argument pins, calls with wired args, return values', () => {
    const { first, printed } = roundTrip(
      [
        'blueprint Util',
        '',
        'on start:',
        '    Boost(8, 2)',
        '',
        'function Boost(a, b, c):',
        '    apply_impulse(self, vector: vec3(0, 1, 0), amount: a)',
        '    return b',
      ].join('\n'),
    );

    expect(printed).toContain('Boost(8, 2)');
    expect(printed).toContain('function Boost(a, b, c):');
    expect(printed).toContain('return b');
    const graph = first.graph!;
    const call = nodeOf(graph, 'logic.callFunction');
    expect(call.data.functionName).toBe('Boost');
    expect(valueEdgeInto(graph, call.id, 'a')).toBeDefined();
    expect(valueEdgeInto(graph, call.id, 'b')).toBeDefined();
    const entry = nodeOf(graph, 'event.functionEntry');
    const impulse = nodeOf(graph, 'action.applyImpulse');
    expect(graph.edges.some((edge) => edge.source === entry.id && edge.sourceHandle === 'arg-a' && edge.target === impulse.id && edge.targetHandle === 'amount')).toBe(true);
    const ret = nodeOf(graph, 'logic.functionReturn');
    expect(graph.edges.some((edge) => edge.source === entry.id && edge.sourceHandle === 'arg-b' && edge.target === ret.id && edge.targetHandle === 'value')).toBe(true);
  });

  it('bare return prints without a phantom value', () => {
    const { printed } = roundTrip(['blueprint Util', '', 'function Stop(a, b, c):', '    return'].join('\n'));
    expect(printed).toContain('    return');
    expect(printed).not.toContain('return none');
  });

  it('assignments, instance/object variables, time scale, quoted "="', () => {
    const { printed } = roundTrip(
      [
        'blueprint Store',
        '',
        'on start:',
        '    Game.Score = 25',
        '    self.hp = 5',
        '    Time.scale = 0.5',
        '    set_var(other, "shield", 3)',
        '    print(self.hp)',
        '    print(get_var(other, "shield"))',
        '    print("Score = 10")',
      ].join('\n'),
    );

    expect(printed).toContain('Game.Score = 25');
    expect(printed).toContain('self.hp = 5');
    expect(printed).toContain('Time.scale = 0.5');
    expect(printed).toContain('set_var(other, "shield", 3)');
    expect(printed).toContain('print(self.hp)');
    expect(printed).toContain('print(get_var(other, "shield"))');
    expect(printed).toContain('print("Score = 10")');
  });

  it('timer, interact, and custom-event firing', () => {
    const { printed } = roundTrip(
      [
        'blueprint Door',
        '',
        'on timer(2):',
        '    fire_event("Pulse")',
        '',
        'on interact(player):',
        '    self.jump()',
      ].join('\n'),
    );
    expect(printed).toContain('on timer(2):');
    expect(printed).toContain('fire_event("Pulse")');
  });
});

// ----- graph -> text -> graph: a visual-editor-authored blueprint survives the script view -----

const nodeTone = (kind: GraphNodeKind): GraphNodeTone => {
  if (kind.startsWith('event.')) return 'event';
  if (kind.startsWith('logic.')) return 'logic';
  if (kind.startsWith('value.') || kind === 'variable.get') return 'value';
  return 'runtime';
};

const nodeCategory = (kind: GraphNodeKind): GraphNodeCategory => {
  if (kind.startsWith('event.')) return 'Events';
  if (kind.startsWith('logic.')) return 'Logic';
  if (kind.startsWith('value.')) return 'Values';
  if (kind.startsWith('variable.')) return 'Variables';
  return 'Runtime';
};

const makeNode = (id: string, kind: GraphNodeKind, x: number, y: number, data: Partial<NodeForgeNode['data']> = {}): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x, y },
  data: { label: id, nodeKind: kind, category: nodeCategory(kind), description: '', tone: nodeTone(kind), ...data },
});

describe('FeatherScript round-trip: graph -> text -> graph', () => {
  it('a visual blueprint prints to a script that recompiles without loss', () => {
    const authored: ProjectGraph = {
      id: 'graph-test',
      name: 'Test Graph',
      nodes: [
        makeNode('start', 'event.start', 0, 0),
        makeNode('ready', 'action.print', 260, 0, { message: 'Ready' }),
        makeNode('update', 'event.update', 0, 180),
        makeNode('branch', 'logic.branch', 300, 180),
        makeNode('score', 'variable.get', 40, 360, { variableId: 'var-score', valueType: 'number', hasInput: false }),
        makeNode('ten', 'value.number', 40, 520, { numberValue: 10, hasInput: false }),
        makeNode('compare', 'logic.compare', 300, 420, { compareOp: '>', hasInput: false }),
        makeNode('move', 'action.translate', 560, 180, { axis: 'z', amount: 5 }),
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ready', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
        { id: 'e2', source: 'update', target: 'branch', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
        { id: 'e3', source: 'branch', target: 'move', sourceHandle: 'exec-out', targetHandle: 'exec-in' },
        { id: 'e4', source: 'score', target: 'compare', sourceHandle: 'value-out', targetHandle: 'a' },
        { id: 'e5', source: 'ten', target: 'compare', sourceHandle: 'value-out', targetHandle: 'b' },
        { id: 'e6', source: 'compare', target: 'branch', sourceHandle: 'value-out', targetHandle: 'condition' },
      ],
    };

    const printed = graphToFeatherScript({ blueprint, graph: authored, variables, blueprints: [blueprint] });
    expect(parseFeatherScript(printed).diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

    const compiled = compileFeatherScriptToGraph({ blueprint, graph: authored, variables, source: printed });
    expect(compiled.ok).toBe(true);
    expect(warningsOf(compiled), `script view lost visual-graph semantics:\n${printed}`).toEqual([]);

    // Same behavior-carrying structure (the recompiled graph may add explicit literal nodes,
    // e.g. "if true:" materializing a Boolean, but must keep every original kind).
    const originalKinds = kindCounts(authored);
    const recompiledKinds = kindCounts(compiled.graph!);
    for (const [kind, count] of Object.entries(originalKinds)) {
      expect(recompiledKinds[kind], `missing ${kind} after round-trip`).toBeGreaterThanOrEqual(count);
    }

    const translate = nodeOf(compiled.graph!, 'action.translate');
    expect(translate.data.axis).toBe('z');
    expect(translate.data.amount).toBe(5);
    expect(nodeOf(compiled.graph!, 'variable.get').data.variableId).toBe('var-score');

    // And the script view of the recompiled graph is identical — printing is a fixpoint.
    const reprinted = graphToFeatherScript({
      blueprint: compiled.blueprint!,
      graph: compiled.graph!,
      variables,
      blueprints: [compiled.blueprint!],
    });
    expect(reprinted).toBe(printed);
  });
});
