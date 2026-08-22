import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Eye,
  FolderOpen,
  Gamepad2,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { getPlatform, isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { clearRecovery, readRecovery } from '../store/autosave';
import { useMarketplaceStore } from '../store/marketplaceStore';
import { formatSize, type StoreListing } from '../marketplace/catalog';

/** The starter world shown first. Everything else keeps the catalog's order. */
const FEATURED_SLUG = 'template-spline-studio';

/** Human-friendly "time ago" for the recovery banner. */
function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(ms).toLocaleString();
}

export function Launcher() {
  const [name, setName] = useState('My Game');
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const openRecent = useProjectStore((state) => state.openRecent);
  const removeRecent = useProjectStore((state) => state.removeRecent);
  const useDemo = useProjectStore((state) => state.useDemo);
  const newProjectFromPackageUrl = useProjectStore((state) => state.newProjectFromPackageUrl);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const busy = useProjectStore((state) => state.busy);
  const error = useProjectStore((state) => state.error);
  const restoreRecovery = useProjectStore((state) => state.restoreRecovery);
  // Unsaved work from a crashed/closed session, if any (read once on mount).
  const [recovery, setRecovery] = useState(() => readRecovery());

  // Starter worlds come from the asset store, so the Launcher and the Asset Store panel can't drift
  // apart — there is one catalog, and adding a template to it is enough to surface it in both.
  const loadCatalog = useMarketplaceStore((state) => state.load);
  const catalogStatus = useMarketplaceStore((state) => state.status);
  const catalogError = useMarketplaceStore((state) => state.error);
  const packages = useMarketplaceStore((state) => state.packages);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Derived with useMemo, not in the selector: a selector returning a new array each call breaks
  // zustand's snapshot caching.
  const templates = useMemo(() => {
    const worlds = packages.filter((entry) => entry.kind === 'project');
    return worlds.sort((a, b) => Number(b.slug === FEATURED_SLUG) - Number(a.slug === FEATURED_SLUG));
  }, [packages]);
  const createBlankProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || busy) return;
    await newProject(projectName);
  };

  // Installing a template creates the project itself (and validates the package before doing so),
  // so unlike the blank path this doesn't call newProject first.
  const createTemplateProject = async (listing: StoreListing) => {
    await newProjectFromPackageUrl(listing.downloadUrl, name.trim());
  };

  const handleReveal = async (event: React.MouseEvent, dir: string) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const platform = await getPlatform();
      await platform.revealFile?.(dir);
    } catch {
      // Non-fatal — reveal is a convenience.
    }
  };

  const handleRemove = (event: React.MouseEvent, dir: string) => {
    event.preventDefault();
    event.stopPropagation();
    removeRecent(dir);
  };

  return (
    <div className="launcher">
      <div className="launcher-ambient" aria-hidden>
        <span />
        <span />
      </div>

      <main className="launcher-shell" aria-busy={busy}>
        <header className="launcher-header">
          <div className="launcher-brand">
            <span className="launcher-brand-mark">
              <Gamepad2 size={20} aria-hidden />
            </span>
            <div>
              <strong>Feather</strong>
              <span>Engine</span>
            </div>
          </div>
          <div className="launcher-platform">
            <span aria-hidden />
            {isDesktop ? 'Desktop workspace' : 'Web preview'}
          </div>
        </header>

        <section className="launcher-intro" aria-labelledby="launcher-title">
          <div>
            <span className="eyebrow">A lighter way to build games</span>
            <h1 id="launcher-title">Bring your next world to life.</h1>
            <p>Create, iterate, and play in one focused workspace. Start with a blank canvas or a ready-to-run world.</p>
          </div>
          <div className="launcher-intro-meta" aria-label="Available starter projects">
            <strong>{templates.length || '—'}</strong>
            <span>starter worlds</span>
          </div>
        </section>

        {recovery && (
          <div className="launcher-recovery" role="status">
            <RotateCcw size={16} aria-hidden />
            <div className="launcher-recovery-text">
              <strong>Unsaved work is available</strong>
              <small>
                “{recovery.name}” · {formatAgo(recovery.savedAt)}
              </small>
            </div>
            <button
              type="button"
              className="launcher-recovery-restore"
              disabled={busy}
              onClick={() => restoreRecovery(recovery)}
            >
              Restore
            </button>
            <button
              type="button"
              className="launcher-recovery-dismiss"
              title="Discard recovered work"
              aria-label="Discard recovered work"
              onClick={() => {
                clearRecovery();
                setRecovery(null);
              }}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        )}

        <div className="launcher-content">
          <aside className="launcher-create-panel">
            <div className="launcher-section-heading">
              <span className="launcher-step" aria-hidden>
                01
              </span>
              <div>
                <h2>Name your project</h2>
                <p>This name is used for blank and template projects.</p>
              </div>
            </div>

            <form className="launcher-new" onSubmit={(event) => void createBlankProject(event)}>
              <label className="node-field" htmlFor="launcher-project-name">
                <span>Project name</span>
              </label>
              <input
                id="launcher-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My Game"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="launcher-primary" disabled={busy || !name.trim()}>
                <Plus size={16} aria-hidden />
                <span>{busy ? 'Creating…' : 'Create blank project'}</span>
                {!busy && <ArrowRight size={15} aria-hidden />}
              </button>
            </form>

            <div className="launcher-divider">
              <span>or continue</span>
            </div>

            <div className="launcher-actions">
              <button type="button" disabled={busy} onClick={() => void openProject()}>
                <FolderOpen size={15} aria-hidden />
                <span>Open project{isDesktop ? '…' : ' file'}</span>
              </button>
              <button type="button" disabled={busy} onClick={useDemo}>
                <Sparkles size={15} aria-hidden />
                <span>Explore demo</span>
              </button>
            </div>

            {isDesktop && recentProjects.length > 0 && (
              <section className="launcher-recent" aria-labelledby="recent-projects-title">
                <span id="recent-projects-title" className="eyebrow">
                  Recent projects
                </span>
                <div className="launcher-recent-list">
                  {recentProjects.map((project) => (
                    <div key={project.dir} className="launcher-recent-item">
                      <button
                        type="button"
                        className="launcher-recent-main"
                        disabled={busy}
                        onClick={() => void openRecent(project.dir)}
                        title={project.dir}
                      >
                        <strong>{project.name}</strong>
                        <small>{project.dir}</small>
                      </button>
                      <div className="launcher-recent-actions">
                        <button
                          type="button"
                          className="launcher-recent-action"
                          title="Reveal in Finder"
                          aria-label={`Reveal ${project.name} in Finder`}
                          disabled={busy}
                          onClick={(event) => void handleReveal(event, project.dir)}
                        >
                          <Eye size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="launcher-recent-action"
                          title="Remove from recent"
                          aria-label={`Remove ${project.name} from recent projects`}
                          disabled={busy}
                          onClick={(event) => handleRemove(event, project.dir)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {error && (
              <div className="ai-error" role="alert">
                <AlertTriangle size={14} aria-hidden /> {error}
              </div>
            )}

            {!isDesktop && (
              <p className="launcher-note">
                Web projects save as a downloadable <code>.nforge</code> file. Use the desktop app for project folders
                and assets stored directly on disk.
              </p>
            )}
          </aside>

          <section className="launcher-templates" aria-labelledby="starter-worlds-title">
            <div className="launcher-section-heading launcher-section-heading--templates">
              <span className="launcher-step" aria-hidden>
                02
              </span>
              <div>
                <h2 id="starter-worlds-title">Choose a starting point</h2>
                <p>Every starter world is ready to play and fully editable.</p>
              </div>
              <span className="launcher-template-count">
                {catalogStatus === 'ready' ? `${templates.length} worlds` : '…'}
              </span>
            </div>

            {catalogStatus === 'loading' && <p className="launcher-template-hint">Loading starter worlds…</p>}
            {catalogStatus === 'error' && (
              <p className="launcher-template-hint">
                Could not load starter worlds ({catalogError}). You can still create a blank project.
              </p>
            )}

            <div className="template-grid">
              {templates.map((listing, index) => (
                <button
                  type="button"
                  key={listing.id}
                  className={`template-card ${index === 0 ? 'template-card--featured' : ''}`}
                  disabled={busy || !name.trim()}
                  aria-label={`Create ${name.trim() || 'project'} from the ${listing.title} template`}
                  onClick={() => void createTemplateProject(listing)}
                >
                  <span className="template-card-icon">
                    {listing.thumbnail ? (
                      <img src={listing.thumbnail} alt="" width={20} height={20} />
                    ) : (
                      <Boxes size={20} aria-hidden />
                    )}
                  </span>
                  <span className="template-card-copy">
                    {index === 0 && <span className="template-card-kicker">Recommended</span>}
                    <strong>{listing.title}</strong>
                    <small>{listing.description}</small>
                    <span className="template-card-meta">{formatSize(listing.sizeBytes)}</span>
                  </span>
                  <ArrowRight className="template-card-arrow" size={16} aria-hidden />
                </button>
              ))}
            </div>
            {!name.trim() && <p className="launcher-template-hint">Enter a project name to choose a starter world.</p>}
          </section>
        </div>

        <footer className="launcher-footer">
          <span>Local-first workspace</span>
          <span aria-hidden>•</span>
          <span>No account required</span>
          <span aria-hidden>•</span>
          <span>Your work stays yours</span>
        </footer>
      </main>
    </div>
  );
}
