import { describe, expect, it } from 'vitest';
import { BEHAVIOR_PRESETS } from '../behaviors';
import { compileFeatherScriptToGraph } from '../../scripting/featherCompiler';
import { graphToFeatherScript } from '../../scripting/featherScript';
import type { ProjectGraph, ProjectVariable, ScriptBlueprint } from '../../types';

/**
 * Every behavior preset must sit ON the supported FeatherScript surface: compile with zero
 * warnings (a warning = part of the behavior silently became a comment node) and round-trip
 * through the printer, since attaching one produces a real blueprint the user will read and edit.
 */
describe('behavior presets', () => {
  const blueprint: ScriptBlueprint = {
    id: 'bp-behavior',
    name: 'Behavior',
    description: '',
    graphId: 'graph-behavior',
    color: '#3DDC97',
    variables: [],
    createdAt: 1,
  };
  const graph: ProjectGraph = { id: 'graph-behavior', name: 'Behavior Graph', nodes: [], edges: [] };

  for (const preset of BEHAVIOR_PRESETS) {
    it(`"${preset.name}" compiles warning-free and round-trips`, () => {
      const variables: ProjectVariable[] = (preset.ensureProjectVariables ?? []).map((wanted, index) => ({
        id: `var-${index}`,
        name: wanted.name,
        type: wanted.type,
        defaultValue: wanted.defaultValue ?? 0,
        persistent: true,
        createdAt: 1,
      }));

      const compiled = compileFeatherScriptToGraph({ blueprint, graph, variables, source: preset.script });
      expect(compiled.ok, preset.id).toBe(true);
      expect(
        compiled.diagnostics.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`),
        `${preset.id} must compile without dropping semantics`,
      ).toEqual([]);
      expect(compiled.graph!.nodes.length).toBeGreaterThan(1);

      const printed = graphToFeatherScript({
        blueprint: compiled.blueprint!,
        graph: compiled.graph!,
        variables,
        blueprints: [compiled.blueprint!],
      });
      const again = compileFeatherScriptToGraph({ blueprint: compiled.blueprint!, graph: compiled.graph!, variables, source: printed });
      expect(again.ok, `${preset.id} reprint must recompile`).toBe(true);
      expect(again.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'), `${preset.id}:\n${printed}`).toEqual([]);
    });
  }

  it('preset ids are unique and scripts declare identifier blueprint names', () => {
    const ids = BEHAVIOR_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of BEHAVIOR_PRESETS) {
      expect(preset.script, preset.id).toMatch(/^blueprint [A-Za-z_][A-Za-z0-9_]*\n/);
    }
  });

  it('door presets use one named Timeline with matching playback controls', () => {
    for (const presetId of ['door-on-interact', 'timed-door']) {
      const preset = BEHAVIOR_PRESETS.find((item) => item.id === presetId)!;
      const compiled = compileFeatherScriptToGraph({ blueprint, graph, variables: [], source: preset.script });
      const timelines = compiled.graph!.nodes.filter((node) => node.data.nodeKind === 'action.tweenProperty');
      const controls = compiled.graph!.nodes.filter((node) => node.data.nodeKind === 'action.timelineControl');
      expect(timelines, presetId).toHaveLength(1);
      expect(controls.length, presetId).toBeGreaterThanOrEqual(2);
      const timelineId = timelines[0].data.timelineId;
      expect(timelineId).toBeTruthy();
      expect(controls.every((control) => control.data.timelineRefId === timelineId)).toBe(true);
    }
  });
});
