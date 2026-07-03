import type { NodeForgeProject } from '../types';

/** One export platform (build target) an exported game can ship to. */
export type ExportTarget = 'web' | 'desktop' | 'android' | 'ios';

/** One toolchain requirement inside a platform-doctor report entry. */
export interface ExportRequirement {
  id: string;
  label: string;
  ok: boolean;
  /** How to install/fix it — present only when `ok` is false. */
  fix?: string;
}

/** Per-platform readiness from `scripts/platform-doctor.mjs`. */
export interface ExportPlatformInfo {
  id: 'web' | 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  label: string;
  kind: 'web' | 'desktop' | 'mobile';
  /** ready = buildable on this machine now; ci = build on another OS / GitHub Actions;
   *  missing = toolchain gaps (see requirements); unsupported = impossible here (iOS off-Mac). */
  status: 'ready' | 'ci' | 'missing' | 'unsupported';
  requirements: ExportRequirement[];
  notes?: string;
}

export interface ExportPlatformsReport {
  host: string;
  hostLabel: string;
  platforms: ExportPlatformInfo[];
}

export interface OpenedProject {
  /** Absolute project directory on desktop; a synthetic id on web. */
  dir: string;
  name: string;
  /** Fully loaded project with asset `url`s resolved for the current platform. */
  project: NodeForgeProject;
}

export interface Platform {
  readonly isDesktop: boolean;
  /** Create a new project on disk (desktop) or in memory (web). Returns null if cancelled. */
  createProject(name: string, scaffold: NodeForgeProject): Promise<OpenedProject | null>;
  /** Open an existing project (folder on desktop, file on web). Returns null if cancelled. */
  openProject(): Promise<OpenedProject | null>;
  /** Open a project from a known path/handle (used for "recent projects"). */
  openProjectAt(dir: string): Promise<OpenedProject | null>;
  /** Persist the project to its directory (desktop) or download it (web). */
  saveProject(dir: string, project: NodeForgeProject): Promise<void>;
  /** Copy an imported asset into the project and return its relative path + runtime url. */
  importAsset(dir: string, file: File): Promise<{ path: string; url: string }>;
  /** Resolve a stored relative asset path to a runtime url for rendering. */
  resolveAssetUrl(dir: string, path: string): string;
  /**
   * Write a standalone game bundle (the `game.json` the player loads).
   * Downloads the file on web; prompts for a save location on desktop.
   * Returns a short human-readable destination label, or null if cancelled.
   */
  exportGame(name: string, bundle: unknown): Promise<string | null>;
  /**
   * Stage a game bundle for a production build (portable web folder + native app).
   * On desktop, prompts for a save location and returns the absolute path of the
   * written `game.json` (so the caller can show the exact build command). On web,
   * downloads `game.json` and returns null.
   */
  stageProduction(name: string, bundle: unknown): Promise<string | null>;
  /**
   * Desktop only: actually run the production build for an already-built bundle, streaming each
   * output line via `onProgress`. The portable web folder is always produced; `targets` adds
   * native builds on top: 'desktop' (installer for this OS), 'android' (APK), 'ios' (Xcode).
   * Resolves to the bundle output directory. Undefined on platforms that can't build locally
   * (web) — callers fall back to `stageProduction`.
   */
  buildProduction?(
    bundleJson: string,
    targets: ExportTarget[],
    onProgress: (line: string) => void,
    outDir?: string,
  ): Promise<string>;
  /**
   * Desktop only: run the platform doctor and report which export platforms this machine can
   * build right now (and what's missing for the rest). Undefined on web.
   */
  checkExportPlatforms?(): Promise<ExportPlatformsReport>;
  /** Desktop only: prompt for a folder. Returns the absolute path, or null if cancelled. */
  pickDirectory?(title?: string): Promise<string | null>;
  /**
   * Write a portable template/module package (`.nfpack`). Downloads on web; prompts for a save
   * location on desktop. Returns a short destination label, or null if cancelled.
   */
  exportPackage(name: string, pkg: unknown): Promise<string | null>;
  /** Open a `.nfpack` package file and return its parsed JSON, or null if cancelled. */
  openPackage(): Promise<unknown | null>;
  /**
   * Write arbitrary binary data (e.g. an exported MP4/WebM recording). On desktop, prompts for a
   * save location via a native "Save As" dialog and writes the bytes. On web, downloads via a blob
   * URL (the browser decides the folder). Returns a short destination label, or null if cancelled.
   */
  saveBinary(
    defaultName: string,
    bytes: Uint8Array,
    options?: { title?: string; mimeType?: string; filters?: { name: string; extensions: string[] }[] },
  ): Promise<string | null>;
  /**
   * Desktop only: write `bytes` into `<projectDir>/<subfolder>/<fileName>`, creating the subfolder
   * if missing. Used for "automation" outputs (cinematic recordings, screenshots, etc.) that should
   * live alongside the project on disk instead of forcing a Save-As prompt. Returns the absolute
   * path of the written file. Undefined on web (no project folder on disk).
   */
  saveInProject?(projectDir: string, subfolder: string, fileName: string, bytes: Uint8Array): Promise<string>;
  /**
   * Desktop only: open the OS file manager with the given file highlighted (Explorer on Windows,
   * Finder on macOS). No-op / unsupported on web — callers should fall back to telling the user to
   * check their browser's Downloads folder.
   */
  revealFile?(path: string): Promise<void>;
}
