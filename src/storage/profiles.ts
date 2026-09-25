import { create } from 'zustand';

/*
 * Profiles are fully separate datasets (e.g. you, your spouse, your parents). Each has its own
 * IndexedDB database and its own file-name prefix inside the same Drive appDataFolder. The list
 * of profiles lives in localStorage and is mirrored to `profiles.json` on Drive so other devices
 * discover them.
 */

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  /** Tombstone so a deletion propagates to other devices */
  deleted?: boolean;
}

export const DEFAULT_PROFILE_ID = 'default';
const LS_LIST = 'nova.profiles';
const LS_ACTIVE = 'nova.activeProfile';
const EPOCH = new Date(0).toISOString();

function defaultProfile(): Profile {
  return { id: DEFAULT_PROFILE_ID, name: 'Me', color: '#818cf8', createdAt: EPOCH, updatedAt: EPOCH };
}

function load(): Profile[] {
  let list: Profile[] = [];
  try {
    list = JSON.parse(localStorage.getItem(LS_LIST) || '[]') as Profile[];
  } catch {
    list = [];
  }
  if (!list.some((p) => p.id === DEFAULT_PROFILE_ID)) list.unshift(defaultProfile());
  return list;
}

interface ProfilesState {
  /** Includes tombstones */
  all: Profile[];
  activeId: string;
}

export const useProfiles = create<ProfilesState>(() => {
  const all = load();
  const stored = localStorage.getItem(LS_ACTIVE) || DEFAULT_PROFILE_ID;
  const activeId = all.some((p) => p.id === stored && !p.deleted) ? stored : DEFAULT_PROFILE_ID;
  return { all, activeId };
});

function commit(all: Profile[]) {
  localStorage.setItem(LS_LIST, JSON.stringify(all));
  useProfiles.setState({ all });
}

export const activeProfileId = () => useProfiles.getState().activeId;
export const listProfiles = () => useProfiles.getState().all.filter((p) => !p.deleted);
export const activeProfile = () => listProfiles().find((p) => p.id === activeProfileId()) ?? defaultProfile();

/** IndexedDB database name — the default profile keeps the original name so existing data is untouched */
export const dbNameFor = (id: string) => (id === DEFAULT_PROFILE_ID ? 'nova' : `nova-${id}`);
/** Drive file-name prefix for a profile */
export const drivePrefixFor = (id: string) => (id === DEFAULT_PROFILE_ID ? '' : `p-${id}--`);

export function createProfile(name: string, color: string): Profile {
  const now = new Date().toISOString();
  const p: Profile = { id: Math.random().toString(36).slice(2, 10), name: name.trim() || 'New profile', color, createdAt: now, updatedAt: now };
  commit([...useProfiles.getState().all, p]);
  return p;
}

export function updateProfile(id: string, patch: Partial<Pick<Profile, 'name' | 'color'>>) {
  commit(useProfiles.getState().all.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)));
}

/** Marks the profile deleted and removes its local database. Drive files are removed by the sync engine. */
export async function deleteProfileLocal(id: string) {
  if (id === DEFAULT_PROFILE_ID || id === activeProfileId()) throw new Error('Cannot delete this profile');
  commit(useProfiles.getState().all.map((p) => (p.id === id ? { ...p, deleted: true, updatedAt: new Date().toISOString() } : p)));
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbNameFor(id));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Switching reloads the app so every in-memory cache starts clean for the new profile */
export function switchProfile(id: string) {
  localStorage.setItem(LS_ACTIVE, id);
  // Detail routes (e.g. /buckets/:id) point at the old profile's data
  const path = location.pathname.split('/').slice(0, 2).join('/') || '/';
  if (path === location.pathname) location.reload();
  else location.assign(path);
}

/** Merge a remote registry into the local one (newest update wins per profile). Returns true if local changed. */
export function mergeProfiles(remote: Profile[]): { merged: Profile[]; localChanged: boolean; remoteChanged: boolean } {
  const local = useProfiles.getState().all;
  const byId = new Map(local.map((p) => [p.id, p]));
  let localChanged = false;
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.updatedAt > l.updatedAt) {
      byId.set(r.id, r);
      localChanged = true;
    }
  }
  const merged = [...byId.values()];
  const remoteMap = new Map(remote.map((p) => [p.id, p]));
  const remoteChanged = merged.length !== remote.length || merged.some((p) => remoteMap.get(p.id)?.updatedAt !== p.updatedAt);
  if (localChanged) {
    commit(merged);
    // The active profile was deleted on another device
    if (merged.find((p) => p.id === activeProfileId())?.deleted) switchProfile(DEFAULT_PROFILE_ID);
  }
  return { merged, localChanged, remoteChanged };
}
