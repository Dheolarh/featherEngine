import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();
type WriteOptions = { expectedContents: string | null } | undefined;
const performWrite = (path: string, contents: string, options?: WriteOptions) => {
  const currentContents = files.get(path) ?? null;
  if (options && currentContents !== options.expectedContents) {
    return { kind: 'changed' as const, currentContents };
  }
  files.set(path, contents);
  return { kind: 'written' as const };
};
const writeProjectText = vi.fn(async (
  _projectDir: string,
  path: string,
  contents: string,
  options?: WriteOptions,
) => {
  return performWrite(path, contents, options);
});
const readProjectText = vi.fn(async (_projectDir: string, path: string) => files.get(path) ?? null);
const watchProjectPaths = vi.fn(async () => () => undefined);

vi.mock('../../platform', () => ({
  getPlatform: async () => ({
    isDesktop: true,
    readProjectText,
    writeProjectText,
    watchProjectPaths,
    revealProjectFile: vi.fn(),
  }),
}));

import { blankProject } from '../../project/serialize';
import { graphToFeatherScript } from '../../scripting/featherScript';
import { useEditorStore } from '../editorStore';
import { useFeatherExternalStore } from '../featherExternalStore';
import { clearHistory, initHistory, redo, undo } from '../history';
import { useProjectStore } from '../projectStore';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const setupBlueprint = () => {
  const { blueprintId } = useEditorStore.getState().createBlueprintNamed('External Probe');
  const source = [
    'blueprint External_Probe',
    '',
    'on start:',
    '    print("baseline")',
  ].join('\n');
  expect(useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, source).ok).toBe(true);
  return { blueprintId, source };
};

const printedSource = (blueprintId: string) => {
  const state = useEditorStore.getState();
  const blueprint = state.blueprints.find((item) => item.id === blueprintId)!;
  const graph = state.graphs.find((item) => item.id === blueprint.graphId)!;
  return graphToFeatherScript({ blueprint, graph, variables: state.variables, blueprints: state.blueprints });
};

