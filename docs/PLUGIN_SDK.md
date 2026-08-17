# Feather Plugin SDK

Feather has two deliberately separate extension paths:

- **Assets and `.nfpack` packages** are portable project content: models, textures, audio, prefabs,
  materials, Blueprints, and their dependencies.
- **Plugins** are trusted TypeScript modules that add editor behavior: commands, dockable panels, and
  logic built on the public Feather API.

The Plugin SDK is additive. It does not replace Feather's stores, project format, asset importer, or
runtime. The current API version is `0.1.0`.

> [!IMPORTANT]
> This first version is an in-process developer SDK. Plugins are compiled into Feather and have the
> same trust level as engine code. There is not yet a marketplace installer, package loader, signature
> check, permissions dialog, or code sandbox. Those can be added later without replacing the registry
> and lifecycle implemented here.

## What works now

| Capability | API |
| --- | --- |
| Register searchable commands | `api.commands.register(...)` |
| Register and open dockable editor panels | `api.panels.register(...)`, `api.panels.open(...)` |
| Read a detached project snapshot | `api.project.read()` |
| Group synchronous project edits | `api.project.transaction(...)` |
| List, create, rename, remove, select, and transform scene objects | `api.objects.*` |
| Observe stable project, scene, selection, and Play-mode events | `api.events.on(...)` |
| Show editor notifications and namespaced logs | `api.ui.notify(...)`, `api.log.*` |
| Clean up every registration on unload or failed activation | plugin lifecycle host |

The editor discovers registered commands in the command palette and registered panels under
**View → Extensions**. Saved Dockview layouts can resolve plugin panels because bundled plugins are
activated before React mounts.

## Minimal plugin

Create a TypeScript or TSX module under `src/extensions/`:

```tsx
import { defineFeatherPlugin } from './index';

const pluginId = 'com.example.world-tools';
const panelId = `${pluginId}.panel`;

export const worldToolsPlugin = defineFeatherPlugin({
  id: pluginId,
  name: 'World Tools',
  version: '1.0.0',
  apiVersion: '0.1.0',
  activate(api) {
    api.panels.register({
      id: panelId,
      title: 'World Tools',
      placement: { referencePanel: 'inspector', direction: 'within' },
      render: () => <button onClick={() => api.ui.notify('Hello from a plugin')}>Run tool</button>,
    });

    api.commands.register({
      id: `${pluginId}.open`,
      title: 'Open World Tools',
      group: 'Extensions',
      run: () => api.panels.open(panelId),
    });
  },
});
```

All command and panel ids must begin with `<plugin id>.`. The registry rejects collisions instead of
silently replacing another plugin's contribution.

Add the definition to `bundledPlugins` in
[`src/extensions/bundledPlugins.ts`](../src/extensions/bundledPlugins.ts), then rebuild Feather. The
included `Scene Tools SDK Example` plugin is a complete working reference: it contributes two
commands, a panel, and project mutations.

## Safe project edits

Plugins receive detached snapshots rather than the live Zustand stores. Mutation is explicit:

```ts
const platformId = api.project.transaction('Create platform', () =>
  api.objects.create({
    kind: 'cube',
    name: 'Platform',
    position: [0, 0.25, 0],
    scale: [6, 0.5, 6],
  }),
);

api.objects.select(platformId);
```

Transactions must be synchronous. They coalesce public events and work with Feather's existing undo
capture; they are not rollback-capable database transactions. Project mutations are rejected while
Play mode is running.

## Lifecycle

`activate` may return a cleanup function. Feather also tracks every command, panel, and event
subscription registered through that plugin's API. On deactivation, on activation failure, or during
future hot reload, the host runs plugin cleanup and removes all tracked contributions. Open plugin
panels are closed before their render functions are unregistered. Event handlers and panel rendering
are error-isolated, so one faulty plugin does not take down unrelated plugins or the editor workspace.

## Next layers

The registry is the stable seam for future work. The next useful increments are:

1. Expand capability services for assets, scenes, Blueprints, materials, importers, and build hooks.
2. Add a manifest and local-folder loader that resolves compatibility before activation.
3. Add development hot reload and an installed-plugin manager.
4. Add permissions, signing, process isolation, and a marketplace only after the API is mature.

New engine access should be added as a typed capability on `FeatherPluginAPI`, rather than exposing
the raw store. That keeps plugin code stable while Feather's internals continue to evolve.
