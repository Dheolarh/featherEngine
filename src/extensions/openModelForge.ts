import { MODEL_FORGE_PLUGIN_ID, usePluginStore } from '../store/pluginStore';
import { useProjectStore } from '../store/projectStore';
import { extensionRegistry } from './host';

/** Turn Model Forge on (no-op if it already is). Returns false if this build cannot activate it. */
export function ensureModelForgeEnabled(): boolean {
  const failure = usePluginStore.getState().enable(MODEL_FORGE_PLUGIN_ID);
  if (failure) {
    useProjectStore.setState({ toast: { kind: 'error', message: failure } });
    return false;
  }
  return true;
}

/** Open the Model Forge studio panel (vertex sculpt, full kit-bash canvas). */
export function openModelForgeStudio(): void {
  if (!ensureModelForgeEnabled()) return;
  const command = extensionRegistry.getCommand(`${MODEL_FORGE_PLUGIN_ID}.open`);
  if (!command) {
    useProjectStore.setState({
      toast: { kind: 'error', message: 'Model Forge did not register — try Preferences → Plugins.' },
    });
    return;
  }
  void command.run();
}
