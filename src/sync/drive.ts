import { getToken, invalidateToken, NeedsAuthError } from './google';

/* Minimal Drive v3 client restricted to the hidden appDataFolder. */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

async function call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const t = await getToken(false);
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) {
    invalidateToken();
    throw new NeedsAuthError();
  }
  if ((res.status === 429 || res.status >= 500) && retry) {
    await new Promise((r) => setTimeout(r, 1200));
    return call(url, init, false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

export async function listFiles(): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'nextPageToken, files(id, name, modifiedTime, size)',
      pageSize: '1000',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await call(`${API}/files?${q}`);
    const j = (await r.json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...j.files);
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function download<T>(id: string): Promise<T> {
  const r = await call(`${API}/files/${id}?alt=media`);
  return (await r.json()) as T;
}

export async function create(name: string, data: unknown): Promise<DriveFile> {
  const boundary = `nova${Math.random().toString(36).slice(2)}`;
  const meta = { name, parents: ['appDataFolder'], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const r = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await r.json()) as DriveFile;
}

export async function update(id: string, data: unknown): Promise<DriveFile> {
  const r = await call(`${UPLOAD}/files/${id}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return (await r.json()) as DriveFile;
}

export async function remove(id: string) {
  await call(`${API}/files/${id}`, { method: 'DELETE' });
}
