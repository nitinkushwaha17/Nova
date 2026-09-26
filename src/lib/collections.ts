import type { Collection, CollectionKind, GroupTotals, ID, ISODate } from '../types';
import { mergeGroups } from './transactions';
import { PALETTE } from './defaults';
import { uid } from './format';

export const COLLECTION_KINDS: Record<CollectionKind, { label: string; emoji: string }> = {
  trip: { label: 'Trip', emoji: '✈️' },
  event: { label: 'Event', emoji: '🎉' },
  project: { label: 'Project', emoji: '🛠️' },
  home: { label: 'Home', emoji: '🏠' },
  other: { label: 'Other', emoji: '📁' },
};

export function newCollection(patch: Partial<Collection> = {}, index = 0): Collection {
  return { id: uid('col'), name: '', kind: 'trip', color: PALETTE[index % PALETTE.length], createdAt: new Date().toISOString(), ...patch };
}

export type CollectionStatus = 'upcoming' | 'active' | 'done' | 'open';

export function collectionStatus(b: Collection, today: ISODate): CollectionStatus {
  if (!b.startDate && !b.endDate) return 'open';
  if (b.startDate && today < b.startDate) return 'upcoming';
  if (b.endDate && today > b.endDate) return 'done';
  return 'active';
}

export const STATUS_LABEL: Record<CollectionStatus, { label: string; color: string }> = {
  upcoming: { label: 'Upcoming', color: '#38bdf8' },
  active: { label: 'In progress', color: '#34d399' },
  done: { label: 'Finished', color: '#94a3b8' },
  open: { label: 'Ongoing', color: '#c084fc' },
};

export const collectionIcon = (b: Pick<Collection, 'emoji' | 'kind'>) => b.emoji || COLLECTION_KINDS[b.kind].emoji;

// ─── Nesting ───────────────────────────────────────────────────────────────

/** Parent id, ignoring dangling references (e.g. the parent was deleted on another device) */
export function parentOf(c: Collection, byId: Map<ID, Collection>): ID | null {
  return c.parentId && c.parentId !== c.id && byId.has(c.parentId) ? c.parentId : null;
}

export function childrenMap(all: Collection[]): Map<ID | null, Collection[]> {
  const byId = new Map(all.map((c) => [c.id, c]));
  const out = new Map<ID | null, Collection[]>();
  for (const c of all) {
    const p = parentOf(c, byId);
    const arr = out.get(p);
    if (arr) arr.push(c);
    else out.set(p, [c]);
  }
  return out;
}

/** The collection itself plus every collection nested under it */
export function descendantIds(id: ID, all: Collection[]): Set<ID> {
  const kids = childrenMap(all);
  const out = new Set<ID>();
  const walk = (x: ID) => {
    if (out.has(x)) return;
    out.add(x);
    for (const k of kids.get(x) ?? []) walk(k.id);
  };
  walk(id);
  return out;
}

/** Root-first chain of ancestors (excluding the collection itself) */
export function ancestorsOf(id: ID, all: Collection[]): Collection[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const out: Collection[] = [];
  const seen = new Set([id]);
  let p = byId.get(id) && parentOf(byId.get(id)!, byId);
  while (p && !seen.has(p)) {
    seen.add(p);
    out.unshift(byId.get(p)!);
    p = parentOf(byId.get(p)!, byId);
  }
  return out;
}

/** Depth-first order with depth, for indented pickers */
export function flattenTree(all: Collection[]): { c: Collection; depth: number }[] {
  const kids = childrenMap(all);
  const out: { c: Collection; depth: number }[] = [];
  const seen = new Set<ID>();
  const walk = (p: ID | null, depth: number) => {
    for (const c of [...(kids.get(p) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left is part of a cycle; show it at the top level
  for (const c of all) if (!seen.has(c.id)) out.push({ c, depth: 0 });
  return out;
}

/** Totals including everything in nested collections */
export function rollupTotals(own: Map<ID, GroupTotals>, all: Collection[]): Map<ID, GroupTotals> {
  const out = new Map<ID, GroupTotals>();
  for (const c of all) {
    const g = mergeGroups([...descendantIds(c.id, all)].map((id) => own.get(id)));
    if (g) out.set(c.id, g);
  }
  return out;
}