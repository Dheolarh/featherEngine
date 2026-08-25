import { beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { hashFeatherSource } from '../../scripting/featherExternalSource';
import { graphToFeatherScript } from '../../scripting/featherScript';
import { useEditorStore } from '../editorStore';
import { clearHistory, initHistory, redo, undo } from '../history';

const graphSource = (blueprintId: string) => {
  const state = useEditorStore.getState();
  const blueprint = state.blueprints.find((item) => item.id === blueprintId)!;
  const graph = state.graphs.find((item) => item.id === blueprint.graphId)!;
  return graphToFeatherScript({ blueprint, graph, variables: state.variables, blueprints: state.blueprints });
};

describe('scripting undo history', () => {
  beforeEach(() => {
    initHistory();
    useEditorStore.getState().loadProject(blankProject('History Test'));
    clearHistory();
  });

  it('undoes and redoes a code-to-graph synchronization as one recoverable edit', () => {
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('History Probe');
    const baseline = 'blueprint History_Probe\n\non start:\n    print("before")';
    const changed = 'blueprint History_Probe\n\non start:\n    print("after")';
    expect(useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, baseline).ok).toBe(true);
    clearHistory();

    expect(useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, changed).ok).toBe(true);
    expect(graphSource(blueprintId)).toContain('print("after")');

    undo();
    expect(graphSource(blueprintId)).toContain('print("before")');
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(baseline);

    redo();
    expect(graphSource(blueprintId)).toContain('print("after")');
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(changed);
  });

  it('keeps the real disk checkpoint when undo restores older linked source', () => {
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Linked History');
    const path = 'scripts/linked-history.feather';
    const baseline = 'blueprint Linked_History\n\non start:\n    print("before")';
    const changed = 'blueprint Linked_History\n\non start:\n    print("after")';
    expect(useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, baseline).ok).toBe(true);
    useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
      path,
      lastSyncedHash: hashFeatherSource(baseline),
      lastSyncedVisualHash: hashFeatherSource(graphSource(blueprintId)),
    });
    clearHistory();

    expect(useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, changed).ok).toBe(true);
    const latestDiskHash = hashFeatherSource(changed);
    const latestVisualHash = hashFeatherSource(graphSource(blueprintId));
    useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
      path,
      lastSyncedHash: latestDiskHash,
      lastSyncedVisualHash: latestVisualHash,
    });

    undo();
    const restored = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!;
    expect(restored.featherSource).toBe(baseline);
    expect(restored.featherSourceLastSyncedHash).toBe(latestDiskHash);
    expect(restored.featherSourceLastSyncedVisualHash).toBe(latestVisualHash);
  });

  it('does not turn canvas selection into an undo step, but still captures node movement', () => {
    useEditorStore.getState().createBlueprintNamed('Selection Probe');
    const graph = useEditorStore.getState().activeGraph()!;
    const node = graph.nodes[0]!;
    clearHistory();

    useEditorStore.getState().onNodesChange([{ id: node.id, type: 'select', selected: true }]);
    expect(useEditorStore.getState().undoDepth).toBe(0);

    const moved = { x: node.position.x + 48, y: node.position.y + 24 };
    useEditorStore.getState().onNodesChange([{ id: node.id, type: 'position', position: moved }]);
    expect(useEditorStore.getState().undoDepth).toBe(1);
    expect(useEditorStore.getState().activeGraph()?.nodes[0]?.position).toEqual(moved);

    undo();
    expect(useEditorStore.getState().activeGraph()?.nodes[0]?.position).toEqual(node.position);
  });
});