describe('external FeatherScript store', () => {
  beforeEach(() => {
    initHistory();
    files.clear();
    vi.clearAllMocks();
    useEditorStore.getState().loadProject(blankProject('External Test'));
    useProjectStore.setState({ hasProject: true, projectDir: '/projects/external-test', projectName: 'External Test' });
    useFeatherExternalStore.setState({ statuses: {}, conflicts: {} });
    clearHistory();
  });

  it('creates a stable linked file and persists its checkpoint metadata', async () => {
    const { blueprintId, source } = setupBlueprint();

    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);

    const blueprint = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!;
    expect(blueprint.featherSourcePath).toMatch(/^scripts\/external-probe--[0-9a-f]{12}\.feather$/);
    expect(files.get(blueprint.featherSourcePath!)).toBe(source);
    expect(blueprint.featherSourceLastSyncedHash).toMatch(/^feather-fnv1a64-v1:/);
    expect(blueprint.featherSourceLastSyncedVisualHash).toMatch(/^feather-fnv1a64-v1:/);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('synced');
  });

  it('applies valid external changes to the graph', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const external = source.replace('"baseline"', '"from VS Code"');
    files.set(path, external);

    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    expect(printedSource(blueprintId)).toContain('print("from VS Code")');
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(external);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('synced');
  });

  it('keeps the last valid graph when an external draft has errors', async () => {
    const { blueprintId } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const before = printedSource(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const invalid = 'blueprint External_Probe\n\non start:\n    definitely_not_supported(';
    files.set(path, invalid);

    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    expect(printedSource(blueprintId)).toBe(before);
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(invalid);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]).toMatchObject({ kind: 'draft-error' });

    const secondInvalid = `${invalid}\n    still_working_on_it(`;
    files.set(path, secondInvalid);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    expect(printedSource(blueprintId)).toBe(before);
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(secondInvalid);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]).toMatchObject({ kind: 'draft-error' });
  });

  it('does not overwrite a file that changed while its blueprint was unlinked', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    await useFeatherExternalStore.getState().unlinkBlueprint(blueprintId);
    const orphanedEdit = source.replace('"baseline"', '"edited while unlinked"');
    files.set(path, orphanedEdit);
    writeProjectText.mockClear();

    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);

    const blueprint = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!;
    expect(files.get(path)).toBe(orphanedEdit);
    expect(writeProjectText).not.toHaveBeenCalled();
    expect(blueprint.featherSourcePath).toBe(path);
    expect(blueprint.featherSourceLastSyncedHash).toBeUndefined();
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]).toMatchObject({
      diskSource: orphanedEdit,
      internalSource: source,
    });

    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    expect(files.get(path)).toBe(orphanedEdit);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
  });

  it('preserves a newer editor draft typed while an internal file write is in flight', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const firstEdit = source.replace('"baseline"', '"first edit"');
    const latestEdit = source.replace('"baseline"', '"latest edit"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, firstEdit);
    const gate = deferred();
    writeProjectText.mockClear();
    writeProjectText.mockImplementationOnce(async (_projectDir, writePath, contents, options) => {
      await gate.promise;
      return performWrite(writePath, contents, options);
    });

    const syncing = useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    await vi.waitFor(() => expect(writeProjectText).toHaveBeenCalled());
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, latestEdit);
    gate.resolve();
    await syncing;

    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(latestEdit);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    expect(files.get(path)).toBe(latestEdit);
    expect(printedSource(blueprintId)).toContain('print("latest edit")');
  });

  it('never overwrites an external save that lands inside the final write window', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const internal = source.replace('"baseline"', '"inside Feather"');
    const external = source.replace('"baseline"', '"saved at the last moment"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, internal);

    const gate = deferred();
    writeProjectText.mockClear();
    writeProjectText.mockImplementationOnce(async (_projectDir, writePath, contents, options) => {
      await gate.promise;
      return performWrite(writePath, contents, options);
    });
    const syncing = useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    await vi.waitFor(() => expect(writeProjectText).toHaveBeenCalled());
    files.set(path, external);
    gate.resolve();
    await syncing;

    expect(files.get(path)).toBe(external);
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(internal);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]?.diskSource).toBe(external);
  });

  it('queues an editor change made while the first linked file is being created', async () => {
    const { blueprintId, source } = setupBlueprint();
    const latestEdit = source.replace('"baseline"', '"typed during link"');
    const gate = deferred();
    writeProjectText.mockImplementationOnce(async (_projectDir, path, contents, options) => {
      await gate.promise;
      return performWrite(path, contents, options);
    });

    const linking = useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    await vi.waitFor(() => expect(writeProjectText).toHaveBeenCalled());
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, latestEdit);
    gate.resolve();
    await linking;
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    expect(files.get(path)).toBe(latestEdit);
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(latestEdit);
  });

  it('verifies an equal existing file again after the watcher starts', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    await useFeatherExternalStore.getState().unlinkBlueprint(blueprintId);
    files.set(path, source);
    const savedDuringWatcherStart = source.replace('"baseline"', '"saved during watcher start"');
    watchProjectPaths.mockImplementationOnce(async () => {
      files.set(path, savedDuringWatcherStart);
      return () => undefined;
    });

    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);

    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(
      savedDuringWatcherStart,
    );
    expect(printedSource(blueprintId)).toContain('print("saved during watcher start")');
  });

  it('requires an explicit choice when disk and Feather both changed', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const internal = source.replace('"baseline"', '"inside Feather"');
    const external = source.replace('"baseline"', '"outside Feather"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, internal);
    files.set(path, external);

    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]).toMatchObject({
      diskSource: external,
      internalSource: internal,
    });
    expect(files.get(path)).toBe(external);

    await useFeatherExternalStore.getState().resolveConflict(blueprintId, 'internal');
    expect(files.get(path)).toBe(internal);
    expect(printedSource(blueprintId)).toContain('print("inside Feather")');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]).toBeUndefined();
  });

  it('resolves a conflict with the latest editor and disk contents, not the stale warning snapshot', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    useEditorStore.getState().updateBlueprintFeatherSource(
      blueprintId,
      source.replace('"baseline"', '"first inside edit"'),
    );
    files.set(path, source.replace('"baseline"', '"first outside edit"'));
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const latestInternal = source.replace('"baseline"', '"latest inside edit"');
    const latestExternal = source.replace('"baseline"', '"latest outside edit"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, latestInternal);
    files.set(path, latestExternal);
    await useFeatherExternalStore.getState().resolveConflict(blueprintId, 'internal');

    expect(files.get(path)).toBe(latestInternal);
    expect(printedSource(blueprintId)).toContain('print("latest inside edit")');
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(latestInternal);
  });

  it('serializes conflict resolution behind an already-running watcher reconciliation', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const internal = source.replace('"baseline"', '"inside Feather"');
    const external = source.replace('"baseline"', '"outside Feather"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, internal);
    files.set(path, external);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const gate = deferred();
    const staleDiskSnapshot = external;
    readProjectText.mockClear();
    readProjectText.mockImplementationOnce(async () => {
      await gate.promise;
      return staleDiskSnapshot;
    });
    const watcherSync = useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    await vi.waitFor(() => expect(readProjectText).toHaveBeenCalledTimes(1));
    const resolving = useFeatherExternalStore.getState().resolveConflict(blueprintId, 'internal');
    await Promise.resolve();
    expect(readProjectText).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([watcherSync, resolving]);

    expect(files.get(path)).toBe(internal);
    expect(printedSource(blueprintId)).toContain('print("inside Feather")');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]).toBeUndefined();
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('synced');
  });

  it('re-reads disk before accepting the external side of a conflict', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    useEditorStore.getState().updateBlueprintFeatherSource(
      blueprintId,
      source.replace('"baseline"', '"inside Feather"'),
    );
    files.set(path, source.replace('"baseline"', '"first disk version"'));
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const latestExternal = source.replace('"baseline"', '"latest disk version"');
    files.set(path, latestExternal);
    await useFeatherExternalStore.getState().resolveConflict(blueprintId, 'external');

    expect(printedSource(blueprintId)).toContain('print("latest disk version")');
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(latestExternal);
  });

  it('asks again instead of discarding an editor change made while conflict resolution reads disk', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const firstInternal = source.replace('"baseline"', '"first inside"');
    const firstExternal = source.replace('"baseline"', '"first outside"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, firstInternal);
    files.set(path, firstExternal);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const gate = deferred();
    readProjectText.mockClear();
    readProjectText.mockImplementationOnce(async (_projectDir, readPath) => {
      await gate.promise;
      return files.get(readPath) ?? null;
    });
    const resolving = useFeatherExternalStore.getState().resolveConflict(blueprintId, 'external');
    await vi.waitFor(() => expect(readProjectText).toHaveBeenCalled());
    const latestInternal = source.replace('"baseline"', '"typed while reading"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, latestInternal);
    gate.resolve();
    await resolving;

    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(latestInternal);
    expect(printedSource(blueprintId)).toContain('print("baseline")');
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]?.internalSource).toBe(latestInternal);
  });

  it('preserves a Visual edit made while Keep Feather is writing', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const internal = source.replace('"baseline"', '"inside Feather"');
    const external = source.replace('"baseline"', '"outside Feather"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, internal);
    files.set(path, external);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const gate = deferred();
    writeProjectText.mockClear();
    writeProjectText.mockImplementationOnce(async (_projectDir, writePath, contents, options) => {
      await gate.promise;
      return performWrite(writePath, contents, options);
    });
    const resolving = useFeatherExternalStore.getState().resolveConflict(blueprintId, 'internal');
    await vi.waitFor(() => expect(writeProjectText).toHaveBeenCalled());
    const visualNodeId = useEditorStore.getState().addGraphNodeToBlueprint(
      blueprintId,
      'Rotate',
      'Runtime',
      { axis: 'y', amount: 45 },
    );
    gate.resolve();
    await resolving;
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const state = useEditorStore.getState();
    const blueprint = state.blueprints.find((item) => item.id === blueprintId)!;
    const graph = state.graphs.find((item) => item.id === blueprint.graphId)!;
    expect(graph.nodes.some((node) => node.id === visualNodeId)).toBe(true);
    expect(files.get(path)).toBe(internal);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
  });

  it('asks again when the external file changes while Keep Feather is writing', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const internal = source.replace('"baseline"', '"inside Feather"');
    const external = source.replace('"baseline"', '"first outside"');
    const latestExternal = source.replace('"baseline"', '"last-moment outside"');
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, internal);
    files.set(path, external);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    const gate = deferred();
    writeProjectText.mockClear();
    writeProjectText.mockImplementationOnce(async (_projectDir, writePath, contents, options) => {
      await gate.promise;
      return performWrite(writePath, contents, options);
    });
    const resolving = useFeatherExternalStore.getState().resolveConflict(blueprintId, 'internal');
    await vi.waitFor(() => expect(writeProjectText).toHaveBeenCalled());
    files.set(path, latestExternal);
    gate.resolve();
    await resolving;

    expect(files.get(path)).toBe(latestExternal);
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(internal);
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('conflict');
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]?.diskSource).toBe(latestExternal);
  });

  it('offers the Visual graph as a non-destructive third side of a conflict', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    const invalidDraft = `${source}\n    still_editing(`;
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, invalidDraft);
    useEditorStore.getState().addGraphNodeToBlueprint(
      blueprintId,
      'Rotate',
      'Runtime',
      { axis: 'y', amount: 90 },
    );
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    const conflict = useFeatherExternalStore.getState().conflicts[blueprintId]!;
    expect(conflict.internalSource).toBe(invalidDraft);
    expect(conflict.visualSource).not.toBe(invalidDraft);

    await useFeatherExternalStore.getState().resolveConflict(blueprintId, 'visual');

    expect(files.get(path)).toBe(conflict.visualSource);
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.featherSource).toBe(
      conflict.visualSource,
    );
    expect(useFeatherExternalStore.getState().conflicts[blueprintId]).toBeUndefined();
  });

  it('writes blueprint renames to the linked file instead of restoring the stale declaration', async () => {
    const { blueprintId } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;

    useEditorStore.getState().renameBlueprint(blueprintId, 'Renamed Probe');
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);

    expect(files.get(path)).toContain('blueprint Renamed_Probe');
    expect(useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)?.name).toBe('Renamed Probe');
    expect(useFeatherExternalStore.getState().statuses[blueprintId]?.kind).toBe('synced');
  });

  it('undoes and redoes linked source all the way through the disk file', async () => {
    const { blueprintId, source } = setupBlueprint();
    await useFeatherExternalStore.getState().linkBlueprint(blueprintId);
    const path = useEditorStore.getState().blueprints.find((item) => item.id === blueprintId)!.featherSourcePath!;
    clearHistory();
    const changed = source.replace('"baseline"', '"history change"');
    expect(useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, changed).ok).toBe(true);
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    expect(files.get(path)).toBe(changed);

    undo();
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    expect(files.get(path)).toBe(source);

    redo();
    await useFeatherExternalStore.getState().syncBlueprintNow(blueprintId);
    expect(files.get(path)).toBe(changed);
  });
});
