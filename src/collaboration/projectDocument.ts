import * as Y from 'yjs';
import type { NodeForgeProject, ProjectGraph, ScriptBlueprint } from '../types';
import { canEditCollaborativeProject, collaborationAccess } from './access';
import { useEditorStore } from '../store/editorStore';
import {
  applyWithoutHistory,
  setCollaborationUndoDelegate,
  type CollaborationUndoDelegate,
} from '../store/history';

export const LOCAL_COLLABORATION_ORIGIN = Symbol('feather-collaboration-local');
export const REMOTE_COLLABORATION_ORIGIN = Symbol('feather-collaboration-remote');
export const SEED_COLLABORATION_ORIGIN = Symbol('feather-collaboration-seed');

const ROOT_KEY = 'feather-project';
const KIND_KEY = '$featherKind';
const ORDER_KEY = '$featherOrder';
const OBJECT_KIND = 'object';
const ID_ARRAY_KIND = 'id-array';

const TOP_LEVEL_ID_COLLECTIONS = [
  'scenes',
  'assets',
  'folders',
  'variables',
  'dataAssets',
  'materials',
  'particleSystems',
  'skeletons',
  'skeletalMeshes',
  'animations',
  'animatorControllers',
  'blueprints',
  'graphs',
  'uiDocuments',
  'treeSpecs',
  'modelSpecs',
  'prefabs',
] as const;

/** Empty arrays need an explicit shape so two peers can concurrently add without replacing types. */
const KNOWN_ID_ARRAY_FIELDS = new Set<string>([
  ...TOP_LEVEL_ID_COLLECTIONS,
  'objects',
  'nodes',
  'edges',
  'children',
  'cinematics',
  'columns',
  'rows',
  'states',
  'transitions',
  'parameters',
  'sockets',
  'bones',
  'tracks',
  'keyframes',
  'actions',
  'markers',
  'layers',
  'breakPoints',
]);

const BLUEPRINT_LOCAL_FIELDS = new Set([
  'featherSourcePath',
  'featherSourceLastSynced',
  'featherSourceLastSyncedHash',
  'featherSourceLastSyncedVisualHash',
]);

const ASSET_LOCAL_FIELDS = new Set(['path', 'url', 'data', 'unresolved', 'source']);
const NODE_TRANSIENT_FIELDS = new Set(['selected', 'dragging']);
const EDGE_TRANSIENT_FIELDS = new Set(['selected']);

type JsonObject = Record<string, unknown>;

function omitFields(value: JsonObject, fields: ReadonlySet<string>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key)));
}

/** Strip machine/session-only data before it can enter the shared CRDT or network stream. */
export function sanitizeProjectForCollaboration(project: NodeForgeProject): NodeForgeProject {
  return {
    ...project,
    savedAt: undefined,
    assets: project.assets.map((asset) =>
      omitFields(asset as unknown as JsonObject, ASSET_LOCAL_FIELDS) as unknown as typeof asset,
    ),
    blueprints: project.blueprints.map((blueprint) =>
      omitFields(blueprint as unknown as JsonObject, BLUEPRINT_LOCAL_FIELDS) as unknown as ScriptBlueprint,
    ),
    graphs: project.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        omitFields(node as unknown as JsonObject, NODE_TRANSIENT_FIELDS) as unknown as typeof node,
      ),
      edges: graph.edges.map((edge) =>
        omitFields(edge as unknown as JsonObject, EDGE_TRANSIENT_FIELDS) as unknown as typeof edge,
      ),
    })),
  };
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdObject(value: unknown): value is JsonObject & { id: string } {
  return isPlainObject(value) && typeof value.id === 'string' && value.id.length > 0;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/** Preserve concurrent edits around a changed span instead of replacing the whole Y.Text. */
function syncText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  const deleteLength = current.length - prefix - suffix;
  if (deleteLength > 0) text.delete(prefix, deleteLength);
  const insertion = next.slice(prefix, next.length - suffix);
  if (insertion) text.insert(prefix, insertion);
}

function ensureMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const current = parent.get(key);
  if (current instanceof Y.Map) return current;
  const created = new Y.Map<unknown>();
  parent.set(key, created);
  return created;
}

function syncIdArray(target: Y.Map<unknown>, values: Array<JsonObject & { id: string }>, path: string[]): void {
  if (target.get(KIND_KEY) !== ID_ARRAY_KIND) target.set(KIND_KEY, ID_ARRAY_KIND);
  const ids = new Set(values.map((item) => item.id));
  for (const key of [...target.keys()]) {
    if (key !== KIND_KEY && !ids.has(key)) target.delete(key);
  }
  values.forEach((value, index) => {
    const entity = ensureMap(target, value.id);
    syncObject(entity, value, [...path, value.id]);
    if (entity.get(ORDER_KEY) !== index) entity.set(ORDER_KEY, index);
  });
}

