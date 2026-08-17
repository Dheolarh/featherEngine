import { useState } from 'react';
import { Boxes } from 'lucide-react';
import { defineFeatherPlugin, type FeatherPluginAPI } from './types';

const PLUGIN_ID = 'feather.example.scene-tools';
const PANEL_ID = `${PLUGIN_ID}.panel`;

function createPlatform(api: FeatherPluginAPI): string {
  return api.project.transaction('Create example platform', () =>
    api.objects.create({
      kind: 'cube',
      name: 'Plugin Platform',
      position: [0, 0.25, 0],
      scale: [6, 0.5, 6],
      color: '#6ea8ff',
    }),
  );
}

function SceneToolsPanel({ api }: { api: FeatherPluginAPI }) {
  const [lastCreated, setLastCreated] = useState('Nothing created yet.');

  const addPlatform = () => {
    try {
      const id = createPlatform(api);
      setLastCreated(`Created Plugin Platform (${id}).`);
      api.ui.notify('Example plugin created a platform.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastCreated(message);
      api.ui.notify(message, 'error');
    }
  };

  const addMarker = () => {
    try {
      const id = api.project.transaction('Create example marker', () =>
        api.objects.create({
          kind: 'sphere',
          name: 'Plugin Marker',
          position: [0, 1.5, 0],
          scale: [0.5, 0.5, 0.5],
          color: '#f7b955',
        }),
      );
      setLastCreated(`Created Plugin Marker (${id}).`);
    } catch (error) {
      setLastCreated(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <aside className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Plugin SDK example</span>
          <h2>Scene Tools</h2>
        </div>
        <Boxes size={18} aria-hidden />
      </div>
      <section className="inspector-section">
        <h3>Procedural content</h3>
        <p className="field-hint">
          This panel and its actions are registered by a plugin instead of being hard-coded into the editor.
        </p>
        <button className="full-button primary" onClick={addPlatform}>Create platform</button>
        <button className="full-button" onClick={addMarker}>Create marker</button>
        <p className="field-hint">{lastCreated}</p>
      </section>
    </aside>
  );
}

export const exampleSceneToolsPlugin = defineFeatherPlugin({
  id: PLUGIN_ID,
  name: 'Scene Tools SDK Example',
  version: '1.0.0',
  apiVersion: '0.1.0',
  activate(api) {
    api.panels.register({
      id: PANEL_ID,
      title: 'Scene Tools (Plugin)',
      placement: { referencePanel: 'inspector', direction: 'within' },
      render: () => <SceneToolsPanel api={api} />,
    });

    api.commands.register({
      id: `${PLUGIN_ID}.open-panel`,
      title: 'Open Scene Tools example plugin',
      group: 'Extensions',
      keywords: 'plugin sdk panel example',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.commands.register({
      id: `${PLUGIN_ID}.create-platform`,
      title: 'Create platform (example plugin)',
      group: 'Extensions',
      keywords: 'plugin sdk cube ground',
      run: () => {
        const id = createPlatform(api);
        api.objects.select(id);
        api.ui.notify('Example plugin created a platform.');
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});
