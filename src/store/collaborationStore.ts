import { create } from 'zustand';
import * as Y from 'yjs';
import { isDesktop, getPlatform } from '../platform';
import type { CollaborationJoinRole } from '../platform/types';
import type { NodeForgeProject } from '../types';
import { useEditorStore } from './editorStore';
import { clearHistory } from './history';
import { useProjectStore } from './projectStore';
import {
  collaborationWebsocketUrl,
  buildCollaborationInvite,
  parseCollaborationInvite,
  randomCollaborationToken,
} from '../collaboration/invite';
import {
  CollaborationWebSocketProvider,
  type CollaborationEditingPresence,
  type CollaborationPresence,
  type ProtocolParticipant,
  type ProviderConnectionStatus,
} from '../collaboration/provider';
import { CollaborationProjectBinding } from '../collaboration/projectDocument';
import {
  collaborationAccess,
  setCollaborationAccess,
  type CollaborationRole,
} from '../collaboration/access';
import { CollaborationAssetResolver } from '../collaboration/assets';

export type CollaborationStatus =
  | 'idle'
  | 'starting'
  | 'hosting'
  | 'joining'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface CollaborationParticipant {
  id: string;
  name: string;
  role: CollaborationRole;
  color: string;
  presence: CollaborationPresence;
  isSelf: boolean;
}

interface StartSessionInput {
  displayName: string;
  sessionName: string;
  authtoken: string;
  defaultRole: CollaborationJoinRole;
  domain?: string;
}

interface JoinSessionInput {
  displayName: string;
  invite: string;
}

interface CollaborationState {
  status: CollaborationStatus;
  role: CollaborationRole | null;
  sessionName: string;
  inviteUrl: string;
  publicUrl: string;
  participants: CollaborationParticipant[];
  error: string | null;
  canHost: boolean;
  startSession: (input: StartSessionInput) => Promise<void>;
  joinSession: (input: JoinSessionInput) => Promise<void>;
  leaveSession: () => Promise<void>;
  setParticipantRole: (id: string, role: CollaborationJoinRole) => void;
  kickParticipant: (id: string) => void;
  updatePresence: (presence: CollaborationPresence) => void;
  setEditingActivity: (editing?: CollaborationEditingPresence) => void;
  setPresenceSurface: (surface: CollaborationPresence['surface']) => void;
  flushProjectChanges: () => void;
}

let provider: CollaborationWebSocketProvider | null = null;
let binding: CollaborationProjectBinding | null = null;
let document: Y.Doc | null = null;
let assetResolver: CollaborationAssetResolver | null = null;
let operation = 0;
let hosted = false;
let selfId: string | null = null;
let unsubscribePresence: (() => void) | null = null;
let unsubscribeHostAssets: (() => void) | null = null;
let unsubscribeHostProject: (() => void) | null = null;
let hostAssetTimer: ReturnType<typeof setTimeout> | null = null;
let hostAssetRegistrationChain = Promise.resolve();
const registeredHostAssets = new Map<string, string>();
const presenceByParticipant = new Map<string, CollaborationPresence>();
let localEditingPresence: CollaborationEditingPresence | undefined;
let localPresenceSurface: CollaborationPresence['surface'];

interface GuestWorkspaceSnapshot {
  project: NodeForgeProject;
  isDirty: boolean;
  hasProject: boolean;
  projectDir: string | null;
  projectName: string;
}

let guestWorkspaceSnapshot: GuestWorkspaceSnapshot | null = null;

function participantColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return `hsl(${Math.abs(hash) % 360} 72% 58%)`;
}

function participantsForUi(roster: ProtocolParticipant[]): CollaborationParticipant[] {
  return roster.map((participant) => ({
    id: participant.id,
    name: participant.name,
    role: participant.role,
    color: participantColor(participant.id),
    presence: presenceByParticipant.get(participant.id) ?? {},
    isSelf: participant.id === selfId,
  }));
}

function normalizedLabel(value: string, fallback: string, maxLength = 80): string {
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return clean || fallback;
}

function safeError(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[credential]');
  }
  return message.slice(0, 500) || 'Collaboration could not be started.';
}

function clearGuestMachineLinks(): void {
  useEditorStore.setState((state) => ({
    isPlaying: false,
    assets: state.assets.map(({ path: _path, url: _url, data: _data, source: _source, ...asset }) => asset),
    blueprints: state.blueprints.map((blueprint) => ({
      ...blueprint,
      featherSourcePath: undefined,
      featherSourceLastSynced: undefined,
      featherSourceLastSyncedHash: undefined,
      featherSourceLastSyncedVisualHash: undefined,
    })),
  }));
}

