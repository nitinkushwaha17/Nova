import { getPrice, setPrice, type PriceEntry } from '../storage/db';

/* Mutual fund NAVs from mfapi.in (free, CORS-enabled, AMFI data). */

const BASE = 'https://api.mfapi.in/mf';
const MAX_AGE_MS = 12 * 3600 * 1000;

export interface SchemeHit {
  schemeCode: number;
  schemeName: string;
}

export async function searchSchemes(q: string): Promise<SchemeHit[]> {
  if (q.trim().length < 3) return [];
  const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q.trim())}`);
  if (!r.ok) throw new Error('NAV search failed');
  return ((await r.json()) as SchemeHit[]).slice(0, 25);
}

/** "26-09-2026" → "2026-09-26" */
function isoFromDMY(s: string) {
  const [d, m, y] = s.split('-');
  return `${y}-${m}-${d}`;
}

export async function latestNav(code: string, force = false): Promise<PriceEntry | null> {
  const key = `mf:${code}`;
  const cached = await getPrice(key);
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < MAX_AGE_MS) return cached;
  try {
    const r = await fetch(`${BASE}/${code}/latest`);
    if (!r.ok) return cached ?? null;
    const j = (await r.json()) as { meta?: { scheme_name?: string }; data?: { date: string; nav: string }[] };
    const d = j.data?.[0];
    if (!d) return cached ?? null;
    const entry: PriceEntry = { nav: parseFloat(d.nav), date: isoFromDMY(d.date), name: j.meta?.scheme_name, fetchedAt: new Date().toISOString() };
    await setPrice(key, entry);
    return entry;
  } catch {
    return cached ?? null;
  }
}

export async function navsFor(codes: string[], force = false): Promise<Record<string, { nav: number; date: string }>> {
  const out: Record<string, { nav: number; date: string }> = {};
  await Promise.all(
    [...new Set(codes)].map(async (c) => {
      const e = await latestNav(c, force);
      if (e) out[c] = { nav: e.nav, date: e.date };
    }),
  );
  return out;
}
