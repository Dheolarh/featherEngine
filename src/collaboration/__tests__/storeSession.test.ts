import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { blankProject } from '../../project/serialize';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { useCollaborationStore } from '../../store/collaborationStore';
import { buildCollaborationInvite } from '../invite';
import { readProjectFromCollaborationDoc, writeProjectToCollaborationDoc } from '../projectDocument';
import {
  decodeCollaborationUpdateMessage,
  encodeCollaborationUpdate,
  encodeCollaborationUpdateMessage,
} from '../provider';
import { resetCollaborationAccessForTests } from '../access';

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

const invite = buildCollaborationInvite(
  'https://collaboration.example',
  'session_0123456789abcdef',
  'secret_0123456789abcdefghijklmnopqrstuvwxyz',
);

async function joinAndReceiveSharedProject(): Promise<{ socket: FakeSocket; sharedDocument: Y.Doc }> {
  await useCollaborationStore.getState().joinSession({ displayName: 'Guest', invite });
  const socket = FakeSocket.instances.at(-1)!;
  socket.open();
  socket.message(JSON.stringify({
    v: 1,
    type: 'welcome',
    sessionId: 'session_0123456789abcdef',
    participant: { id: 'guest-1', name: 'Guest', role: 'editor' },
    participants: [{ id: 'guest-1', name: 'Guest', role: 'editor' }],
    assetToken: 'asset_0123456789abcdefghijklmnopqrstuvwxyz',
    serverTime: 1,
  }));

  const shared = blankProject('Shared');
  shared.scenes[0].name = 'Shared world';
  shared.scenes[0].objects.push({
    id: 'cube-one',
    name: 'Cube',
    kind: 'cube',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  });
  const sharedDocument = new Y.Doc();
  writeProjectToCollaborationDoc(sharedDocument, shared);
  const frame = encodeCollaborationUpdate(Y.encodeStateAsUpdate(sharedDocument));
  socket.message(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { socket, sharedDocument };
}

describe('collaboration guest workspace isolation', () => {
  beforeEach(async () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    await useCollaborationStore.getState().leaveSession();
    resetCollaborationAccessForTests();

    const local = blankProject('Local');
    local.scenes[0].name = 'Private local world';
    local.assets.push({
      id: 'private-image',
      name: 'private.png',
      type: 'image',
      size: 64,
      path: 'assets/private.png',
      url: 'blob:private-local-asset',
      createdAt: 1,
    });
    useEditorStore.getState().loadProject(local);
    useEditorStore.setState({ isDirty: true });
    useProjectStore.setState({
      hasProject: true,
      projectDir: '/projects/private-local',
      projectName: 'Local',
      busy: false,
    });
  });

  afterEach(async () => {
    await useCollaborationStore.getState().leaveSession();
    resetCollaborationAccessForTests();
    vi.unstubAllGlobals();
  });

  it('restores the exact local workspace after a normal leave', async () => {
    await joinAndReceiveSharedProject();
    expect(useEditorStore.getState().scenes[0].name).toBe('Shared world');

    await useCollaborationStore.getState().leaveSession();

    expect(useEditorStore.getState().scenes[0].name).toBe('Private local world');
    expect(useEditorStore.getState().assets[0].url).toBe('blob:private-local-asset');
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState()).toMatchObject({
      hasProject: true,
      projectDir: '/projects/private-local',
      projectName: 'Local',
    });
  });

  it('restores the local workspace when the host removes the guest', async () => {
    const { socket } = await joinAndReceiveSharedProject();
    socket.message(JSON.stringify({
      v: 1,
      type: 'error',
      code: 'kicked',
      message: 'You were removed from this session.',
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useCollaborationStore.getState()).toMatchObject({
      status: 'error',
      role: null,
      error: 'You were removed from this session.',
    });
    expect(useEditorStore.getState().scenes[0].name).toBe('Private local world');
    expect(useProjectStore.getState().projectDir).toBe('/projects/private-local');
  });

  it('replicates transforms guest-to-host and host-to-guest without a remote echo', async () => {
    const { socket, sharedDocument } = await joinAndReceiveSharedProject();
    const updateMessages = () => socket.sent
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => decodeCollaborationUpdateMessage(value) !== null);

    const beforeGuestEdit = updateMessages().length;
    useEditorStore.getState().updateTransform('cube-one', 'position', [6, 2, -3]);
    await new Promise((resolve) => setTimeout(resolve, 45));

    const guestUpdate = decodeCollaborationUpdateMessage(updateMessages().at(-1)!);
    expect(guestUpdate).not.toBeNull();
    Y.applyUpdate(sharedDocument, guestUpdate!);
    expect(readProjectFromCollaborationDoc(sharedDocument)?.scenes[0].objects[0].transform.position).toEqual([6, 2, -3]);
    expect(updateMessages().length).toBeGreaterThan(beforeGuestEdit);

    const vectorBeforeHostEdit = Y.encodeStateVector(sharedDocument);
    const hostProject = readProjectFromCollaborationDoc(sharedDocument)!;
    hostProject.scenes[0].objects[0].transform.scale = [2, 3, 4];
    writeProjectToCollaborationDoc(sharedDocument, hostProject);
    const hostUpdate = Y.encodeStateAsUpdate(sharedDocument, vectorBeforeHostEdit);
    const hostFrame = encodeCollaborationUpdateMessage(hostUpdate);
    const beforeHostFrame = updateMessages().length;
    socket.message(hostFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      useEditorStore.getState().scenes[0].objects.find((object) => object.id === 'cube-one')?.transform.scale,
    ).toEqual([2, 3, 4]);
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(updateMessages().length).toBe(beforeHostFrame);
  });

  it('re-publishes local presence for newcomers and removes departed presence', async () => {
    const { socket } = await joinAndReceiveSharedProject();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const presenceMessages = () => socket.sent
      .filter((value): value is string => typeof value === 'string')
      .map((value) => JSON.parse(value) as { type?: string; data?: Record<string, unknown> })
      .filter((value) => value.type === 'presence');
    const beforeRoster = presenceMessages().length;

    const rosterWithNewcomer = {
      v: 1,
      type: 'roster',
      participants: [
        { id: 'guest-1', name: 'Guest', role: 'editor' },
        { id: 'guest-2', name: 'Alex', role: 'editor' },
      ],
    };
    socket.message(JSON.stringify(rosterWithNewcomer));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(presenceMessages().length).toBeGreaterThan(beforeRoster);
    expect(presenceMessages().at(-1)?.data).toMatchObject({ activeSceneId: 'scene-main' });

    socket.message(JSON.stringify({
      v: 1,
      type: 'presence',
      participantId: 'guest-2',
      data: { activeSceneId: 'scene-main', selectedObjectId: 'cube-one' },
    }));
    expect(useCollaborationStore.getState().participants.find(({ id }) => id === 'guest-2')?.presence)
      .toMatchObject({ selectedObjectId: 'cube-one' });

    socket.message(JSON.stringify({
      ...rosterWithNewcomer,
      participants: [{ id: 'guest-1', name: 'Guest', role: 'editor' }],
    }));
    socket.message(JSON.stringify(rosterWithNewcomer));
    expect(useCollaborationStore.getState().participants.find(({ id }) => id === 'guest-2')?.presence).toEqual({});
  });
});
