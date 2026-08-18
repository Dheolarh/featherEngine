import { create } from 'zustand';
import { getPlatform } from '../platform';
import type { ProjectTextWriteResult } from '../platform/types';
import { compileFeatherScriptToGraph } from '../scripting/featherCompiler';
import {
  classifyFeatherSourceSync,
  hashFeatherSource,
  makeFeatherSourcePath,
} from '../scripting/featherExternalSource';
import { graphToFeatherScript } from '../scripting/featherScript';
import type { FeatherDiagnostic } from '../scripting/featherParser';
import type { ProjectGraph, ScriptBlueprint } from '../types';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';

export type FeatherExternalSyncKind =
  | 'syncing'
  | 'synced'
  | 'draft-error'
  | 'missing'
  | 'conflict'
  | 'error';

export interface FeatherExternalSyncStatus {
  kind: FeatherExternalSyncKind;
  path: string;
  message: string;
  updatedAt: number;
}

export interface FeatherExternalConflict {
  blueprintId: string;
  path: string;
  diskSource: string;
  internalSource: string;
  visualSource: string;
}

interface FeatherExternalState {
  statuses: Record<string, FeatherExternalSyncStatus | undefined>;
  conflicts: Record<string, FeatherExternalConflict | undefined>;
  linkBlueprint: (blueprintId: string) => Promise<void>;
  unlinkBlueprint: (blueprintId: string) => Promise<void>;
  revealBlueprintFile: (blueprintId: string) => Promise<void>;
  recreateBlueprintFile: (blueprintId: string) => Promise<void>;
  syncBlueprintNow: (blueprintId: string) => Promise<void>;
  resolveConflict: (
    blueprintId: string,
    choice: 'external' | 'internal' | 'visual',
  ) => Promise<void>;
}

