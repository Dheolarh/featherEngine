import type { Edge } from '@xyflow/react';
import type { NodeForgeNode, ProjectGraph } from '../../types';
import { isStructuralGraphConnection } from './wireTypes';

const LAYOUT_COL = 264;
const LAYOUT_X0 = 48;
const LAYOUT_Y0 = 48;
const LAYOUT_GRID = 24;
const LAYOUT_ROW_GAP = 48;

const numericSize = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

/** Conservative card-height estimate for layout before React Flow has measured the DOM. */
const estimatedNodeHeight = (node: NodeForgeNode): number => {
  const measured = node.measured?.height ?? numericSize(node.style?.height);
  if (measured) return measured;
  const kind = node.data.nodeKind;
  if (kind === 'comment.note') return 144;
  if (kind === 'math.mapRange') return 240;
  if (kind === 'logic.callFunction') return 224;
  if (kind === 'query.raycast') return 208;
  if (kind === 'query.overlapSphere') return 184;
  if (kind === 'logic.switch') return Math.max(152, 122 + (node.data.switchCases?.length ?? 0) * 28);
  if (kind === 'logic.sequence' || kind === 'event.functionEntry') return 184;
  if (
    kind === 'logic.select' ||
    kind === 'math.makeVector' ||
    kind === 'math.clamp' ||
    kind === 'math.lerp' ||
    kind === 'action.tweenProperty'
  ) return 200;
  return 144;
};

/** Layered left-to-right layout that follows execution flow and snaps to a grid. */
export const layoutGraphNodes = (nodes: NodeForgeNode[], edges: Edge[]): NodeForgeNode[] => {
  if (nodes.length === 0) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    if (adjacency.has(edge.source) && indegree.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  });

  // Longest-path layering (Kahn's algorithm); nodes left in a cycle stay in column 0.
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  const remaining = new Map(indegree);
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const current = layer.get(id) ?? 0;
    (adjacency.get(id) ?? []).forEach((target) => {
      layer.set(target, Math.max(layer.get(target) ?? 0, current + 1));
      const next = (remaining.get(target) ?? 0) - 1;
      remaining.set(target, next);
      if (next === 0) queue.push(target);
    });
  }

  // A strongly-connected section never reaches indegree zero. Lay those nodes out as a compact
  // three-row block after the acyclic flow instead of piling the whole cycle into column zero.
  const unresolved = nodes
    .filter((node) => (remaining.get(node.id) ?? 0) > 0)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  if (unresolved.length > 0) {
    const firstCycleColumn = Math.max(0, ...layer.values()) + 1;
    unresolved.forEach((node, index) => layer.set(node.id, firstCycleColumn + Math.floor(index / 3)));
  }

  const byLayer = new Map<number, string[]>();
  nodes.forEach((node) => {
    const column = layer.get(node.id) ?? 0;
    byLayer.set(column, [...(byLayer.get(column) ?? []), node.id]);
  });

  const snap = (value: number) => Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
  const orderY = new Map(nodes.map((node) => [node.id, node.position.y]));
  const positions = new Map<string, { x: number; y: number }>();
  [...byLayer.keys()]
    .sort((a, b) => a - b)
    .forEach((column) => {
      const ids = byLayer.get(column)!.sort((a, b) => (orderY.get(a) ?? 0) - (orderY.get(b) ?? 0));
      let nextY = LAYOUT_Y0;
      ids.forEach((id) => {
        const node = nodeById.get(id)!;
        positions.set(id, { x: snap(LAYOUT_X0 + column * LAYOUT_COL), y: snap(nextY) });
        nextY += estimatedNodeHeight(node) + LAYOUT_ROW_GAP;
      });
    });

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
};

