import { create } from 'zustand';
import {
  STORE_BASE_URL,
  collectTags,
  fetchCatalog,
  matchesQuery,
  type StoreListing,
} from '../marketplace/catalog';
import { useProjectStore } from './projectStore';
import { usePluginStore } from './pluginStore';

/**
 * State behind the Asset Store panel: the catalog index, the browse filters, and the install call.
 *
 * Installing delegates to `projectStore.importPackageFromUrl`, which is the same code path as
 * opening a `.nfpack` by hand — the store is only a nicer way to find the URL.
 */

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The catalog fetch currently running, so concurrent load() callers all await the same one. */
let inFlight: Promise<void> | null = null;

interface MarketplaceState {
  status: CatalogStatus;
  error: string | null;
  packages: StoreListing[];
  updatedAt: string | null;
  query: string;
  /** Active tag filter, or null for "All". */
  tag: string | null;
  /** Id of the package currently downloading, so its card can show a spinner. */
  installingId: string | null;
  /**
   * Packages installed during this session. Deliberately NOT persisted: a package lands in one
   * project, so remembering it globally would claim an install the open project doesn't have.
   */
  installedIds: string[];
  /** Fetch the catalog. No-op when it is already loaded unless `force` is set. */
  load: (force?: boolean) => Promise<void>;
  setQuery: (query: string) => void;
  setTag: (tag: string | null) => void;
  install: (listing: StoreListing) => Promise<void>;
  /** Listings passing the current search + tag filter, in catalog order. */
  visiblePackages: () => StoreListing[];
  availableTags: () => string[];
}

export const useMarketplaceStore = create<MarketplaceState>()((set, get) => ({
  status: 'idle',
  error: null,
  packages: [],
  updatedAt: null,
  query: '',
  tag: null,
  installingId: null,
  installedIds: [],

  load: async (force = false) => {
    const { status } = get();
    // Join the fetch already in flight rather than returning early: callers await load() to mean
    // "the catalog is now readable", and two mounts racing must not leave the second with none.
    if (status === 'loading' && inFlight) return inFlight;
    if (status === 'ready' && !force) return;
    set({ status: 'loading', error: null });
    inFlight = (async () => {
      try {
        const catalog = await fetchCatalog(STORE_BASE_URL);
        set({
          status: 'ready',
          packages: catalog.packages,
          updatedAt: catalog.updatedAt ?? null,
          error: null,
        });
      } catch (error) {
        set({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          packages: [],
        });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  setQuery: (query) => set({ query }),
  setTag: (tag) => set({ tag }),

  install: async (listing) => {
    if (get().installingId) return;
    const project = useProjectStore.getState();
    // A project package is a whole world (its own new project) and a plugin is editor-level, so
    // only an asset merge requires — or uses — an already-open project.
    if (listing.kind === 'asset' && !project.hasProject) {
      useProjectStore.setState({
        toast: { kind: 'error', message: 'Open or create a project before installing from the store.' },
      });
      return;
    }
    set({ installingId: listing.id });
    try {
      const installed =
        listing.kind === 'plugin'
          ? await usePluginStore.getState().installFromUrl(listing.downloadUrl)
          : listing.kind === 'project'
            ? await project.newProjectFromPackageUrl(listing.downloadUrl, listing.title)
            : await project.importPackageFromUrl(listing.downloadUrl);
      if (installed) {
        set((state) => ({
          installedIds: state.installedIds.includes(listing.id)
            ? state.installedIds
            : [...state.installedIds, listing.id],
        }));
      }
    } finally {
      set({ installingId: null });
    }
  },

  visiblePackages: () => {
    const { packages, query, tag } = get();
    return packages.filter(
      (listing) => matchesQuery(listing, query) && (!tag || listing.tags.includes(tag)),
    );
  },

  availableTags: () => collectTags(get().packages),
}));
