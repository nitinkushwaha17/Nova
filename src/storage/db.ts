import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredFile } from '../types';
import { activeProfileId, dbNameFor } from './profiles';

export interface PriceEntry {
  nav: number;
  date: string;
  name?: string;
  fetchedAt: string;
}

export interface SyncMeta {
  lastSyncAt?: string;
  /** Last manifest seen on Drive (lets us know which remote files exist without re-fetching) */
  remoteFiles?: Record<string, { rev: number; updatedAt: string }>;
  deviceId?: string;
}

interface NovaDB extends DBSchema {
  files: { key: string; value: StoredFile };
  sync: { key: string; value: SyncMeta };
  priceCache: { key: string; value: PriceEntry };
}

let dbp: Promise<IDBPDatabase<NovaDB>> | null = null;

export function db() {
  dbp ??= openDB<NovaDB>(dbNameFor(activeProfileId()), 1, {
    upgrade(d) {
      d.createObjectStore('files', { keyPath: 'name' });
      d.createObjectStore('sync');
      d.createObjectStore('priceCache');
    },
  });
  return dbp;
}

export async function getFile<T>(name: string): Promise<StoredFile<T> | undefined> {
  return (await (await db()).get('files', name)) as StoredFile<T> | undefined;
}

export async function putFile(file: StoredFile) {
  await (await db()).put('files', file);
}

export async function allFiles(): Promise<StoredFile[]> {
  return (await db()).getAll('files');
}

export async function fileNames(): Promise<string[]> {
  return (await (await db()).getAllKeys('files')) as string[];
}

export async function deleteFile(name: string) {
  await (await db()).delete('files', name);
}

const inflight = new Set<Promise<unknown>>();
/** Resolves once every local write started so far has landed (used before switching profile) */
export async function flushWrites() {
  await Promise.allSettled([...inflight]);
}

/** Save data locally and mark it as needing upload */
export function writeLocal<T>(name: string, data: T): Promise<StoredFile<T>> {
  const p = writeLocalInner(name, data);
  inflight.add(p);
  const done = () => inflight.delete(p);
  p.then(done, done);
  return p;
}

async function writeLocalInner<T>(name: string, data: T): Promise<StoredFile<T>> {
  const prev = await getFile<T>(name);
  const file: StoredFile<T> = {
    name,
    data,
    localRev: (prev?.localRev ?? 0) + 1,
    remoteRev: prev?.remoteRev ?? 0,
    dirty: true,
    updatedAt: new Date().toISOString(),
  };
  await putFile(file as StoredFile);
  return file;
}

export async function getSyncMeta(): Promise<SyncMeta> {
  return (await (await db()).get('sync', 'state')) ?? {};
}

export async function setSyncMeta(patch: Partial<SyncMeta>) {
  const cur = await getSyncMeta();
  await (await db()).put('sync', { ...cur, ...patch }, 'state');
}

export async function getPrice(key: string) {
  return (await db()).get('priceCache', key);
}

export async function setPrice(key: string, v: PriceEntry) {
  await (await db()).put('priceCache', v, key);
}

export async function clearAll() {
  const d = await db();
  await Promise.all([d.clear('files'), d.clear('sync'), d.clear('priceCache')]);
}
