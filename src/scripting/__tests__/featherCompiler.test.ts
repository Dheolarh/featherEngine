import { describe, expect, it } from 'vitest';
import { compileFeatherScriptToGraph } from '../featherCompiler';
import type { ProjectGraph, ProjectVariable, ScriptBlueprint } from '../../types';

const blueprint: ScriptBlueprint = {
  id: 'bp-player',
  name: 'Player',
  description: '',
  graphId: 'graph-player',
  color: '#3DDC97',
  variables: [],
  createdAt: 1,
};

const graph: ProjectGraph = {
  id: 'graph-player',
  name: 'Player Graph',
  nodes: [],
  edges: [],
};

const score: ProjectVariable = {
  id: 'var-score',
  name: 'Score',
  type: 'number',
  defaultValue: 0,
  persistent: false,
  createdAt: 1,
};

describe('compileFeatherScriptToGraph', () => {
  it('applies script events, variables, calls, and conditions to a graph', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [score],
      source: [
        'blueprint Player',
        '',
        'var health: number = 100',
        '',
        'on start:',
        '    print("Ready")',
        '    self.translate(axis: "x", amount: 2)',
        '',
        'on update(dt):',
        '    if Game.Score > 10:',
        '        self.jump()',
      ].join('\n'),
    });

    expect(result.ok).toBe(true);
    expect(result.blueprint?.variables?.[0]).toMatchObject({ name: 'health', type: 'number', defaultValue: 100 });
    expect(result.blueprint?.featherSource).toBeUndefined();

    const kinds = result.graph?.nodes.map((node) => node.data.nodeKind) ?? [];
    expect(kinds).toEqual(
      expect.arrayContaining([
        'event.start',
        'action.print',
        'action.translate',
        'event.update',
        'logic.branch',
        'logic.compare',
        'variable.get',
        'value.number',
        'action.jump',
      ]),
    );

    const branch = result.graph?.nodes.find((node) => node.data.nodeKind === 'logic.branch');
    const compare = result.graph?.nodes.find((node) => node.data.nodeKind === 'logic.compare');
    expect(result.graph?.edges).toContainEqual(expect.objectContaining({ source: compare?.id, target: branch?.id, targetHandle: 'condition' }));
  });

  it('refuses to apply scripts with syntax errors', () => {
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source: ['blueprint Broken', 'function Move', '    self.jump()'].join('\n'),
    });

    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('must end with'))).toBe(true);
  });

  it('can preserve edited source while live-syncing the graph', () => {
    const source = ['blueprint Player', '', 'on start:', '    self.jump()'].join('\n');
    const result = compileFeatherScriptToGraph({
      blueprint,
      graph,
      variables: [],
      source,
      preserveSource: true,
    });

    expect(result.ok).toBe(true);
    expect(result.blueprint?.featherSource).toBe(source);
    expect(result.graph?.nodes.some((node) => node.data.nodeKind === 'action.jump')).toBe(true);
  });
});
