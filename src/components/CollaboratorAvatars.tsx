import type { CSSProperties } from 'react';
import type { PresenceParticipant } from '../collaboration/presence';

export function CollaboratorAvatars({
  participants,
  label,
  compact = false,
}: {
  participants: readonly PresenceParticipant[];
  label?: string;
  compact?: boolean;
}) {
  if (participants.length === 0) return null;
  const names = participants.map((participant) => participant.name).join(', ');
  const title = label ? `${names} ${label}` : names;
  const visible = participants.slice(0, 3);
  return (
    <span
      className={`collaborator-avatars${compact ? ' is-compact' : ''}`}
      title={title}
      aria-label={title}
      data-testid="collaborator-avatars"
    >
      {visible.map((participant) => (
        <span
          key={participant.id}
          className="collaborator-avatar"
          style={{ '--participant-color': participant.color } as CSSProperties}
          aria-hidden
        >
          {participant.name.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
      ))}
      {participants.length > visible.length && (
        <span className="collaborator-avatar is-overflow" aria-hidden>
          +{participants.length - visible.length}
        </span>
      )}
    </span>
  );
}
