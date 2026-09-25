import type { Collection, CollectionKind, ISODate } from '../types';
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
