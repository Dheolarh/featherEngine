import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { createTimelineShowcaseTemplate } from '../timelineShowcaseTemplate';

const mechanismNames = [
  'Vault Door Timeline',
  'Elevator World Timeline',
  'Drawbridge Local Timeline',
  'Security Gate Control Timeline',
  'Looping Crusher Timeline',
  'Chest Finished Timeline',
];

describe('Timeline Mechanics showcase template', () => {
  beforeEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Timeline Showcase Test'));
  });

  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Timeline Showcase Cleanup'));
  });

  it('builds six valid Timeline examples and a placed reusable Vault Door prefab', async () => {
    const pawnId = await createTimelineShowcaseTemplate();
    expect(pawnId).toBeTruthy();

    const state = useEditorStore.getState();
    const objects = selectActiveObjects(state);
    expect(state.activeScene()?.name).toBe('Timeline Mechanics');
    expect(objects.find((object) => object.id === pawnId)?.character?.enabled).toBe(true);

    for (const name of [
      'Vault Door Pivot',
      'World Space Elevator',
      'Drawbridge Pivot',
      'Restartable Security Gate',
      'Looping Crusher Head',
      'Restartable Chest Lid Pivot',
    ]) {
      expect(objects.some((object) => object.name === name), `${name} should exist`).toBe(true);
    }

    const prefab = state.prefabs.find((item) => item.name === 'Interactive Vault Door');
    expect(prefab).toBeDefined();
    expect(prefab!.objects).toHaveLength(17);
    const prefabRoot = prefab!.objects.find((object) => object.id === prefab!.rootId);
    expect(prefabRoot?.name).toBe('Vault Door Pivot');
    expect(prefabRoot?.script?.blueprintId).toBeTruthy();
    expect(prefabRoot?.variables?.interactable).toBe(true);

    const placedRoot = objects.find(
      (object) => object.prefabSourceId === prefab!.id && object.prefabObjectId === prefab!.rootId,
    );
    expect(placedRoot).toBeDefined();
    expect(placedRoot!.id).not.toBe(prefab!.rootId);
    expect(placedRoot!.script?.blueprintId).toBe(prefabRoot!.script?.blueprintId);

    const blueprints = mechanismNames.map((name) => state.blueprints.find((item) => item.name === name));
    expect(blueprints.every(Boolean)).toBe(true);
    const graphs = blueprints.map((blueprint) => state.graphs.find((graph) => graph.id === blueprint!.graphId)!);

    for (let index = 0; index < graphs.length; index += 1) {
      const graph = graphs[index];
      expect(graph.nodes.filter((node) => node.data.nodeKind === 'action.tweenProperty')).toHaveLength(1);
      expect(scanBlueprintGraphProblems(blueprints[index]!, graph, state.variables)).toEqual([]);
      for (const control of graph.nodes.filter((node) => node.data.nodeKind === 'action.timelineControl')) {
        expect(
          graph.nodes.some(
            (node) =>
              node.data.nodeKind === 'action.tweenProperty' && node.data.timelineId === control.data.timelineRefId,
          ),
        ).toBe(true);
      }
    }

    const commands = new Set(
      graphs
        .flatMap((graph) => graph.nodes)
        .filter((node) => node.data.nodeKind === 'action.timelineControl')
        .map((node) => node.data.timelineCommand),
    );
    expect(commands).toEqual(new Set(['play', 'reverse', 'restart', 'stop']));

    const timelines = graphs.flatMap((graph) =>
      graph.nodes.filter((node) => node.data.nodeKind === 'action.tweenProperty'),
    );
    expect(timelines.some((node) => node.data.tweenSpace === 'world' && node.data.tweenValueMode === 'absolute')).toBe(true);
    expect(timelines.some((node) => node.data.tweenSpace === 'local' && node.data.tweenValueMode === 'relative')).toBe(true);
    expect(timelines.some((node) => node.data.tweenLoop && node.data.tweenPingPong)).toBe(true);

    const vaultGraph = graphs[0];
    const vaultTimeline = vaultGraph.nodes.find((node) => node.data.timelineId === 'vault-door-swing')!;
    expect(vaultGraph.edges.some((edge) => edge.source === vaultTimeline.id && edge.sourceHandle === 'exec-update')).toBe(true);
    expect(vaultGraph.edges.some((edge) => edge.source === vaultTimeline.id && edge.sourceHandle === 'exec-done')).toBe(true);
  });

  it('packages and remaps the prefab, placed instance, Blueprint and stable Timeline references', async () => {
    await createTimelineShowcaseTemplate();
    const authored = useEditorStore.getState();
    const collected = authored.buildProjectPackage();

    const prefab = collected.content.prefabs.find((item) => item.name === 'Interactive Vault Door');
    expect(prefab).toBeDefined();
    const sceneInstance = collected.content.scenes?.[0].objects.find((object) => object.prefabSourceId === prefab!.id);
    expect(sceneInstance).toBeDefined();
    expect(collected.content.blueprints.some((blueprint) => blueprint.id === sceneInstance!.script?.blueprintId)).toBe(true);

    const pkg = buildPackage('project', collected.content, [], {
      id: 'pkg-timeline-mechanics-test',
      name: 'Timeline Mechanics',
      version: '1.0.0',
    });
    const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
    const importedPrefab = content.prefabs.find((item) => item.name === 'Interactive Vault Door')!;
    const importedInstance = content.scenes?.[0].objects.find(
      (object) => object.prefabSourceId === importedPrefab.id && object.prefabObjectId === importedPrefab.rootId,
    );
    expect(importedInstance).toBeDefined();

    const importedRoot = importedPrefab.objects.find((object) => object.id === importedPrefab.rootId)!;
    expect(importedRoot.script?.blueprintId).toBe(importedInstance!.script?.blueprintId);
    const importedBlueprint = content.blueprints.find((item) => item.id === importedRoot.script?.blueprintId)!;
    const importedGraph = content.graphs.find((item) => item.id === importedBlueprint.graphId)!;
    const definition = importedGraph.nodes.find((node) => node.data.timelineId === 'vault-door-swing')!;
    expect(definition).toBeDefined();
    expect(
      importedGraph.nodes
        .filter((node) => node.data.nodeKind === 'action.timelineControl')
        .every((node) => node.data.timelineRefId === definition.data.timelineId),
    ).toBe(true);
  });

  it('plays and reverses the placed Vault Door through the real interaction input path', async () => {
    await createTimelineShowcaseTemplate();
    const store = useEditorStore.getState();
    const prefab = store.prefabs.find((item) => item.name === 'Interactive Vault Door')!;
    const doorId = selectActiveObjects(store).find(
      (object) => object.prefabSourceId === prefab.id && object.prefabObjectId === prefab.rootId,
    )!.id;

    store.setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    useEditorStore.getState().tickRuntime(0);

    useEditorStore.getState().setRuntimeKey('KeyE', true);
    useEditorStore.getState().tickRuntime(0);
    useEditorStore.getState().setRuntimeKey('KeyE', false);
    useEditorStore.getState().tickRuntime(0.45);
    const openedAngle = Math.abs(
      selectActiveObjects(useEditorStore.getState()).find((object) => object.id === doorId)!.transform.rotation[1],
    );
    expect(openedAngle).toBeGreaterThan(0.1);

    useEditorStore.getState().setRuntimeKey('KeyE', true);
    useEditorStore.getState().tickRuntime(0);
    useEditorStore.getState().setRuntimeKey('KeyE', false);
    useEditorStore.getState().tickRuntime(0.25);
    const reversedAngle = Math.abs(
      selectActiveObjects(useEditorStore.getState()).find((object) => object.id === doorId)!.transform.rotation[1],
    );
    expect(reversedAngle).toBeLessThan(openedAngle);
  });
});
