export type MediaKey = 'editor' | 'thirdPerson' | 'graph' | 'driving' | 'cinematic' | 'export';

export interface WorkflowStep {
  number: string;
  label: string;
  title: string;
  summary: string;
  userAction: string;
  engineAction: string;
  outcome: string;
  media: MediaKey;
  signal: string;
}

export const workflowSteps: WorkflowStep[] = [
  {
    number: '01',
    label: 'Start',
    title: 'Begin with momentum.',
    summary: 'Name a project, open existing work, or choose one of seven fully editable starter worlds.',
    userAction: 'Pick blank, Third-person, Meadows, Cube Realm, FPS, Driving, Sim racing, or Cinematic.',
    engineAction: 'Feather creates a real project with scenes, assets, reusable systems, and local persistence ready.',
    outcome: 'You start with something you can immediately inspect, change, and play—not a locked showcase.',
    media: 'editor',
    signal: 'PROJECT READY',
  },
  {
    number: '02',
    label: 'Build',
    title: 'Shape the world live.',
    summary: 'Arrange scenes through the viewport, hierarchy, inspector, and focused creative panels.',
    userAction: 'Add terrain, lights, cameras, primitives, trees, prefabs, or imported assets; then tune their components.',
    engineAction: 'One project state keeps transforms, materials, physics, tags, variables, and reusable assets in sync.',
    outcome: 'Every panel is another view of the same world, so changes stay visible and understandable.',
    media: 'thirdPerson',
    signal: 'SCENE SYNCED',
  },
  {
    number: '03',
    label: 'Script',
    title: 'Give every object rules.',
    summary: 'Connect typed visual Blueprints or write FeatherScript—the two authoring modes share one graph.',
    userAction: 'Wire events to actions, pass typed values, create reusable functions, and store game or instance state.',
    engineAction: 'Execution wires decide when work runs; value wires carry numbers, booleans, strings, vectors, and references.',
    outcome: 'Designers can think visually while code-first creators edit the same behavior as readable source.',
    media: 'graph',
    signal: 'SOURCE + GRAPH IN SYNC',
  },
  {
    number: '04',
    label: 'Play',
    title: 'Press Play. Stay in context.',
    summary: 'Test keyboard, mouse, gamepad, physics, cameras, audio, UI, and gameplay in the same viewport.',
    userAction: 'Enter Play mode whenever you need to feel a movement change, interaction, encounter, or camera beat.',
    engineAction: 'Rapier drives physics while scripts, input, animation, audio, camera, and UI systems run together.',
    outcome: 'There is no separate authoring build between an idea and the moment you can feel it.',
    media: 'driving',
    signal: 'RUNTIME ACTIVE',
  },
  {
    number: '05',
    label: 'Polish',
    title: 'See what happened—and why.',
    summary: 'Trace logic, watch values, read logs and problems, inspect frame timing, then refine the presentation.',
    userAction: 'Move between diagnostics, materials, animation, particles, terrain, UI, environment, and Film Mode.',
    engineAction: 'Live traces connect runtime feedback to the authoring surface without hiding the underlying state.',
    outcome: 'Debugging and polish become part of the same creative loop instead of a late-stage detour.',
    media: 'cinematic',
    signal: 'FRAME INSPECTED',
  },
  {
    number: '06',
    label: 'Ship',
    title: 'Know exactly what ships.',
    summary: 'Save locally, review the production report, validate the bundle, and build for the targets your machine supports.',
    userAction: 'Choose Export → Production, review readiness, select targets, and choose an output folder.',
    engineAction: 'Feather embeds referenced resources, builds the portable player, and packages platform artifacts with installed toolchains.',
    outcome: 'The same project becomes a hosted web build or a native/mobile package with clear platform requirements.',
    media: 'export',
    signal: 'BUNDLE VERIFIED',
  },
];

