import type { CollaborationPresence } from './provider';

export interface PresenceParticipant {
  id: string;
  name: string;
  color: string;
  presence: CollaborationPresence;
  isSelf: boolean;
}

function selectedObjectIds(presence: CollaborationPresence): string[] {
  const ids = presence.selectedObjectIds ?? [];
  return presence.selectedObjectId && !ids.includes(presence.selectedObjectId)
    ? [...ids, presence.selectedObjectId]
    : ids;
}

/** Remote collaborators visibly working on an object in the same scene as this editor. */
export function collaboratorsOnObject<T extends PresenceParticipant>(
  participants: readonly T[],
  activeSceneId: string,
  objectId: string,
): T[] {
  return participants.filter((participant) =>
    !participant.isSelf
    && participant.presence.activeSceneId === activeSceneId
    && (
      selectedObjectIds(participant.presence).includes(objectId)
      || (
        participant.presence.editing?.kind === 'transform'
        && participant.presence.editing.targetId === objectId
      )
    ),
  );
}

/** Remote collaborators looking at a particular node in the same Blueprint file. */
export function collaboratorsOnGraphNode<T extends PresenceParticipant>(
  participants: readonly T[],
  activeBlueprintId: string | undefined,
  nodeId: string,
): T[] {
  if (!activeBlueprintId) return [];
  return participants.filter((participant) =>
    !participant.isSelf
    && participant.presence.activeBlueprintId === activeBlueprintId
    && (
      participant.presence.selectedGraphNodeId === nodeId
      || (
        participant.presence.editing?.kind === 'graph'
        && participant.presence.editing.targetId === nodeId
      )
    ),
  );
}

/** Remote collaborators with the same Blueprint open, regardless of Visual/Code surface. */
export function collaboratorsInBlueprint<T extends PresenceParticipant>(
  participants: readonly T[],
  activeBlueprintId: string | undefined,
): T[] {
  if (!activeBlueprintId) return [];
  return participants.filter((participant) =>
    !participant.isSelf && participant.presence.activeBlueprintId === activeBlueprintId,
  );
}