function syncArray(parent: Y.Map<unknown>, key: string, value: unknown[], path: string[]): void {
  const idShaped = value.every(isIdObject);
  if (idShaped && (value.length > 0 || KNOWN_ID_ARRAY_FIELDS.has(key))) {
    const target = ensureMap(parent, key);
    syncIdArray(target, value, [...path, key]);
    return;
  }

  // Primitive/fixed arrays (notably transform tuples) must be atomic values. Concurrently deleting
  // and reinserting a Y.Array can merge [x,y,z] replacements into six elements, corrupting the
  // project shape. Genuine entity lists use the id-keyed branch above; everything else is LWW JSON.
  const current = parent.get(key);
  const currentJson = current instanceof Y.Array ? current.toJSON() : current;
  if (!sameJson(currentJson, value)) parent.set(key, structuredClone(value));
}

function syncValue(parent: Y.Map<unknown>, key: string, value: unknown, path: string[]): void {
  if (value === undefined) {
    parent.delete(key);
    return;
  }
  if (key === 'featherSource' && typeof value === 'string') {
    const current = parent.get(key);
    const text = current instanceof Y.Text ? current : new Y.Text();
    if (!(current instanceof Y.Text)) parent.set(key, text);
    syncText(text, value);
    return;
  }
  if (Array.isArray(value)) {
    syncArray(parent, key, value, path);
    return;
  }
  if (isPlainObject(value)) {
    const target = ensureMap(parent, key);
    syncObject(target, value, [...path, key]);
    return;
  }
  if (!sameJson(parent.get(key), value)) parent.set(key, value);
}

function syncObject(target: Y.Map<unknown>, value: JsonObject, path: string[]): void {
  if (target.get(KIND_KEY) !== OBJECT_KIND) target.set(KIND_KEY, OBJECT_KIND);
  const keys = new Set(Object.keys(value).filter((key) => value[key] !== undefined));
  for (const key of [...target.keys()]) {
    if (key !== KIND_KEY && key !== ORDER_KEY && !keys.has(key)) target.delete(key);
  }
  for (const [key, child] of Object.entries(value)) syncValue(target, key, child, path);
}

function decodeValue(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(decodeValue);
  if (value instanceof Y.Map) {
    if (value.get(KIND_KEY) === ID_ARRAY_KIND) {
      return [...value.entries()]
        .filter(([key, item]) => key !== KIND_KEY && item instanceof Y.Map)
        .map(([key, item]) => {
          const decoded = decodeValue(item) as JsonObject;
          return {
            id: typeof decoded.id === 'string' ? decoded.id : key,
            ...decoded,
            [ORDER_KEY]: (item as Y.Map<unknown>).get(ORDER_KEY),
          };
        })
        .sort((a, b) => {
          const orderA = typeof a[ORDER_KEY] === 'number' ? a[ORDER_KEY] : Number.MAX_SAFE_INTEGER;
          const orderB = typeof b[ORDER_KEY] === 'number' ? b[ORDER_KEY] : Number.MAX_SAFE_INTEGER;
          return orderA - orderB || String(a.id).localeCompare(String(b.id));
        })
        .map(({ [ORDER_KEY]: _order, ...item }) => item);
    }
    const result: JsonObject = {};
    for (const [key, child] of value.entries()) {
      if (key !== KIND_KEY && key !== ORDER_KEY) result[key] = decodeValue(child);
    }
    return result;
  }
  return value;
}

function projectShape(value: unknown): value is NodeForgeProject {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.version === 'string' &&
    typeof value.name === 'string' &&
    typeof value.activeSceneId === 'string' &&
    TOP_LEVEL_ID_COLLECTIONS.every((key) => Array.isArray(value[key])) &&
    isPlainObject(value.exportSettings)
  );
}

export function collaborationDocumentInitialized(doc: Y.Doc): boolean {
  return doc.getMap(ROOT_KEY).get(KIND_KEY) === OBJECT_KIND;
}

/** Transactionally project one authored snapshot into granular shared types. */
export function writeProjectToCollaborationDoc(
  doc: Y.Doc,
  project: NodeForgeProject,
  origin: unknown = LOCAL_COLLABORATION_ORIGIN,
): void {
  const sanitized = sanitizeProjectForCollaboration(project);
  doc.transact(() => syncObject(doc.getMap(ROOT_KEY), sanitized as unknown as JsonObject, []), origin);
}

export function readProjectFromCollaborationDoc(doc: Y.Doc): NodeForgeProject | null {
  const root = doc.getMap(ROOT_KEY);
  if (root.get(KIND_KEY) !== OBJECT_KIND) return null;
  const decoded = decodeValue(root);
  return projectShape(decoded) ? decoded : null;
}

