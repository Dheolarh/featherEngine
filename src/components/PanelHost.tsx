import { useEffect } from 'react';
import { HierarchyPanel } from './HierarchyPanel';
import { InspectorPanel } from './InspectorPanel';
import { AssetBrowser } from './AssetBrowser';
import { VisualScriptingPanel } from './VisualScriptingPanel';
import { MaterialEditorPanel } from './MaterialEditorPanel';
import { ParticleSystemEditorPanel } from './ParticleSystemEditorPanel';
import { AnimatorEditorPanel } from './AnimatorEditorPanel';
import { UIEditorPanel } from './UIEditorPanel';
import { TerrainEditorPanel } from './TerrainEditorPanel';
import { TreeBuilderPanel } from './TreeBuilderPanel';
import { SceneSettingsPanel } from './SceneSettingsPanel';
import { CinematicPanel } from './CinematicPanel';
import { broadcastPanelClosed, initStoreSync } from '../sync/storeSync';
import { useExtensionSnapshot } from '../extensions/react';
import { ExtensionPanelBoundary } from '../extensions/ExtensionPanelBoundary';

const PANELS: Record<string, () => JSX.Element> = {
  hierarchy: HierarchyPanel,
  inspector: InspectorPanel,
  project: AssetBrowser,
  scripting: VisualScriptingPanel,
  materials: MaterialEditorPanel,
  terrain: TerrainEditorPanel,
  trees: TreeBuilderPanel,
  particles: ParticleSystemEditorPanel,
  animator: AnimatorEditorPanel,
  ui: UIEditorPanel,
  scene: SceneSettingsPanel,
  cinematic: CinematicPanel,
};

/**
 * Root of a popped-out panel window (loaded via ?panel=<kind>). Renders just the one
 * panel full-bleed, pulls the current project over BroadcastChannel, and notifies the
 * main window when it closes so the dock can restore the panel.
 */
export function PanelHost({ kind }: { kind: string }) {
  const extensionPanel = useExtensionSnapshot().panels.find((panel) => panel.id === kind);
  useEffect(() => {
    initStoreSync({ requestSnapshot: true });
    const onUnload = () => broadcastPanelClosed(kind);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [kind]);

  const Panel = PANELS[kind];
  if (!Panel && !extensionPanel) {
    return <div className="panel-window panel-window-empty">Unknown panel: {kind}</div>;
  }

  return (
    <div className="panel-window">
      {Panel ? (
        <Panel />
      ) : extensionPanel ? (
        <ExtensionPanelBoundary
          pluginId={extensionPanel.pluginId}
          panelId={extensionPanel.id}
          title={extensionPanel.title}
          render={extensionPanel.render}
        />
      ) : null}
    </div>
  );
}