interface FeatherSourceContext {
  blueprint: ScriptBlueprint;
  graph: ProjectGraph;
  visualSource: string;
  internalSource: string;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isBlockingWarning = (diagnostic: FeatherDiagnostic): boolean =>
  diagnostic.severity === 'warning' &&
  !diagnostic.message.startsWith('Add a blueprint declaration at the top');

const sourceContext = (blueprintId: string): FeatherSourceContext | null => {
  const editor = useEditorStore.getState();
  const blueprint = editor.blueprints.find((item) => item.id === blueprintId);
  const graph = editor.graphs.find((item) => item.id === blueprint?.graphId);
  if (!blueprint || !graph) return null;
  const visualSource = graphToFeatherScript({
    blueprint,
    graph,
    variables: editor.variables,
    blueprints: editor.blueprints,
  });
  return {
    blueprint,
    graph,
    visualSource,
    internalSource: blueprint.featherSource ?? visualSource,
  };
};

const compilePreview = (context: FeatherSourceContext, source: string) => {
  const editor = useEditorStore.getState();
  return compileFeatherScriptToGraph({
    source,
    blueprint: context.blueprint,
    graph: context.graph,
    variables: editor.variables,
    blueprints: editor.blueprints,
    preserveSource: true,
  });
};

const draftStatus = (
  context: FeatherSourceContext,
  source: string,
): Pick<FeatherExternalSyncStatus, 'kind' | 'message'> => {
  const preview = compilePreview(context, source);
  const errors = preview.diagnostics.filter((item) => item.severity === 'error');
  const blockingWarnings = preview.diagnostics.filter(isBlockingWarning);
  const blockers = errors.length ? errors : blockingWarnings;
  if (blockers.length > 0) {
    return {
      kind: 'draft-error',
      message: `File saved · visual graph kept at its last valid version · ${blockers[0].message}`,
    };
  }
  const warnings = preview.diagnostics.filter((item) => item.severity === 'warning').length;
  return {
    kind: 'synced',
    message: warnings
      ? `Linked file and visual graph are current · ${warnings} suggestion${warnings === 1 ? '' : 's'}`
      : 'Linked file and visual graph are current',
  };
};

let editorMutationDepth = 0;

const mutateEditor = (mutation: () => void): void => {
  editorMutationDepth += 1;
  try {
    mutation();
  } finally {
    editorMutationDepth -= 1;
  }
};

const setStatus = (
  blueprintId: string,
  path: string,
  kind: FeatherExternalSyncKind,
  message: string,
): void => {
  useFeatherExternalStore.setState((state) => ({
    statuses: {
      ...state.statuses,
      [blueprintId]: { kind, path, message, updatedAt: Date.now() },
    },
  }));
};

const setConflict = (conflict: FeatherExternalConflict | undefined): void => {
  if (!conflict) return;
  useFeatherExternalStore.setState((state) => ({
    conflicts: { ...state.conflicts, [conflict.blueprintId]: conflict },
  }));
};

const clearBlueprintState = (blueprintId: string): void => {
  useFeatherExternalStore.setState((state) => ({
    statuses: { ...state.statuses, [blueprintId]: undefined },
    conflicts: { ...state.conflicts, [blueprintId]: undefined },
  }));
};

const clearConflict = (blueprintId: string): void => {
  useFeatherExternalStore.setState((state) => ({
    conflicts: { ...state.conflicts, [blueprintId]: undefined },
  }));
};

const surfaceConditionalWriteChange = (
  blueprintId: string,
  path: string,
  result: Extract<ProjectTextWriteResult, { kind: 'changed' }>,
): void => {
  const current = sourceContext(blueprintId);
  if (!current || current.blueprint.featherSourcePath !== path) return;
  if (result.currentContents === null) {
    clearConflict(blueprintId);
    setStatus(blueprintId, path, 'missing', 'Linked file changed while saving and is now missing');
    return;
  }
  setConflict({
    blueprintId,
    path,
    diskSource: result.currentContents,
    internalSource: current.internalSource,
    visualSource: current.visualSource,
  });
  setStatus(
    blueprintId,
    path,
    'conflict',
    result.recoveryPath
      ? `External file changed while Feather was saving · recovery copy: ${result.recoveryPath}`
      : 'External file changed while Feather was saving · review the latest versions',
  );
};

const savedDesktopProject = async () => {
  const projectDir = useProjectStore.getState().projectDir;
  const platform = await getPlatform();
  if (!platform.isDesktop || !projectDir || projectDir === 'web') {
    throw new Error('Save this project in the desktop app before linking external scripts.');
  }
  if (!platform.readProjectText || !platform.writeProjectText) {
    throw new Error('External script files are not available on this platform.');
  }
  return { platform, projectDir };
};

const operationStillTargets = (
  projectDir: string,
  blueprintId: string,
  graphId: string,
  expectedPath?: string,
): FeatherSourceContext | null => {
  if (useProjectStore.getState().projectDir !== projectDir) return null;
  const current = sourceContext(blueprintId);
  if (!current || current.blueprint.graphId !== graphId) return null;
  if (expectedPath !== undefined && current.blueprint.featherSourcePath !== expectedPath) return null;
  return current;
};

const applyExternalSource = (
  blueprintId: string,
  path: string,
  source: string,
  diskHash: string,
): void => {
  const context = sourceContext(blueprintId);
  if (!context) return;
  const preview = compilePreview(context, source);
  const errors = preview.diagnostics.filter((item) => item.severity === 'error');
  const blockingWarnings = preview.diagnostics.filter(isBlockingWarning);
  let blueprintRenamed = false;

  mutateEditor(() => {
    useEditorStore.getState().updateBlueprintFeatherSource(blueprintId, source);
    if (preview.ok && errors.length === 0 && blockingWarnings.length === 0) {
      useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, source);
    }
    const latest = sourceContext(blueprintId);
    blueprintRenamed = Boolean(latest && latest.blueprint.name !== context.blueprint.name);
    useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
      path,
      lastSyncedHash: diskHash,
      lastSyncedVisualHash: latest ? hashFeatherSource(latest.visualSource) : undefined,
    });
  });

  clearConflict(blueprintId);
  const blockers = errors.length ? errors : blockingWarnings;
  if (blockers.length > 0) {
    setStatus(
      blueprintId,
      path,
      'draft-error',
      `External draft loaded · visual graph kept at its last valid version · ${blockers[0].message}`,
    );
    return;
  }
  const warnings = preview.diagnostics.filter((item) => item.severity === 'warning').length;
  setStatus(
    blueprintId,
    path,
    'synced',
    warnings
      ? `External changes applied · ${warnings} suggestion${warnings === 1 ? '' : 's'}`
      : 'External changes applied to the visual graph',
  );
  // A valid external edit can rename a Blueprint. The editor store invalidates scripts that refer
  // to that Blueprint; schedule them here because mutateEditor intentionally suppresses the normal
  // store subscription while this source is being applied.
  if (blueprintRenamed) scheduleAllLinkedBlueprints();
};

