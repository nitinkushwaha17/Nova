import { create } from 'zustand';
import type { Manifest, StoredFile } from '../types';
import { allFiles, getFile, getSyncMeta, putFile, setSyncMeta } from '../storage/db';
import { CORE_FILES, driveName, manifestName, PROFILES_FILE, SCHEMA_VERSION } from '../storage/files';
import { drivePrefixFor, mergeProfiles, useProfiles, type Profile } from '../storage/profiles';
import * as drive from './drive';
import { hasValidToken, isConnected, NeedsAuthError, setLocalOnly, signIn, signOut } from './google';

export type SyncStatus = 'disconnected' | 'needs-auth' | 'idle' | 'syncing' | 'error' | 'offline';

export interface Conflict {
  name: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

interface SyncState {
  status: SyncStatus;
  lastSyncAt?: string;
  error?: string;
  pending: number;
  conflicts: Conflict[];
  /** Files present on Drive (from last manifest) */
  remoteFiles: Record<string, { rev: number; updatedAt: string }>;
}

export const useSync = create<SyncState>(() => ({
  status: 'disconnected',
  pending: 0,
  conflicts: [],
  remoteFiles: {},
}));

const set = useSync.setState;

// The app store registers a handler so it can refresh in-memory state after a pull.
let onFilesUpdated: (names: string[]) => void | Promise<void> = () => {};
export function setFilesUpdatedHandler(fn: (names: string[]) => void | Promise<void>) {
  onFilesUpdated = fn;
}

let deviceId = '';
async function getDeviceId() {
  if (deviceId) return deviceId;
  const meta = await getSyncMeta();
  deviceId = meta.deviceId ?? `dev_${Math.random().toString(36).slice(2, 10)}`;
  if (!meta.deviceId) await setSyncMeta({ deviceId });
  return deviceId;
}

// Drive ids are looked up once per session via listFiles
let idCache: Map<string, string> | null = null;
async function ids(): Promise<Map<string, string>> {
  if (!idCache) {
    const files = await drive.listFiles();
    idCache = new Map(files.map((f) => [f.name, f.id]));
  }
  return idCache;
}

async function fetchManifest(): Promise<Manifest> {
  const map = await ids();
  const id = map.get(manifestName());
  if (!id) return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date(0).toISOString(), files: {} };
  return drive.download<Manifest>(id);
}

async function uploadJson(fileName: string, data: unknown) {
  const map = await ids();
  const id = map.get(fileName);
  if (id) await drive.update(id, data);
  else {
    const created = await drive.create(fileName, data);
    map.set(fileName, created.id);
  }
}

async function refreshPending() {
  const files = await allFiles();
  set({ pending: files.filter((f) => f.dirty).length });
}