function captureGuestWorkspace(): void {
  const projectState = useProjectStore.getState();
  const editorState = useEditorStore.getState();
  const project = structuredClone(editorState.exportProject());
  // exportProject intentionally strips runtime URLs for persistence. A guest restore is different:
  // it must retain this machine's desktop/blob URL overlay, including browser blobs that cannot be
  // reconstructed after the shared session has replaced the editor's asset list.
  project.assets = structuredClone(editorState.assets);
  guestWorkspaceSnapshot = {
    project,
    isDirty: editorState.isDirty,
    hasProject: projectState.hasProject,
    projectDir: projectState.projectDir,
    projectName: projectState.projectName,
  };
}

function restoreGuestWorkspace(): void {
  const snapshot = guestWorkspaceSnapshot;
  guestWorkspaceSnapshot = null;
  if (!snapshot) return;
  useEditorStore.getState().loadProject(snapshot.project);
  useEditorStore.setState({ isDirty: snapshot.isDirty, isPlaying: false });
  useProjectStore.setState({
    hasProject: snapshot.hasProject,
    projectDir: snapshot.projectDir,
    projectName: snapshot.projectName,
    busy: false,
  });
  clearHistory();
}

function currentPresence(): CollaborationPresence {
  const state = useEditorStore.getState();
  return {
    activeSceneId: state.activeSceneId,
    selectedObjectId: state.selectedObjectId || undefined,
    selectedObjectIds: state.selectedObjectIds.length > 0 ? state.selectedObjectIds : undefined,
    activeBlueprintId: state.activeBlueprintId || undefined,
    selectedGraphNodeId: state.selectedGraphNodeId || undefined,
    surface: localPresenceSurface ?? (state.activeBlueprintId ? 'graph' : 'viewport'),
    editing: localEditingPresence,
    lastSeenAt: Date.now(),
  };
}

function startPresenceTracking(): void {
  let previousKey = '';
  const publish = () => {
    const presence = currentPresence();
    const key = JSON.stringify([
      presence.activeSceneId,
      presence.selectedObjectId,
      presence.selectedObjectIds,
      presence.activeBlueprintId,
      presence.selectedGraphNodeId,
    ]);
    if (key === previousKey) return;
    previousKey = key;
    useCollaborationStore.getState().updatePresence(presence);
  };
  unsubscribePresence = useEditorStore.subscribe(publish);
  publish();
}

function destroyClient(): void {
  unsubscribePresence?.();
  unsubscribeHostAssets?.();
  unsubscribeHostProject?.();
  unsubscribePresence = null;
  unsubscribeHostAssets = null;
  unsubscribeHostProject = null;
  if (hostAssetTimer) clearTimeout(hostAssetTimer);
  hostAssetTimer = null;
  registeredHostAssets.clear();
  provider?.destroy();
  binding?.destroy();
  assetResolver?.destroy();
  document?.destroy();
  provider = null;
  binding = null;
  assetResolver = null;
  document = null;
  selfId = null;
  presenceByParticipant.clear();
  localEditingPresence = undefined;
  localPresenceSurface = undefined;
  setCollaborationAccess(false, null);
  clearHistory();
}

function settleHostPlayBeforeSessionEnd(): void {
  if (!hosted) return;
  const editor = useEditorStore.getState();
  if (editor.isPlaying) editor.setPlaying(false);
  // Stop restores the runtime snapshot synchronously. Project the latest Yjs document immediately
  // afterwards so guest edits received during Play survive a manual or transport-driven shutdown.
  binding?.applyNow();
}

function terminateSession(message: string, currentOperation: number): void {
  if (operation !== currentOperation) return;
  const terminalOperation = ++operation;
  const stopHost = hosted;
  settleHostPlayBeforeSessionEnd();
  hosted = false;
  destroyClient();
  useCollaborationStore.setState({
    ...idleState,
    status: 'error',
    error: safeError(message),
  });
  void (async () => {
    restoreGuestWorkspace();
    if (stopHost) {
      try {
        await (await getPlatform()).stopCollaboration?.();
      } catch {
        // The transport is already terminal; local native cleanup also runs on app shutdown.
      }
    }
    if (operation === terminalOperation) {
      useCollaborationStore.setState({ ...idleState, status: 'error', error: safeError(message) });
    }
  })();
}

