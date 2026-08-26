import * as Y from 'yjs';
import { z } from 'zod';
import type { CollaborationRole } from './access';
import { REMOTE_COLLABORATION_ORIGIN } from './projectDocument';

const protocolRoleSchema = z.enum(['host', 'editor', 'viewer']);
const participantSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(80),
  role: protocolRoleSchema,
});
const welcomeSchema = z.object({
  v: z.literal(1),
  type: z.literal('welcome'),
  sessionId: z.string(),
  participant: participantSchema,
  participants: z.array(participantSchema),
  assetToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
  serverTime: z.number(),
});
const rosterSchema = z.object({
  v: z.literal(1),
  type: z.literal('roster'),
  participants: z.array(participantSchema),
});
const collaborationEditingSchema = z.object({
  kind: z.enum(['transform', 'inspector', 'graph', 'code']),
  targetId: z.string().min(1).max(128),
  mode: z.enum(['translate', 'rotate', 'scale']).optional(),
  field: z.string().min(1).max(80).optional(),
});
const collaborationPresenceSchema = z.object({
  activeSceneId: z.string().min(1).max(128).optional(),
  selectedObjectId: z.string().min(1).max(128).optional(),
  selectedObjectIds: z.array(z.string().min(1).max(128)).max(128).optional(),
  activeBlueprintId: z.string().min(1).max(128).optional(),
  selectedGraphNodeId: z.string().min(1).max(128).optional(),
  activePanel: z.string().min(1).max(80).optional(),
  surface: z.enum(['viewport', 'inspector', 'graph', 'script']).optional(),
  editing: collaborationEditingSchema.optional(),
  lastSeenAt: z.number().finite().nonnegative().optional(),
});
const presenceSchema = z.object({
  v: z.literal(1),
  type: z.literal('presence'),
  participantId: z.string(),
  data: collaborationPresenceSchema,
});
const liveUpdateSchema = z.object({
  v: z.literal(1),
  type: z.literal('update'),
  update: z.string().max(64 * 1024 * 1024),
});
const syncRequestSchema = z.object({
  v: z.literal(1),
  type: z.literal('syncRequest'),
  participantId: z.string(),
});
const syncStateSchema = z.object({
  v: z.literal(1),
  type: z.literal('syncState'),
  update: z.string().max(64 * 1024 * 1024),
});
const errorSchema = z.object({
  v: z.literal(1),
  type: z.literal('error'),
  code: z.string(),
  message: z.string().max(500),
});

export type CollaborationEditingPresence = z.infer<typeof collaborationEditingSchema>;
export type CollaborationPresence = z.infer<typeof collaborationPresenceSchema>;

export interface ProtocolParticipant {
  id: string;
  name: string;
  role: CollaborationRole;
}

export type ProviderConnectionStatus = 'connected' | 'reconnecting' | 'error';

interface CollaborationProviderOptions {
  doc: Y.Doc;
  websocketUrl: string;
  sessionId: string;
  credential: string;
  displayName: string;
  clientId: string;
  initialRole: CollaborationRole | null;
  onStatus: (status: ProviderConnectionStatus, error?: string) => void;
  onWelcome: (self: ProtocolParticipant, participants: ProtocolParticipant[], assetToken: string) => void;
  onRoster: (participants: ProtocolParticipant[]) => void;
  onPresence: (participantId: string, presence: CollaborationPresence) => void;
  onTerminated?: (message: string) => void;
  webSocketFactory?: (url: string) => WebSocket;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

const UPDATE_PROTOCOL = 0x01;
const UPDATE_KIND = 0x01;
const MAX_BINARY_UPDATE = 32 * 1024 * 1024;
const PRESENCE_INTERVAL_MS = 100;
const CLOSE_REASON_SESSION_ENDED = 'Session ended';
const CLOSE_REASON_TUNNEL_UNAVAILABLE = 'Ngrok tunnel unavailable';
const CLOSE_REASON_RELAY_UNAVAILABLE = 'Local relay unavailable';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  if (binary.length > MAX_BINARY_UPDATE) throw new Error('Collaboration state is too large.');
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export function encodeCollaborationUpdate(update: Uint8Array): Uint8Array {
  const frame = new Uint8Array(update.length + 2);
  frame[0] = UPDATE_PROTOCOL;
  frame[1] = UPDATE_KIND;
  frame.set(update, 2);
  return frame;
}

export function decodeCollaborationUpdate(frame: ArrayBuffer | ArrayBufferView): Uint8Array | null {
  const bytes = frame instanceof Uint8Array
    ? frame
    : ArrayBuffer.isView(frame)
      ? new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)
      : new Uint8Array(frame);
  if (
    bytes.length < 3 ||
    bytes.length > MAX_BINARY_UPDATE + 2 ||
    bytes[0] !== UPDATE_PROTOCOL ||
    bytes[1] !== UPDATE_KIND
  ) return null;
  return bytes.subarray(2);
}

