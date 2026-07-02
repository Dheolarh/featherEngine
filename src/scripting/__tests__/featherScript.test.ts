import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { parseFeatherScript } from '../featherParser';
import { graphToFeatherScript } from '../featherScript';
import type {
  BlueprintVariable,
  GraphNodeCategory,
  GraphNodeKind,
  GraphNodeTone,
  NodeForgeNode,
  ProjectGraph,
  ProjectVariable,
  ScriptBlueprint,
} from '../../types';

const nodeTone = (kind: GraphNodeKind): GraphNodeTone => {
  if (kind.startsWith('event.')) return 'event';
  if (kind.startsWith('logic.')) return 'logic';
  if (kind.startsWith('value.') || kind.startsWith('math.') || kind === 'variable.get') return 'value';
  return 'runtime';
};

const nodeCategory = (kind: GraphNodeKind): GraphNodeCategory => {
  if (kind.startsWith('event.')) return 'Events';
  if (kind.startsWith('logic.')) return 'Logic';
  if (kind.startsWith('value.')) return 'Values';
  if (kind.startsWith('math.')) return 'Math';
  if (kind.startsWith('variable.')) return 'Variables';
  return 'Runtime';
};

const makeNode = (
  id: string,
  kind: GraphNodeKind,
  x: number,
  y: number,
  data: Partial<NodeForgeNode['data']> = {},
): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x, y },
  data: {
    label: id,
    nodeKind: kind,
    category: nodeCategory(kind),
    description: '',
    tone: nodeTone(kind),
    ...data,
  },
});

const execEdge = (id: string, source: string, target: string, sourceHandle = 'exec-out'): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle: 'exec-in',
});

const valueEdge = (id: string, source: string, target: string, targetHandle: string, sourceHandle = 'value-out'): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
});

describe('graphToFeatherScript', () => {
  it('prints a readable script view from a visual blueprint graph', () => {
    const speed: BlueprintVariable = { id: 'bpv-speed', name: 'Speed', type: 'number', defaultValue: 6 };
    const score: ProjectVariable = { id: 'var-score', name: 'Score', type: 'number', defaultValue: 0, persistent: false, createdAt: 1 };
    const blueprint: ScriptBlueprint = {
      id: 'bp-player',
      name: 'Player Controller',
      description: 'Moves the player when Score is high enough.',
      graphId: 'graph-player',
      color: '#3DDC97',
      variables: [speed],
      createdAt: 1,
    };
    const graph: ProjectGraph = {
      id: 'graph-player',
      name: 'Player Controller Graph',
      nodes: [
        makeNode('start', 'event.start', 0, 0),
        makeNode('ready', 'action.print', 260, 0, { message: 'Ready' }),
        makeNode('update', 'event.update', 0, 180),
        makeNode('branch', 'logic.branch', 300, 180),
        makeNode('score', 'variable.get', 40, 360, { variableId: score.id, valueType: 'number', hasInput: false }),
        makeNode('ten', 'value.number', 40, 520, { numberValue: 10, hasInput: false }),
        makeNode('compare', 'logic.compare', 300, 420, { compareOp: '>', hasInput: false }),
        makeNode('move', 'action.translate', 560, 180, { axis: 'z', amount: 5 }),
      ],
      edges: [
        execEdge('start-ready', 'start', 'ready'),
        execEdge('update-branch', 'update', 'branch'),
        execEdge('branch-move', 'branch', 'move'),
        valueEdge('score-compare', 'score', 'compare', 'a'),
        valueEdge('ten-compare', 'ten', 'compare', 'b'),
        valueEdge('compare-branch', 'compare', 'branch', 'condition'),
      ],
    };

    const script = graphToFeatherScript({ blueprint, graph, variables: [score], blueprints: [blueprint] });
    const parsed = parseFeatherScript(script);

    expect(script).toContain('blueprint Player_Controller');
    expect(script).toContain('var Speed: number = 6');
    expect(script).toContain('on start:');
    expect(script).toContain('print("Ready")');
    expect(script).toContain('on update(dt):');
    expect(script).toContain('if (Game.Score > 10):');
    expect(script).toContain('self.translate(axis: "z", amount: 5)');
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });
});
