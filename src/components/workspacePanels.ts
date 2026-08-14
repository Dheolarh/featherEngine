import type { DockviewApi } from 'dockview-react';

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
