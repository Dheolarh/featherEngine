import { describe, it, expect, afterEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { graphToFeatherScript } from '../../scripting/featherScript';

/**
 * End-to-end coverage for the store actions behind the Script tab and the AI's
 * get_blueprint_script / set_blueprint_script tools: apply a FeatherScript to a real blueprint in
 * the live Zustand store, read it back, and prove the compiled behavior actually RUNS in Play.
 */
describe('applyBlueprintFeatherSource — store + runtime', () => {
  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it('compiles a script into a blueprint, round-trips it, and executes it in Play', () => {
    const store = useEditorStore.getState();
    const { blueprintId } = store.createBlueprintNamed('Feather Probe', 'script-tab test');

    const result = useEditorStore.getState().applyBlueprintFeatherSource(
      blueprintId,
      ['blueprint Feather_Probe', '', 'var Ticks: number = 0', '', 'on update(dt):', '    self.hits = 1'].join('\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')).toEqual([]);

    // The store now holds the compiled graph + variables (what the AI tool reports back).
    const state = useEditorStore.getState();
    const blueprint = state.blueprints.find((item) => item.id === blueprintId)!;
    const graph = state.graphs.find((item) => item.id === blueprint.graphId)!;
    expect(blueprint.variables?.[0]).toMatchObject({ name: 'Ticks', type: 'number', defaultValue: 0 });
    expect(graph.nodes.some((node) => node.data.nodeKind === 'event.update')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'variable.setObject')).toBe(true);

    // get_blueprint_script view of the same blueprint.
    const printed = graphToFeatherScript({ blueprint, graph, variables: state.variables, blueprints: state.blueprints });
    expect(printed).toContain('blueprint Feather_Probe');
    expect(printed).toContain('on update(dt):');
    expect(printed).toContain('self.hits = 1');

    // Attach to an object and Play: the scripted assignment must actually execute.
    const objectId = useEditorStore.getState().createObjectWithProps('cube');
    useEditorStore.getState().attachScript(objectId, blueprintId);
    useEditorStore.getState().setPlaying(true);
    for (let frame = 0; frame < 10; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    expect(useEditorStore.getState().runtimeObjectVariables[objectId]?.hits).toBe(1);
  });

  it('rejects a broken script without touching the blueprint', () => {
    const store = useEditorStore.getState();
    const { blueprintId } = store.createBlueprintNamed('Feather Reject');
    const before = useEditorStore.getState().graphs.find(
      (item) => item.id === useEditorStore.getState().blueprints.find((bp) => bp.id === blueprintId)!.graphId,
    )!;

    const result = useEditorStore.getState().applyBlueprintFeatherSource(blueprintId, 'function Broken\n    self.jump()');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);

    const after = useEditorStore.getState().graphs.find((item) => item.id === before.id)!;
    expect(after).toBe(before);
  });
});
