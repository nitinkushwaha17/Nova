/* Google Identity Services (token model) — browser-only OAuth, no backend. */

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
  callback: (r: TokenResponse) => void;
  error_callback?: (e: { type: string; message?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, cb?: () => void): void;
        };
      };
    };
  }
}

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';

const LS_CLIENT = 'nova.googleClientId';
const LS_CONNECTED = 'nova.driveConnected';
const LS_EMAIL = 'nova.driveEmail';

export class NeedsAuthError extends Error {
  constructor() {
    super('Google sign-in required');
  }
}

export function getClientId(): string {
  return localStorage.getItem(LS_CLIENT) || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}
export function setClientId(id: string) {
  if (id) localStorage.setItem(LS_CLIENT, id.trim());
  else localStorage.removeItem(LS_CLIENT);
  client = null;
}
export const isConnected = () => localStorage.getItem(LS_CONNECTED) === '1';
export const connectedEmail = () => localStorage.getItem(LS_EMAIL) || '';

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load Google sign-in (offline?)'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

let client: TokenClient | null = null;
let token: { value: string; expiresAt: number } | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

async function getClient(): Promise<TokenClient> {
  const id = getClientId();
  if (!id) throw new Error('Google OAuth Client ID is not configured (Settings → Cloud sync).');
  await loadScript();
  if (!client) {
    client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPE,
      callback: (r) => {
        const p = pending;
        pending = null;
        if (r.error || !r.access_token) {
          p?.reject(new Error(r.error_description || r.error || 'Sign-in failed'));
          return;
        }
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in - 60) * 1000 };
        p?.resolve(r.access_token);
      },
      error_callback: (e) => {
        const p = pending;
        pending = null;
        p?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in window closed' : e.message || e.type));
      },
    });
  }
  return client;
}

export function hasValidToken() {
  return !!token && token.expiresAt > Date.now();
}

/**
 * Get an access token. Interactive requests open Google's popup and must be triggered by a user
 * gesture; non-interactive calls throw NeedsAuthError when the token has expired.
 */
export async function getToken(interactive: boolean, forceConsent = false): Promise<string> {
  if (token && token.expiresAt > Date.now() && !forceConsent) return token.value;
  if (!interactive) throw new NeedsAuthError();
  const c = await getClient();
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt: forceConsent ? 'consent' : '', login_hint: connectedEmail() || undefined });
  });
}

export async function signIn(): Promise<string> {
  const t = await getToken(true, !isConnected());
  localStorage.setItem(LS_CONNECTED, '1');
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${t}` } });
    if (r.ok) {
      const info = (await r.json()) as { email?: string };
      if (info.email) localStorage.setItem(LS_EMAIL, info.email);
    }
  } catch {
    /* email is only a convenience */
  }
  return t;
}

export function signOut() {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value);
  token = null;
  localStorage.removeItem(LS_CONNECTED);
  localStorage.removeItem(LS_EMAIL);
}

export function invalidateToken() {
  token = null;
}