function installProvider(args: {
  doc: Y.Doc;
  websocketUrl: string;
  publicUrl: string;
  sessionId: string;
  credential: string;
  displayName: string;
  initialRole: CollaborationRole | null;
  currentOperation: number;
}): void {
  const clientId = randomCollaborationToken(18);
  assetResolver = null;
  binding = new CollaborationProjectBinding(args.doc, {
    seed: args.initialRole === 'host' ? useEditorStore.getState().exportProject() : undefined,
    onApplied: () => { void assetResolver?.hydrateMissingAssets(); },
  });

  const updateRoster = (roster: ProtocolParticipant[]) => {
    if (operation !== args.currentOperation) return;
    const participantIds = new Set(roster.map((participant) => participant.id));
    for (const participantId of presenceByParticipant.keys()) {
      if (!participantIds.has(participantId)) presenceByParticipant.delete(participantId);
    }
    useCollaborationStore.setState({ participants: participantsForUi(roster) });
    // Presence is intentionally ephemeral at the relay. Re-publish when membership changes so a
    // newcomer immediately sees what everyone already in the session is selecting/editing.
    if (selfId && participantIds.has(selfId)) {
      useCollaborationStore.getState().updatePresence(currentPresence());
    }
  };
  const onProviderStatus = (status: ProviderConnectionStatus, error?: string) => {
    if (operation !== args.currentOperation) return;
    const role = useCollaborationStore.getState().role;
    useCollaborationStore.setState({
      status: status === 'connected' ? (role === 'host' ? 'hosting' : 'connected') : status,
      error: error ?? (status === 'connected' ? null : useCollaborationStore.getState().error),
    });
  };

  provider = new CollaborationWebSocketProvider({
    doc: args.doc,
    websocketUrl: args.websocketUrl,
    sessionId: args.sessionId,
    credential: args.credential,
    displayName: args.displayName,
    clientId,
    initialRole: args.initialRole,
    onStatus: onProviderStatus,
    onWelcome: (self, roster, assetToken) => {
      if (operation !== args.currentOperation) return;
      selfId = self.id;
      setCollaborationAccess(true, self.role);
      if (self.role !== 'host') {
        if (assetResolver) assetResolver.updateCredential(assetToken);
        else {
          assetResolver = new CollaborationAssetResolver({
            publicUrl: args.publicUrl,
            credential: assetToken,
          });
        }
        clearGuestMachineLinks();
        void assetResolver.hydrateMissingAssets();
      }
      if (self.role === 'viewer') clearHistory();
      useCollaborationStore.setState({
        role: self.role,
        status: self.role === 'host' ? 'hosting' : 'connected',
        participants: participantsForUi(roster),
        error: null,
      });
      useCollaborationStore.getState().updatePresence(currentPresence());
    },
    onRoster: (roster) => {
      if (operation !== args.currentOperation) return;
      const self = roster.find((participant) => participant.id === selfId);
      if (self) {
        setCollaborationAccess(true, self.role);
        if (self.role === 'viewer') clearHistory();
        useCollaborationStore.setState({ role: self.role });
      }
      updateRoster(roster);
    },
    onPresence: (participantId, presence) => {
      if (operation !== args.currentOperation) return;
      presenceByParticipant.set(participantId, presence);
      useCollaborationStore.setState((state) => ({
        participants: state.participants.map((participant) =>
          participant.id === participantId ? { ...participant, presence } : participant,
        ),
      }));
    },
    onTerminated: (message) => terminateSession(message, args.currentOperation),
  });
  try {
    startPresenceTracking();
  } catch (presenceError) {
    unsubscribePresence?.();
    unsubscribePresence = null;
    // Presence is useful context, not part of the authoritative project stream. Keep live editing
    // connected if the local editor cannot start its presence watcher.
    useProjectStore.setState({
      toast: {
        kind: 'error',
        message: `Live editing started, but presence could not be shared: ${safeError(presenceError)}`,
      },
    });
  }
}

