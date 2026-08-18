import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  Box,
  Boxes,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Clapperboard,
  Code2,
  Command,
  Copy,
  Cpu,
  ExternalLink,
  Feather as FeatherIcon,
  Film,
  FolderOpen,
  Gamepad2,
  Gauge,
  Github,
  Globe2,
  Layers3,
  Menu,
  Monitor,
  MousePointer2,
  PackageCheck,
  PanelLeft,
  Play,
  Rocket,
  Route,
  Sparkles,
  Terminal,
  Trees,
  WandSparkles,
  Waypoints,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import editorFull from '../../docs/images/editor-full.png';
import editorThirdPerson from '../../docs/images/editor-third-person.png';
import editorDriving from '../../docs/images/editor-driving.png';
import editorCinematic from '../../docs/images/editor-cinematic.png';
import visualScripting from '../../docs/images/visual-scripting.png';
import { faqs, systemFeatures, templates, workflowSteps, type MediaKey } from './content';

const GITHUB_URL = 'https://github.com/mariojgt/NodeForgeEngine';
const QUICK_START = [
  'git clone https://github.com/mariojgt/NodeForgeEngine.git',
  'cd NodeForgeEngine',
  'npm ci',
  'npm run dev',
].join('\n');

const heroModes = [
  {
    label: 'World',
    eyebrow: 'LIVE SCENE',
    title: 'Author the whole world in context.',
    image: editorThirdPerson,
    alt: 'Feather Engine editor with a 3D tutorial world, hierarchy, inspector, asset browser, and creative panels.',
    note: 'Hierarchy · Viewport · Inspector',
  },
  {
    label: 'Logic',
    eyebrow: 'TYPED GRAPH',
    title: 'Turn behavior into something you can see.',
    image: visualScripting,
    alt: 'Feather Engine visual scripting workspace with event, logic, and variable nodes.',
    note: 'Visual Blueprint · FeatherScript',
  },
  {
    label: 'Cinema',
    eyebrow: 'FILM MODE',
    title: 'Direct gameplay and story in one timeline.',
    image: editorCinematic,
    alt: 'Feather Engine cinematic workspace with a camera path, timeline, scene hierarchy, and particle panel.',
    note: 'Shots · Camera paths · Capture',
  },
] as const;

const mediaByKey: Record<Exclude<MediaKey, 'export'>, { src: string; alt: string }> = {
  editor: {
    src: editorFull,
    alt: 'The complete Feather Engine editor workspace.',
  },
  thirdPerson: {
    src: editorThirdPerson,
    alt: 'A third-person starter world open in the Feather Engine editor.',
  },
  graph: {
    src: visualScripting,
    alt: 'A typed visual Blueprint graph in Feather Engine.',
  },
  driving: {
    src: editorDriving,
    alt: 'A driving project with a vehicle selected in the Feather Engine viewport.',
  },
  cinematic: {
    src: editorCinematic,
    alt: 'Film Mode and camera-path tools in Feather Engine.',
  },
};

const systemIcons: Record<string, LucideIcon> = {
  worlds: Trees,
  physics: Route,
  animation: Boxes,
  interface: Gamepad2,
  cinema: Film,
  diagnostics: Gauge,
};

