import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { createFeatherPluginAPI } from './api';
import { bundledPlugins } from './bundledPlugins';
import { FeatherEventBus } from './events';
import { ExtensionRegistry } from './registry';
import {
  FEATHER_EXTENSION_API_VERSION,
  type FeatherDispose,
  type FeatherPluginDefinition,
} from './types';

export const extensionRegistry = new ExtensionRegistry();
export const extensionEventBus = new FeatherEventBus();

export interface ExtensionActivationEnvironment {
  registry: ExtensionRegistry;
  eventBus: FeatherEventBus;
}

/** Activate one trusted plugin and guarantee that every registration is removed on deactivation. */
export function activateExtensionPlugin(
  plugin: FeatherPluginDefinition,
  environment: ExtensionActivationEnvironment = {
    registry: extensionRegistry,
    eventBus: extensionEventBus,
  },
): FeatherDispose {
  if (!plugin.id.trim() || /\s/.test(plugin.id)) throw new Error('Plugin ids must be non-empty and contain no whitespace.');
  if (!plugin.name.trim() || !plugin.version.trim()) throw new Error(`Plugin ${plugin.id} requires a name and version.`);
  if (plugin.apiVersion && plugin.apiVersion !== FEATHER_EXTENSION_API_VERSION) {
    throw new Error(
      `Plugin ${plugin.id} requires Feather Extension API ${plugin.apiVersion}; this engine provides ${FEATHER_EXTENSION_API_VERSION}.`,
    );
  }
  if (environment.registry.hasPlugin(plugin.id)) throw new Error(`Extension plugin id already active: ${plugin.id}`);

  const registrations: FeatherDispose[] = [];
  const track = (dispose: FeatherDispose) => {
    registrations.push(dispose);
    return dispose;
  };
  const api = createFeatherPluginAPI(plugin.id, environment.registry, environment.eventBus, track);
  let pluginCleanup: FeatherDispose | undefined;

  const cleanup = () => {
    try {
      pluginCleanup?.();
    } catch (error) {
      console.error(`[Feather plugin: ${plugin.id}] Deactivation failed`, error);
    }
    for (const dispose of registrations.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`[Feather plugin: ${plugin.id}] Registration cleanup failed`, error);
      }
    }
  };

  try {
    pluginCleanup = plugin.activate(api) ?? undefined;
    environment.registry.registerPlugin(plugin, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    environment.registry.deactivatePlugin(plugin.id);
  };
}

let started = false;
const hostDisposers: FeatherDispose[] = [];

/** Start bundled plugins and bridge stable editor state changes into the public event bus. */
export function startExtensionHost(): void {
  if (started) return;
  started = true;

  hostDisposers.push(
    useProjectStore.subscribe((state, previous) => {
      if (state.hasProject === previous.hasProject && state.projectName === previous.projectName) return;
      extensionEventBus.emit('project:changed', { hasProject: state.hasProject, name: state.projectName });
    }),
    useEditorStore.subscribe((state, previous) => {
      if (state.selectedObjectId !== previous.selectedObjectId) {
        extensionEventBus.emit('selection:changed', { objectId: state.selectedObjectId });
      }
      if (state.isPlaying !== previous.isPlaying) {
        extensionEventBus.emit('runtime:play-changed', { isPlaying: state.isPlaying });
      }
      if (state.scenes !== previous.scenes && !state.isPlaying && !previous.isPlaying) {
        extensionEventBus.emit('scene:changed', {
          activeSceneId: state.activeSceneId,
          objectCount: selectActiveObjects(state).length,
        });
      }
      if (state.modelSpecs !== previous.modelSpecs) {
        extensionEventBus.emit('models:changed', { specCount: state.modelSpecs.length });
      }
    }),
  );

  for (const plugin of bundledPlugins) {
    try {
      activateExtensionPlugin(plugin);
    } catch (error) {
      console.error(`[Feather extensions] Could not activate ${plugin.id}`, error);
    }
  }
}

/** Primarily useful for tests and future hot-reload support. */
export function stopExtensionHost(): void {
  if (!started) return;
  extensionRegistry.deactivateAll();
  for (const dispose of hostDisposers.splice(0).reverse()) dispose();
  started = false;
}