export interface GraphRuntime {
  graph: ProjectGraph;
  nodesById: Map<string, NodeForgeNode>;
  /** Timeline definitions keyed by their persisted logical id (legacy graphs fall back to node.id). */
  timelineNodesById: Map<string, NodeForgeNode>;
  /** Compiled node records: one lookup gives the node plus its exec/value wiring. */
  compiledNodesById: Map<string, CompiledGraphNode>;
  /** Default execution continuation: targets reached via the standard "exec-out" pin. */
  outgoing: Map<string, string[]>;
  /** Execution targets grouped by the source pin they leave from (e.g. "exec-out", "exec-body").
   *  Lets multi-output exec nodes (For Loop's Body vs Completed) route to distinct chains. */
  outgoingByHandle: Map<string, Map<string, string[]>>;
  incomingValues: Map<string, Edge[]>;
  incomingValueByHandle: Map<string, Map<string, Edge>>;
  eventRoots: NodeForgeNode[];
  /** Event roots that can auto-dispatch during a tick. Function entries are call-only. */
  dispatchEventRoots: NodeForgeNode[];
  customEventRoots: Map<string, NodeForgeNode[]>;
  /** Function entry nodes grouped by lowercased name — the targets of Call Function (never auto-fire). */
  functionRoots: Map<string, NodeForgeNode[]>;
  /** Timer-driven roots (event.timer + throttled event.update) — the store advances their countdowns
   *  once per tick; precomputed so the per-frame pass doesn't re-filter eventRoots per object. */
  timerRoots: NodeForgeNode[];
  /** The graph's On Receive Damage root, if any — read once per scripted object per tick. */
  receiveDamageRoot: NodeForgeNode | undefined;
  /** True when the graph has a Collision Stay / Trigger Stay root. Physics only bothers replaying
   *  resting contacts for objects running such a graph, so this is what gates that whole pass. */
  hasStayRoot: boolean;
}

export interface CompiledGraphNode {
  node: NodeForgeNode;
  /** Default execution continuation from the standard "exec-out" pin. */
  outgoing: string[];
  /** Execution targets grouped by source pin. */
  outgoingByHandle: Map<string, string[]>;
  /** Value inputs keyed by target handle. */
  valueInputs: Map<string, CompiledValueInput>;
}

export interface CompiledValueInput {
  source: string;
  sourceHandle: string;
}

const graphRuntimeCache = new WeakMap<ProjectGraph, GraphRuntime>();
const graphRuntimeMapCache = new WeakMap<ProjectGraph[], Map<string, GraphRuntime>>();

