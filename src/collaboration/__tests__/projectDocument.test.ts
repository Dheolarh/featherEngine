import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blankProject } from '../../project/serialize';
import {
  CollaborationProjectBinding,
  REMOTE_COLLABORATION_ORIGIN,
  readProjectFromCollaborationDoc,
  sanitizeProjectForCollaboration,
  writeProjectToCollaborationDoc,
} from '../projectDocument';
import { useEditorStore } from '../../store/editorStore';
import { resetCollaborationAccessForTests, setCollaborationAccess } from '../access';

function exchange(left: Y.Doc, right: Y.Doc): void {
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
}

describe('collaboration project document', () => {
  it('never projects machine-local paths, URLs, linked files or React Flow selection', () => {
    const project = blankProject('Safe');
    project.assets.push({
      id: 'asset-one',
      name: 'mesh.glb',
      type: 'model',
      size: 42,
      hash: 'a'.repeat(64),
      path: 'assets/mesh.glb',
      url: 'asset://localhost/private/path',
      source: { url: 'https://private.invalid/mesh.glb', sha256: 'a'.repeat(64) },
      createdAt: 1,
    });
    project.blueprints.push({
      id: 'bp-one', name: 'Move', description: '', graphId: 'graph-one', color: '#fff',
      featherSource: 'blueprint Move {}', featherSourcePath: 'scripts/private.feather', createdAt: 1,
    });
    project.graphs.push({
      id: 'graph-one', name: 'Move',
      nodes: [{
        id: 'node-one', type: 'nodeforge', position: { x: 0, y: 0 }, selected: true,
        data: { label: 'Start', category: 'Events', nodeKind: 'event.start', description: '', tone: 'event' },
      }],
      edges: [],
    });

    const clean = sanitizeProjectForCollaboration(project);
    expect(clean.assets[0]).toMatchObject({ name: 'mesh.glb', hash: 'a'.repeat(64) });
    expect(clean.assets[0]).not.toHaveProperty('path');
    expect(clean.assets[0]).not.toHaveProperty('url');
    expect(clean.assets[0]).not.toHaveProperty('source');
    expect(clean.blueprints[0]).not.toHaveProperty('featherSourcePath');
    expect(clean.graphs[0].nodes[0]).not.toHaveProperty('selected');
  });

  it('merges concurrent edits to different fields of one scene', () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    const initial = blankProject('Merge');
    writeProjectToCollaborationDoc(left, initial);
    exchange(left, right);

    const leftEdit = structuredClone(initial);
    leftEdit.scenes[0].name = 'The Atrium';
    writeProjectToCollaborationDoc(left, leftEdit);

    const rightEdit = structuredClone(initial);
    rightEdit.scenes[0].ambientSoundId = 'asset-wind';
    writeProjectToCollaborationDoc(right, rightEdit);
    exchange(left, right);

    expect(readProjectFromCollaborationDoc(left)?.scenes[0]).toMatchObject({
      id: 'scene-main', name: 'The Atrium', ambientSoundId: 'asset-wind',
    });
    expect(readProjectFromCollaborationDoc(right)).toEqual(readProjectFromCollaborationDoc(left));
  });

  it('uses Y.Text so concurrent FeatherScript insertions both survive', () => {
    const initial = blankProject('Scripts');
    initial.blueprints.push({
      id: 'bp-one', name: 'Logic', description: '', graphId: 'graph-one', color: '#fff',
      featherSource: 'blueprint Logic {}', createdAt: 1,
    });
    initial.graphs.push({ id: 'graph-one', name: 'Logic', nodes: [], edges: [] });
    const left = new Y.Doc();
    const right = new Y.Doc();
    writeProjectToCollaborationDoc(left, initial);
    exchange(left, right);

    const leftEdit = structuredClone(initial);
    leftEdit.blueprints[0].featherSource = `// left\n${initial.blueprints[0].featherSource}`;
    writeProjectToCollaborationDoc(left, leftEdit);
    const rightEdit = structuredClone(initial);
    rightEdit.blueprints[0].featherSource = `${initial.blueprints[0].featherSource}\n// right`;
    writeProjectToCollaborationDoc(right, rightEdit);
    exchange(left, right);

    const source = readProjectFromCollaborationDoc(left)?.blueprints[0].featherSource;
    expect(source).toContain('// left');
    expect(source).toContain('// right');
    expect(readProjectFromCollaborationDoc(right)?.blueprints[0].featherSource).toBe(source);
  });

  it('keeps concurrent transform tuple replacements atomic and valid', () => {
    const initial = blankProject('Transforms');
    initial.scenes[0].objects.push({
      id: 'cube-one',
      name: 'Cube',
      kind: 'cube',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    });
    const left = new Y.Doc();
    const right = new Y.Doc();
    writeProjectToCollaborationDoc(left, initial);
    exchange(left, right);

    const leftEdit = structuredClone(initial);
    leftEdit.scenes[0].objects[0].transform.position = [1, 2, 3];
    writeProjectToCollaborationDoc(left, leftEdit);
    const rightEdit = structuredClone(initial);
    rightEdit.scenes[0].objects[0].transform.position = [4, 5, 6];
    writeProjectToCollaborationDoc(right, rightEdit);
    exchange(left, right);

    const leftPosition = readProjectFromCollaborationDoc(left)?.scenes[0].objects[0].transform.position;
    const rightPosition = readProjectFromCollaborationDoc(right)?.scenes[0].objects[0].transform.position;
    expect(leftPosition).toEqual(rightPosition);
    expect(leftPosition).toHaveLength(3);
    expect([[1, 2, 3], [4, 5, 6]]).toContainEqual(leftPosition);
  });

  it('defers collaborator edits during host Play and applies them immediately after Stop', async () => {
    const initial = blankProject('Play merge');
    useEditorStore.getState().loadProject(initial);
    useEditorStore.setState({ isPlaying: false });
    setCollaborationAccess(true, 'host');
    const doc = new Y.Doc();
    writeProjectToCollaborationDoc(doc, initial);
    const binding = new CollaborationProjectBinding(doc, { manageUndo: false });
    try {
      useEditorStore.setState({ isPlaying: true });
      const remote = structuredClone(initial);
      remote.scenes[0].name = 'Edited while host was playing';
      writeProjectToCollaborationDoc(doc, remote, REMOTE_COLLABORATION_ORIGIN);
      await Promise.resolve();
      expect(useEditorStore.getState().scenes[0].name).toBe('Main');

      useEditorStore.setState({ isPlaying: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useEditorStore.getState().scenes[0].name).toBe('Edited while host was playing');
    } finally {
      binding.destroy();
      resetCollaborationAccessForTests();
    }
  });
});