export const systemFeatures = [
  {
    key: 'worlds',
    eyebrow: 'World building',
    title: 'Atmosphere with structure.',
    body: 'Terrain, water, procedural trees, day/night, skies, volumetric fog, reflections, shadows, post effects, LOD, and instancing.',
    stat: 'LIVE 3D',
  },
  {
    key: 'physics',
    eyebrow: 'Gameplay & physics',
    title: 'Make motion matter.',
    body: 'Rapier rigid bodies, colliders, triggers, joints, characters, vehicles, ragdolls, cloth, cables, projectiles, damage, and fracture.',
    stat: 'RAPIER',
  },
  {
    key: 'animation',
    eyebrow: 'Assets & animation',
    title: 'Bring the cast to life.',
    body: 'Import common 3D, image, and audio formats; inspect skeletons, attach sockets, author state machines, and reuse prefabs.',
    stat: 'GLTF · FBX',
  },
  {
    key: 'interface',
    eyebrow: 'UI & input',
    title: 'Design the whole experience.',
    body: 'Build screen-space or world-space UI, connect HUD data, add a minimap, and support keyboard, mouse, gamepad, and touch.',
    stat: '4 INPUTS',
  },
  {
    key: 'cinema',
    eyebrow: 'Cinematics',
    title: 'Direct the moment.',
    body: 'Sequence shots, camera paths, blends, timed actions, audio, overlays, and frame-locked captures in Film Mode.',
    stat: 'FILM MODE',
  },
  {
    key: 'diagnostics',
    eyebrow: 'Diagnostics',
    title: 'Keep the truth visible.',
    body: 'Use execution and value tracing, console output, variable watch, problem reports, performance stats, and replay capture.',
    stat: 'LIVE TRACE',
  },
];

export const templates = [
  { key: 'third', number: '01', name: 'Third-person', body: 'Character movement, follow camera, combat, and an explorable tutorial world.', tag: 'Recommended' },
  { key: 'meadows', number: '02', name: 'Meadows', body: 'A stylized outdoor scene with interactive grass and nature rendering.', tag: 'World' },
  { key: 'cube', number: '03', name: 'Cube Realm', body: 'An action slice with combos, a day cycle, and a shrine encounter.', tag: 'Action' },
  { key: 'fps', number: '04', name: 'First-person shooter', body: 'A neon sandbox with weapons, grenades, targets, and HUD logic.', tag: 'Combat' },
  { key: 'driving', number: '05', name: 'Driving', body: 'An arcade-style neon cruise with vehicle controls, cameras, and a garage.', tag: 'Vehicle' },
  { key: 'racing', number: '06', name: 'Sim racing', body: 'Tuned vehicle physics, laps, rivals, traffic, and race presentation.', tag: 'Simulation' },
  { key: 'film', number: '07', name: 'Cinematic', body: 'A timeline-driven flythrough with cameras, wind, cloth, music, and VFX.', tag: 'Film' },
];

export const faqs = [
  {
    question: 'Do I need to know how to code?',
    answer: 'No. You can build gameplay with typed visual Blueprints and use the editor from start to export. FeatherScript is there when source is faster or easier to maintain, and both views describe the same gameplay graph.',
  },
  {
    question: 'What is different between the browser and desktop editor?',
    answer: 'The browser is the quickest way to explore and saves portable .nforge files. The Tauri desktop workspace uses readable project folders, native dialogs, recent projects, linked FeatherScript files, and is the recommended path for production exports.',
  },
  {
    question: 'Where does my project data go?',
    answer: 'Feather is local-first and does not require an account. Browser projects are downloaded as portable files; desktop projects live in a folder you choose. If you enable the optional AI assistant, requests go to the provider you select using your own API key.',
  },
  {
    question: 'Can I export to every platform from one computer?',
    answer: 'Web builds are broadly available, but native installers use host-specific toolchains. Desktop targets can be built on their matching operating system or through the included CI workflow. Android and iOS also require their platform SDKs and signing setup.',
  },
  {
    question: 'Is Feather ready for a production game?',
    answer: 'Feather is experimental v0.1.0 software under active development. The editor is functional and extensively tested, but APIs and the project format can change. Evaluate your riskiest scene and export target early, and keep source-controlled backups.',
  },
];
