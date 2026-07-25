import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { useEditorStore } from '../editorStore';
import { initRapier, getActivePhysics } from '../../runtime/physicsWorld';
import { foliageInteractorUniforms } from '../../three/foliageInteractors';

/**
 * Foliage interaction gather (tickRuntime) — the shared list the grass/flower shaders read to part &
 * flatten around actors. Characters/vehicles ALWAYS interact; when physics is enabled, moving rigid
 * bodies (dynamic/kinematic) must interact too, while static (fixed) scenery must NOT steal a slot.
 */
describe('foliage interactor gather', () => {
  beforeAll(async () => {
    await initRapier();
  });

  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it('includes the player AND moving physics bodies, but not fixed scenery', async () => {
    const sceneId = useEditorStore.getState().createScene('Foliage Interactors');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();

    // Fixed ground (must NOT count) + a player character + a loose dynamic ball (must count).
    store.createObjectWithProps('plane', { position: [0, 0, 0], physics: { enabled: true, bodyType: 'fixed' } });
    const playerId = store.createObjectWithProps('capsule', { position: [0, 1, 0] });
    store.toggleCharacterController(playerId);
    store.createObjectWithProps('sphere', {
      position: [2, 1, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere' },
    });

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // startPhysics activates in a microtask
    expect(getActivePhysics()).toBeTruthy();
    for (let i = 0; i < 3; i += 1) useEditorStore.getState().tickRuntime(1 / 60);

    // Player (character) + dynamic ball = 2 interactors; the fixed ground is excluded.
    expect(foliageInteractorUniforms.uInteractorCount.value).toBe(2);

    // Stop clears the list so a static scene shows no phantom bending.
    useEditorStore.getState().setPlaying(false);
    expect(foliageInteractorUniforms.uInteractorCount.value).toBe(0);
  });

  it('caps at 8 slots, keeping characters plus the nearest bodies', async () => {
    const sceneId = useEditorStore.getState().createScene('Foliage Interactor Cap');
    useEditorStore.getState().setActiveScene(sceneId);
    const store = useEditorStore.getState();

    store.createObjectWithProps('plane', { position: [0, 0, 0], physics: { enabled: true, bodyType: 'fixed' } });
    const playerId = store.createObjectWithProps('capsule', { position: [0, 1, 0] });
    store.toggleCharacterController(playerId);
    // 12 dynamic bodies at increasing distance — only the 7 nearest should fill the remaining slots.
    for (let i = 0; i < 12; i += 1) {
      store.createObjectWithProps('sphere', {
        position: [3 + i * 2, 1, 0],
        physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere' },
      });
    }

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 3; i += 1) useEditorStore.getState().tickRuntime(1 / 60);

    // 1 character + 7 nearest bodies = the 8-slot cap, never more.
    expect(foliageInteractorUniforms.uInteractorCount.value).toBe(8);
  });
});