function mergeGraphTransientFields(remote: ProjectGraph[], local: ProjectGraph[]): ProjectGraph[] {
  const localGraphs = new Map(local.map((graph) => [graph.id, graph]));
  return remote.map((graph) => {
    const localGraph = localGraphs.get(graph.id);
    if (!localGraph) return graph;
    const localNodes = new Map(localGraph.nodes.map((node) => [node.id, node]));
    const localEdges = new Map(localGraph.edges.map((edge) => [edge.id, edge]));
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const current = localNodes.get(node.id);
        return current
          ? { ...node, selected: current.selected, dragging: current.dragging }
          : node;
      }),
      edges: graph.edges.map((edge) => {
        const current = localEdges.get(edge.id);
        return current ? { ...edge, selected: current.selected } : edge;
      }),
    };
  });
}

function mergeMachineLocalFields(remote: NodeForgeProject, local: NodeForgeProject): NodeForgeProject {
  const isHost = collaborationAccess().role === 'host';
  const localAssets = new Map(local.assets.map((asset) => [asset.id, asset]));
  const localBlueprints = new Map(local.blueprints.map((blueprint) => [blueprint.id, blueprint]));
  return {
    ...remote,
    // A guest never inherits or keeps filesystem links. The host retains its own path/runtime URL.
    activeSceneId: remote.scenes.some((scene) => scene.id === local.activeSceneId)
      ? local.activeSceneId
      : remote.activeSceneId,
    assets: remote.assets.map((asset) => {
      const current = localAssets.get(asset.id);
      if (!current || current.hash !== asset.hash) return asset;
      if (!isHost) {
        // Guest blob URLs are a machine-local overlay created by the authenticated asset resolver.
        // Retaining them prevents a viewer hydration/reprojection loop while paths remain stripped.
        return { ...asset, url: current.url, unresolved: current.unresolved };
      }
      return {
        ...asset,
        path: current.path,
        url: current.url,
        data: current.data,
        unresolved: current.unresolved,
        source: current.source,
      };
    }),
    blueprints: remote.blueprints.map((blueprint) => {
      const current = localBlueprints.get(blueprint.id);
      if (!isHost || !current) return blueprint;
      return {
        ...blueprint,
        featherSourcePath: current.featherSourcePath,
        featherSourceLastSynced: current.featherSourceLastSynced,
        featherSourceLastSyncedHash: current.featherSourceLastSyncedHash,
        featherSourceLastSyncedVisualHash: current.featherSourceLastSyncedVisualHash,
      };
    }),
    graphs: mergeGraphTransientFields(remote.graphs, local.graphs),
  };
}

const AUTHORED_STATE_KEYS = [
  'activeSceneId',
  'exportSettings',
  ...TOP_LEVEL_ID_COLLECTIONS,
  'renderSettings',
] as const;

function authoredStateChanged(next: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  return AUTHORED_STATE_KEYS.some((key) => next[key] !== previous[key]);
}

function applyProjectToEditor(project: NodeForgeProject): void {
  const current = useEditorStore.getState();
  const localProject = current.exportProject();
  const merged = mergeMachineLocalFields(project, localProject);
  applyWithoutHistory(() => {
    useEditorStore.setState({
      activeSceneId: merged.activeSceneId,
      exportSettings: merged.exportSettings,
      scenes: merged.scenes,
      assets: merged.assets,
      folders: merged.folders,
      variables: merged.variables,
      dataAssets: merged.dataAssets,
      materials: merged.materials,
      particleSystems: merged.particleSystems,
      skeletons: merged.skeletons,
      skeletalMeshes: merged.skeletalMeshes,
      animations: merged.animations,
      animatorControllers: merged.animatorControllers,
      blueprints: merged.blueprints,
      graphs: merged.graphs,
      uiDocuments: merged.uiDocuments,
      treeSpecs: merged.treeSpecs,
      modelSpecs: merged.modelSpecs ?? [],
      prefabs: merged.prefabs,
      renderSettings: merged.renderSettings ?? current.renderSettings,
      isDirty: true,
    });
  });
}

/**
 * Bridges the shared document and the authored Zustand slices. Local edits are diffed immediately
 * into nested Y types; remote transactions patch only authored slices and never reset selection,
 * runtime state, local asset URLs or the host's linked-file checkpoints.
 */
export class CollaborationProjectBinding {
  private readonly undoManager: Y.UndoManager;
  private readonly unsubscribeEditor: () => void;
  private applyingDocument = false;
  private applyQueued = false;
  private remoteApplyPending = false;
  private localSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly undoDelegate: CollaborationUndoDelegate;
  private readonly onApplied?: () => void;