/** Decode the reliable JSON/base64 live-update envelope used by current clients. */
export function decodeCollaborationUpdateMessage(message: string): Uint8Array | null {
  try {
    const parsed = liveUpdateSchema.safeParse(JSON.parse(message));
    return parsed.success ? base64ToBytes(parsed.data.update) : null;
  } catch {
    return null;
  }
}

export function encodeCollaborationUpdateMessage(update: Uint8Array): string {
  return JSON.stringify({ v: 1, type: 'update', update: bytesToBase64(update) });
}

/** Small dependency-free Yjs provider for the host relay's authenticated WebSocket protocol. */
export class CollaborationWebSocketProvider {
  private socket: WebSocket | null = null;
  private destroyed = false;
  private welcomed = false;
  private selfId: string | null = null;
  private role: CollaborationRole | null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPresence: CollaborationPresence | null = null;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly random: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(private readonly options: CollaborationProviderOptions) {
    this.role = options.initialRole;
    this.socketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    options.doc.on('update', this.onDocumentUpdate);
    this.connect();
  }

  private connect = (): void => {
    if (this.destroyed) return;
    let socket: WebSocket;
    try {
      socket = this.socketFactory(this.options.websocketUrl);
    } catch {
      this.scheduleReconnect('Could not open the collaboration connection.');
      return;
    }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', this.onOpen);
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('close', this.onClose);
    socket.addEventListener('error', this.onError);
  };

  private onOpen = (): void => {
    this.welcomed = false;
    this.sendJson({
      v: 1,
      type: 'auth',
      sessionId: this.options.sessionId,
      credential: this.options.credential,
      name: this.options.displayName,
      clientId: this.options.clientId,
    });
    this.authTimer = this.setTimer(() => {
      if (!this.welcomed) this.socket?.close(4001, 'Authentication timeout');
    }, 9_000);
  };

  private onMessage = (event: MessageEvent): void => {
    if (typeof event.data === 'string') {
      this.handleText(event.data);
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      this.handleBinary(event.data);
      return;
    }
    if (ArrayBuffer.isView(event.data)) {
      this.handleBinary(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      void event.data.arrayBuffer().then((buffer) => this.handleBinary(buffer));
    }
  };

  private handleText(value: string): void {
    if (value.length > 64 * 1024 * 1024) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return;
    }

    const welcome = welcomeSchema.safeParse(parsed);
    if (welcome.success) {
      if (welcome.data.sessionId !== this.options.sessionId) {
        this.fail('The collaboration server answered for a different session.');
        return;
      }
      this.welcomed = true;
      this.selfId = welcome.data.participant.id;
      this.role = welcome.data.participant.role;
      this.reconnectAttempt = 0;
      if (this.authTimer) this.clearTimer(this.authTimer);
      this.authTimer = null;
      this.options.onWelcome(
        welcome.data.participant,
        welcome.data.participants,
        welcome.data.assetToken,
      );
      this.options.onStatus('connected');
      // Re-send the complete local state after every reconnect. Yjs merges it idempotently, so
      // edits made while either side was offline cannot disappear behind a newer connection.
      if (this.role !== 'viewer') this.sendUpdate(Y.encodeStateAsUpdate(this.options.doc));
      this.sendJson({ v: 1, type: 'syncRequest' });
      this.flushPresence();
      return;
    }

    const roster = rosterSchema.safeParse(parsed);
    if (roster.success) {
      const self = roster.data.participants.find((participant) => participant.id === this.selfId);
      if (self) this.role = self.role;
      this.options.onRoster(roster.data.participants);
      return;
    }

    const presence = presenceSchema.safeParse(parsed);
    if (presence.success) {
      this.options.onPresence(presence.data.participantId, presence.data.data);
      return;
    }

    const liveUpdate = liveUpdateSchema.safeParse(parsed);
    if (liveUpdate.success) {
      try {
        Y.applyUpdate(
          this.options.doc,
          base64ToBytes(liveUpdate.data.update),
          REMOTE_COLLABORATION_ORIGIN,
        );
      } catch {
        this.options.onStatus('error', 'A collaboration update was invalid and was ignored.');
      }
      return;
    }

    const syncRequest = syncRequestSchema.safeParse(parsed);
    if (syncRequest.success && this.role !== 'viewer') {
      this.sendJson({
        v: 1,
        type: 'syncState',
        targetId: syncRequest.data.participantId,
        update: bytesToBase64(Y.encodeStateAsUpdate(this.options.doc)),
      });
      return;
    }

    const syncState = syncStateSchema.safeParse(parsed);
    if (syncState.success) {
      try {
        Y.applyUpdate(this.options.doc, base64ToBytes(syncState.data.update), REMOTE_COLLABORATION_ORIGIN);
        // Merge edits made during a disconnect back into the authoritative host after its fallback.
        if (this.role === 'editor') this.sendUpdate(Y.encodeStateAsUpdate(this.options.doc));
      } catch {
        this.options.onStatus('error', 'The shared project state could not be decoded.');
      }
      return;
    }

    const serverError = errorSchema.safeParse(parsed);
    if (serverError.success) {
      this.options.onStatus('error', serverError.data.message || 'The collaboration server rejected the request.');
      if (
        serverError.data.code === 'kicked'
        || serverError.data.code === 'auth_failed'
        || serverError.data.code === 'superseded'
      ) {
        this.terminate(serverError.data.message || 'The collaboration session ended.');
      }
    }
  }

