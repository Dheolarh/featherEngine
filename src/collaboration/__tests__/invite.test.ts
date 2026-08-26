import { describe, expect, it } from 'vitest';
import {
  buildCollaborationInvite,
  collaborationWebsocketUrl,
  parseCollaborationInvite,
} from '../invite';

const sessionId = 'session_0123456789abcdef';
const secret = 'secret_0123456789abcdefghijklmnopqrstuvwxyz';

describe('collaboration invites', () => {
  it('keeps the join secret in the URL fragment and derives a secure WebSocket endpoint', () => {
    const invite = buildCollaborationInvite('https://quiet-moth.ngrok.app', sessionId, secret);
    const url = new URL(invite);
    expect(url.origin).toBe('https://quiet-moth.ngrok.app');
    expect(url.search).toBe('');
    expect(url.hash).toContain('feather-secret=');
    expect(url.href.slice(0, url.href.indexOf('#'))).not.toContain(secret);

    expect(parseCollaborationInvite(invite)).toEqual({
      publicUrl: 'https://quiet-moth.ngrok.app/',
      websocketUrl: 'wss://quiet-moth.ngrok.app/collaboration/ws',
      sessionId,
      secret,
    });
  });

  it('rejects missing credentials, short secrets and non-web protocols', () => {
    expect(() => parseCollaborationInvite('https://quiet-moth.ngrok.app')).toThrow(/incomplete/i);
    expect(() => parseCollaborationInvite('https://quiet-moth.ngrok.app#feather-session=abc&feather-secret=x')).toThrow(/invalid/i);
    expect(() => collaborationWebsocketUrl('file:///tmp/session')).toThrow(/http/i);
    expect(() => buildCollaborationInvite('http://remote.example', sessionId, secret)).toThrow(/encrypted/i);
  });

  it('allows unencrypted endpoints only for the desktop host loopback relay', () => {
    expect(collaborationWebsocketUrl('http://127.0.0.1:43127')).toBe(
      'ws://127.0.0.1:43127/collaboration/ws',
    );
    expect(collaborationWebsocketUrl('ws://localhost:43127')).toBe(
      'ws://localhost:43127/collaboration/ws',
    );
  });
});