  constructor(
    readonly doc: Y.Doc,
    options: { seed?: NodeForgeProject; manageUndo?: boolean; onApplied?: () => void } = {},
  ) {
    this.onApplied = options.onApplied;
    if (options.seed && !collaborationDocumentInitialized(doc)) {
      writeProjectToCollaborationDoc(doc, options.seed, SEED_COLLABORATION_ORIGIN);
    }
    const root = doc.getMap(ROOT_KEY);
    this.undoManager = new Y.UndoManager(root, {
      trackedOrigins: new Set([LOCAL_COLLABORATION_ORIGIN]),
      captureTimeout: 180,
    });
    this.undoDelegate = {
      undo: () => this.undoManager.undo(),
      redo: () => this.undoManager.redo(),
      clear: () => this.undoManager.clear(),
      depths: () => ({
        undo: this.undoManager.undoStack.length,
        redo: this.undoManager.redoStack.length,
      }),
    };
    if (options.manageUndo !== false) setCollaborationUndoDelegate(this.undoDelegate);

    const syncUndoDepths = () => {
      if (options.manageUndo === false || this.destroyed) return;
      const depths = this.undoDelegate.depths();
      useEditorStore.setState({ undoDepth: depths.undo, redoDepth: depths.redo });
    };
    this.undoManager.on('stack-item-added', syncUndoDepths);
    this.undoManager.on('stack-item-popped', syncUndoDepths);
    this.undoManager.on('stack-cleared', syncUndoDepths);

    doc.on('update', this.onDocumentUpdate);

    this.unsubscribeEditor = useEditorStore.subscribe((state, previous) => {
      if (this.destroyed || this.applyingDocument) return;
      if (previous.isPlaying && !state.isPlaying) {
        // Runtime objects are restored from the host's pre-Play snapshot on Stop. Apply the latest
        // CRDT state immediately afterwards so edits collaborators made during Play win over that
        // stale runtime snapshot instead of being written back into Yjs by the next host edit.
        if (this.remoteApplyPending) this.queueApplyFromDocument();
        return;
      }
      if (state.isPlaying || previous.isPlaying) return;
      if (!authoredStateChanged(state as unknown as Record<string, unknown>, previous as unknown as Record<string, unknown>)) return;
      if (!collaborationDocumentInitialized(this.doc)) return;
      if (!canEditCollaborativeProject()) {
        // Viewer mutations are rejected locally as well as by the server's binary-frame guard.
        this.queueApplyFromDocument();
        return;
      }
      this.queueLocalSync();
    });
  }

  private onDocumentUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (origin === LOCAL_COLLABORATION_ORIGIN || origin === SEED_COLLABORATION_ORIGIN) return;
    if (useEditorStore.getState().isPlaying) {
      this.remoteApplyPending = true;
      return;
    }
    this.queueApplyFromDocument();
  };

  /** Coalesce transform drags and inspector scrubs to ~30Hz before walking the project. */
  private queueLocalSync(): void {
    if (this.localSyncTimer || this.destroyed) return;
    this.localSyncTimer = setTimeout(() => {
      this.localSyncTimer = null;
      this.flushLocalChanges();
    }, 32);
  }

  /** Commit a final drag/scrub value immediately so pointer-up cannot strand it behind a timer. */
  flushLocalChanges(): void {
    if (this.localSyncTimer) clearTimeout(this.localSyncTimer);
    this.localSyncTimer = null;
    if (
      this.destroyed
      || useEditorStore.getState().isPlaying
      || !canEditCollaborativeProject()
      || !collaborationDocumentInitialized(this.doc)
    ) return;
    writeProjectToCollaborationDoc(
      this.doc,
      useEditorStore.getState().exportProject(),
      LOCAL_COLLABORATION_ORIGIN,
    );
  }

  applyNow(): void {
    if (useEditorStore.getState().isPlaying) {
      this.remoteApplyPending = true;
      return;
    }
    const project = readProjectFromCollaborationDoc(this.doc);
    if (!project || this.destroyed) return;
    this.applyingDocument = true;
    try {
      applyProjectToEditor(project);
      this.remoteApplyPending = false;
      this.onApplied?.();
    } finally {
      this.applyingDocument = false;
    }
  }

  private queueApplyFromDocument(): void {
    if (this.applyQueued || this.destroyed) return;
    if (useEditorStore.getState().isPlaying) {
      this.remoteApplyPending = true;
      return;
    }
    this.applyQueued = true;
    queueMicrotask(() => {
      this.applyQueued = false;
      if (useEditorStore.getState().isPlaying) {
        this.remoteApplyPending = true;
        return;
      }
      this.applyNow();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.localSyncTimer) clearTimeout(this.localSyncTimer);
    this.localSyncTimer = null;
    this.unsubscribeEditor();
    this.doc.off('update', this.onDocumentUpdate);
    this.undoManager.destroy();
    setCollaborationUndoDelegate(null);
  }
}
