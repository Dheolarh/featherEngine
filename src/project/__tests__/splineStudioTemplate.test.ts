import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../serialize';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { createSplineStudioTemplate } from '../splineStudioTemplate';

describe('Spline Studio template', () => {
  beforeEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Spline Studio Test'));
  });

  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Spline Studio Cleanup'));
  });

  it('builds an asset-free, material-complete studio composition with valid kinetic logic', async () => {
    const sculptureId = await createSplineStudioTemplate();
    const state = useEditorStore.getState();
    const scene = state.activeScene();
    const objects = selectActiveObjects(state);

    expect(scene?.name).toBe('Spline Studio');
    expect(state.renderSettings.renderPreset).toBe('spline-studio');
    expect(scene?.environment?.contactShadowBlur).toBe(3.4);
    expect(scene?.environment?.contactShadowColor).toBe('#120D20');
    expect(state.assets).toHaveLength(0);
    expect(state.materials.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Graphite Stage', 'Violet Candy', 'Coral Candy', 'Aqua Candy', 'Pearl White']),
    );

    const materialIds = new Set(state.materials.map((item) => item.id));
    expect(
      objects
        .filter((object) => object.renderer?.materialId)
        .every((object) => materialIds.has(object.renderer!.materialId!)),
    ).toBe(true);

    const sculpture = objects.find((object) => object.id === sculptureId);
    expect(sculpture?.name).toBe('Kinetic Sculpture');
    expect(objects.filter((object) => object.parentId === sculptureId)).toHaveLength(6);
    expect(objects.some((object) => object.kind === 'camera')).toBe(true);
    expect(objects.filter((object) => object.kind === 'light')).toHaveLength(2);

    const blueprint = state.blueprints.find((item) => item.id === sculpture?.script?.blueprintId);
    const graph = state.graphs.find((item) => item.id === blueprint?.graphId);
    expect(blueprint).toBeDefined();
    expect(graph).toBeDefined();
    expect(scanBlueprintGraphProblems(blueprint!, graph!, state.variables)).toEqual([]);
    const timeline = graph!.nodes.find((node) => node.data.timelineId === 'studio-float');
    expect(timeline?.data.tweenLoop).toBe(true);
    expect(timeline?.data.tweenPingPong).toBe(true);
    expect(graph!.nodes.some((node) => node.data.nodeKind === 'action.rotate')).toBe(true);
  });

  it('moves the sculpture through the real Blueprint runtime while preserving the authored scene', async () => {
    const sculptureId = await createSplineStudioTemplate();
    const authored = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === sculptureId)!.transform;

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    useEditorStore.getState().tickRuntime(0);
    useEditorStore.getState().tickRuntime(0.5);

    const live = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === sculptureId)!.transform;
    expect(live.rotation[1]).not.toBe(authored.rotation[1]);

    useEditorStore.getState().setPlaying(false);
    const restored = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === sculptureId)!.transform;
    expect(restored).toEqual(authored);
  });
});
