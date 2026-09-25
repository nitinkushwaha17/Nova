import type { FY } from '../types';
import { activeProfileId, drivePrefixFor } from './profiles';

/** Logical file names — each maps to one JSON file in Drive and one IndexedDB record */
export const F = {
  settings: 'settings',
  meta: 'meta',
  summaries: 'summaries',
  portfolio: 'portfolio',
  liabilities: 'liabilities',
  planning: 'planning',
  networth: 'networth',
  cpi: 'cpi',
  buckets: 'buckets',
} as const;

export type CoreFile = (typeof F)[keyof typeof F];

/** Loaded at startup; everything else (per-FY files) is loaded lazily */
export const CORE_FILES: CoreFile[] = Object.values(F);

export const txFile = (fy: FY) => `transactions/FY${fy}`;
export const taxFile = (fy: FY) => `tax/FY${fy}`;

export function fyFromFile(name: string): FY | null {
  const m = name.match(/^(?:transactions|tax)\/FY(\d{4}-\d{2})$/);
  return m ? m[1] : null;
}

export const isTxFile = (name: string) => name.startsWith('transactions/');
export const isTaxFile = (name: string) => name.startsWith('tax/');

/** Drive file name for a logical name (appDataFolder is flat) */
export const driveName = (name: string) => `${drivePrefixFor(activeProfileId())}${name.replace(/\//g, '__')}.json`;

/** Drive name of the active profile's manifest */
export const manifestName = () => `${drivePrefixFor(activeProfileId())}manifest.json`;
/** Shared list of profiles (not profile-specific) */
export const PROFILES_FILE = 'profiles.json';
export const SCHEMA_VERSION = 1;
