import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canEditCollaborativeProject,
  canUseHostOnlyFeatures,
  resetCollaborationAccessForTests,
  setCollaborationAccess,
} from '../access';
import * as Y from 'yjs';
import {
  CollaborationWebSocketProvider,
  decodeCollaborationUpdate,
  decodeCollaborationUpdateMessage,
  encodeCollaborationUpdate,
  encodeCollaborationUpdateMessage,
} from '../provider';

afterEach(() => {
  resetCollaborationAccessForTests();
  vi.unstubAllGlobals();
});

describe('collaboration roles and update protocol', () => {
  it('allows editors to author but reserves save/play/filesystem work for the host', () => {
    setCollaborationAccess(true, 'editor');
    expect(canEditCollaborativeProject()).toBe(true);
    expect(canUseHostOnlyFeatures()).toBe(false);
    setCollaborationAccess(true, 'viewer');
    expect(canEditCollaborativeProject()).toBe(false);
    expect(canUseHostOnlyFeatures()).toBe(false);
    setCollaborationAccess(true, 'host');
    expect(canEditCollaborativeProject()).toBe(true);
    expect(canUseHostOnlyFeatures()).toBe(true);
  });

  it('keeps backward-compatible binary framing strict', () => {
    const update = new Uint8Array([3, 1, 4, 1, 5]);
    expect(decodeCollaborationUpdate(encodeCollaborationUpdate(update))).toEqual(update);
    expect(decodeCollaborationUpdate(new Uint8Array([2, 1, 3]))).toBeNull();
    expect(decodeCollaborationUpdate(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('round-trips current live updates through the reliable text envelope', () => {
    const update = new Uint8Array([8, 5, 3, 2, 1]);
    expect(decodeCollaborationUpdateMessage(encodeCollaborationUpdateMessage(update))).toEqual(update);
    expect(decodeCollaborationUpdateMessage('{"v":1,"type":"update","update":"not base64!"}')).toBeNull();
  });

  it('binds native Window timers before using them as provider callbacks', () => {
    const timerReceivers: unknown[] = [];
    const brandedSetTimer = function (this: unknown) {
      timerReceivers.push(this);
      if (this !== globalThis) throw new TypeError('Timer receiver must be Window');
      return 1 as unknown as ReturnType<typeof setTimeout>;
    } as unknown as typeof setTimeout;
    const brandedClearTimer = function (this: unknown) {
      timerReceivers.push(this);
      if (this !== globalThis) throw new TypeError('Timer receiver must be Window');
    } as typeof clearTimeout;
    vi.stubGlobal('setTimeout', brandedSetTimer);
    vi.stubGlobal('clearTimeout', brandedClearTimer);

    class FakeSocket {
      readyState = 0;
      binaryType = '';
      private readonly listeners = new Map<string, Array<(event: never) => void>>();
      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as (event: never) => void]);
      }
      send() { /* transport payload is irrelevant to the timer receiver regression */ }
      close() { this.readyState = 3; }
      open() {
        this.readyState = 1;
        for (const listener of this.listeners.get('open') ?? []) listener({} as never);
      }
    }

    const socket = new FakeSocket();
    const provider = new CollaborationWebSocketProvider({
      doc: new Y.Doc(),
      websocketUrl: 'wss://example.test/collaboration/ws',
      sessionId: 'session_0123456789',
      credential: 'secret_0123456789abcdefghijklmnopqrstuvwxyz',
      displayName: 'Firefox',
      clientId: 'firefox-client-1',
      initialRole: 'editor',
      onStatus: () => undefined,
      onWelcome: () => undefined,
      onRoster: () => undefined,
      onPresence: () => undefined,
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    expect(() => socket.open()).not.toThrow();
    expect(() => provider.updatePresence({ activeSceneId: 'scene-main' })).not.toThrow();
    expect(() => provider.destroy()).not.toThrow();
    expect(timerReceivers.length).toBeGreaterThanOrEqual(4);
    expect(timerReceivers.every((receiver) => receiver === globalThis)).toBe(true);
  });

  it('authenticates, publishes Yjs updates and replays offline edits after reconnect', () => {
    class FakeSocket {
      readyState = 0;
      binaryType = '';
      sent: unknown[] = [];
      listeners = new Map<string, Array<(event: never) => void>>();
      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as (event: never) => void]);
      }
      send(value: unknown) { this.sent.push(value); }
      close(code = 1000, reason = '') { this.readyState = 3; this.emit('close', { code, reason }); }
      emit(type: string, event: unknown) {
        for (const listener of this.listeners.get(type) ?? []) listener(event as never);
      }
      open() { this.readyState = 1; this.emit('open', {}); }
      message(data: unknown) { this.emit('message', { data }); }
    }

    const sockets: FakeSocket[] = [];
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const statuses: string[] = [];
    const terminations: string[] = [];
    const doc = new Y.Doc();
    const provider = new CollaborationWebSocketProvider({
      doc,
      websocketUrl: 'wss://example.test/collaboration/ws',
      sessionId: 'session_0123456789',
      credential: 'secret_0123456789abcdefghijklmnopqrstuvwxyz',
      displayName: 'Ada',
      clientId: 'client_0123456789',
      initialRole: 'editor',
      onStatus: (status) => statuses.push(status),
      onWelcome: () => undefined,
      onRoster: () => undefined,
      onPresence: () => undefined,
      onTerminated: (message) => terminations.push(message),
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      random: () => 0.5,
      setTimer: ((callback: () => void) => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      }) as typeof setTimeout,
      clearTimer: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout,
    });

    sockets[0].open();
    expect(JSON.parse(sockets[0].sent[0] as string)).toMatchObject({ type: 'auth', name: 'Ada' });
    sockets[0].message(JSON.stringify({
      v: 1,
      type: 'welcome',
      sessionId: 'session_0123456789',
      participant: { id: 'p1', name: 'Ada', role: 'editor' },
      participants: [{ id: 'p1', name: 'Ada', role: 'editor' }],
      assetToken: 'asset_0123456789abcdefghijklmnopqrstuvwxyz',
      serverTime: 1,
    }));
    doc.getMap('test').set('value', 42);
    expect(sockets[0].sent.some(
      (value) => typeof value === 'string' && decodeCollaborationUpdateMessage(value) !== null,
    )).toBe(true);

    sockets[0].close();
    doc.getMap('test').set('offlineValue', 99);
    expect(statuses).toContain('reconnecting');
    const reconnect = [...timers.values()].at(-1);
    expect(reconnect).toBeTypeOf('function');
    reconnect?.();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].message(JSON.stringify({
      v: 1,
      type: 'welcome',
      sessionId: 'session_0123456789',
      participant: { id: 'p2', name: 'Ada', role: 'editor' },
      participants: [{ id: 'p2', name: 'Ada', role: 'editor' }],
      assetToken: 'asset_0123456789abcdefghijklmnopqrstuvwxyz',
      serverTime: 2,
    }));
    const replayFrame = sockets[1].sent.find(
      (value): value is string => typeof value === 'string' && decodeCollaborationUpdateMessage(value) !== null,
    )!;
    const replayUpdate = decodeCollaborationUpdateMessage(replayFrame);
    const replayed = new Y.Doc();
    expect(replayUpdate).not.toBeNull();
    Y.applyUpdate(replayed, replayUpdate!);
    expect(replayed.getMap('test').get('offlineValue')).toBe(99);
    sockets[1].close(1001, 'Session ended');
    expect(terminations).toEqual(['The host ended the collaboration session.']);
    provider.destroy();
  });

  it('reports an ngrok forwarding failure without claiming that the host ended the session', () => {
    class FakeSocket {
      readyState = 0;
      binaryType = '';
      private readonly listeners = new Map<string, Array<(event: never) => void>>();
      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as (event: never) => void]);
      }
      send() { /* protocol output is irrelevant to this close-reason regression */ }
      close(code = 1000, reason = '') {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.emit('close', { code, reason });
      }
      emit(type: string, event: unknown) {
        for (const listener of this.listeners.get(type) ?? []) listener(event as never);
      }
    }

    const socket = new FakeSocket();
    const terminations: string[] = [];
    const provider = new CollaborationWebSocketProvider({
      doc: new Y.Doc(),
      websocketUrl: 'ws://127.0.0.1:45678/collaboration/ws',
      sessionId: 'session_0123456789',
      credential: 'secret_0123456789abcdefghijklmnopqrstuvwxyz',
      displayName: 'Host',
      clientId: 'client_0123456789',
      initialRole: 'host',
      onStatus: () => undefined,
      onWelcome: () => undefined,
      onRoster: () => undefined,
      onPresence: () => undefined,
      onTerminated: (message) => terminations.push(message),
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    socket.close(1001, 'Ngrok tunnel unavailable');
    expect(terminations).toEqual([
      'The ngrok tunnel stopped unexpectedly. Check the host network and start a new session.',
    ]);
    expect(terminations[0]).not.toContain('host ended');
    provider.destroy();
  });
});