  private handleBinary(frame: ArrayBuffer | ArrayBufferView): void {
    const update = decodeCollaborationUpdate(frame);
    if (!update) return;
    try {
      Y.applyUpdate(this.options.doc, update, REMOTE_COLLABORATION_ORIGIN);
    } catch {
      this.options.onStatus('error', 'A collaboration update was invalid and was ignored.');
    }
  }

  private onClose = (event: CloseEvent): void => {
    this.socket = null;
    this.welcomed = false;
    if (this.authTimer) this.clearTimer(this.authTimer);
    this.authTimer = null;
    if (this.destroyed) return;
    if (event.code === 1001) {
      if (event.reason === CLOSE_REASON_TUNNEL_UNAVAILABLE) {
        this.terminate('The ngrok tunnel stopped unexpectedly. Check the host network and start a new session.');
        return;
      }
      if (event.reason === CLOSE_REASON_RELAY_UNAVAILABLE) {
        this.terminate('The host collaboration relay stopped unexpectedly. Start a new session.');
        return;
      }
      if (event.reason === CLOSE_REASON_SESSION_ENDED) {
        this.terminate(
          this.role === 'host'
            ? 'The collaboration session stopped unexpectedly.'
            : 'The host ended the collaboration session.',
        );
        return;
      }
    }
    if (event.code === 1008 || event.code === 4002) {
      this.terminate(event.reason || 'The collaboration server rejected the connection.');
      return;
    }
    this.scheduleReconnect();
  };

  private onError = (): void => {
    // `close` is the single reconnect path; surfacing both creates duplicate timers in browsers.
    if (this.socket?.readyState === 1) this.socket.close();
  };

  private scheduleReconnect(message?: string): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.options.onStatus('reconnecting', message);
    const exponential = Math.min(10_000, 500 * 2 ** this.reconnectAttempt);
    const delay = Math.round(exponential * (0.8 + this.random() * 0.4));
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 8);
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private fail(message: string): void {
    this.terminate(message, 4002, 'Protocol error');
  }

  private terminate(message: string, closeCode = 1000, closeReason = 'Session ended'): void {
    if (this.destroyed) return;
    this.options.onStatus('error', message);
    const socket = this.socket;
    this.destroy();
    if (socket && socket.readyState < 2) socket.close(closeCode, closeReason);
    this.options.onTerminated?.(message);
  }

  private onDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_COLLABORATION_ORIGIN || this.role === 'viewer') return;
    this.sendUpdate(update);
  };

  private sendUpdate(update: Uint8Array): void {
    if (!this.welcomed || !this.socket || this.socket.readyState !== 1 || this.role === 'viewer') return;
    // Initial state already uses a JSON/base64 frame successfully across WebKit, ngrok and the
    // native relay. Keep incremental edits on that same transport too. Binary input remains
    // supported for compatibility with sessions created by older builds.
    this.socket.send(encodeCollaborationUpdateMessage(update));
  }

  private sendJson(value: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(value));
  }

  updatePresence(presence: CollaborationPresence): void {
    this.pendingPresence = presence;
    if (this.presenceTimer) return;
    this.presenceTimer = this.setTimer(() => {
      this.presenceTimer = null;
      this.flushPresence();
    }, PRESENCE_INTERVAL_MS);
  }

  private flushPresence(): void {
    if (!this.pendingPresence || !this.welcomed) return;
    const data = this.pendingPresence;
    this.pendingPresence = null;
    this.sendJson({ v: 1, type: 'presence', data });
  }

  setParticipantRole(participantId: string, role: Exclude<CollaborationRole, 'host'>): void {
    if (this.role !== 'host') return;
    this.sendJson({ v: 1, type: 'setRole', participantId, role });
  }

  kickParticipant(participantId: string): void {
    if (this.role !== 'host' || participantId === this.selfId) return;
    this.sendJson({ v: 1, type: 'kick', participantId });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.doc.off('update', this.onDocumentUpdate);
    if (this.reconnectTimer) this.clearTimer(this.reconnectTimer);
    if (this.authTimer) this.clearTimer(this.authTimer);
    if (this.presenceTimer) this.clearTimer(this.presenceTimer);
    this.reconnectTimer = null;
    this.authTimer = null;
    this.presenceTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Session left');
  }
}
