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

/** Layout captured before a maximize — kept separate from localStorage so Play fullscreen never overwrites the user's dock. */
let layoutBeforeMaximize: unknown | null = null;

export function setWorkspaceApi(api: DockviewApi | null) {
  apiSingleton = api;
}

export function getWorkspaceApi(): DockviewApi | null {
  return apiSingleton;
}

/** Bring a panel (by id, e.g. 'scripting') to the front and focus its group. */
export function focusWorkspacePanel(id: string) {
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
