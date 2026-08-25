import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { GraphNodeKind, NodeForgeNode } from '../../types';
import { layoutGraphNodes } from '../editor/graphRuntime';

const node = (id: string, kind: GraphNodeKind, y: number, extra: Partial<NodeForgeNode['data']> = {}): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x: 0, y },
  data: {
    label: id,
    nodeKind: kind,
    category: 'Logic',
    description: '',
    tone: 'logic',
    ...extra,
  },
});

describe('visual graph auto layout', () => {
  it('uses card-aware vertical spacing and keeps every result on the visible 24px grid', () => {
    const arranged = layoutGraphNodes(
      [node('regular-a', 'event.start', 0), node('tall', 'math.mapRange', 10), node('regular-b', 'action.print', 20)],
      [],
    );
    const byId = new Map(arranged.map((item) => [item.id, item]));
    expect(byId.get('tall')!.position.y - byId.get('regular-a')!.position.y).toBeGreaterThanOrEqual(192);
    expect(byId.get('regular-b')!.position.y - byId.get('tall')!.position.y).toBeGreaterThanOrEqual(288);
    for (const item of arranged) {
      expect(item.position.x % 24).toBe(0);
      expect(item.position.y % 24).toBe(0);
    }
  });

  it('places cyclic logic in a readable block after the acyclic flow instead of column zero', () => {
    const nodes = [node('start', 'event.start', 0), node('a', 'logic.branch', 20), node('b', 'logic.sequence', 40)];
    const edges: Edge[] = [
      { id: 'start-a', source: 'start', target: 'a' },
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-a', source: 'b', target: 'a' },
    ];
    const arranged = layoutGraphNodes(nodes, edges);
    const startX = arranged.find((item) => item.id === 'start')!.position.x;
    expect(arranged.find((item) => item.id === 'a')!.position.x).toBeGreaterThan(startX);
    expect(arranged.find((item) => item.id === 'b')!.position.x).toBeGreaterThan(startX);
  });
});
