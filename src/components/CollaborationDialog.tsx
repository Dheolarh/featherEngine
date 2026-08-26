import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  LogOut,
  Radio,
  ShieldCheck,
  Square,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { useCollaborationStore } from '../store/collaborationStore';

type SetupTab = 'start' | 'join';
type GuestRole = 'editor' | 'viewer';

const BUSY_STATUSES = new Set(['starting', 'joining']);
const SESSION_STATUSES = new Set(['starting', 'hosting', 'joining', 'connected', 'reconnecting']);

const statusCopy = {
  idle: { label: 'Offline', hint: 'Not in a live session.' },
  starting: { label: 'Starting', hint: 'Opening a secure ngrok tunnel from this computer…' },
  hosting: { label: 'Hosting', hint: 'This computer is the session host.' },
  joining: { label: 'Joining', hint: 'Connecting to the host…' },
  connected: { label: 'Connected', hint: 'Changes are syncing live.' },
  reconnecting: { label: 'Reconnecting', hint: 'The connection dropped. Retrying automatically…' },
  error: { label: 'Connection error', hint: 'The session could not connect.' },
} as const;

function titleCase(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function participantPresenceLabel(presence: {
  activeSceneId?: string;
  selectedObjectId?: string;
  activePanel?: string;
  lastSeenAt?: number;
} | undefined) {
  if (presence?.activePanel) return `In ${titleCase(presence.activePanel.replace(/[-_]/g, ' '))}`;
  if (presence?.activeSceneId) return 'In the scene';
  return 'In the editor';
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden'));
}

export function CollaborationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useCollaborationStore((state) => state.status);
  const role = useCollaborationStore((state) => state.role);
  const activeSessionName = useCollaborationStore((state) => state.sessionName);
  const inviteUrl = useCollaborationStore((state) => state.inviteUrl);
  const publicUrl = useCollaborationStore((state) => state.publicUrl);
  const participants = useCollaborationStore((state) => state.participants);
  const error = useCollaborationStore((state) => state.error);
  const canHost = useCollaborationStore((state) => state.canHost);
  const startSession = useCollaborationStore((state) => state.startSession);
  const joinSession = useCollaborationStore((state) => state.joinSession);
  const leaveSession = useCollaborationStore((state) => state.leaveSession);
  const setParticipantRole = useCollaborationStore((state) => state.setParticipantRole);
  const kickParticipant = useCollaborationStore((state) => state.kickParticipant);

  const [tab, setTab] = useState<SetupTab>('start');
  const [displayName, setDisplayName] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [authtoken, setAuthtoken] = useState('');
  const [defaultRole, setDefaultRole] = useState<GuestRole>('editor');
  const [domain, setDomain] = useState('');
  const [invite, setInvite] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [kickConfirmId, setKickConfirmId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const copyResetRef = useRef<number | null>(null);

  const hasSession = SESSION_STATUSES.has(status) || (status === 'error' && role !== null);
  const isBusy = BUSY_STATUSES.has(status);
  const isHost = role === 'host';
  const currentStatus = statusCopy[status];
  const sortedParticipants = useMemo(
    () => [...participants].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name)),
    [participants],
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !hasSession) return;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-session-focus="true"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, hasSession]);

  useEffect(() => () => {
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
  }, []);

  useEffect(() => {
    if (open) return;
    // The ngrok credential never leaves component memory except for the explicit start request.
    setAuthtoken('');
    setCopyState('idle');
    setKickConfirmId(null);
  }, [open]);

  if (!open) return null;

  const close = () => {
    setAuthtoken('');
    onClose();
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitStart = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = displayName.trim();
    const cleanSession = sessionName.trim();
    const cleanToken = authtoken.trim();
    if (!cleanName || !cleanSession || !cleanToken || !canHost || isBusy) return;
    const request = startSession({
      displayName: cleanName,
      sessionName: cleanSession,
      authtoken: cleanToken,
      defaultRole,
      domain: domain.trim() || undefined,
    });
    void Promise.resolve(request).then(() => setAuthtoken('')).catch(() => undefined);
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = displayName.trim();
    const cleanInvite = invite.trim();
    if (!cleanName || !cleanInvite || isBusy) return;
    void Promise.resolve(joinSession({ displayName: cleanName, invite: cleanInvite })).catch(() => undefined);
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState('idle'), 1800);
  };

  return createPortal(
    <div
      className="collaboration-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
      data-testid="collaboration-backdrop"
    >
      <div
        ref={dialogRef}
        className="collaboration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaboration-title"
        aria-describedby="collaboration-description"
        data-testid="collaboration-dialog"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="collaboration-dialog__header">
          <div className="collaboration-dialog__mark" aria-hidden>
            <Users size={18} />
          </div>
          <div>
            <h2 id="collaboration-title">Live collaboration</h2>
            <p id="collaboration-description">Build the same world together, from each person’s computer.</p>
          </div>
          <button className="collaboration-dialog__close" type="button" onClick={close} aria-label="Close collaboration dialog" title="Close (Esc)">
            <X size={16} aria-hidden />
          </button>
        </header>

        {hasSession ? (
          <div className="collaboration-session" data-testid="collaboration-session">
            <div
              className={`collaboration-session__hero collaboration-status--${status}`}
              tabIndex={-1}
              data-session-focus="true"
              role="status"
            >
              <span className="collaboration-status-dot" aria-hidden />
              <div>
                <span className="collaboration-eyebrow">{currentStatus.label}</span>
                <h3>{activeSessionName || (isHost ? 'Your live session' : 'Live session')}</h3>
                <p>{currentStatus.hint}</p>
              </div>
              {isBusy && <LoaderCircle className="collaboration-spin" size={20} aria-hidden />}
              {!isBusy && isHost && <ShieldCheck size={21} aria-label="You are the host" />}
            </div>

            {status === 'reconnecting' && (
              <div className="collaboration-notice is-warning" role="status">
                <Radio size={15} aria-hidden />
                Your edits stay local while Feather reconnects.
              </div>
            )}

            {isHost && inviteUrl && (
              <section className="collaboration-section" aria-labelledby="collaboration-invite-heading">
                <div className="collaboration-section__heading">
                  <div>
                    <h4 id="collaboration-invite-heading">Invite your team</h4>
                    <p>Anyone with this private link can join with the default guest role.</p>
                  </div>
                </div>
                <div className="collaboration-copy-field">
                  <Link2 size={15} aria-hidden />
                  <input value={inviteUrl} readOnly aria-label="Collaboration invite link" data-testid="collaboration-invite-url" />
                  <button type="button" onClick={() => void copyInvite()} data-testid="collaboration-copy-invite">
                    {copyState === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                    {copyState === 'copied' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <span className={`collaboration-copy-feedback ${copyState === 'error' ? 'is-error' : ''}`} aria-live="polite">
                  {copyState === 'error' ? 'Could not copy. Select the link and copy it manually.' : copyState === 'copied' ? 'Invite copied to clipboard.' : ''}
                </span>
                {publicUrl && (
                  <a className="collaboration-public-link" href={publicUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} aria-hidden />
                    Secure endpoint: {publicUrl}
                  </a>
                )}
              </section>
            )}

            <section className="collaboration-section collaboration-roster" aria-labelledby="collaboration-people-heading" data-testid="collaboration-roster">
              <div className="collaboration-section__heading">
                <div>
                  <h4 id="collaboration-people-heading">People</h4>
                  <p>{participants.length} {participants.length === 1 ? 'person' : 'people'} in this session</p>
                </div>
                <span className="collaboration-live-chip"><Radio size={12} aria-hidden /> Live</span>
              </div>
              <ul>
                {sortedParticipants.map((participant) => {
                  const confirmingKick = kickConfirmId === participant.id;
                  const canManage = isHost && !participant.isSelf && participant.role !== 'host';
                  return (
                    <li key={participant.id} data-testid={`collaboration-participant-${participant.id}`}>
                      <span className="collaboration-avatar" style={{ '--participant-color': participant.color } as CSSProperties} aria-hidden>
                        {participant.name.trim().slice(0, 1).toUpperCase() || '?'}
                      </span>
                      <span className="collaboration-person">
                        <strong>{participant.name}{participant.isSelf ? ' (you)' : ''}</strong>
                        <small>{participantPresenceLabel(participant.presence)}</small>
                      </span>
                      {canManage ? (
                        <select
                          className="collaboration-role-select"
                          value={participant.role}
                          onChange={(event) => setParticipantRole(participant.id, event.target.value as GuestRole)}
                          aria-label={`Role for ${participant.name}`}
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span className={`collaboration-role-badge is-${participant.role}`}>{titleCase(participant.role)}</span>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          className={`collaboration-kick ${confirmingKick ? 'is-confirming' : ''}`}
                          onClick={() => {
                            if (confirmingKick) {
                              kickParticipant(participant.id);
                              setKickConfirmId(null);
                            } else {
                              setKickConfirmId(participant.id);
                            }
                          }}
                          onBlur={() => setKickConfirmId((current) => current === participant.id ? null : current)}
                          aria-label={confirmingKick ? `Confirm remove ${participant.name}` : `Remove ${participant.name} from session`}
                          title={confirmingKick ? 'Click again to confirm' : 'Remove from session'}
                        >
                          <UserMinus size={14} aria-hidden />
                          {confirmingKick && <span>Confirm</span>}
                        </button>
                      )}
                    </li>
                  );
                })}
                {participants.length === 0 && (
                  <li className="collaboration-roster__empty">Waiting for people to connect…</li>
                )}
              </ul>
            </section>

            <div className="collaboration-host-note">
              <ShieldCheck size={16} aria-hidden />
              <div>
                <strong>{isHost ? 'You control the simulation' : 'The host controls Play and Save'}</strong>
                <span>{isHost ? 'Guests edit live, while Play, project files, and saving remain authoritative on this machine.' : 'Your edits sync live. The host runs the shared simulation and writes project files.'}</span>
              </div>
            </div>

            {error && <p className="collaboration-error" role="alert">{error}</p>}

            <footer className="collaboration-dialog__footer">
              <button type="button" className="collaboration-secondary-button" onClick={close}>Close</button>
              <button
                type="button"
                className="collaboration-leave-button"
                onClick={() => void Promise.resolve(leaveSession()).catch(() => undefined)}
                data-testid="collaboration-leave-session"
              >
                {isHost ? <Square size={14} aria-hidden /> : <LogOut size={14} aria-hidden />}
                {isHost ? 'Stop session' : 'Leave session'}
              </button>
            </footer>
          </div>
        ) : (
          <div className="collaboration-setup">
            <div className="collaboration-tabs" role="tablist" aria-label="Collaboration setup">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'start'}
                aria-controls="collaboration-start-panel"
                id="collaboration-start-tab"
                className={tab === 'start' ? 'active' : ''}
                onClick={() => setTab('start')}
                data-testid="collaboration-tab-start"
              >
                <Radio size={14} aria-hidden />
                Start a session
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'join'}
                aria-controls="collaboration-join-panel"
                id="collaboration-join-tab"
                className={tab === 'join' ? 'active' : ''}
                onClick={() => setTab('join')}
                data-testid="collaboration-tab-join"
              >
                <Link2 size={14} aria-hidden />
                Join with invite
              </button>
            </div>

            {tab === 'start' ? (
              <form
                id="collaboration-start-panel"
                role="tabpanel"
                aria-labelledby="collaboration-start-tab"
                className="collaboration-form"
                onSubmit={submitStart}
                data-testid="collaboration-start-form"
              >
                <div className="collaboration-form__intro">
                  <h3>Host from this computer</h3>
                  <p>Feather opens a secure ngrok tunnel. There is no hosted Feather server to pay for.</p>
                </div>

                {!canHost && (
                  <div className="collaboration-notice is-warning" role="status" data-testid="collaboration-host-unavailable">
                    <ShieldCheck size={15} aria-hidden />
                    Hosting is available in the Feather desktop app. You can still join from this client.
                  </div>
                )}

                <div className="collaboration-field-grid">
                  <label className="collaboration-field">
                    <span>Your name</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Alex"
                      autoComplete="name"
                      required
                      data-autofocus="true"
                      data-testid="collaboration-display-name"
                    />
                  </label>
                  <label className="collaboration-field">
                    <span>Session name</span>
                    <input
                      value={sessionName}
                      onChange={(event) => setSessionName(event.target.value)}
                      placeholder="Tuesday level build"
                      required
                      data-testid="collaboration-session-name"
                    />
                  </label>
                </div>

                <label className="collaboration-field">
                  <span>ngrok authtoken</span>
                  <input
                    type="password"
                    value={authtoken}
                    onChange={(event) => setAuthtoken(event.target.value)}
                    placeholder="Paste your ngrok authtoken"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    data-testid="collaboration-authtoken"
                  />
                  <small><ShieldCheck size={12} aria-hidden /> Memory only — Feather never saves this token in the project or browser storage.</small>
                </label>

                <div className="collaboration-field-grid">
                  <label className="collaboration-field">
                    <span>Default guest access</span>
                    <select value={defaultRole} onChange={(event) => setDefaultRole(event.target.value as GuestRole)} data-testid="collaboration-default-role">
                      <option value="editor">Can edit</option>
                      <option value="viewer">View only</option>
                    </select>
                  </label>
                  <label className="collaboration-field">
                    <span>Reserved domain <em>Optional</em></span>
                    <input
                      value={domain}
                      onChange={(event) => setDomain(event.target.value)}
                      placeholder="studio.ngrok.app"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-testid="collaboration-domain"
                    />
                  </label>
                </div>

                <div className="collaboration-info-row">
                  <span><Check size={13} aria-hidden /> Edits sync peer-to-host</span>
                  <span><Check size={13} aria-hidden /> Assets stream directly from the host</span>
                  <span><Check size={13} aria-hidden /> Host controls Play</span>
                </div>

                {error && <p className="collaboration-error" role="alert" data-testid="collaboration-error">{error}</p>}

                <footer className="collaboration-dialog__footer">
                  <button type="button" className="collaboration-secondary-button" onClick={close}>Cancel</button>
                  <button
                    type="submit"
                    className="collaboration-primary-button"
                    disabled={!canHost || isBusy || !displayName.trim() || !sessionName.trim() || !authtoken.trim()}
                    data-testid="collaboration-start-submit"
                  >
                    {status === 'starting' ? <LoaderCircle className="collaboration-spin" size={15} aria-hidden /> : <Radio size={15} aria-hidden />}
                    Start secure session
                  </button>
                </footer>
              </form>
            ) : (
              <form
                id="collaboration-join-panel"
                role="tabpanel"
                aria-labelledby="collaboration-join-tab"
                className="collaboration-form"
                onSubmit={submitJoin}
                data-testid="collaboration-join-form"
              >
                <div className="collaboration-form__intro">
                  <h3>Join a live project</h3>
                  <p>Paste the private invite link from the host. Feather connects directly to their session.</p>
                </div>

                <label className="collaboration-field">
                  <span>Your name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Alex"
                    autoComplete="name"
                    required
                    data-autofocus="true"
                    data-testid="collaboration-join-display-name"
                  />
                </label>
                <label className="collaboration-field">
                  <span>Private invite</span>
                  <div className="collaboration-invite-input">
                    <Link2 size={15} aria-hidden />
                    <input
                      value={invite}
                      onChange={(event) => setInvite(event.target.value)}
                      placeholder="https://…ngrok.app/join#…"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      data-testid="collaboration-join-invite"
                    />
                  </div>
                  <small>The invite contains a session secret. Only accept links from someone you trust.</small>
                </label>

                <div className="collaboration-host-note is-compact">
                  <ShieldCheck size={16} aria-hidden />
                  <div>
                    <strong>The host remains authoritative</strong>
                    <span>You can edit together, but only the host can Play the shared simulation or save project files.</span>
                  </div>
                </div>

                {error && <p className="collaboration-error" role="alert" data-testid="collaboration-error">{error}</p>}

                <footer className="collaboration-dialog__footer">
                  <button type="button" className="collaboration-secondary-button" onClick={close}>Cancel</button>
                  <button
                    type="submit"
                    className="collaboration-primary-button"
                    disabled={isBusy || !displayName.trim() || !invite.trim()}
                    data-testid="collaboration-join-submit"
                  >
                    {status === 'joining' ? <LoaderCircle className="collaboration-spin" size={15} aria-hidden /> : <Users size={15} aria-hidden />}
                    Join session
                  </button>
                </footer>
              </form>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
