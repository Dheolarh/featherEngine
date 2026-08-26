export type CollaborationRole = 'host' | 'editor' | 'viewer';

/**
 * A tiny dependency-free policy boundary used by the editor, filesystem and history layers.
 * Keeping it outside the Zustand collaboration store avoids a collaborationStore ↔ editorStore
 * import cycle while still making the security rule synchronous at the point of mutation.
 */
let active = false;
let role: CollaborationRole | null = null;

export function setCollaborationAccess(nextActive: boolean, nextRole: CollaborationRole | null): void {
  active = nextActive;
  role = nextActive ? nextRole : null;
}

export function collaborationAccess(): { active: boolean; role: CollaborationRole | null } {
  return { active, role };
}

/** Authoring is open normally, and restricted to host/editor while a shared session is active. */
export function canEditCollaborativeProject(): boolean {
  return !active || role === 'host' || role === 'editor';
}

/** Saving, linked files and the authoritative simulation belong to the host only. */
export function canUseHostOnlyFeatures(): boolean {
  return !active || role === 'host';
}

export function resetCollaborationAccessForTests(): void {
  active = false;
  role = null;
}
