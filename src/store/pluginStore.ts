import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { activateExtensionPlugin, extensionRegistry } from '../extensions/host';
import { getAvailablePlugin } from '../extensions/availablePlugins';
import { readPackageFile } from '../project/packageArchive';
import { useProjectStore } from './projectStore';

/**
 * Installed store plugins. Plugins are EDITOR-level, not project-level: installing one from the
 * Asset Store enables it for this user everywhere, so the enabled set persists in localStorage
 * (unlike asset installs, which land inside one project).
 *
 * "Install" here activates a module already compiled into the build — see
 * src/extensions/availablePlugins.ts for why no downloaded code ever runs.
 */

const toast = (kind: 'success' | 'error', message: string) => {
  useProjectStore.setState({ toast: { kind, message } });
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** First-class modeling: Model Forge ships with the engine and is on for new users. */
export const MODEL_FORGE_PLUGIN_ID = 'feather.model-forge';

interface PluginState {
  /** Ids of gallery plugins the user has installed. Persisted; re-activated on every boot. */
  enabledIds: string[];
  /** Once true, we never auto-enable Model Forge again (so a user who turns it off stays off). */
  coreBootstrapped: boolean;
  /** Activate a compiled-in plugin and remember it. Returns an error message, or null on success. */
  enable: (pluginId: string) => string | null;
  /** Deactivate a plugin (its panels close, its commands vanish) and forget it. */
  disable: (pluginId: string) => boolean;
  /** The Asset Store's plugin install: download the .nfpack, verify it, enable what it names. */
  installFromUrl: (url: string) => Promise<boolean>;
  /** Re-activate every persisted plugin. Called once at boot, after startExtensionHost(). */
  restore: () => void;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      enabledIds: [],
      coreBootstrapped: false,

      enable: (pluginId) => {
        const definition = getAvailablePlugin(pluginId);
        if (!definition) {
          return 'That plugin is not part of this Feather build — it needs a newer engine release.';
        }
        if (!extensionRegistry.hasPlugin(pluginId)) {
          try {
            activateExtensionPlugin(definition);
          } catch (error) {
            return `Could not activate "${definition.name}": ${errorMessage(error)}`;
          }
        }
        set((state) => ({
          enabledIds: state.enabledIds.includes(pluginId) ? state.enabledIds : [...state.enabledIds, pluginId],
        }));
        return null;
      },

      disable: (pluginId) => {
        if (!get().enabledIds.includes(pluginId)) return false;
        extensionRegistry.deactivatePlugin(pluginId);
        set((state) => ({ enabledIds: state.enabledIds.filter((id) => id !== pluginId) }));
        return true;
      },

      installFromUrl: async (url) => {
        try {
          let response: Response;
          try {
            response = await fetch(url);
          } catch {
            throw new Error(`Could not reach ${url}. Check your connection.`);
          }
          if (!response.ok) throw new Error(`Download failed (HTTP ${response.status} ${response.statusText}).`);
          const { pkg } = readPackageFile(new Uint8Array(await response.arrayBuffer()));
          if (pkg.kind !== 'plugin') throw new Error('That package is not a plugin.');
          const pluginId = pkg.meta?.pluginId;
          if (!pluginId) throw new Error('This plugin package names no plugin module — it cannot be installed.');
          const failure = get().enable(pluginId);
          if (failure) throw new Error(failure);
          toast(
            'success',
            `Installed "${pkg.meta.name}" — its tools are live now, and every time Feather starts. Remove it from the store card.`,
          );
          return true;
        } catch (error) {
          toast('error', `Plugin install failed: ${errorMessage(error)}`);
          return false;
        }
      },

      restore: () => {
        if (!get().coreBootstrapped) {
          const already = get().enabledIds.includes(MODEL_FORGE_PLUGIN_ID);
          set({
            coreBootstrapped: true,
            enabledIds: already ? get().enabledIds : [...get().enabledIds, MODEL_FORGE_PLUGIN_ID],
          });
        }
        for (const pluginId of get().enabledIds) {
          const definition = getAvailablePlugin(pluginId);
          if (!definition) {
            // Keep the id: an older build opening a newer profile shouldn't silently uninstall.
            console.warn(`[Feather plugins] "${pluginId}" is enabled but not in this build — skipping.`);
            continue;
          }
          if (extensionRegistry.hasPlugin(pluginId)) continue;
          try {
            activateExtensionPlugin(definition);
          } catch (error) {
            console.error(`[Feather plugins] Could not restore ${pluginId}`, error);
          }
        }
      },
    }),
    {
      name: 'nodeforge.plugins',
      partialize: (state) => ({ enabledIds: state.enabledIds, coreBootstrapped: state.coreBootstrapped }),
    },
  ),
);
