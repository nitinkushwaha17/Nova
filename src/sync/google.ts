/* Google OAuth without a backend: Google Identity Services (token model) in the browser, Play services in the Android app. */

import { registerPlugin } from '@capacitor/core';
import { isNative } from '../platform';

// Android: GoogleAuthPlugin.java. Google blocks its web sign-in inside app WebViews.
interface GoogleAuthPlugin {
  authorize(opts: { scopes: string[]; interactive?: boolean }): Promise<{ accessToken: string; scopes: string[] }>;
  clearToken(opts: { token: string }): Promise<void>;
}
const NativeAuth = registerPlugin<GoogleAuthPlugin>('GoogleAuth');
// Play services doesn't report the lifetime; Google access tokens last an hour
const NATIVE_TTL = 55 * 60 * 1000;

async function nativeToken(scopes: string[], interactive: boolean): Promise<string> {
  try {
    return (await NativeAuth.authorize({ scopes, interactive })).accessToken;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'NEEDS_AUTH') throw new NeedsAuthError();
    if (code === 'CANCELLED') throw new Error('Sign-in window closed');
    throw new Error((e as Error).message || 'Google sign-in failed');
  }
}

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

/** Nova's OAuth Web client. Client IDs are public by design; access is limited by the authorised JavaScript origins. */
const NOVA_CLIENT_ID = '167718968754-6o12cobjuq87kfbe9aboa7jmblanoedb.apps.googleusercontent.com';
const LS_CONNECTED = 'nova.driveConnected';
const LS_EMAIL = 'nova.driveEmail';

export class NeedsAuthError extends Error {
  constructor() {
    super('Google sign-in required');
  }
}

// A forked build can still point at its own Google Cloud project via .env.local
export const getClientId = (): string => import.meta.env.VITE_GOOGLE_CLIENT_ID || NOVA_CLIENT_ID;
export const isConnected = () => localStorage.getItem(LS_CONNECTED) === '1';

// Welcome screen choices: "use without syncing" is remembered; "offline for now" lasts for this tab only
const LS_LOCAL_ONLY = 'nova.localOnly';
const SS_SKIP_RESUME = 'nova.skipResume';
export const isLocalOnly = () => localStorage.getItem(LS_LOCAL_ONLY) === '1';
export function setLocalOnly(on: boolean) {
  if (on) localStorage.setItem(LS_LOCAL_ONLY, '1');
  else localStorage.removeItem(LS_LOCAL_ONLY);
}
export const resumeSkipped = () => sessionStorage.getItem(SS_SKIP_RESUME) === '1';
export const skipResume = () => sessionStorage.setItem(SS_SKIP_RESUME, '1');
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
// Kept in sessionStorage (this tab only, ~1h lifetime) so switching profile — which reloads the app — doesn't force a new sign-in
const SS_TOKEN = 'nova.token';
let token: { value: string; expiresAt: number } | null = (() => {
  try {
    const t = JSON.parse(sessionStorage.getItem(SS_TOKEN) || 'null') as { value: string; expiresAt: number } | null;
    return t && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
})();
function setToken(t: typeof token) {
  token = t;
  if (t) sessionStorage.setItem(SS_TOKEN, JSON.stringify(t));
  else sessionStorage.removeItem(SS_TOKEN);
}
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

async function getClient(): Promise<TokenClient> {
  await loadScript();
  if (!client) {
    client = window.google!.accounts.oauth2.initTokenClient({
      client_id: getClientId(),
      scope: SCOPE,
      callback: (r) => {
        const p = pending;
        pending = null;
        if (r.error || !r.access_token) {
          p?.reject(new Error(r.error_description || r.error || 'Sign-in failed'));
          return;
        }
        setToken({ value: r.access_token, expiresAt: Date.now() + (r.expires_in - 60) * 1000 });
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
 * In the Android app, non-interactive calls renew the token silently while access is still granted.
 */
export async function getToken(interactive: boolean, forceConsent = false): Promise<string> {
  if (token && token.expiresAt > Date.now() && !forceConsent) return token.value;
  if (isNative) {
    const t = await nativeToken(SCOPE.split(' '), interactive);
    setToken({ value: t, expiresAt: Date.now() + NATIVE_TTL });
    return t;
  }
  if (!interactive) throw new NeedsAuthError();
  const c = await getClient();
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt: forceConsent ? 'consent' : '', login_hint: connectedEmail() || undefined });
  });
}

/** App start: true if Drive can sync without a click (valid token, or a silent renewal in the Android app) */
export async function restoreSession(): Promise<boolean> {
  if (hasValidToken()) return true;
  if (!isNative || !isConnected()) return false;
  try {
    await getToken(false);
    return true;
  } catch {
    return false;
  }
}

export async function signIn(): Promise<string> {
  const t = await getToken(true, !isConnected());
  localStorage.setItem(LS_CONNECTED, '1');
  setLocalOnly(false);
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
  if (token && isNative) {
    // Revoking the grant makes the next sign-in ask again, like the web popup does
    const value = token.value;
    void fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(value)}`,
    })
      .catch(() => {})
      .finally(() => void NativeAuth.clearToken({ token: value }).catch(() => {}));
  } else if (token && window.google) window.google.accounts.oauth2.revoke(token.value);
  setToken(null);
  localStorage.removeItem(LS_CONNECTED);
  localStorage.removeItem(LS_EMAIL);
}

export function invalidateToken() {
  // Play services would otherwise hand back the same rejected token
  if (token && isNative) void NativeAuth.clearToken({ token: token.value }).catch(() => {});
  setToken(null);
}

// ─── Gmail (read-only, requested separately and only when the user fetches statements) ─────────

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
let gmailClient: TokenClient | null = null;
// Memory only: Gmail access is never persisted, not even for the tab session
let gmailToken: { value: string; expiresAt: number } | null = null;
let gmailPending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

export const hasGmailToken = () => !!gmailToken && gmailToken.expiresAt > Date.now();
export const dropGmailToken = () => {
  if (gmailToken && isNative) void NativeAuth.clearToken({ token: gmailToken.value }).catch(() => {});
  gmailToken = null;
};

/** Must be called from a click handler the first time (opens Google's consent popup) */
export async function getGmailToken(): Promise<string> {
  if (gmailToken && gmailToken.expiresAt > Date.now()) return gmailToken.value;
  if (isNative) {
    const t = await nativeToken([GMAIL_SCOPE], true);
    gmailToken = { value: t, expiresAt: Date.now() + NATIVE_TTL };
    return t;
  }
  await loadScript();
  if (!gmailClient) {
    gmailClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: getClientId(),
      scope: GMAIL_SCOPE,
      callback: (r) => {
        const p = gmailPending;
        gmailPending = null;
        if (r.error || !r.access_token) return p?.reject(new Error(r.error_description || r.error || 'Gmail access was not granted'));
        gmailToken = { value: r.access_token, expiresAt: Date.now() + (r.expires_in - 60) * 1000 };
        p?.resolve(r.access_token);
      },
      error_callback: (e) => {
        const p = gmailPending;
        gmailPending = null;
        p?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in window closed' : e.message || e.type));
      },
    });
  }
  const c = gmailClient;
  return new Promise<string>((resolve, reject) => {
    gmailPending = { resolve, reject };
    c.requestAccessToken({ prompt: '', login_hint: connectedEmail() || undefined });
  });
}