async function registerHostAssetBatch(
  platform: Awaited<ReturnType<typeof getPlatform>>,
  projectDir: string,
  assets: Array<{ sha256: string; relativePath: string }>,
): Promise<void> {
  if (!platform.registerCollaborationAssets || assets.length === 0 || !hosted) return;
  try {
    await platform.registerCollaborationAssets(projectDir, assets);
    for (const asset of assets) registeredHostAssets.set(asset.sha256, asset.relativePath);
  } catch (error) {
    if (assets.length === 1) throw error;
    const middle = Math.ceil(assets.length / 2);
    const results = await Promise.allSettled([
      registerHostAssetBatch(platform, projectDir, assets.slice(0, middle)),
      registerHostAssetBatch(platform, projectDir, assets.slice(middle)),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

async function registerHostAssets(): Promise<void> {
  if (!hosted) return;
  const platform = await getPlatform();
  if (!platform.registerCollaborationAssets) return;
  const projectDir = useProjectStore.getState().projectDir;
  if (!projectDir || projectDir === 'web') return;
  const byHash = new Map<string, string>();
  for (const asset of useEditorStore.getState().assets) {
    if (asset.path && asset.hash && /^[a-f0-9]{64}$/.test(asset.hash)) {
      byHash.set(asset.hash, asset.path);
    }
  }
  const assets = [...byHash].flatMap(([sha256, relativePath]) =>
    registeredHostAssets.get(sha256) === relativePath ? [] : [{ sha256, relativePath }],
  );
  for (let offset = 0; offset < assets.length && hosted; offset += 256) {
    await registerHostAssetBatch(platform, projectDir, assets.slice(offset, offset + 256));
  }
}

function scheduleHostAssetRegistration(currentOperation: number, delayMs = 120): void {
  if (hostAssetTimer) clearTimeout(hostAssetTimer);
  hostAssetTimer = setTimeout(() => {
    hostAssetTimer = null;
    hostAssetRegistrationChain = hostAssetRegistrationChain
      .then(async () => {
        if (!hosted || operation !== currentOperation) return;
        await registerHostAssets();
      })
      .catch(async (error) => {
        if (!hosted || operation !== currentOperation) return;
        useProjectStore.setState({
          toast: {
            kind: 'error',
            message: `A project asset could not be shared: ${safeError(error)}`,
          },
        });
      });
  }, delayMs);
}

function startHostAssetTracking(currentOperation: number): void {
  let previousAssets = useEditorStore.getState().assets;
  unsubscribeHostAssets = useEditorStore.subscribe((state) => {
    if (state.assets === previousAssets) return;
    previousAssets = state.assets;
    scheduleHostAssetRegistration(currentOperation);
  });
  let previousDir = useProjectStore.getState().projectDir;
  unsubscribeHostProject = useProjectStore.subscribe((state) => {
    if (state.projectDir === previousDir) return;
    previousDir = state.projectDir;
    registeredHostAssets.clear();
    scheduleHostAssetRegistration(currentOperation);
  });
  scheduleHostAssetRegistration(currentOperation, 0);
}

const idleState = {
  status: 'idle' as const,
  role: null,
  sessionName: '',
  inviteUrl: '',
  publicUrl: '',
  participants: [],
  error: null,
};

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  ...idleState,
  canHost: isDesktop,

  startSession: async (input) => {
    if (collaborationAccess().active) {
      set({ error: 'Leave or stop the current collaboration session first.' });
      return;
    }
    if (!get().canHost) {
      set({ status: 'error', error: 'Hosting collaboration requires the Feather desktop app.' });
      return;
    }
    const authtoken = input.authtoken.trim();
    if (!authtoken) {
      set({ status: 'error', error: 'Enter your ngrok authtoken to host a session.' });
      return;
    }
    if (useEditorStore.getState().isPlaying) {
      set({ status: 'error', error: 'Stop Play before starting a collaboration session.' });
      return;
    }
    const currentOperation = ++operation;
    guestWorkspaceSnapshot = null;
    destroyClient();
    const sessionName = normalizedLabel(input.sessionName, 'Feather session');
    const displayName = normalizedLabel(input.displayName, 'Host');
    const sessionId = randomCollaborationToken(18);
    const joinSecret = randomCollaborationToken();
    const hostSecret = randomCollaborationToken();
    setCollaborationAccess(true, 'host');
    set({ ...idleState, status: 'starting', role: 'host', sessionName });
    let nativeStarted = false;
    let startupPhase = 'opening the ngrok endpoint';
    try {
      const platform = await getPlatform();
      if (!platform.startCollaboration) throw new Error('Collaboration hosting is unavailable in this build.');
      const started = await platform.startCollaboration({
        authtoken,
        sessionId,
        joinSecret,
        hostSecret,
        defaultRole: input.defaultRole,
        domain: input.domain?.trim() || undefined,
      });
      nativeStarted = true;
      if (operation !== currentOperation) {
        await platform.stopCollaboration?.();
        return;
      }
      startupPhase = 'creating the collaboration invite';
      const inviteUrl = buildCollaborationInvite(started.publicUrl, started.sessionId, joinSecret);
      startupPhase = 'preparing the shared project';
      document = new Y.Doc();
      set({ status: 'hosting', publicUrl: started.publicUrl, inviteUrl, error: null });
      installProvider({
        doc: document,
        websocketUrl: collaborationWebsocketUrl(started.localUrl),
        publicUrl: started.publicUrl,
        sessionId: started.sessionId,
        credential: hostSecret,
        displayName,
        initialRole: 'host',
        currentOperation,
      });
      hosted = true;
      startupPhase = 'starting project asset sharing';
      // Asset hashing can be expensive, so it runs behind the live editing connection. Guests
      // retry authenticated asset requests while the host registers verified content hashes.
      try {
        startHostAssetTracking(currentOperation);
      } catch (assetError) {
        // Asset registration is an optional companion to the live CRDT connection. A local file
        // watcher problem must not tear down an otherwise healthy collaboration session.
        useProjectStore.setState({
          toast: {
            kind: 'error',
            message: `Live editing started, but project assets could not be shared: ${safeError(assetError)}`,
          },
        });
      }
    } catch (error) {
      const failure = safeError(error, [authtoken, joinSecret, hostSecret]);
      // Tear down the provider before stopping the native relay. Otherwise the deliberate cleanup
      // close frame races back through onTerminated and hides this original startup failure behind
      // the misleading message "The collaboration session stopped unexpectedly."
      hosted = false;
      destroyClient();
      if (operation === currentOperation) {
        set({
          ...idleState,
          status: 'error',
          error: `Could not finish ${startupPhase}: ${failure}`,
        });
      }
      if (nativeStarted) {
        await (await getPlatform()).stopCollaboration?.().catch(() => undefined);
      }
    }
  },

  joinSession: async (input) => {
    if (collaborationAccess().active) {
      set({ error: 'Leave or stop the current collaboration session first.' });
      return;
    }
    const currentOperation = ++operation;
    let workspaceCaptured = false;
    try {
      const invite = parseCollaborationInvite(input.invite);
      const displayName = normalizedLabel(input.displayName, 'Guest');
      captureGuestWorkspace();
      workspaceCaptured = true;
      destroyClient();
      setCollaborationAccess(true, null);
      set({ ...idleState, status: 'joining', publicUrl: invite.publicUrl });
      document = new Y.Doc();
      installProvider({
        doc: document,
        websocketUrl: invite.websocketUrl,
        publicUrl: invite.publicUrl,
        sessionId: invite.sessionId,
        credential: invite.secret,
        displayName,
        initialRole: null,
        currentOperation,
      });
    } catch (error) {
      if (workspaceCaptured) {
        destroyClient();
        restoreGuestWorkspace();
      }
      if (operation === currentOperation) set({ ...idleState, status: 'error', error: safeError(error) });
    }
  },

  leaveSession: async () => {
    ++operation;
    const stopHost = hosted;
    settleHostPlayBeforeSessionEnd();
    hosted = false;
    destroyClient();
    restoreGuestWorkspace();
    set(idleState);
    if (stopHost) {
      try {
        await (await getPlatform()).stopCollaboration?.();
      } catch (error) {
        set({ status: 'error', error: safeError(error) });
      }
    }
  },

  setParticipantRole: (id, role) => {
    if (get().role !== 'host') return;
    provider?.setParticipantRole(id, role);
  },

  kickParticipant: (id) => {
    if (get().role !== 'host') return;
    provider?.kickParticipant(id);
  },

  updatePresence: (presence) => {
    provider?.updatePresence(presence);
    if (!selfId) return;
    presenceByParticipant.set(selfId, presence);
    set((state) => ({
      participants: state.participants.map((participant) =>
        participant.isSelf ? { ...participant, presence } : participant,
      ),
    }));
  },

  setEditingActivity: (editing) => {
    localEditingPresence = editing;
    get().updatePresence(currentPresence());
  },

  setPresenceSurface: (surface) => {
    if (localPresenceSurface === surface) return;
    localPresenceSurface = surface;
    get().updatePresence(currentPresence());
  },

  flushProjectChanges: () => binding?.flushLocalChanges(),
}));