const reconcileBlueprint = async (blueprintId: string): Promise<void> => {
  const context = sourceContext(blueprintId);
  const path = context?.blueprint.featherSourcePath;
  if (!context || !path) return;

  try {
    const { platform, projectDir } = await savedDesktopProject();
    setStatus(blueprintId, path, 'syncing', 'Checking linked file…');
    const diskSource = await platform.readProjectText!(projectDir, path);

    const current = operationStillTargets(projectDir, blueprintId, context.graph.id, path);
    if (!current) return;
    if (diskSource === null) {
      setStatus(blueprintId, path, 'missing', 'Linked file is missing');
      return;
    }

    const sync = classifyFeatherSourceSync({
      blueprint: current.blueprint,
      diskSource,
      visualSource: current.visualSource,
    });

    if (sync.kind === 'conflict') {
      setConflict({
        blueprintId,
        path,
        diskSource,
        internalSource: current.internalSource,
        visualSource: current.visualSource,
      });
      setStatus(blueprintId, path, 'conflict', 'External file and Feather both changed');
      return;
    }

    if (sync.kind === 'external-update') {
      applyExternalSource(blueprintId, path, diskSource, sync.diskHash);
      return;
    }

    if (sync.kind === 'internal-update') {
      // Editors often save through temp-file rename. Re-read immediately before our write so an
      // external change that landed after the first read becomes a conflict instead of being lost.
      const diskBeforeWrite = await platform.readProjectText!(projectDir, path);
      const latestBeforeWrite = operationStillTargets(projectDir, blueprintId, context.graph.id, path);
      if (!latestBeforeWrite) return;
      if (diskBeforeWrite === null) {
        setStatus(blueprintId, path, 'missing', 'Linked file is missing');
        return;
      }
      const freshSync = classifyFeatherSourceSync({
        blueprint: latestBeforeWrite.blueprint,
        diskSource: diskBeforeWrite,
        visualSource: latestBeforeWrite.visualSource,
      });
      if (freshSync.kind === 'conflict') {
        setConflict({
          blueprintId,
          path,
          diskSource: diskBeforeWrite,
          internalSource: latestBeforeWrite.internalSource,
          visualSource: latestBeforeWrite.visualSource,
        });
        setStatus(blueprintId, path, 'conflict', 'External file and Feather both changed');
        return;
      }
      if (freshSync.kind === 'external-update') {
        applyExternalSource(blueprintId, path, diskBeforeWrite, freshSync.diskHash);
        return;
      }
      if (freshSync.kind === 'unchanged') {
        clearConflict(blueprintId);
        const health = draftStatus(latestBeforeWrite, latestBeforeWrite.internalSource);
        setStatus(blueprintId, path, health.kind, health.message);
        return;
      }

      const source = latestBeforeWrite.internalSource;
      const writtenHash = hashFeatherSource(source);
      const writtenVisualHash = hashFeatherSource(latestBeforeWrite.visualSource);
      const writeResult = await platform.writeProjectText!(projectDir, path, source, {
        expectedContents: diskBeforeWrite,
      });
      const afterWrite = operationStillTargets(projectDir, blueprintId, context.graph.id, path);
      if (!afterWrite) return;
      if (writeResult.kind === 'changed') {
        surfaceConditionalWriteChange(blueprintId, path, writeResult);
        return;
      }

      // The filesystem write yielded control. If the user changed either Code or Visual while it
      // was in flight, never feed the older source back through the compiler. Record exactly what
      // reached disk, then queue the newer editor state as another internal update.
      if (
        hashFeatherSource(afterWrite.internalSource) !== writtenHash ||
        hashFeatherSource(afterWrite.visualSource) !== writtenVisualHash
      ) {
        mutateEditor(() => {
          useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
            path,
            lastSyncedHash: writtenHash,
            lastSyncedVisualHash: writtenVisualHash,
          });
        });
        clearConflict(blueprintId);
        setStatus(blueprintId, path, 'syncing', 'Feather changed again · syncing latest edit…');
        void enqueueReconcile(blueprintId);
        return;
      }

      const preview = compilePreview(afterWrite, source);
      const errors = preview.diagnostics.filter((item) => item.severity === 'error');
      const blockingWarnings = preview.diagnostics.filter(isBlockingWarning);
      mutateEditor(() => {
        if (
          afterWrite.blueprint.featherSource !== undefined &&
          preview.ok &&
          errors.length === 0 &&
          blockingWarnings.length === 0 &&
          afterWrite.blueprint.featherSourceLastSynced !== source
        ) {
          useEditorStore.getState().syncBlueprintFeatherSource(blueprintId, source);
        }
        const checkpoint = sourceContext(blueprintId);
        useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
          path,
          lastSyncedHash: writtenHash,
          lastSyncedVisualHash: checkpoint ? hashFeatherSource(checkpoint.visualSource) : undefined,
        });
      });
      clearConflict(blueprintId);
      const health = draftStatus(afterWrite, source);
      setStatus(blueprintId, path, health.kind, health.message);
      return;
    }

    clearConflict(blueprintId);
    if (
      current.blueprint.featherSourceLastSyncedHash !== sync.diskHash ||
      current.blueprint.featherSourceLastSyncedVisualHash !== sync.visualHash
    ) {
      mutateEditor(() => {
        useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
          path,
          lastSyncedHash: sync.diskHash,
          lastSyncedVisualHash: sync.visualHash,
        });
      });
    }
    const health = draftStatus(current, current.internalSource);
    setStatus(blueprintId, path, health.kind, health.message);
  } catch (error) {
    setStatus(blueprintId, path, 'error', errorMessage(error));
  }
};

