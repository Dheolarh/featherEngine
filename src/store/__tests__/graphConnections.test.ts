import { beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { useEditorStore } from '../editorStore';

describe('visual graph connection editing', () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject(blankProject('Connection Test'));
  });

  it('replaces an occupied value input and reconnects wires without leaving a hidden duplicate', () => {
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Wire Probe');
    const firstNumber = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values');
    const secondNumber = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values');
    const firstRotate = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Rotate', 'Runtime');
    const secondRotate = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Rotate', 'Runtime');

    useEditorStore.getState().onConnect({
      source: firstNumber,
      sourceHandle: 'value-out',
      target: firstRotate,
      targetHandle: 'amount',
    });
    useEditorStore.getState().onConnect({
      source: secondNumber,
      sourceHandle: 'value-out',
      target: firstRotate,
      targetHandle: 'amount',
    });

    let valueEdges = useEditorStore.getState().activeGraph()!.edges.filter((edge) => edge.targetHandle === 'amount');
    expect(valueEdges).toHaveLength(1);
    expect(valueEdges[0]).toMatchObject({ source: secondNumber, target: firstRotate, animated: false });

    useEditorStore.getState().onConnect({
      source: firstNumber,
      sourceHandle: 'value-out',
      target: secondRotate,
      targetHandle: 'amount',
    });
    const oldEdge = useEditorStore.getState().activeGraph()!.edges.find((edge) => edge.target === firstRotate)!;
    useEditorStore.getState().onReconnect(oldEdge, {
      source: secondNumber,
      sourceHandle: 'value-out',
      target: secondRotate,
      targetHandle: 'amount',
    });

    valueEdges = useEditorStore.getState().activeGraph()!.edges.filter((edge) => edge.targetHandle === 'amount');
    expect(valueEdges).toHaveLength(1);
    expect(valueEdges[0]).toMatchObject({
      id: oldEdge.id,
      source: secondNumber,
      target: secondRotate,
      animated: false,
    });
  });

  it('does not persist transient canvas selection state', () => {
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Clean Save');
    const nodeId = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Print', 'Runtime');
    useEditorStore.getState().onNodesChange([{ id: nodeId, type: 'select', selected: true }]);

    const liveNode = useEditorStore.getState().activeGraph()!.nodes.find((node) => node.id === nodeId)!;
    expect(liveNode.selected).toBe(true);
    const savedNode = useEditorStore
      .getState()
      .exportProject()
      .graphs.flatMap((graph) => graph.nodes)
      .find((node) => node.id === nodeId)!;
    expect(savedNode.selected).toBeUndefined();
    expect(useEditorStore.getState().activeGraph()!.nodes.find((node) => node.id === nodeId)?.selected).toBe(true);
  });

  it('applies the same single-input rule to programmatic graph building', () => {
    const { blueprintId } = useEditorStore.getState().createBlueprintNamed('Tool Wire Probe');
    const first = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values');
    const second = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values');
    const rotate = useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, 'Rotate', 'Runtime');
    useEditorStore.getState().connectGraphNodes(blueprintId, first, rotate, 'value-out', 'amount');
    useEditorStore.getState().connectGraphNodes(blueprintId, second, rotate, 'value-out', 'amount');

    const edges = useEditorStore.getState().activeGraph()!.edges.filter((edge) => edge.targetHandle === 'amount');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: second, target: rotate, animated: false });
  });
});