const templateIcons: Record<string, LucideIcon> = {
  third: Gamepad2,
  meadows: Trees,
  cube: Box,
  fps: MousePointer2,
  driving: Route,
  racing: Gauge,
  film: Clapperboard,
};

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'left',
}: {
  eyebrow: string;
  title: string;
  body: string;
  align?: 'left' | 'center';
}) {
  return (
    <div className={'site-section-heading site-section-heading--' + align}>
      <span className="site-kicker">
        <span aria-hidden />
        {eyebrow}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function ProductWindow({
  src,
  alt,
  label,
  status,
  children,
  className = '',
}: {
  src: string;
  alt: string;
  label: string;
  status: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={'site-product-window ' + className}>
      <div className="site-window-bar">
        <span className="site-window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="site-window-label">
          <Layers3 size={13} aria-hidden />
          {label}
        </span>
        <span className="site-window-status">
          <i aria-hidden />
          {status}
        </span>
      </div>
      <div className="site-window-media">
        <img src={src} alt={alt} />
        <span className="site-window-sheen" aria-hidden />
        {children}
      </div>
    </div>
  );
}

function ExportReport() {
  return (
    <div className="site-build-report" aria-label="Example production build report">
      <div className="site-build-report__head">
        <div>
          <span className="site-kicker">PRODUCTION / REPORT</span>
          <strong>Build readiness</strong>
        </div>
        <span className="site-verified">
          <Check size={14} aria-hidden />
          Bundle verified
        </span>
      </div>
      <div className="site-build-score">
        <span>READY</span>
        <strong>01</strong>
        <p>Portable web player is always included. Native targets follow the installed host toolchain.</p>
      </div>
      <div className="site-build-lines">
        <div>
          <span>Referenced resources</span>
          <strong>Embedded</strong>
        </div>
        <div>
          <span>Project schema</span>
          <strong>Validated</strong>
        </div>
        <div>
          <span>Web artifact</span>
          <strong>Ready</strong>
        </div>
      </div>
      <div className="site-build-tree" aria-label="Example output structure">
        <span>MyGame/</span>
        <span>├── web/</span>
        <span>├── native/</span>
        <span>└── build-report.json</span>
      </div>
    </div>
  );
}

export function SiteApp() {
  const [heroMode, setHeroMode] = useState(0);
  const [activeWorkflow, setActiveWorkflow] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const hero = heroModes[heroMode];
  const workflow = workflowSteps[activeWorkflow];

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const copyQuickStart = async () => {
    try {
      await navigator.clipboard.writeText(QUICK_START);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-page">
      <a className="site-skip-link" href="#main">
        Skip to main content
      </a>

      <div className="site-future-ambient" aria-hidden>
        <span className="site-future-rail site-future-rail--left">
          <i>NF / 01</i>
          <b />
          <i>REALTIME</i>
        </span>
        <span className="site-future-rail site-future-rail--right">
          <i>WEBGL 2</i>
          <b />
          <i>LOCAL / 17421</i>
        </span>
        <span className="site-future-reticle site-future-reticle--one" />
        <span className="site-future-reticle site-future-reticle--two" />
      </div>

      <header className="site-header">
        <div className="site-header__inner">
          <a className="site-brand" href="#top" aria-label="Feather Engine home" onClick={closeMenu}>
            <span className="site-brand__mark">
              <FeatherIcon size={20} aria-hidden />
            </span>
            <span className="site-brand__copy">
              <strong>Feather</strong>
              <small>ENGINE</small>
            </span>
          </a>

          <nav className="site-nav" aria-label="Primary navigation">
            <a href="#workflow">How it works</a>
            <a href="#scripting">Scripting</a>
            <a href="#templates">Templates</a>
            <a href="#export">Export</a>
          </nav>

          <div className="site-header__actions">
            <a className="site-github-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Github size={17} aria-hidden />
              <span>GitHub</span>
            </a>
            <a className="site-button site-button--small" href="#quickstart">
              Start locally
              <ArrowRight size={15} aria-hidden />
            </a>
            <button
              className="site-menu-button"
              type="button"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
            </button>
          </div>
        </div>
        <div className="site-header__telemetry" aria-hidden>
          <span>FEATHER / CORE</span>
          <span>
            <i />
            GRAPH RUNTIME ONLINE
          </span>
          <span>PHYSICS / RAPIER</span>
          <span>FRAME / AUTHOR → PLAY → SHIP</span>
        </div>

        <nav
          id="mobile-navigation"
          className="site-mobile-nav"
          aria-label="Mobile navigation"
          data-open={menuOpen || undefined}
        >
          <a href="#workflow" onClick={closeMenu}>
            How it works <ChevronRight size={16} aria-hidden />
          </a>
          <a href="#scripting" onClick={closeMenu}>
            Scripting <ChevronRight size={16} aria-hidden />
          </a>
          <a href="#templates" onClick={closeMenu}>
            Templates <ChevronRight size={16} aria-hidden />
          </a>
          <a href="#export" onClick={closeMenu}>
            Export <ChevronRight size={16} aria-hidden />
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" onClick={closeMenu}>
            GitHub <ExternalLink size={15} aria-hidden />
          </a>
        </nav>
      </header>

      <main id="main">
        <section id="top" className="site-hero">
          <div className="site-hero__grid" aria-hidden />
          <div className="site-hero__horizon" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="site-orb site-orb--one" aria-hidden />
          <div className="site-orb site-orb--two" aria-hidden />

          <div className="site-container site-hero__content">
            <div className="site-hero__copy">
              <div className="site-status-pill">
                <span aria-hidden />
                Experimental v0.1.0
                <i aria-hidden>·</i>
                MIT licensed
              </div>
              <h1>
                Make the world.
                <br />
                Give it rules.
                <br />
                <span>Press play.</span>
              </h1>
              <p>
                Feather is a visual-first 3D game engine for building scenes, authoring gameplay,
                testing in place, and turning one project into a portable player.
              </p>
              <div className="site-hero__actions">
                <a className="site-button site-button--primary" href="#quickstart">
                  <Terminal size={18} aria-hidden />
                  Start building
                  <ArrowRight size={17} aria-hidden />
                </a>
                <a className="site-button site-button--ghost" href="#workflow">
                  <Play size={17} aria-hidden />
                  See the build loop
                </a>
              </div>
              <div className="site-hero__proof" aria-label="Product highlights">
                <span>
                  <Globe2 size={15} aria-hidden />
                  Browser editor
                </span>
                <span>
                  <Monitor size={15} aria-hidden />
                  Desktop workspace
                </span>
                <span>
                  <PackageCheck size={15} aria-hidden />
                  Web + native export
                </span>
              </div>
            </div>

            <div className="site-hero__visual">
              <div className="site-hero__halo" aria-hidden />
              <div className="site-hero__orbit" aria-hidden>
                <span />
                <span />
                <span />
                <i />
              </div>
              <div className="site-hero__hud site-hero__hud--north" aria-hidden>
                <span>SCENE MATRIX</span>
                <strong>07.16 / LIVE</strong>
              </div>
              <div className="site-hero__hud site-hero__hud--east" aria-hidden>
                <span>RENDER VECTOR</span>
                <strong>SYNC / 100%</strong>
              </div>
              <ProductWindow
                src={hero.image}
                alt={hero.alt}
                label={hero.title}
                status={hero.eyebrow}
                className="site-product-window--hero"
              >
                <div className="site-float-card site-float-card--runtime">
                  <span>WORKSPACE</span>
                  <strong>{hero.note}</strong>
                </div>
                <div className="site-float-card site-float-card--signal">
                  <CircleDot size={14} aria-hidden />
                  <span>PROJECT STATE</span>
                  <strong>SYNCED</strong>
                </div>
              </ProductWindow>

              <div className="site-mode-tabs" aria-label="Explore Feather workspaces">
                {heroModes.map((mode, index) => (
                  <button
                    key={mode.label}
                    type="button"
                    aria-pressed={heroMode === index}
                    onClick={() => setHeroMode(index)}
                  >
                    <span>0{index + 1}</span>
                    {mode.label}
                  </button>
                ))}
              </div>
              <div className="site-hero__coordinates" aria-hidden>
                <span>X 74.20</span>
                <i />
                <span>Y 17.421</span>
                <i />
                <span>Z LIVE</span>
              </div>
            </div>
          </div>

          <div className="site-container site-proof-strip" aria-label="Core technology">
            <span>One project</span>
            <i aria-hidden />
            <strong>React</strong>
            <strong>Three.js</strong>
            <strong>Rapier</strong>
            <strong>Tauri</strong>
            <strong>WebGL 2</strong>
            <i aria-hidden />
            <span>Local first</span>
          </div>
        </section>

        <section className="site-loop-intro">
          <div className="site-container">
            <SectionHeading
              eyebrow="One project · The whole loop"
              title="The engine stays out of your way—and close to your work."
              body="Scene building, gameplay logic, runtime feedback, and export all operate on the same project. Change the world by hand, by graph, by source, or with the optional AI assistant."
              align="center"
            />

            <div className="site-system-path" aria-label="Feather Engine project flow">
              <div>
                <span className="site-system-path__icon">
                  <Layers3 size={20} aria-hidden />
                </span>
                <small>AUTHOR</small>
                <strong>Scene + components</strong>
              </div>
              <ArrowRight aria-hidden />
              <div>
                <span className="site-system-path__icon site-system-path__icon--blue">
                  <Workflow size={20} aria-hidden />
                </span>
                <small>BEHAVIOR</small>
                <strong>Blueprint / source</strong>
              </div>
              <ArrowRight aria-hidden />
              <div>
                <span className="site-system-path__icon site-system-path__icon--mint">
                  <Play size={20} aria-hidden />
                </span>
                <small>FEEDBACK</small>
                <strong>Live runtime</strong>
              </div>
              <ArrowRight aria-hidden />
              <div>
                <span className="site-system-path__icon site-system-path__icon--amber">
                  <Rocket size={20} aria-hidden />
                </span>
                <small>DELIVER</small>
                <strong>Portable player</strong>
              </div>
            </div>

            <div className="site-principles">
              <article>
                <span>01</span>
                <h3>Stay in one workspace</h3>
                <p>Author a scene, press Play, inspect the result, and keep editing without changing tools.</p>
              </article>
              <article>
                <span>02</span>
                <h3>Choose how you think</h3>
                <p>Use visual nodes, FeatherScript, direct manipulation, or an AI co-editor on the same state.</p>
              </article>
              <article>
                <span>03</span>
                <h3>Own what you make</h3>
                <p>Projects stay local, remain readable on desktop, and export through a dedicated portable player.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="workflow" className="site-workflow-section">
          <div className="site-container">
            <SectionHeading
              eyebrow="How Feather works"
              title="From a name to a playable build."
              body="Follow the real workflow inside the engine. Each step explains what you do, what Feather does underneath, and what you leave with."
            />

            <div className="site-workflow">
              <div className="site-workflow__rail" aria-label="Game creation workflow">
                {workflowSteps.map((step, index) => (
                  <button
                    key={step.number}
                    type="button"
                    aria-pressed={activeWorkflow === index}
                    onClick={() => setActiveWorkflow(index)}
                  >
                    <span>{step.number}</span>
                    <div>
                      <small>{step.label}</small>
                      <strong>{step.title}</strong>
                    </div>
                    <ChevronRight size={17} aria-hidden />
                  </button>
                ))}
              </div>

              <div className="site-workflow__stage" aria-live="polite">
                <div className="site-workflow__signal">
                  <CircleDot size={14} aria-hidden />
                  {workflow.signal}
                </div>
                <div className="site-workflow__copy">
                  <span className="site-step-index">{workflow.number} / 06</span>
                  <h3>{workflow.title}</h3>
                  <p>{workflow.summary}</p>
                </div>

                {workflow.media === 'export' ? (
                  <ExportReport />
                ) : (
                  <ProductWindow
                    src={mediaByKey[workflow.media].src}
                    alt={mediaByKey[workflow.media].alt}
                    label={workflow.label + ' workspace'}
                    status={workflow.signal}
                    className="site-product-window--workflow"
                  />
                )}

                <div className="site-workflow__details">
                  <article>
                    <span>
                      <MousePointer2 size={15} aria-hidden />
                      YOU DO
                    </span>
                    <p>{workflow.userAction}</p>
                  </article>
                  <article>
                    <span>
                      <Cpu size={15} aria-hidden />
                      FEATHER DOES
                    </span>
                    <p>{workflow.engineAction}</p>
                  </article>
                </div>
                <div className="site-outcome">
                  <Check size={17} aria-hidden />
                  <span>
                    <small>THE RESULT</small>
                    {workflow.outcome}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="scripting" className="site-scripting-section">
          <div className="site-container">
            <div className="site-scripting__copy">
              <span className="site-kicker">
                <span aria-hidden />
                Visual logic + FeatherScript
              </span>
              <h2>Execution wires say when. Value wires carry what.</h2>
              <p>
                Build reusable typed Blueprints with events, flow, values, variables, physics, animation,
                audio, UI, and runtime actions. When source is faster, open the same behavior as FeatherScript.
              </p>
              <div className="site-scripting__facts">
                <div>
                  <Waypoints size={19} aria-hidden />
                  <span>
                    <strong>Typed visual flow</strong>
                    See control and data paths separately.
                  </span>
                </div>
                <div>
                  <Braces size={19} aria-hidden />
                  <span>
                    <strong>Readable source view</strong>
                    Move between code and graph representation.
                  </span>
                </div>
                <div>
                  <CircleDot size={19} aria-hidden />
                  <span>
                    <strong>Live runtime traces</strong>
                    Watch active paths and values during Play.
                  </span>
                </div>
              </div>
            </div>

            <div className="site-scripting__visual">
              <ProductWindow
                src={visualScripting}
                alt="Feather Engine Blueprint editor showing typed event and variable nodes."
                label="Player Controller / Visual"
                status="GRAPH VALID"
                className="site-product-window--script"
              />
              <div className="site-code-card">
                <div className="site-code-card__bar">
                  <span>
                    <Code2 size={14} aria-hidden />
                    player-controller.feather
                  </span>
                  <span className="site-code-sync">
                    <Check size={12} aria-hidden />
                    In sync
                  </span>
                </div>
                <pre aria-label="Example FeatherScript">
                  <code>
                    <span className="syntax-key">blueprint</span> Player{'\n'}
                    {'\n'}
                    <span className="syntax-key">var</span> speed: <span className="syntax-type">number</span> ={' '}
                    <span className="syntax-number">6</span>
                    {'\n'}
                    {'\n'}
                    <span className="syntax-key">on</span> update(dt):{'\n'}
                    {'    '}
                    <span className="syntax-key">if</span> Input.move().x &gt; <span className="syntax-number">0</span>:
                    {'\n'}
                    {'        '}self.translate({'\n'}
                    {'            '}axis: <span className="syntax-string">&quot;x&quot;</span>,{'\n'}
                    {'            '}amount: speed{'\n'}
                    {'        '}){'\n'}
                  </code>
                </pre>
              </div>
              <span className="site-sync-connector" aria-hidden>
                <i />
                SOURCE + GRAPH / ONE REPRESENTATION
              </span>
            </div>
          </div>
        </section>

        <section className="site-capabilities-section">
          <div className="site-container">
            <SectionHeading
              eyebrow="Creative tool belt"
              title="Deep enough to make the details matter."
              body="Feather brings the core systems of a modern 3D workflow into focused panels, then keeps them connected to the same live project."
              align="center"
            />
            <div className="site-capabilities">
              {systemFeatures.map((feature, index) => {
                const Icon = systemIcons[feature.key];
                return (
                  <article key={feature.key} className={index === 0 || index === 5 ? 'site-capability site-capability--wide' : 'site-capability'}>
                    <div className="site-capability__top">
                      <span className="site-capability__icon">
                        <Icon size={21} aria-hidden />
                      </span>
                      <span className="site-capability__stat">{feature.stat}</span>
                    </div>
                    <small>{feature.eyebrow}</small>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                    <span className="site-capability__line" aria-hidden />
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="templates" className="site-templates-section">
          <div className="site-container">
            <div className="site-templates__head">
              <SectionHeading
                eyebrow="Seven starter worlds"
                title="Start from something playable."
                body="Every template is an editable project. Open the scenes, inspect the logic, replace the assets, and carry the systems into your own game."
              />
              <div className="site-template-count">
                <strong>07</strong>
                <span>complete starting points</span>
              </div>
            </div>
            <div className="site-template-grid">
              {templates.map((template) => {
                const Icon = templateIcons[template.key];
                return (
                  <article key={template.key} className={template.key === 'third' ? 'site-template-card site-template-card--featured' : 'site-template-card'}>
                    <div className="site-template-card__top">
                      <span>{template.number}</span>
                      <small>{template.tag}</small>
                    </div>
                    <span className="site-template-card__icon">
                      <Icon size={22} aria-hidden />
                    </span>
                    <h3>{template.name}</h3>
                    <p>{template.body}</p>
                    <span className="site-template-card__arrow" aria-hidden>
                      <ArrowRight size={17} />
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="site-ai-section">
          <div className="site-container site-ai">
            <div className="site-ai__visual">
              <div className="site-ai-panel">
                <div className="site-ai-panel__head">
                  <span className="site-ai-orb">
                    <Sparkles size={17} aria-hidden />
                  </span>
                  <div>
                    <strong>Feather Assistant</strong>
                    <small>Optional co-editor · project aware</small>
                  </div>
                  <span className="site-ai-online">READY</span>
                </div>
                <div className="site-ai-message site-ai-message--user">
                  Make this scene feel like rainy dusk, bring the streetlights on, and add a checkpoint at the tunnel.
                </div>
                <div className="site-ai-message site-ai-message--assistant">
                  <span>I’ll update the live project through the editor’s typed actions.</span>
                  <div className="site-ai-actions">
                    <div>
                      <Check size={13} aria-hidden />
                      Set environment
                      <small>day cycle · fog · color grade</small>
                    </div>
                    <div>
                      <Check size={13} aria-hidden />
                      Update scene lights
                      <small>6 objects changed</small>
                    </div>
                    <div>
                      <Check size={13} aria-hidden />
                      Create checkpoint
                      <small>trigger + UI event</small>
                    </div>
                  </div>
                </div>
                <div className="site-ai-composer">
                  <span>Ask for a change…</span>
                  <WandSparkles size={16} aria-hidden />
                </div>
              </div>
              <span className="site-ai-caption">
                <Command size={14} aria-hidden />
                Same actions as the editor. Every result stays inspectable.
              </span>
            </div>

            <div className="site-ai__copy">
              <span className="site-kicker">
                <span aria-hidden />
                AI-native, never opaque
              </span>
              <h2>Ask for a change. Inspect every result.</h2>
              <p>
                The built-in assistant is an optional editor operator, not a separate generator. It uses the
                same typed project actions as the interface, so AI and manual work land in one scene.
              </p>
              <div className="site-ai__points">
                <div>
                  <Bot size={18} aria-hidden />
                  <span>
                    <strong>Live project editing</strong>
                    Create and tune objects, logic, environments, UI, and cinematics.
                  </span>
                </div>
                <div>
                  <PanelLeft size={18} aria-hidden />
                  <span>
                    <strong>Bring your own provider</strong>
                    Connect OpenAI, Anthropic, or Google with your own API key.
                  </span>
                </div>
                <div>
                  <Cpu size={18} aria-hidden />
                  <span>
                    <strong>Local external agents</strong>
                    The same tool surface can run through a localhost-only MCP bridge.
                  </span>
                </div>
              </div>
              <p className="site-ai__note">
                Provider requests use the key and service you configure. The MCP relay binds to localhost because connected clients can modify the open project.
              </p>
            </div>
          </div>
        </section>

        <section id="export" className="site-export-section">
          <div className="site-container">
            <SectionHeading
              eyebrow="Production export"
              title="From editable world to portable player."
              body="The desktop workflow stages your project, validates its resources, builds the player, and packages the targets supported by your host and installed toolchains."
              align="center"
            />
            <div className="site-export-pipeline" aria-label="Production export pipeline">
              <div>
                <span>01</span>
                <FolderOpen size={20} aria-hidden />
                <strong>Stage project</strong>
                <small>Scenes + resources</small>
              </div>
              <ChevronRight aria-hidden />
              <div>
                <span>02</span>
                <PackageCheck size={20} aria-hidden />
                <strong>Verify bundle</strong>
                <small>Schema + references</small>
              </div>
              <ChevronRight aria-hidden />
              <div>
                <span>03</span>
                <Rocket size={20} aria-hidden />
                <strong>Build player</strong>
                <small>Portable runtime</small>
              </div>
              <ChevronRight aria-hidden />
              <div>
                <span>04</span>
                <Globe2 size={20} aria-hidden />
                <strong>Package targets</strong>
                <small>Host toolchains</small>
              </div>
            </div>

            <div className="site-export-grid">
              <ExportReport />
              <div className="site-platforms">
                <div className="site-platforms__head">
                  <span className="site-kicker">OUTPUT TARGETS</span>
                  <h3>Ship where your toolchain can build.</h3>
                  <p>
                    A hosted web folder is the portable baseline. Native and mobile artifacts use platform-specific build tools.
                  </p>
                </div>
                <div className="site-platform-list">
                  <div>
                    <Globe2 size={18} aria-hidden />
                    <span>
                      <strong>Web</strong>
                      Static folder + zip
                    </span>
                    <small>Any supported OS</small>
                  </div>
                  <div>
                    <Monitor size={18} aria-hidden />
                    <span>
                      <strong>Windows · macOS · Linux</strong>
                      Native installers
                    </span>
                    <small>Matching host or CI</small>
                  </div>
                  <div>
                    <Gamepad2 size={18} aria-hidden />
                    <span>
                      <strong>Android · iOS</strong>
                      Mobile packages
                    </span>
                    <small>SDK + signing required</small>
                  </div>
                </div>
                <p className="site-platforms__foot">
                  Web builds must be served over HTTP(S); browser security blocks module applications launched directly through file://.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="site-status-section">
          <div className="site-container site-status-card">
            <div className="site-status-card__index">0.1</div>
            <div className="site-status-card__copy">
              <span className="site-kicker">
                <span aria-hidden />
                Honest by design
              </span>
              <h2>Experimental. Functional. Moving fast.</h2>
              <p>
                Feather is under active development. The editor is functional and extensively tested, but APIs and
                the project format can change before a stable release. Test your riskiest scene and export path early.
              </p>
            </div>
            <div className="site-status-card__checks">
              <span>
                <Check size={15} aria-hidden />
                MIT licensed
              </span>
              <span>
                <Check size={15} aria-hidden />
                Local-first projects
              </span>
              <span>
                <Check size={15} aria-hidden />
                Source-controlled backups recommended
              </span>
            </div>
          </div>
        </section>

        <section id="quickstart" className="site-quickstart-section">
          <div className="site-container site-quickstart">
            <div className="site-quickstart__copy">
              <span className="site-kicker">
                <span aria-hidden />
                Quick start
              </span>
              <h2>Your first playable world is four commands away.</h2>
              <p>
                Install Node.js 20 or newer, clone the MIT-licensed project, and open the browser editor at
                <strong> localhost:17420</strong>. Choose a starter world and press Play.
              </p>
              <div className="site-quickstart__choices">
                <div>
                  <Globe2 size={19} aria-hidden />
                  <span>
                    <strong>Browser preview</strong>
                    Fastest way to explore
                  </span>
                </div>
                <div>
                  <Monitor size={19} aria-hidden />
                  <span>
                    <strong>Desktop workspace</strong>
                    Best for sustained work and export
                  </span>
                </div>
              </div>
            </div>

            <div className="site-terminal">
              <div className="site-terminal__bar">
                <span className="site-window-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span>feather / quick-start</span>
                <button type="button" onClick={() => void copyQuickStart()} aria-live="polite">
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre>
                <code>
                  <span className="terminal-prompt">$</span> git clone https://github.com/mariojgt/NodeForgeEngine.git{'\n'}
                  <span className="terminal-prompt">$</span> cd NodeForgeEngine{'\n'}
                  <span className="terminal-prompt">$</span> npm ci{'\n'}
                  <span className="terminal-prompt">$</span> npm run dev
                </code>
              </pre>
              <div className="site-terminal__result">
                <CircleDot size={14} aria-hidden />
                Local: http://localhost:17420
              </div>
              <div className="site-terminal__actions">
                <a href="http://localhost:17420" target="_blank" rel="noreferrer">
                  Open local editor
                  <ExternalLink size={14} aria-hidden />
                </a>
                <span>
                  Desktop: <code>npm run tauri:dev</code>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="site-faq-section">
          <div className="site-container site-faq">
            <div className="site-faq__head">
              <span className="site-kicker">
                <span aria-hidden />
                The useful answers
              </span>
              <h2>Before you begin.</h2>
              <p>Clear expectations for authoring, data ownership, platforms, and project maturity.</p>
            </div>
            <div className="site-faq__list">
              {faqs.map((faq, index) => (
                <details key={faq.question}>
                  <summary>
                    <span>0{index + 1}</span>
                    {faq.question}
                    <span className="site-faq__toggle" aria-hidden>
                      <i />
                      <i />
                    </span>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="site-final-cta">
          <div className="site-final-cta__grid" aria-hidden />
          <div className="site-container site-final-cta__inner">
            <span className="site-final-cta__mark">
              <FeatherIcon size={31} aria-hidden />
            </span>
            <span className="site-kicker">FROM IDEA TO RUNTIME</span>
            <h2>Make something you can feel.</h2>
            <p>Start from a playable world, understand every system, and keep the whole creative loop close.</p>
            <div>
              <a className="site-button site-button--primary" href="#quickstart">
                <Terminal size={18} aria-hidden />
                Start locally
                <ArrowRight size={17} aria-hidden />
              </a>
              <a className="site-button site-button--ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Github size={17} aria-hidden />
                Explore the source
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-container site-footer__top">
          <a className="site-brand" href="#top" aria-label="Feather Engine home">
            <span className="site-brand__mark">
              <FeatherIcon size={20} aria-hidden />
            </span>
            <span className="site-brand__copy">
              <strong>Feather</strong>
              <small>ENGINE</small>
            </span>
          </a>
          <p>A visual-first, AI-native 3D game engine built in the open.</p>
          <span className="site-footer__status">
            <i aria-hidden />
            Experimental v0.1.0
          </span>
        </div>
        <div className="site-container site-footer__links">
          <div>
            <strong>Product</strong>
            <a href="#workflow">How it works</a>
            <a href="#scripting">Scripting</a>
            <a href="#templates">Templates</a>
            <a href="#export">Export</a>
          </div>
          <div>
            <strong>Documentation</strong>
            <a href={GITHUB_URL + '#get-started'} target="_blank" rel="noreferrer">Get started</a>
            <a href={GITHUB_URL + '/blob/main/docs/PRODUCTION_EXPORT.md'} target="_blank" rel="noreferrer">Production export</a>
            <a href={GITHUB_URL + '/blob/main/docs/AI_ASSISTANT.md'} target="_blank" rel="noreferrer">AI assistant</a>
            <a href={GITHUB_URL + '/blob/main/docs/PLUGIN_SDK.md'} target="_blank" rel="noreferrer">Plugin SDK</a>
          </div>
          <div>
            <strong>Project</strong>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href={GITHUB_URL + '/issues'} target="_blank" rel="noreferrer">Issues</a>
            <a href={GITHUB_URL + '/blob/main/LICENSE'} target="_blank" rel="noreferrer">MIT license</a>
            <a href="https://youtu.be/bG56Lbc-PN4" target="_blank" rel="noreferrer">Watch the demo</a>
          </div>
        </div>
        <div className="site-container site-footer__bottom">
          <span>© 2026 Feather Engine.</span>
          <span>Built for people who would rather make the game.</span>
        </div>
      </footer>
    </div>
  );
}
