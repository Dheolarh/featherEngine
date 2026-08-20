import { useEffect, useMemo } from 'react';
import { AlertTriangle, Check, Download, Loader2, PackageOpen, Puzzle, RefreshCw, Search, Sparkles, Store } from 'lucide-react';
import { useMarketplaceStore } from '../store/marketplaceStore';
import { useProjectStore } from '../store/projectStore';
import { confirmAction } from '../store/confirmStore';
import { collectTags, formatSize, matchesQuery, type StoreListing } from '../marketplace/catalog';
import { packageKindLabel } from '../project/package';

/**
 * The Asset Store — browse published `.nfpack` packages and install them into the open project.
 *
 * The catalog is data, not code: it is fetched from `VITE_STORE_URL` (defaulting to the bundled
 * `public/store/` index), so the same panel works against a static folder today and a hosted
 * backend later without changes here.
 *
 * Installing runs the ordinary package-import path, so anything the store can add is something the
 * user could equally have imported from a file by hand.
 */

/** Summarise what a package will add, so the cost of installing is visible before clicking. */
function contentSummary(listing: StoreListing): string {
  const { prefabs, materials, blueprints, assets, scenes } = listing.contents;
  const parts = [
    scenes && `${scenes} scene${scenes === 1 ? '' : 's'}`,
    prefabs && `${prefabs} prefab${prefabs === 1 ? '' : 's'}`,
    materials && `${materials} material${materials === 1 ? '' : 's'}`,
    blueprints && `${blueprints} blueprint${blueprints === 1 ? '' : 's'}`,
    assets && `${assets} asset${assets === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : 'Empty package';
}

function StoreCard({ listing }: { listing: StoreListing }) {
  const install = useMarketplaceStore((state) => state.install);
  const installing = useMarketplaceStore((state) => state.installingId === listing.id);
  const installed = useMarketplaceStore((state) => state.installedIds.includes(listing.id));
  const busy = useMarketplaceStore((state) => !!state.installingId);
  const isTemplate = listing.kind === 'project';
  const isPlugin = listing.kind === 'plugin';

  // A template starts a NEW project, so anything unsaved in the current one is left behind. Modules
  // merge additively and need no warning.
  const run = async () => {
    if (isTemplate) {
      const ok = await confirmAction({
        title: `Start "${listing.title}"?`,
        message:
          'This template creates a new project and opens its world. Any unsaved changes in your current project will be left behind — save first if you need them.',
        confirmLabel: 'Create project',
      });
      if (!ok) return;
    }
    void install(listing);
  };

  return (
    <article className="store-card">
      <div className="store-card-art">
        {listing.thumbnail ? (
          <img src={listing.thumbnail} alt="" />
        ) : (
          <PackageOpen size={28} aria-hidden />
        )}
        {/* Every card states what it IS, so "installs into my project" vs "creates a new project"
            vs "not installable" is never a surprise after clicking. */}
        <span className={`store-card-badge store-card-badge--${listing.kind}`}>
          {packageKindLabel(listing.kind)}
        </span>
      </div>
      <div className="store-card-body">
        <header className="store-card-head">
          <h3>{listing.title}</h3>
          <span className="store-card-price">{listing.priceCents ? `$${(listing.priceCents / 100).toFixed(2)}` : 'Free'}</span>
        </header>
        <p className="store-card-author">
          {listing.author} · v{listing.version}
        </p>
        <p className="store-card-desc">{listing.description}</p>
        <ul className="store-card-tags">
          {listing.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
        <footer className="store-card-foot">
          <span className="store-card-meta">
            {contentSummary(listing)} · {formatSize(listing.sizeBytes)}
          </span>
          <button
            className="full-button store-install-button"
            onClick={() => void run()}
            // Plugins have no runtime loader yet, so the button is disabled rather than failing
            // after a download.
            disabled={busy || isPlugin}
            // Re-installing is legitimate (it adds a second, independently editable copy), so the
            // button stays live after a successful install — only the label changes.
            title={
              isPlugin
                ? 'Plugins are compiled into the editor build — not installable yet'
                : isTemplate
                  ? `Create a new project from ${listing.title}`
                  : installed
                    ? 'Install another copy into this project'
                    : `Install ${listing.title}`
            }
          >
            {isPlugin ? (
              <>
                <Puzzle size={14} aria-hidden /> Not installable yet
              </>
            ) : installing ? (
              <>
                <Loader2 size={14} className="spin" aria-hidden />
                {isTemplate ? ' Creating…' : ' Installing…'}
              </>
            ) : installed && !isTemplate ? (
              <>
                <Check size={14} aria-hidden /> Added
              </>
            ) : isTemplate ? (
              <>
                <Sparkles size={14} aria-hidden /> Use template
              </>
            ) : (
              <>
                <Download size={14} aria-hidden /> Install
              </>
            )}
          </button>
        </footer>
      </div>
    </article>
  );
}

export function AssetStorePanel() {
  const status = useMarketplaceStore((state) => state.status);
  const error = useMarketplaceStore((state) => state.error);
  const query = useMarketplaceStore((state) => state.query);
  const tag = useMarketplaceStore((state) => state.tag);
  const setQuery = useMarketplaceStore((state) => state.setQuery);
  const setTag = useMarketplaceStore((state) => state.setTag);
  const load = useMarketplaceStore((state) => state.load);
  const packages = useMarketplaceStore((state) => state.packages);
  const hasProject = useProjectStore((state) => state.hasProject);

  // Derived here, not via a selector: a selector returning a fresh array on every call breaks
  // zustand's snapshot caching and re-renders (or loops) on unrelated store writes.
  const visible = useMemo(
    () => packages.filter((listing) => matchesQuery(listing, query) && (!tag || listing.tags.includes(tag))),
    [packages, query, tag],
  );
  const tags = useMemo(() => collectTags(packages), [packages]);
  const total = packages.length;

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel store-panel">
      <div className="panel-header panel-header-actions-only">
        <button
          className="icon-button compact"
          title="Refresh catalog"
          onClick={() => void load(true)}
          disabled={status === 'loading'}
        >
          <RefreshCw size={14} className={status === 'loading' ? 'spin' : undefined} aria-hidden />
        </button>
      </div>

      <div className="store-body">
        {!hasProject && (
          <p className="store-notice">
            <AlertTriangle size={14} aria-hidden />
            Open or create a project to install packages.
          </p>
        )}

        <div className="store-filters">
          <label className="search-field">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search the store…"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search the asset store"
            />
          </label>
          {tags.length > 0 && (
            <div className="store-tags" role="group" aria-label="Filter by tag">
              <button className={tag ? '' : 'active'} onClick={() => setTag(null)}>
                All
              </button>
              {tags.map((entry) => (
                <button
                  key={entry}
                  className={tag === entry ? 'active' : ''}
                  onClick={() => setTag(tag === entry ? null : entry)}
                >
                  {entry}
                </button>
              ))}
            </div>
          )}
        </div>

        {status === 'loading' && <p className="store-status">Loading catalog…</p>}

        {status === 'error' && (
          <div className="empty-state wide">
            <AlertTriangle size={18} aria-hidden />
            <span>{error}</span>
            <button className="full-button" onClick={() => void load(true)}>
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && visible.length === 0 && (
          <div className="empty-state wide">
            <Store size={18} aria-hidden />
            <span>
              {total === 0 ? 'The store catalog is empty.' : 'No packages match your search.'}
            </span>
            {total > 0 && (
              <button
                className="full-button"
                onClick={() => {
                  setQuery('');
                  setTag(null);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {visible.length > 0 && (
          <div className="store-grid">
            {visible.map((listing) => (
              <StoreCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