const queues = new Map<string, Promise<void>>();

const enqueueBlueprintOperation = (
  blueprintId: string,
  operation: () => Promise<void>,
): Promise<void> => {
  const previous = queues.get(blueprintId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(operation)
    .catch((error) => {
      const path = sourceContext(blueprintId)?.blueprint.featherSourcePath ?? 'scripts';
      setStatus(blueprintId, path, 'error', errorMessage(error));
    });
  queues.set(blueprintId, next);
  void next.finally(() => {
    if (queues.get(blueprintId) === next) queues.delete(blueprintId);
  });
  return next;
};

const enqueueReconcile = (blueprintId: string): Promise<void> => {
  return enqueueBlueprintOperation(blueprintId, () => reconcileBlueprint(blueprintId));
};

let watcherCleanup: (() => void) | undefined;
let watcherGeneration = 0;

const linkedBlueprints = (): ScriptBlueprint[] =>
  useEditorStore.getState().blueprints.filter((item) => Boolean(item.featherSourcePath));

const restartWatcher = async (): Promise<void> => {
  const generation = ++watcherGeneration;
  watcherCleanup?.();
  watcherCleanup = undefined;

  try {
    const links = linkedBlueprints();
    if (links.length === 0) return;
    const { platform, projectDir } = await savedDesktopProject();
    if (!platform.watchProjectPaths) return;
    const directories = [
      ...new Set(
        links.map((item) => {
          const path = item.featherSourcePath!;
          const separator = path.lastIndexOf('/');
          return separator > 0 ? path.slice(0, separator) : path;
        }),
      ),
    ];
    const stop = await platform.watchProjectPaths(
      projectDir,
      directories,
      (changedPaths) => {
        const currentLinks = linkedBlueprints();
        for (const blueprint of currentLinks) {
          const linkedPath = blueprint.featherSourcePath!;
          if (
            changedPaths.some(
              (changedPath) =>
                changedPath === linkedPath ||
                changedPath.startsWith(`${linkedPath}/`) ||
                linkedPath.startsWith(`${changedPath}/`),
            )
          ) {
            void enqueueReconcile(blueprint.id);
          }
        }
      },
      { debounceMs: 250 },
    );
    if (generation !== watcherGeneration) {
      stop();
      return;
    }
    watcherCleanup = stop;
  } catch (error) {
    for (const blueprint of linkedBlueprints()) {
      setStatus(
        blueprint.id,
        blueprint.featherSourcePath!,
        'error',
        `Could not watch linked scripts: ${errorMessage(error)}`,
      );
    }
  }
};

let scheduledReconcile: ReturnType<typeof setTimeout> | undefined;

function scheduleAllLinkedBlueprints(delayMs = 450): void {
  if (scheduledReconcile) clearTimeout(scheduledReconcile);
  scheduledReconcile = setTimeout(() => {
    scheduledReconcile = undefined;
    for (const blueprint of linkedBlueprints()) void enqueueReconcile(blueprint.id);
  }, delayMs);
}

const linkOrRecreate = async (blueprintId: string, forceExistingPath = false): Promise<void> => {
  const context = sourceContext(blueprintId);
  if (!context) return;
  const previousPath = context.blueprint.featherSourcePath;
  const path =
    (forceExistingPath ? previousPath : undefined) ??
    previousPath ??
    makeFeatherSourcePath(context.blueprint.name, context.blueprint.id);
  try {
    const { platform, projectDir } = await savedDesktopProject();
    const current = operationStillTargets(projectDir, blueprintId, context.graph.id);
    if (!current || current.blueprint.featherSourcePath !== previousPath) return;
    setStatus(
      blueprintId,
      path,
      'syncing',
      forceExistingPath ? 'Recreating linked file…' : 'Checking linked file…',
    );

    // Unlink deliberately leaves the file on disk. If that file is still present when the user
    // links again, make them choose a side instead of silently replacing work done while unlinked.
    const existingSource = await platform.readProjectText!(projectDir, path);
    const latest = operationStillTargets(projectDir, blueprintId, context.graph.id);
    if (!latest || latest.blueprint.featherSourcePath !== previousPath) return;
    const source = latest.internalSource;
    const sourceHash = hashFeatherSource(source);

    if (existingSource !== null && hashFeatherSource(existingSource) !== sourceHash) {
      mutateEditor(() => {
        useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, { path });
      });
      setConflict({
        blueprintId,
        path,
        diskSource: existingSource,
        internalSource: source,
        visualSource: latest.visualSource,
      });
      setStatus(blueprintId, path, 'conflict', 'Existing linked file and Feather differ');
      await restartWatcher();
      return;
    }

    const sourceVisualHash = hashFeatherSource(latest.visualSource);
    if (existingSource === null) {
      const writeResult = await platform.writeProjectText!(projectDir, path, source, {
        expectedContents: null,
      });
      const afterWrite = operationStillTargets(projectDir, blueprintId, context.graph.id);
      if (!afterWrite || afterWrite.blueprint.featherSourcePath !== previousPath) return;
      if (writeResult.kind === 'changed') {
        mutateEditor(() => {
          useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, { path });
        });
        surfaceConditionalWriteChange(blueprintId, path, writeResult);
        await restartWatcher();
        return;
      }
    }

    const afterIo = operationStillTargets(projectDir, blueprintId, context.graph.id);
    if (!afterIo || afterIo.blueprint.featherSourcePath !== previousPath) return;
    const changedDuringWrite =
      hashFeatherSource(afterIo.internalSource) !== sourceHash ||
      hashFeatherSource(afterIo.visualSource) !== sourceVisualHash;
    mutateEditor(() => {
      useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
        path,
        lastSyncedHash: sourceHash,
        lastSyncedVisualHash: sourceVisualHash,
      });
    });
    clearConflict(blueprintId);
    const linked = sourceContext(blueprintId) ?? afterIo;
    const health = draftStatus(linked, linked.internalSource);
    setStatus(
      blueprintId,
      path,
      changedDuringWrite ? 'syncing' : health.kind,
      changedDuringWrite ? 'Feather changed again · syncing latest edit…' : health.message,
    );
    await restartWatcher();
    // Watching starts after the initial read/write, so verify once more to close the event gap if an
    // external editor saved between that read and watcher registration.
    await reconcileBlueprint(blueprintId);
  } catch (error) {
    setStatus(blueprintId, path, 'error', errorMessage(error));
  }
};

