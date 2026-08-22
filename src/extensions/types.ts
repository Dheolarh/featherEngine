import type { ReactNode } from 'react';
import type {
  NodeForgeProject,
  SceneObject,
  SceneObjectKind,
  TransformComponent,
  TreeArchetype,
  TreeSpec,
  Vector3Tuple,
} from '../types';
import type { StylizedTreePreset } from '../tree/stylizedPresets';
import type { PlantGroveOptions } from '../store/editorStore';

/** Version of the public extension contract. Bump this only for SDK changes. */
export const FEATHER_EXTENSION_API_VERSION = '0.2.0' as const;

export type FeatherDispose = () => void;
export type FeatherPanelDirection = 'left' | 'right' | 'above' | 'below' | 'within';

export interface FeatherCommandDefinition {
  /** Globally unique id. By convention it starts with the plugin id plus a dot. */
  id: string;
  title: string;
  group?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

export interface FeatherPanelDefinition {
  /** Globally unique id. By convention it starts with the plugin id plus a dot. */
  id: string;
  title: string;
  /** Called by React whenever Dockview renders the registered panel. */
  render: () => ReactNode;
  placement?: {
    referencePanel?: string;
    direction?: FeatherPanelDirection;
  };
}

export interface FeatherObjectCreateOptions {
  kind: SceneObjectKind;
  name?: string;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
  color?: string;
  parentId?: string;
}

export interface FeatherTreePlaceOptions {
  /** Library asset to link the tree to. Takes precedence over presetId/archetype. */
  specId?: string;
  /** Stylized preset id (see trees.presets) — its library entry is created or reused first. */
  presetId?: string;
  /** Plain archetype, linked to the project's first matching library entry (createTree behaviour). */
  archetype?: TreeArchetype;
  position?: Vector3Tuple;
  /** Same seed = identical tree. Derived from the object id when omitted. */
  seed?: number;
  name?: string;
}

export interface FeatherEventMap {
  'project:changed': { hasProject: boolean; name: string };
  'scene:changed': { activeSceneId: string; objectCount: number };
  'selection:changed': { objectId: string };
  'runtime:play-changed': { isPlaying: boolean };
}

export interface FeatherPluginAPI {
  readonly apiVersion: typeof FEATHER_EXTENSION_API_VERSION;
  readonly pluginId: string;

  readonly commands: {
    register(definition: FeatherCommandDefinition): FeatherDispose;
  };

  readonly panels: {
    register(definition: FeatherPanelDefinition): FeatherDispose;
    /**
     * Open a panel by id. Resolves plugin panels first, then falls back to the editor's built-in
     * workspace panels ('trees', 'terrain', 'materials', …) so a plugin can hand the user over to
     * a full editor it just prepared.
     */
    open(id: string): boolean;
  };

  readonly events: {
    on<K extends keyof FeatherEventMap>(event: K, handler: (payload: FeatherEventMap[K]) => void): FeatherDispose;
  };

  readonly project: {
    /** A detached snapshot. Changing it never mutates the live project. */
    read(): Readonly<NodeForgeProject>;
    /**
     * Group synchronous edits into one extension operation. This is an undo-coalesced
     * edit batch, not a database transaction, so callbacks must not return a Promise.
     */
    transaction<T>(label: string, action: () => T): T;
  };

  readonly objects: {
    list(): ReadonlyArray<Readonly<SceneObject>>;
    get(id: string): Readonly<SceneObject> | undefined;
    create(options: FeatherObjectCreateOptions): string;
    rename(id: string, name: string): boolean;
    remove(id: string): boolean;
    select(id: string): boolean;
    setTransform(id: string, patch: Partial<TransformComponent>): boolean;
  };

  /** Parametric tree access: the project's Tree Builder library plus the stylized preset gallery. */
  readonly trees: {
    /** Detached copies of the project's reusable tree assets (the Tree Builder library). */
    library(): ReadonlyArray<Readonly<TreeSpec>>;
    /** The engine's stylized preset gallery — static data, readable without an open project. */
    presets(): ReadonlyArray<Readonly<StylizedTreePreset>>;
    /** Add a stylized preset to the project library. Returns the new asset's id. */
    addPreset(presetId: string, name?: string): string;
    /** Add a plain archetype to the project library. Returns the new asset's id. */
    addArchetype(archetype: TreeArchetype, name?: string): string;
    /** Patch a library asset — every placed and scattered tree referencing it updates. */
    updateSpec(specId: string, patch: Partial<TreeSpec>): boolean;
    /** Create one tree object in the scene. Returns its object id. */
    place(options?: FeatherTreePlaceOptions): string;
    /** Plant a grouped grove of trees linked to one library asset. */
    plantGrove(options?: PlantGroveOptions): { groupId: string; treeIds: string[] };
  };

  readonly ui: {
    notify(message: string, kind?: 'success' | 'error'): void;
  };

  readonly log: {
    info(message: string, ...details: unknown[]): void;
    warn(message: string, ...details: unknown[]): void;
    error(message: string, ...details: unknown[]): void;
  };
}

export interface FeatherPluginDefinition {
  id: string;
  name: string;
  version: string;
  /** SDK version this plugin was authored against. */
  apiVersion?: typeof FEATHER_EXTENSION_API_VERSION;
  activate(api: FeatherPluginAPI): void | FeatherDispose;
}

/** Identity helper that validates plugin objects through TypeScript without changing them. */
export function defineFeatherPlugin(plugin: FeatherPluginDefinition): FeatherPluginDefinition {
  return plugin;
}
