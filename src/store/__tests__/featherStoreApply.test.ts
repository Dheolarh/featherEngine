import { describe, it, expect, afterEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
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

  it('executes else branches and for loops during Play', () => {
    const store = useEditorStore.getState();
    const { blueprintId } = store.createBlueprintNamed('Flow Probe');
    const result = useEditorStore.getState().applyBlueprintFeatherSource(
      blueprintId,
      [
        'blueprint Flow_Probe',
        '',
        'var armed: boolean = false',
        '',
        'on update(dt):',
        '    if self.armed:',
        '        self.a = 1',
        '    else:',
        '        self.b = 2',
        '    self.after = 3',
        '',
        'on start:',
        '    for index in range(3):',
        '        self.n = index',
        '    self.loop_done = 1',
      ].join('\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')).toEqual([]);

    const objectId = useEditorStore.getState().createObjectWithProps('cube');
    useEditorStore.getState().attachScript(objectId, blueprintId);
    useEditorStore.getState().setPlaying(true);
    for (let frame = 0; frame < 5; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    const vars = useEditorStore.getState().runtimeObjectVariables[objectId] ?? {};
    expect(vars.a).toBeUndefined(); // armed=false → true path must NOT run
    expect(vars.b).toBe(2); // else path ran (the new Branch False pin)
    expect(vars.after).toBe(3); // the join after if/else ran on the false path too
    expect(vars.n).toBe(2); // for index in range(3) → last index written is 2
    expect(vars.loop_done).toBe(1); // Completed pin continued the chain
  });

  it('attaches one-click behaviors that really run: shared blueprint, physics, vars, Play', () => {
    const store = useEditorStore.getState();
    const spinnerId = store.createObjectWithProps('cube');
    const blueprintId = useEditorStore.getState().attachBehaviorPreset(spinnerId, 'rotating-prop');
    expect(blueprintId).toBeTruthy();

    const state = useEditorStore.getState();
    const blueprint = state.blueprints.find((item) => item.id === blueprintId)!;
    expect(blueprint.name).toBe('Behavior Rotating Prop');
    const spinner = selectActiveObjects(state).find((item) => item.id === spinnerId)!;
    expect(spinner.script?.blueprintId).toBe(blueprintId);
    expect(spinner.variables?.spin_speed).toBe(90); // per-instance var seeded from the script

    // Attaching the same behavior to a second object REUSES the blueprint (shared class).
    const secondId = useEditorStore.getState().createObjectWithProps('cube');
    expect(useEditorStore.getState().attachBehaviorPreset(secondId, 'rotating-prop')).toBe(blueprintId);

    // Collectible: creates the Score project variable and makes the object a trigger.
    const coinId = useEditorStore.getState().createObjectWithProps('sphere');
    expect(useEditorStore.getState().attachBehaviorPreset(coinId, 'collectible')).toBeTruthy();
    const after = useEditorStore.getState();
    expect(after.variables.some((variable) => variable.name === 'Score')).toBe(true);
    const coin = selectActiveObjects(after).find((item) => item.id === coinId)!;
    expect(coin.physics?.enabled).toBe(true);
    expect(coin.physics?.isTrigger).toBe(true);

    // Play: the rotating prop actually spins.
    useEditorStore.getState().setPlaying(true);
    for (let frame = 0; frame < 30; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const playing = useEditorStore.getState();
    const spun = selectActiveObjects(playing).find((item) => item.id === spinnerId)!;
    expect(spun.transform.rotation[1]).toBeGreaterThan(0.3);
  });

  it('activation streaming freezes far objects and wakes them when the player approaches', () => {
    const store = useEditorStore.getState();
    // A camera-follow player at the origin — the streaming center.
    const playerId = store.createObjectWithProps('capsule', { position: [0, 1, 0] });
    useEditorStore.getState().toggleCharacterController(playerId);
    useEditorStore.getState().updateCharacterController(playerId, { cameraFollow: true });

    // Two spinning props: one near, one far outside the streaming radius.
    const nearId = useEditorStore.getState().createObjectWithProps('cube', { position: [5, 0, 5] });
    const farId = useEditorStore.getState().createObjectWithProps('cube', { position: [500, 0, 500] });
    useEditorStore.getState().attachBehaviorPreset(nearId, 'rotating-prop');
    useEditorStore.getState().attachBehaviorPreset(farId, 'rotating-prop');
    useEditorStore.getState().updateSceneStreaming({ enabled: true, radius: 100 });

    useEditorStore.getState().setPlaying(true);
    for (let frame = 0; frame < 40; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    let objects = selectActiveObjects(useEditorStore.getState());
    expect(objects.find((item) => item.id === nearId)!.transform.rotation[1]).toBeGreaterThan(0.3);
    expect(objects.find((item) => item.id === farId)!.transform.rotation[1]).toBe(0); // frozen
    expect(useEditorStore.getState().runtimeDisabled).toContain(farId);
    expect(useEditorStore.getState().runtimeHidden).toContain(farId); // not rendered either

    // Walk the player next to the far prop: it must wake and start spinning.
    useEditorStore.getState().updateTransform(playerId, 'position', [495, 1, 495]);
    for (let frame = 0; frame < 60; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    objects = selectActiveObjects(useEditorStore.getState());
    expect(useEditorStore.getState().runtimeDisabled).not.toContain(farId);
    expect(objects.find((item) => item.id === farId)!.transform.rotation[1]).toBeGreaterThan(0.3);
    // And the near prop (now far away) streamed OUT.
    expect(useEditorStore.getState().runtimeDisabled).toContain(nearId);
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