export const buildGraphRuntime = (graph: ProjectGraph): GraphRuntime => {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const timelineNodesById = new Map<string, NodeForgeNode>();
  for (const node of graph.nodes) {
    if (node.data.nodeKind === 'action.tweenProperty') {
      timelineNodesById.set(node.data.timelineId || node.id, node);
    }
  }
  const compiledNodesById = new Map<string, CompiledGraphNode>(
    graph.nodes.map((node) => [
      node.id,
      {
        node,
        outgoing: [],
        outgoingByHandle: new Map<string, string[]>(),
        valueInputs: new Map<string, CompiledValueInput>(),
      },
    ]),
  );
  const outgoing = new Map<string, string[]>();
  const outgoingByHandle = new Map<string, Map<string, string[]>>();
  const incomingValues = new Map<string, Edge[]>();
  const incomingValueByHandle = new Map<string, Map<string, Edge>>();

  graph.edges.forEach((edge) => {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode || edge.source === edge.target) return;
    if (!isStructuralGraphConnection(edge.sourceHandle, edge.targetHandle)) return;
    const isValueEdge = Boolean(edge.targetHandle && edge.targetHandle !== 'exec-in');
    if (isValueEdge) {
      const existing = incomingValues.get(edge.target);
      if (existing) existing.push(edge);
      else incomingValues.set(edge.target, [edge]);
      const byHandle = incomingValueByHandle.get(edge.target) ?? new Map<string, Edge>();
      if (edge.targetHandle) byHandle.set(edge.targetHandle, edge);
      incomingValueByHandle.set(edge.target, byHandle);
      const compiledTarget = compiledNodesById.get(edge.target);
      if (compiledTarget && edge.targetHandle) {
        compiledTarget.valueInputs.set(edge.targetHandle, {
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? 'value-out',
        });
      }
    } else {
      // Exec edges leave a node from a named pin. Edges authored before multi-output nodes existed
      // (and AI-created flow edges) carry no sourceHandle → treat them as the default "exec-out".
      const handle = edge.sourceHandle || 'exec-out';
      const byHandle = outgoingByHandle.get(edge.source) ?? new Map<string, string[]>();
      const handleTargets = byHandle.get(handle);
      if (handleTargets) handleTargets.push(edge.target);
      else byHandle.set(handle, [edge.target]);
      outgoingByHandle.set(edge.source, byHandle);
      const compiledSource = compiledNodesById.get(edge.source);
      if (compiledSource) {
        const compiledTargets = compiledSource.outgoingByHandle.get(handle);
        if (compiledTargets) compiledTargets.push(edge.target);
        else compiledSource.outgoingByHandle.set(handle, [edge.target]);
      }
      // The default-pin continuation stays in `outgoing` so existing call sites are unchanged.
      if (handle === 'exec-out') {
        const existing = outgoing.get(edge.source);
        if (existing) existing.push(edge.target);
        else outgoing.set(edge.source, [edge.target]);
        compiledSource?.outgoing.push(edge.target);
      }
    }
  });

  const eventRoots = graph.nodes.filter((node) => node.data.nodeKind?.startsWith('event.'));
  const dispatchEventRoots = eventRoots.filter((node) => node.data.nodeKind !== 'event.functionEntry');
  const customEventRoots = new Map<string, NodeForgeNode[]>();
  const functionRoots = new Map<string, NodeForgeNode[]>();
  for (const node of eventRoots) {
    if (node.data.nodeKind === 'event.functionEntry') {
      const key = (node.data.functionName || 'MyFunction').toLowerCase();
      const existing = functionRoots.get(key);
      if (existing) existing.push(node);
      else functionRoots.set(key, [node]);
      continue;
    }
    if (node.data.nodeKind !== 'event.custom') continue;
    const key = (node.data.eventName || 'CustomEvent').toLowerCase();
    const existing = customEventRoots.get(key);
    if (existing) existing.push(node);
    else customEventRoots.set(key, [node]);
  }

  const timerRoots = dispatchEventRoots.filter(
    (node) =>
      node.data.nodeKind === 'event.timer' ||
      (node.data.nodeKind === 'event.update' && Number(node.data.numberValue ?? 0) > 0),
  );
  const receiveDamageRoot = eventRoots.find((node) => node.data.nodeKind === 'event.receiveDamage');
  const hasStayRoot = dispatchEventRoots.some(
    (node) => node.data.nodeKind === 'event.collisionStay' || node.data.nodeKind === 'event.triggerStay',
  );

  return {
    graph,
    nodesById,
    timelineNodesById,
    compiledNodesById,
    outgoing,
    outgoingByHandle,
    incomingValues,
    incomingValueByHandle,
    eventRoots,
    dispatchEventRoots,
    customEventRoots,
    functionRoots,
    timerRoots,
    receiveDamageRoot,
    hasStayRoot,
  };
};

export const getGraphRuntime = (graph: ProjectGraph): GraphRuntime => {
  const cached = graphRuntimeCache.get(graph);
  if (cached) return cached;
  const runtime = buildGraphRuntime(graph);
  graphRuntimeCache.set(graph, runtime);
  return runtime;
};

export const getGraphRuntimeMap = (graphs: ProjectGraph[]): Map<string, GraphRuntime> => {
  const cached = graphRuntimeMapCache.get(graphs);
  if (cached) return cached;
  const runtimes = new Map(graphs.map((graph) => [graph.id, getGraphRuntime(graph)]));
  graphRuntimeMapCache.set(graphs, runtimes);
  return runtimes;
};
