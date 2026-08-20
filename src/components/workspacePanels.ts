import type { DockviewApi } from 'dockview-react';

export interface WorkspacePanelDefinition {
  id: string;
  title: string;
  placement?: {
    referencePanel?: string;
    direction?: 'left' | 'right' | 'above' | 'below' | 'within';
  };
}

// Shared handle to the live Dockview api so non-workspace components (e.g. the
// Hierarchy) can reveal a panel without importing Workspace and creating a cycle.
let apiSingleton: DockviewApi | null = null;

/** Where a built-in panel docks when it has to be created on demand. */
export interface DockPanelDef {
  component: string;
  title: string;
  ref?: string;
  direction?: 'left' | 'right' | 'above' | 'below' | 'within';
}

// Injected by Workspace at module load. Passing the table in (rather than importing it) keeps
// this module free of a dependency cycle back to Workspace.
let panelDefs: Record<string, DockPanelDef> = {};

export function registerPanelDefs(defs: Record<string, DockPanelDef>) {
  panelDefs = defs;
}

/** Add a built-in panel at its usual spot. No-op if it is already docked or unknown. */
export function ensureWorkspacePanel(id: string): boolean {
  const api = apiSingleton;
  if (!api) return false;
  if (api.getPanel(id)) return true;
  const def = panelDefs[id];
  if (!def) return false;
  // Position relative to its usual neighbour, but fall back to a plain add if that's gone.
  const position =
    def.ref && def.direction && api.getPanel(def.ref) ? { referencePanel: def.ref, direction: def.direction } : undefined;
  api.addPanel({ id, component: def.component, title: def.title, position });
  return true;
}

/** Layout captured before a maximize — kept separate from localStorage so Play fullscreen never overwrites the user's dock. */
let layoutBeforeMaximize: unknown | null = null;

export function setWorkspaceApi(api: DockviewApi | null) {
  apiSingleton = api;
}

export function getWorkspaceApi(): DockviewApi | null {
  return apiSingleton;
}

/**
 * Reveal a panel (by id, e.g. 'scripting'): dock it if it isn't open, then bring it to the front.
 *
 * Every caller means "show me this" — "Edit this material", double-clicking an object to script
 * it, and so on. Since the default shell only docks the viewport, the sidebar and the Inspector,
 * a focus-only version of this would silently do nothing for most panels.
 */
export function focusWorkspacePanel(id: string) {
  ensureWorkspacePanel(id);
  apiSingleton?.getPanel(id)?.api.setActive();
}

/** Open an extension panel, adding it to Dockview the first time and focusing it thereafter. */
export function openWorkspacePanel(definition: WorkspacePanelDefinition): boolean {
  const api = apiSingleton;
  if (!api) return false;
  const existing = api.getPanel(definition.id);
  if (existing) {
    existing.api.setActive();
    return true;
  }

  const referencePanel = definition.placement?.referencePanel ?? 'viewport';
  const direction = definition.placement?.direction ?? 'right';
  const position = api.getPanel(referencePanel) ? { referencePanel, direction } : undefined;
  api.addPanel({
    id: definition.id,
    component: definition.id,
    title: definition.title,
    position,
  });
  api.getPanel(definition.id)?.api.setActive();
  return true;
}

/** Remove a dynamically registered panel if it is currently open. */
export function closeWorkspacePanel(id: string): void {
  apiSingleton?.getPanel(id)?.api.close();
}

/** Collapse the dock to just the viewport (immersive Play / modeling). */
export function maximizeViewportLayout(): boolean {
  const api = apiSingleton;
  if (!api) return false;
  if (!layoutBeforeMaximize) layoutBeforeMaximize = api.toJSON();
  api.clear();
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  return true;
}

/** Restore the layout captured by maximizeViewportLayout. */
export function restoreWorkspaceLayout(): boolean {
  const api = apiSingleton;
  if (!api) return false;
  const snapshot = layoutBeforeMaximize;
  layoutBeforeMaximize = null;
  if (snapshot) {
    try {
      api.fromJSON(snapshot as Parameters<DockviewApi['fromJSON']>[0]);
      return true;
    } catch {
      // fall through — at least keep a viewport
    }
  }
  if (!api.getPanel('viewport')) {
    api.clear();
    api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport', renderer: 'always' });
  }
  return true;
}

export function isViewportLayoutMaximized(): boolean {
  return layoutBeforeMaximize !== null;
}
