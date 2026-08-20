import type { ProjectGraph, ProjectVariable, ScriptBlueprint } from '../../types';
import { parseFeatherScript } from '../../scripting/featherParser';
import { isBlockingFeatherWarning } from '../../scripting/featherDiagnostics';
import { isGraphConnectionValid, isStructuralGraphConnection } from './wireTypes';

export interface ScriptProblem {
  severity: 'error' | 'warning' | 'info';
  message: string;
  blueprintId?: string;
  nodeId?: string;
}

/** Drop dangling / illegal wires. Returns the same object when nothing changed (keeps runtime WeakMap identity). */
export function sanitizeGraph(graph: ProjectGraph): ProjectGraph {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.filter((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target || edge.source === edge.target) return false;
    return isStructuralGraphConnection(edge.sourceHandle, edge.targetHandle);
  });
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}

/**
 * Edit-time checks for a single blueprint graph: dangling wires, typed mismatches that slipped past
 * the editor, Call Function with no matching Function node, Get/Set Variable with a deleted var,
 * and FeatherScript drafts that would fail-closed if applied.
 */
export function scanBlueprintGraphProblems(
  blueprint: ScriptBlueprint,
  graph: ProjectGraph,
  variables: ProjectVariable[],
): ScriptProblem[] {
  const problems: ScriptProblem[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const variableIds = new Set(variables.map((variable) => variable.id));
  for (const local of blueprint.variables ?? []) variableIds.add(local.id);

  const functionNames = new Set(
    graph.nodes
      .filter((node) => node.data.nodeKind === 'event.functionEntry')
      .map((node) => (node.data.functionName || 'MyFunction').toLowerCase()),
  );

  let dangling = 0;
  let typeMismatch = 0;
  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      dangling += 1;
      continue;
    }
    if (edge.source === edge.target) {
      typeMismatch += 1;
      continue;
    }
    if (
      !isGraphConnectionValid(
        source.data.nodeKind,
        target.data.nodeKind,
        edge.sourceHandle,
        edge.targetHandle,
        source.data.valueType,
        target.data.valueType,
      )
    ) {
      typeMismatch += 1;
    }
  }
  if (dangling) {
    problems.push({
      severity: 'error',
      message: `Blueprint "${blueprint.name}": ${dangling} wire${dangling > 1 ? 's' : ''} point at a missing node — delete them or the chain stops silently.`,
      blueprintId: blueprint.id,
    });
  }
  if (typeMismatch) {
    problems.push({
      severity: 'warning',
      message: `Blueprint "${blueprint.name}": ${typeMismatch} value wire${typeMismatch > 1 ? 's' : ''} have mismatched types — Play will coerce them, but the result may be 0/false.`,
      blueprintId: blueprint.id,
    });
  }

  for (const node of graph.nodes) {
    if (node.data.nodeKind === 'logic.callFunction') {
      const name = (node.data.functionName || 'MyFunction').toLowerCase();
      if (!functionNames.has(name)) {
        problems.push({
          severity: 'error',
          message: `Blueprint "${blueprint.name}": Call Function "${node.data.functionName || 'MyFunction'}" has no matching Function node.`,
          blueprintId: blueprint.id,
          nodeId: node.id,
        });
        break;
      }
    }
  }

  for (const node of graph.nodes) {
    if (
      (node.data.nodeKind === 'variable.get' || node.data.nodeKind === 'variable.set') &&
      node.data.variableId &&
      !variableIds.has(node.data.variableId)
    ) {
      problems.push({
        severity: 'warning',
        message: `Blueprint "${blueprint.name}": a Get/Set Variable node points at a deleted variable.`,
        blueprintId: blueprint.id,
        nodeId: node.id,
      });
      break;
    }
  }

  if (blueprint.featherSource) {
    const parsed = parseFeatherScript(blueprint.featherSource);
    const compileLike = [...parsed.diagnostics];
    if (compileLike.some((item) => item.severity === 'error') || compileLike.some(isBlockingFeatherWarning)) {
      problems.push({
        severity: 'error',
        message: `Blueprint "${blueprint.name}": the Script tab draft has errors — Visual is keeping the last valid graph until you fix them.`,
        blueprintId: blueprint.id,
      });
    }
  }

  return problems;
}
