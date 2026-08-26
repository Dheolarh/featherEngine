import { z } from 'zod';

const sessionIdSchema = z.string().min(12).max(128).regex(/^[A-Za-z0-9_-]+$/);
const secretSchema = z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/);

export interface CollaborationInvite {
  publicUrl: string;
  websocketUrl: string;
  sessionId: string;
  secret: string;
}

function safeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('That collaboration invite is not a valid URL.');
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('Collaboration invites must use an http(s) or ws(s) endpoint.');
  }
  if (url.username || url.password) {
    throw new Error('Collaboration invites cannot contain URL credentials.');
  }
  const loopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
    || url.hostname === '::1';
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && !loopback) {
    throw new Error('Remote collaboration invites must use an encrypted https or wss endpoint.');
  }
  return url;
}

export function collaborationWebsocketUrl(publicUrl: string): string {
  const url = safeBaseUrl(publicUrl);
  url.hash = '';
  url.search = '';
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/collaboration/ws`.replace(/\/{2,}/g, '/');
  return url.toString();
}

/** The join credential deliberately lives only after `#`, which browsers never send to ngrok. */
export function buildCollaborationInvite(
  publicUrl: string,
  sessionId: string,
  secret: string,
): string {
  const parsedSession = sessionIdSchema.safeParse(sessionId);
  const parsedSecret = secretSchema.safeParse(secret);
  if (!parsedSession.success || !parsedSecret.success) {
    throw new Error('Could not create a secure collaboration invite.');
  }
  const url = safeBaseUrl(publicUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
  url.hash = new URLSearchParams({
    'feather-session': parsedSession.data,
    'feather-secret': parsedSecret.data,
  }).toString();
  return url.toString();
}

export function parseCollaborationInvite(value: string): CollaborationInvite {
  const url = safeBaseUrl(value);
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const sessionId = sessionIdSchema.safeParse(fragment.get('feather-session'));
  const secret = secretSchema.safeParse(fragment.get('feather-secret'));
  if (!sessionId.success || !secret.success) {
    throw new Error('This collaboration invite is incomplete or invalid. Ask the host for a new link.');
  }

  url.hash = '';
  const publicUrl = url.toString();
  return {
    publicUrl,
    websocketUrl: collaborationWebsocketUrl(publicUrl),
    sessionId: sessionId.data,
    secret: secret.data,
  };
}

export function randomCollaborationToken(bytes = 32): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random values are unavailable on this device.');
  }
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
