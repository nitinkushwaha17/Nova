import type { FY, ISODate } from '../types';

export const todayISO = (): ISODate => toISO(new Date());

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Financial year (Apr–Mar) for an ISO date, e.g. 2025-05-01 → "2025-26" */
export function fyOf(date: ISODate): FY {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const currentFY = (): FY => fyOf(todayISO());

export function fyStartYear(fy: FY): number {
  return Number(fy.slice(0, 4));
}

export function fyRange(fy: FY): { start: ISODate; end: ISODate } {
  const y = fyStartYear(fy);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export function shiftFY(fy: FY, delta: number): FY {
  const s = fyStartYear(fy) + delta;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

/** All FYs between two dates, inclusive, oldest first */
export function fysBetween(start: ISODate, end: ISODate): FY[] {
  const out: FY[] = [];
  let fy = fyOf(start);
  const last = fyStartYear(fyOf(end));
  while (fyStartYear(fy) <= last) {
    out.push(fy);
    fy = shiftFY(fy, 1);
  }
  return out;
}

/** Months (YYYY-MM) of an FY in order */
export function fyMonths(fy: FY): string[] {
  const y = fyStartYear(fy);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const yr = i < 9 ? y : y + 1;
    out.push(`${yr}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

export function monthLabel(ym: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
    month: style === 'short' ? 'short' : 'long',
    year: style === 'short' ? '2-digit' : 'numeric',
  });
}

export function formatDate(d?: ISODate | null): string {
  if (!d) return '—';
  return parseISO(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export function addMonths(date: ISODate, n: number): ISODate {
  const d = parseISO(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISO(date);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole months elapsed from a to b */
export function monthsBetween(a: ISODate, b: ISODate): number {
  const da = parseISO(a);
  const db = parseISO(b);
  let m = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  if (db.getDate() < da.getDate()) m -= 1;
  return m;
}

export function endOfMonth(ym: string): ISODate {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

export function quarterOf(date: ISODate): string {
  const m = Number(date.slice(5, 7));
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `${fyOf(date)} Q${q}`;
}

export type PeriodPreset = 'fy' | 'month' | 'quarter' | 'custom' | 'last12' | 'all';

export interface Period {
  preset: PeriodPreset;
  fy?: FY;
  month?: string;
  quarter?: string;
  from?: ISODate;
  to?: ISODate;
}

export function periodRange(p: Period): { start: ISODate; end: ISODate } | null {
  switch (p.preset) {
    case 'fy':
      return p.fy ? fyRange(p.fy) : null;
    case 'month':
      return p.month ? { start: `${p.month}-01`, end: endOfMonth(p.month) } : null;
    case 'quarter': {
      if (!p.quarter) return null;
      const [fy, q] = p.quarter.split(' Q');
      const months = fyMonths(fy).slice((Number(q) - 1) * 3, Number(q) * 3);
      return { start: `${months[0]}-01`, end: endOfMonth(months[2]) };
    }
    case 'last12': {
      const end = todayISO();
      return { start: addMonths(end, -12), end };
    }
    case 'custom':
      return { start: p.from || '1900-01-01', end: p.to || '2999-12-31' };
    default:
      return null;
  }
}

/** Which of the known FYs a period touches */
export function periodFYs(p: Period, knownFYs: FY[]): FY[] {
  const r = periodRange(p);
  if (!r) return knownFYs;
  const wanted = new Set(fysBetween(r.start, r.end));
  return knownFYs.filter((f) => wanted.has(f));
}

export function inPeriod(date: ISODate, p: Period): boolean {
  const r = periodRange(p);
  if (!r) return true;
  return date >= r.start && date <= r.end;
}

export function periodLabel(p: Period): string {
  switch (p.preset) {
    case 'fy':
      return p.fy ? `FY ${p.fy}` : 'Financial year';
    case 'month':
      return p.month ? monthLabel(p.month, 'long') : 'Month';
    case 'quarter':
      return p.quarter ?? 'Quarter';
    case 'last12':
      return 'Last 12 months';
    case 'custom':
      return `${formatDate(p.from)} – ${formatDate(p.to)}`;
    default:
      return 'All time';
  }
}
