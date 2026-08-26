import { describe, expect, it } from 'vitest';
import {
  collaboratorsInBlueprint,
  collaboratorsOnGraphNode,
  collaboratorsOnObject,
  type PresenceParticipant,
} from '../presence';

function participant(
  id: string,
  presence: PresenceParticipant['presence'],
  isSelf = false,
): PresenceParticipant {
  return { id, name: id, color: '#5b8cff', presence, isSelf };
}

describe('collaboration presence targeting', () => {
  it('shows only remote collaborators selecting an object in the same scene', () => {
    const participants = [
      participant('same-scene', { activeSceneId: 'scene-a', selectedObjectId: 'cube' }),
      participant('multi-select', { activeSceneId: 'scene-a', selectedObjectIds: ['light', 'cube'] }),
      participant('other-scene', { activeSceneId: 'scene-b', selectedObjectId: 'cube' }),
      participant('self', { activeSceneId: 'scene-a', selectedObjectId: 'cube' }, true),
    ];

    expect(collaboratorsOnObject(participants, 'scene-a', 'cube').map(({ id }) => id)).toEqual([
      'same-scene',
      'multi-select',
    ]);
  });

  it('keeps a transforming collaborator visible even if selection presence arrives separately', () => {
    const moving = participant('moving', {
      activeSceneId: 'scene-a',
      editing: { kind: 'transform', targetId: 'cube', mode: 'translate' },
    });
    expect(collaboratorsOnObject([moving], 'scene-a', 'cube')).toEqual([moving]);
  });

  it('requires the same Blueprint for graph-node and same-file indicators', () => {
    const participants = [
      participant('same-node', { activeBlueprintId: 'player', selectedGraphNodeId: 'move' }),
      participant('same-file', { activeBlueprintId: 'player', selectedGraphNodeId: 'jump' }),
      participant('other-file', { activeBlueprintId: 'enemy', selectedGraphNodeId: 'move' }),
      participant('self', { activeBlueprintId: 'player', selectedGraphNodeId: 'move' }, true),
    ];

    expect(collaboratorsOnGraphNode(participants, 'player', 'move').map(({ id }) => id)).toEqual([
      'same-node',
    ]);
    expect(collaboratorsInBlueprint(participants, 'player').map(({ id }) => id)).toEqual([
      'same-node',
      'same-file',
    ]);
  });
});
