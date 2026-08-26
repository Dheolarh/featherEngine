import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { blankProject } from '../../project/serialize';
import { resetCollaborationAccessForTests } from '../access';
import { readProjectFromCollaborationDoc } from '../projectDocument';
import { decodeCollaborationUpdateMessage } from '../provider';

const platformMocks = vi.hoisted(() => ({
  startCollaboration: vi.fn(),
  stopCollaboration: vi.fn(),
  registerCollaborationAssets: vi.fn(),
}));

vi.mock('../../platform', () => ({
  isDesktop: true,
  getPlatform: async () => ({
    isDesktop: true,
    startCollaboration: platformMocks.startCollaboration,
    stopCollaboration: platformMocks.stopCollaboration,
    registerCollaborationAssets: platformMocks.registerCollaborationAssets,
  }),
}));

import { useCollaborationStore } from '../../store/collaborationStore';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as (event: unknown) => void]);
  }

  send(value: unknown): void {
    this.sent.push(value);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  message(data: unknown): void {
    this.emit('message', { data });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const hostInput = {
  displayName: 'Host',
  sessionName: 'Review room',
  authtoken: 'test-token-that-never-leaves-this-mock',
  defaultRole: 'editor' as const,
};

describe('collaboration host startup lifecycle', () => {
  beforeEach(async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    await useCollaborationStore.getState().leaveSession();
    resetCollaborationAccessForTests();
    FakeSocket.instances = [];
    platformMocks.startCollaboration.mockReset();
    platformMocks.stopCollaboration.mockReset();
    platformMocks.registerCollaborationAssets.mockReset();
    platformMocks.startCollaboration.mockImplementation(async (request) => ({
      localUrl: 'http://127.0.0.1:45678',
      publicUrl: 'https://collaboration.example',
      sessionId: request.sessionId,
    }));
    platformMocks.stopCollaboration.mockResolvedValue(undefined);
    platformMocks.registerCollaborationAssets.mockResolvedValue([]);
    const hostProject = blankProject('Host project');
    hostProject.scenes[0].objects.push({
      id: 'cube-one',
      name: 'Cube',
      kind: 'cube',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    useEditorStore.getState().loadProject(hostProject);
    useProjectStore.setState({
      hasProject: true,
      projectDir: null,
      projectName: 'Host project',
      busy: false,
      toast: null,
    });
    useCollaborationStore.setState({
      status: 'idle',
      role: null,
      sessionName: '',
      inviteUrl: '',
      publicUrl: '',
      participants: [],
      error: null,
      canHost: true,
    });
  });

  afterEach(async () => {
    await useCollaborationStore.getState().leaveSession();
    resetCollaborationAccessForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not stop a successfully initialized native host', async () => {
    await useCollaborationStore.getState().startSession(hostInput);

    expect(platformMocks.startCollaboration).toHaveBeenCalledOnce();
    expect(platformMocks.stopCollaboration).not.toHaveBeenCalled();
    expect(useCollaborationStore.getState()).toMatchObject({
      status: 'hosting',
      role: 'host',
      error: null,
    });

    const socket = FakeSocket.instances.at(-1)!;
    socket.open();
    socket.message(JSON.stringify({
      v: 1,
      type: 'welcome',
      sessionId: platformMocks.startCollaboration.mock.calls[0][0].sessionId,
      participant: { id: 'host-1', name: 'Host', role: 'host' },
      participants: [{ id: 'host-1', name: 'Host', role: 'host' }],
      assetToken: 'asset_0123456789abcdefghijklmnopqrstuvwxyz',
      serverTime: 1,
    }));

    expect(useCollaborationStore.getState().status).toBe('hosting');
    expect(platformMocks.stopCollaboration).not.toHaveBeenCalled();
  });

  it('publishes host transform edits after the provider welcomes the host', async () => {
    await useCollaborationStore.getState().startSession(hostInput);
    const socket = FakeSocket.instances.at(-1)!;
    socket.open();
    socket.message(JSON.stringify({
      v: 1,
      type: 'welcome',
      sessionId: platformMocks.startCollaboration.mock.calls[0][0].sessionId,
      participant: { id: 'host-1', name: 'Host', role: 'host' },
      participants: [{ id: 'host-1', name: 'Host', role: 'host' }],
      assetToken: 'asset_0123456789abcdefghijklmnopqrstuvwxyz',
      serverTime: 1,
    }));

    useEditorStore.getState().updateTransform('cube-one', 'position', [8, 1, -4]);
    await new Promise((resolve) => setTimeout(resolve, 45));

    const peer = new Y.Doc();
    for (const frame of socket.sent.filter((value): value is string => typeof value === 'string')) {
      const update = decodeCollaborationUpdateMessage(frame);
      if (update) Y.applyUpdate(peer, update);
    }
    expect(readProjectFromCollaborationDoc(peer)?.scenes[0].objects[0].transform.position).toEqual([8, 1, -4]);
  });

  it('preserves a critical startup error while closing the native host exactly once', async () => {
    platformMocks.startCollaboration.mockImplementationOnce(async (request) => ({
      localUrl: 'http://127.0.0.1:45678',
      publicUrl: 'not a valid endpoint',
      sessionId: request.sessionId,
    }));

    await useCollaborationStore.getState().startSession(hostInput);

    expect(platformMocks.stopCollaboration).toHaveBeenCalledOnce();
    expect(useCollaborationStore.getState()).toMatchObject({
      status: 'error',
      role: null,
      error: 'Could not finish creating the collaboration invite: That collaboration invite is not a valid URL.',
    });
    expect(useCollaborationStore.getState().error).not.toContain('session stopped unexpectedly');
  });

  it('keeps live editing available when optional presence tracking cannot start', async () => {
    const originalSubscribe = useEditorStore.subscribe;
    let subscriptions = 0;
    vi.spyOn(useEditorStore, 'subscribe').mockImplementation(((...args: Parameters<typeof originalSubscribe>) => {
      subscriptions += 1;
      if (subscriptions === 2) throw new Error('presence tracking failed');
      return originalSubscribe(...args);
    }) as typeof originalSubscribe);

    await useCollaborationStore.getState().startSession(hostInput);

    expect(platformMocks.stopCollaboration).not.toHaveBeenCalled();
    expect(useCollaborationStore.getState()).toMatchObject({
      status: 'hosting',
      role: 'host',
      error: null,
    });
    expect(useProjectStore.getState().toast?.message).toBe(
      'Live editing started, but presence could not be shared: presence tracking failed',
    );
  });

  it('keeps live editing available when optional asset tracking cannot start', async () => {
    const originalSubscribe = useEditorStore.subscribe;
    let subscriptions = 0;
    vi.spyOn(useEditorStore, 'subscribe').mockImplementation(((...args: Parameters<typeof originalSubscribe>) => {
      subscriptions += 1;
      if (subscriptions === 3) throw new Error('asset tracking failed');
      return originalSubscribe(...args);
    }) as typeof originalSubscribe);

    await useCollaborationStore.getState().startSession(hostInput);

    expect(platformMocks.stopCollaboration).not.toHaveBeenCalled();
    expect(useCollaborationStore.getState()).toMatchObject({
      status: 'hosting',
      role: 'host',
      error: null,
    });
    expect(useProjectStore.getState().toast?.message).toBe(
      'Live editing started, but project assets could not be shared: asset tracking failed',
    );
  });
});
