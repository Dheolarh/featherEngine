import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { toNumber, toVector3 } from '../editor/objectFactory';
import { scanBlueprintGraphProblems, sanitizeGraph } from '../editor/graphDiagnostics';
import { isGraphConnectionValid } from '../editor/wireTypes';
import { scanProblems } from '../../components/ProblemsPanel';
import type { NodeForgeNode, ProjectGraph, ScriptBlueprint } from '../../types';

const makeNode = (id: string, kind: NodeForgeNode['data']['nodeKind'], extra: Partial<NodeForgeNode['data']> = {}): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeKind: kind,
    category: 'Runtime',
    description: '',
    tone: 'runtime',
    ...extra,
  },
});

const blueprint: ScriptBlueprint = {
  id: 'bp-1',
  name: 'Guard',
  description: '',
  graphId: 'g-1',
  color: '#3DDC97',
  variables: [],
  createdAt: 1,
};

describe('script reliability', () => {
  it('coerces NaN and Infinity graph numbers to 0 so transforms never poison', () => {
    expect(toNumber(Number.NaN)).toBe(0);
    expect(toNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toNumber('nope')).toBe(0);
    expect(toVector3([Number.NaN, 2, Number.POSITIVE_INFINITY])).toEqual([0, 2, 0]);
  });

  it('rejects number→vector3 wires', () => {
    expect(isGraphConnectionValid('value.number', 'action.translate', 'value-out', 'vector')).toBe(false);
    expect(isGraphConnectionValid('value.vector3', 'action.translate', 'value-out', 'vector')).toBe(true);
    expect(isGraphConnectionValid('event.start', 'action.jump', 'exec-out', 'exec-in')).toBe(true);
    expect(isGraphConnectionValid('event.start', 'action.jump', 'exec-out', 'vector')).toBe(false);
  });

  it('flags dangling wires and Call Function with no Function node', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [makeNode('call', 'logic.callFunction', { functionName: 'Heal' })],
      edges: [{ id: 'e1', source: 'missing', target: 'call', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge],
    };
    const problems = scanBlueprintGraphProblems(blueprint, graph, []);
    expect(problems.some((problem) => problem.message.includes('missing node'))).toBe(true);
    expect(problems.some((problem) => problem.message.includes('Call Function'))).toBe(true);
  });

  it('surfaces those graph issues in the Problems scan', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [makeNode('start', 'event.start')],
      edges: [{ id: 'e1', source: 'start', target: 'gone', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge],
    };
    const problems = scanProblems([], [graph], [blueprint], [], [], [], []);
    expect(problems.some((problem) => problem.severity === 'error' && problem.message.includes('missing node'))).toBe(true);
  });

  it('strips dangling wires from a loaded graph without touching valid ones', () => {
    const graph: ProjectGraph = {
      id: 'g-1',
      name: 'Guard Graph',
      nodes: [makeNode('start', 'event.start'), makeNode('jump', 'action.jump')],
      edges: [
        { id: 'ok', source: 'start', target: 'jump', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge,
        { id: 'ghost', source: 'start', target: 'gone', sourceHandle: 'exec-out', targetHandle: 'exec-in' } as Edge,
      ],
    };
    const cleaned = sanitizeGraph(graph);
    expect(cleaned.edges).toHaveLength(1);
    expect(cleaned.edges[0]?.id).toBe('ok');
    expect(sanitizeGraph(cleaned)).toBe(cleaned);
  });
});
