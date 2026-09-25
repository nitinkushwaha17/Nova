import type { Bucket, BucketKind, ISODate } from '../types';
import { PALETTE } from './defaults';
import { uid } from './format';

export const BUCKET_KINDS: Record<BucketKind, { label: string; emoji: string }> = {
  trip: { label: 'Trip', emoji: '✈️' },
  event: { label: 'Event', emoji: '🎉' },
  project: { label: 'Project', emoji: '🛠️' },
  home: { label: 'Home', emoji: '🏠' },
  other: { label: 'Other', emoji: '🪣' },
};

export function newBucket(patch: Partial<Bucket> = {}, index = 0): Bucket {
  return { id: uid('bkt'), name: '', kind: 'trip', color: PALETTE[index % PALETTE.length], createdAt: new Date().toISOString(), ...patch };
}

export type BucketStatus = 'upcoming' | 'active' | 'done' | 'open';

export function bucketStatus(b: Bucket, today: ISODate): BucketStatus {
  if (!b.startDate && !b.endDate) return 'open';
  if (b.startDate && today < b.startDate) return 'upcoming';
  if (b.endDate && today > b.endDate) return 'done';
  return 'active';
}

export const STATUS_LABEL: Record<BucketStatus, { label: string; color: string }> = {
  upcoming: { label: 'Upcoming', color: '#38bdf8' },
  active: { label: 'In progress', color: '#34d399' },
  done: { label: 'Finished', color: '#94a3b8' },
  open: { label: 'Ongoing', color: '#c084fc' },
};

export const bucketIcon = (b: Pick<Bucket, 'emoji' | 'kind'>) => b.emoji || BUCKET_KINDS[b.kind].emoji;