export const useFeatherExternalStore = create<FeatherExternalState>(() => ({
  statuses: {},
  conflicts: {},

  linkBlueprint: (blueprintId) =>
    enqueueBlueprintOperation(blueprintId, () => linkOrRecreate(blueprintId)),

  unlinkBlueprint: (blueprintId) =>
    enqueueBlueprintOperation(blueprintId, async () => {
      mutateEditor(() => {
        useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, undefined);
      });
      clearBlueprintState(blueprintId);
      await restartWatcher();
    }),

  revealBlueprintFile: async (blueprintId) => {
    const context = sourceContext(blueprintId);
    const path = context?.blueprint.featherSourcePath;
    if (!path) return;
    try {
      const { platform, projectDir } = await savedDesktopProject();
      if (!platform.revealProjectFile) throw new Error('Reveal is unavailable on this platform.');
      await platform.revealProjectFile(projectDir, path);
    } catch (error) {
      setStatus(blueprintId, path, 'error', errorMessage(error));
    }
  },

  recreateBlueprintFile: (blueprintId) =>
    enqueueBlueprintOperation(blueprintId, () => linkOrRecreate(blueprintId, true)),

  syncBlueprintNow: (blueprintId) => enqueueReconcile(blueprintId),

  resolveConflict: (blueprintId, choice) =>
    enqueueBlueprintOperation(blueprintId, async () => {
      const conflict = useFeatherExternalStore.getState().conflicts[blueprintId];
      if (!conflict) return;
      try {
      const initial = sourceContext(blueprintId);
      if (!initial || initial.blueprint.featherSourcePath !== conflict.path) {
        clearConflict(blueprintId);
        return;
      }
      const initialInternalHash = hashFeatherSource(initial.internalSource);
      const initialVisualHash = hashFeatherSource(initial.visualSource);
      setStatus(blueprintId, conflict.path, 'syncing', 'Resolving with the latest file…');
      const { platform, projectDir } = await savedDesktopProject();
      const beforeRead = operationStillTargets(
        projectDir,
        blueprintId,
        initial.graph.id,
        conflict.path,
      );
      if (!beforeRead) return;
      const diskSource = await platform.readProjectText!(projectDir, conflict.path);
      const current = operationStillTargets(
        projectDir,
        blueprintId,
        initial.graph.id,
        conflict.path,
      );
      if (!current) return;
      if (diskSource === null) {
        clearConflict(blueprintId);
        setStatus(blueprintId, conflict.path, 'missing', 'Linked file is missing');
        return;
      }
      if (
        hashFeatherSource(current.internalSource) !== initialInternalHash ||
        hashFeatherSource(current.visualSource) !== initialVisualHash
      ) {
        setConflict({
          blueprintId,
          path: conflict.path,
          diskSource,
          internalSource: current.internalSource,
          visualSource: current.visualSource,
        });
        setStatus(
          blueprintId,
          conflict.path,
          'conflict',
          'Feather changed while resolving · review the latest versions',
        );
        return;
      }

      if (choice === 'external') {
        applyExternalSource(
          blueprintId,
          conflict.path,
          diskSource,
          hashFeatherSource(diskSource),
        );
      } else {
        const source = choice === 'visual' ? current.visualSource : current.internalSource;
        const sourceHash = hashFeatherSource(source);
        const visualCheckpointHash = hashFeatherSource(current.visualSource);
        const writeResult = await platform.writeProjectText!(projectDir, conflict.path, source, {
          expectedContents: diskSource,
        });
        const afterWrite = operationStillTargets(
          projectDir,
          blueprintId,
          initial.graph.id,
          conflict.path,
        );
        if (!afterWrite) return;
        if (writeResult.kind === 'changed') {
          surfaceConditionalWriteChange(blueprintId, conflict.path, writeResult);
          return;
        }

        // Do not feed a source captured before the async write back into a newer editor state. Mark
        // what reached disk as the common ancestor, then let normal reconciliation send any edit
        // made during the write as the next internal update.
        if (
          hashFeatherSource(afterWrite.internalSource) !==
            hashFeatherSource(current.internalSource) ||
          hashFeatherSource(afterWrite.visualSource) !== visualCheckpointHash
        ) {
          mutateEditor(() => {
            useEditorStore.getState().updateBlueprintFeatherExternalLink(blueprintId, {
              path: conflict.path,
              lastSyncedHash: sourceHash,
              lastSyncedVisualHash: visualCheckpointHash,
            });
          });
          clearConflict(blueprintId);
          setStatus(blueprintId, conflict.path, 'syncing', 'Feather changed again · syncing latest edit…');
          void enqueueReconcile(blueprintId);
          return;
        }

        applyExternalSource(blueprintId, conflict.path, source, sourceHash);
        const linked = sourceContext(blueprintId);
        if (linked) {
          const health = draftStatus(linked, source);
          setStatus(
            blueprintId,
            conflict.path,
            health.kind,
            health.kind === 'synced'
              ? choice === 'visual'
                ? 'Linked file updated from the Visual graph'
                : 'Linked file updated from Feather'
              : health.message,
          );
        }
      }
      clearConflict(blueprintId);
      } catch (error) {
        setStatus(blueprintId, conflict.path, 'error', errorMessage(error));
      }
    }),
}));

