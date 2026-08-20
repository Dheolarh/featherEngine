import { create } from 'zustand';
import type { PackageMetaInput } from './projectStore';

/**
 * Promise-based "Package details" dialog, same shape as confirmStore.
 *
 * Every export path (prefab, folder, whole project) funnels through this so a published package
 * always carries a name, description, author and tags. Before it existed the menu items passed no
 * metadata at all, which meant store cards with an empty description and no cover art.
 */

export interface PackageDetailsRequest {
  /** Dialog heading, e.g. "Share as template". */
  title: string;
  /** What is being packaged, shown under the heading — "3 prefabs, 2 materials" etc. */
  summary?: string;
  /** Pre-filled values; the name usually defaults to the prefab/folder/project name. */
  defaults: PackageMetaInput;
  /** Whether to offer "Use viewport" as a cover source (pointless when no 3D view is mounted). */
  allowViewportCover?: boolean;
}

interface PackageDetailsState {
  request: (PackageDetailsRequest & { id: number }) | null;
  resolver: ((value: PackageMetaInput | null) => void) | null;
  ask: (request: PackageDetailsRequest) => Promise<PackageMetaInput | null>;
  respond: (value: PackageMetaInput | null) => void;
}

let seq = 0;

export const usePackageDetailsStore = create<PackageDetailsState>((set, get) => ({
  request: null,
  resolver: null,
  ask: (request) =>
    new Promise<PackageMetaInput | null>((resolve) => {
      // A dialog already open resolves as cancelled before being replaced.
      get().resolver?.(null);
      set({ request: { ...request, id: ++seq }, resolver: resolve });
    }),
  respond: (value) => {
    get().resolver?.(value);
    set({ request: null, resolver: null });
  },
}));

/** `await askPackageDetails({...})` resolves with the metadata, or null if the user cancelled. */
export const askPackageDetails = (request: PackageDetailsRequest) => usePackageDetailsStore.getState().ask(request);
