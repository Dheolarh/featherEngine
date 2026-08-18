import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  Car,
  Clapperboard,
  Crosshair,
  Eye,
  FolderOpen,
  Gamepad2,
  Gauge,
  Mountain,
  PersonStanding,
  Plus,
  RotateCcw,
  Sparkles,
  Sprout,
  X,
} from 'lucide-react';
import { getPlatform, isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { clearRecovery, readRecovery } from '../store/autosave';
import { createThirdPersonTemplate } from '../project/thirdPersonTemplate';
import { createFirstPersonTemplate } from '../project/firstPersonTemplate';
import { createFilmModeTemplate } from '../project/filmModeTemplate';
import { createDrivingTemplate } from '../project/drivingTemplate';
import { createSimRacingTemplate } from '../project/simRacingTemplate';
import { createMeadowTemplate } from '../project/meadowTemplate';
import { createCubeRealmTemplate } from '../project/cubeRealmTemplate';

type TemplateChoice = {
  icon: LucideIcon;
  title: string;
  blurb: string;
  featured?: boolean;
  build: () => Promise<unknown> | unknown;
};

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

const TEMPLATES: TemplateChoice[] = [
  {
    icon: PersonStanding,
    title: 'Third-person',
    blurb: 'Character, follow camera, and a guided world ready to explore.',
    featured: true,
    build: createThirdPersonTemplate,
  },
  { icon: Sprout, title: 'Meadows', blurb: 'Walk through interactive BOTW-style grass', build: createMeadowTemplate },
  { icon: Mountain, title: 'Cube Realm', blurb: 'Action slice: combo, day cycle, shrine', build: createCubeRealmTemplate },
  { icon: Crosshair, title: 'First-person shooter', blurb: 'Neon FPS with guns & grenades', build: createFirstPersonTemplate },
  { icon: Car, title: 'Driving', blurb: 'NFS-lite neon cruise & garage', build: createDrivingTemplate },
  { icon: Gauge, title: 'Sim racing', blurb: 'Realistic car physics & laps', build: createSimRacingTemplate },
  { icon: Clapperboard, title: 'Cinematic', blurb: '"The Summit" film flythrough', build: createFilmModeTemplate },
];

export function Launcher() {
  const [name, setName] = useState('My Game');
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const openRecent = useProjectStore((state) => state.openRecent);
  const removeRecent = useProjectStore((state) => state.removeRecent);
  const useDemo = useProjectStore((state) => state.useDemo);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const busy = useProjectStore((state) => state.busy);
  const error = useProjectStore((state) => state.error);
  const restoreRecovery = useProjectStore((state) => state.restoreRecovery);
  // Unsaved work from a crashed/closed session, if any (read once on mount).
  const [recovery, setRecovery] = useState(() => readRecovery());
  const createBlankProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || busy) return;
    await newProject(projectName);
  };

  const createTemplateProject = async (builder: () => Promise<unknown> | unknown) => {
    try {
      await newProject(name.trim());
      if (!useProjectStore.getState().hasProject) return;
      await builder();
    } catch (error) {
      useProjectStore.setState({ error: error instanceof Error ? error.message : 'Template failed' });
    }
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
            <strong>{TEMPLATES.length}</strong>
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
              <span className="launcher-template-count">{TEMPLATES.length} worlds</span>
            </div>
            <div className="template-grid">
              {TEMPLATES.map(({ icon: Icon, title, blurb, featured, build }) => (
                <button
                  type="button"
                  key={title}
                  className={`template-card ${featured ? 'template-card--featured' : ''}`}
                  disabled={busy || !name.trim()}
                  aria-label={`Create ${name.trim() || 'project'} from the ${title} template`}
                  onClick={() => void createTemplateProject(build)}
                >
                  <span className="template-card-icon">
                    <Icon size={20} aria-hidden />
                  </span>
                  <span className="template-card-copy">
                    {featured && <span className="template-card-kicker">Recommended</span>}
                    <strong>{title}</strong>
                    <small>{blurb}</small>
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
