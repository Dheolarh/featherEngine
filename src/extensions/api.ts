import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { closeWorkspacePanel, openWorkspacePanel } from '../components/workspacePanels';
import type { SceneObject, SceneObjectKind, TransformComponent, Vector3Tuple } from '../types';
import { FeatherEventBus } from './events';
import type { ExtensionRegistry } from './registry';
import {
  FEATHER_EXTENSION_API_VERSION,
  type FeatherDispose,
  type FeatherObjectCreateOptions,
  type FeatherPluginAPI,
} from './types';

type TrackDisposer = (disposer: FeatherDispose) => FeatherDispose;

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const validVector = (value: Vector3Tuple): boolean =>
  value.length === 3 && value.every((part) => Number.isFinite(part));

const OBJECT_KINDS: ReadonlySet<SceneObjectKind> = new Set([
  'empty',
  'cube',
  'sphere',
  'capsule',
  'plane',
  'terrain',
  'light',
  'camera',
]);

function requireOwnedId(pluginId: string, id: string, kind: string): void {
  if (!id.startsWith(`${pluginId}.`)) {
    throw new Error(`${kind} id "${id}" must start with the plugin namespace "${pluginId}."`);
  }
}

function requireEditableProject(): void {
  const project = useProjectStore.getState();
  if (!project.hasProject) throw new Error('No Feather project is open.');
  if (useEditorStore.getState().isPlaying) throw new Error('Project edits are disabled while Play mode is running.');
}

function findObject(id: string): SceneObject | undefined {
  return selectActiveObjects(useEditorStore.getState()).find((object) => object.id === id);
}

/** Build the capability object handed to one trusted in-process plugin. */
export function createFeatherPluginAPI(
  pluginId: string,
  registry: ExtensionRegistry,
  eventBus: FeatherEventBus,
  track: TrackDisposer,
): FeatherPluginAPI {
  const prefix = `[Feather plugin: ${pluginId}]`;

  const objects: FeatherPluginAPI['objects'] = {
    list: () => clone(selectActiveObjects(useEditorStore.getState())),
    get: (id) => {
      const object = findObject(id);
      return object ? clone(object) : undefined;
    },
    create: (options: FeatherObjectCreateOptions) => {
      requireEditableProject();
      if (!options || !OBJECT_KINDS.has(options.kind)) throw new Error(`Unsupported scene object kind: ${String(options?.kind)}`);
      if (options.name !== undefined && !options.name.trim()) throw new Error('Object names cannot be empty.');
      if (options.position && !validVector(options.position)) throw new Error('Object position must contain three finite numbers.');
      if (options.rotation && !validVector(options.rotation)) throw new Error('Object rotation must contain three finite numbers.');
      if (options.scale && !validVector(options.scale)) throw new Error('Object scale must contain three finite numbers.');
      const store = useEditorStore.getState();
      const id = store.createObjectWithProps(options.kind, {
        name: options.name?.trim(),
        position: options.position,
        color: options.color,
        parentId: options.parentId,
      });
      if (options.rotation) useEditorStore.getState().updateTransform(id, 'rotation', options.rotation);
      if (options.scale) useEditorStore.getState().updateTransform(id, 'scale', options.scale);
      return id;
    },
    rename: (id, name) => {
      requireEditableProject();
      if (!findObject(id)) return false;
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Object names cannot be empty.');
      useEditorStore.getState().renameObject(id, trimmed);
      return true;
    },
    remove: (id) => {
      requireEditableProject();
      if (!findObject(id)) return false;
      useEditorStore.getState().deleteObject(id);
      return true;
    },
    select: (id) => {
      if (!findObject(id)) return false;
      useEditorStore.getState().selectObject(id);
      return true;
    },
    setTransform: (id: string, patch: Partial<TransformComponent>) => {
      requireEditableProject();
      if (!findObject(id)) return false;
      for (const field of ['position', 'rotation', 'scale'] as const) {
        const value = patch[field];
        if (!value) continue;
        if (!validVector(value)) throw new Error(`Object ${field} must contain three finite numbers.`);
        useEditorStore.getState().updateTransform(id, field, value);
      }
      return true;
    },
  };

  const commands: FeatherPluginAPI['commands'] = Object.freeze({
    register: (definition) => {
      requireOwnedId(pluginId, definition.id, 'Command');
      return track(registry.registerCommand(pluginId, definition));
    },
  });
  const panels: FeatherPluginAPI['panels'] = Object.freeze({
    register: (definition) => {
      requireOwnedId(pluginId, definition.id, 'Panel');
      const unregister = registry.registerPanel(pluginId, definition);
      return track(() => {
        closeWorkspacePanel(definition.id);
        unregister();
      });
    },
    open: (id) => {
      const panel = registry.getPanel(id);
      return panel ? openWorkspacePanel(panel) : false;
    },
  });
  const events: FeatherPluginAPI['events'] = Object.freeze({
    on: (event, handler) => track(eventBus.on(event, handler)),
  });
  const project: FeatherPluginAPI['project'] = Object.freeze({
    read: () => {
      const projectState = useProjectStore.getState();
      if (!projectState.hasProject) throw new Error('No Feather project is open.');
      return clone({
        ...useEditorStore.getState().exportProject(),
        name: projectState.projectName,
      });
    },
    transaction: <T,>(label: string, action: () => T): T => {
      requireEditableProject();
      if (!label.trim()) throw new Error('Project transaction labels cannot be empty.');
      try {
        const result = eventBus.batch(action);
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('Project transactions must be synchronous.');
        }
        return result;
      } catch (error) {
        console.error(prefix, `Transaction "${label}" failed: ${errorMessage(error)}`);
        throw error;
      }
    },
  });
  const ui: FeatherPluginAPI['ui'] = Object.freeze({
    notify: (message, kind = 'success') => {
      useProjectStore.setState({ toast: { kind, message } });
    },
  });
  const log: FeatherPluginAPI['log'] = Object.freeze({
    info: (message, ...details) => console.info(prefix, message, ...details),
    warn: (message, ...details) => console.warn(prefix, message, ...details),
    error: (message, ...details) => console.error(prefix, message, ...details),
  });

  return Object.freeze({
    apiVersion: FEATHER_EXTENSION_API_VERSION,
    pluginId,
    commands,
    panels,
    events,
    project,
    objects: Object.freeze(objects),
    ui,
    log,
  });
}