let initialized = false;

/**
 * Starts one project-wide watcher and store subscriptions. Linked scripts keep synchronizing even
 * when the Scripting panel is closed; calling this more than once is harmless.
 */
export const initFeatherExternalSync = (): void => {
  if (initialized) return;
  initialized = true;

  let previousLinkSignature = '';
  useEditorStore.subscribe((state, previous) => {
    if (editorMutationDepth > 0) return;
    if (
      state.blueprints === previous.blueprints &&
      state.graphs === previous.graphs &&
      state.variables === previous.variables
    ) {
      return;
    }
    const linkSignature = state.blueprints
      .map((item) => `${item.id}:${item.featherSourcePath ?? ''}`)
      .join('|');
    if (linkSignature !== previousLinkSignature) {
      previousLinkSignature = linkSignature;
      void restartWatcher();
    }
    scheduleAllLinkedBlueprints();
  });

  useProjectStore.subscribe((state, previous) => {
    if (state.projectDir === previous.projectDir && state.hasProject === previous.hasProject) return;
    clearBlueprintStateForClosedProject();
    void restartWatcher();
    scheduleAllLinkedBlueprints(0);
  });

  previousLinkSignature = useEditorStore
    .getState()
    .blueprints.map((item) => `${item.id}:${item.featherSourcePath ?? ''}`)
    .join('|');
  void restartWatcher();
  scheduleAllLinkedBlueprints(0);
};

const clearBlueprintStateForClosedProject = (): void => {
  useFeatherExternalStore.setState({ statuses: {}, conflicts: {} });
};