function handleError(e: unknown) {
  if (e instanceof NeedsAuthError) {
    set({ status: 'needs-auth', error: undefined });
  } else if (!navigator.onLine) {
    set({ status: 'offline', error: undefined });
  } else {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Download a single remote file into IndexedDB (used for lazy per-FY loading) */
export async function fetchRemoteFile<T = unknown>(name: string): Promise<StoredFile<T> | null> {
  const remote = useSync.getState().remoteFiles[name];
  if (!remote || !isConnected()) return null;
  try {
    const map = await ids();
    const id = map.get(driveName(name));
    if (!id) return null;
    const data = await drive.download<T>(id);
    const file: StoredFile<T> = { name, data, localRev: 0, remoteRev: remote.rev, dirty: false, updatedAt: remote.updatedAt };
    await putFile(file as StoredFile);
    return file;
  } catch (e) {
    handleError(e);
    return null;
  }
}

/**
 * Pull: fetch manifest, download files that changed remotely. Only files that are needed
 * (core files, or files already cached locally) are downloaded; other FYs stay lazy.
 */
async function pull(): Promise<Manifest> {
  const manifest = await fetchManifest();
  const remoteFiles = Object.fromEntries(Object.entries(manifest.files).map(([k, v]) => [k, { rev: v.rev, updatedAt: v.updatedAt }]));
  set({ remoteFiles });
  await setSyncMeta({ remoteFiles });

  const map = await ids();
  const updated: string[] = [];
  const conflicts: Conflict[] = [];
  const core = new Set<string>(CORE_FILES);

  for (const [name, entry] of Object.entries(manifest.files)) {
    const local = await getFile(name);
    const needed = core.has(name) || !!local;
    if (!needed) continue;
    if (local && entry.rev <= local.remoteRev) continue;
    if (local?.dirty) {
      conflicts.push({ name, localUpdatedAt: local.updatedAt, remoteUpdatedAt: entry.updatedAt });
      continue;
    }
    const id = map.get(driveName(name));
    if (!id) continue;
    const data = await drive.download<unknown>(id);
    await putFile({ name, data, localRev: local?.localRev ?? 0, remoteRev: entry.rev, dirty: false, updatedAt: entry.updatedAt });
    updated.push(name);
  }
  set({ conflicts });
  if (updated.length) await onFilesUpdated(updated);
  return manifest;
}

/** Push: upload dirty files whose remote revision hasn't moved, then write the manifest */
async function push(manifest: Manifest) {
  const files = (await allFiles()).filter((f) => f.dirty);
  if (!files.length) return;
  const conflicts = useSync.getState().conflicts;
  const blocked = new Set(conflicts.map((c) => c.name));
  const dev = await getDeviceId();
  let changed = false;
  for (const f of files) {
    if (blocked.has(f.name)) continue;
    const remote = manifest.files[f.name];
    if (remote && remote.rev > f.remoteRev) {
      conflicts.push({ name: f.name, localUpdatedAt: f.updatedAt, remoteUpdatedAt: remote.updatedAt });
      continue;
    }
    await uploadJson(driveName(f.name), f.data);
    const rev = (remote?.rev ?? 0) + 1;
    const now = new Date().toISOString();
    manifest.files[f.name] = { rev, updatedAt: now, device: dev };
    changed = true;
    // Only clear dirty if nothing changed locally during the upload
    const latest = await getFile(f.name);
    await putFile({ ...(latest ?? f), remoteRev: rev, dirty: latest ? latest.localRev !== f.localRev : false });
  }
  if (changed) {
    manifest.updatedAt = new Date().toISOString();
    manifest.schemaVersion = SCHEMA_VERSION;
    await uploadJson(manifestName(), manifest);
    const remoteFiles = Object.fromEntries(Object.entries(manifest.files).map(([k, v]) => [k, { rev: v.rev, updatedAt: v.updatedAt }]));
    set({ remoteFiles });
    await setSyncMeta({ remoteFiles });
  }
  set({ conflicts: [...conflicts] });
}

let running: Promise<void> | null = null;
let again = false;

/** Mirror the profile list to Drive and delete Drive files of profiles removed on any device */
async function syncProfiles() {
  const map = await ids();
  const id = map.get(PROFILES_FILE);
  const remote = id ? ((await drive.download<{ profiles?: Profile[] }>(id)).profiles ?? []) : [];
  const { merged, remoteChanged } = mergeProfiles(remote);
  if (remoteChanged || !id) await uploadJson(PROFILES_FILE, { profiles: merged });
  for (const p of merged) {
    if (!p.deleted) continue;
    const prefix = drivePrefixFor(p.id);
    if (!prefix) continue;
    for (const [name, fid] of [...map]) {
      if (!name.startsWith(prefix)) continue;
      await drive.remove(fid);
      map.delete(name);
    }
  }
}

// Push local profile edits soon after they happen
let lastProfiles = useProfiles.getState().all;
useProfiles.subscribe((s) => {
  if (s.all === lastProfiles) return;
  lastProfiles = s.all;
  schedulePush(1500);
});

export async function syncNow(): Promise<void> {
  if (!isConnected()) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    set({ status: 'syncing', error: undefined });
    try {
      do {
        again = false;
        const manifest = await pull();
        await push(manifest);
        await syncProfiles();
        lastProfiles = useProfiles.getState().all;
      } while (again);
      const now = new Date().toISOString();
      await setSyncMeta({ lastSyncAt: now });
      set({ status: 'idle', lastSyncAt: now });
    } catch (e) {
      idCache = null;
      handleError(e);
    } finally {
      running = null;
      await refreshPending();
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Called after every local write — debounced background upload */
export function schedulePush(delay = 4000) {
  void refreshPending();
  if (!isConnected()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

/** User-initiated connect (must run from a click handler) */
export async function connect() {
  try {
    await signIn();
    idCache = null;
    await syncNow();
  } catch (e) {
    handleError(e);
    throw e;
  }
}

/** Re-authorise after token expiry (click handler) and sync */
export async function reauthorize() {
  await connect();
}

export function disconnect() {
  signOut();
  // A deliberate disconnect means "keep using Nova locally", not "show the sign-in screen again"
  setLocalOnly(true);
  idCache = null;
  set({ status: 'disconnected', conflicts: [], error: undefined });
}

export async function resolveConflict(name: string, keep: 'local' | 'remote') {
  const remote = useSync.getState().remoteFiles[name];
  const local = await getFile(name);
  set({ conflicts: useSync.getState().conflicts.filter((c) => c.name !== name) });
  if (!remote) return;
  if (keep === 'remote') {
    const map = await ids();
    const id = map.get(driveName(name));
    if (id) {
      const data = await drive.download<unknown>(id);
      await putFile({ name, data, localRev: (local?.localRev ?? 0) + 1, remoteRev: remote.rev, dirty: false, updatedAt: remote.updatedAt });
      await onFilesUpdated([name]);
    }
  } else if (local) {
    await putFile({ ...local, remoteRev: remote.rev, dirty: true });
  }
  await syncNow();
}

/** Initial state on app start; sync silently if a token is still valid, else wait for a click */
export async function initSync() {
  const meta = await getSyncMeta();
  set({ remoteFiles: meta.remoteFiles ?? {}, lastSyncAt: meta.lastSyncAt });
  await refreshPending();
  if (!isConnected()) set({ status: 'disconnected' });
  else if (hasValidToken()) void syncNow();
  else set({ status: 'needs-auth' });
  window.addEventListener('online', () => {
    if (useSync.getState().status === 'offline') void syncNow();
  });
}
