/* Match SMS-alert transactions with statement rows. The statement is the source of truth: when both
 * describe the same money movement, the statement's details win and the user's edits on the SMS entry
 * (category, notes, tags, collection) are kept. */
import type { Transaction } from '../types';
import { daysBetween } from './dates';

/** How far apart an SMS and a statement row can be dated (posting delays, value dates, weekends) */
export const MATCH_WINDOW_DAYS = 3;

/** Reference-like numbers (UPI RRN, IMPS/NEFT refs) found anywhere in the transaction */
export function refsOf(t: Transaction): Set<string> {
  const text = `${t.reference ?? ''} ${t.rawDescription ?? ''} ${t.description}`;
  return new Set(text.match(/\d{10,}/g) ?? []);
}

/** Higher = more likely the same transaction; -1 = can't be */
export function matchScore(sms: Transaction, row: Transaction, window = MATCH_WINDOW_DAYS): number {
  if (sms.accountId !== row.accountId || sms.amount.toFixed(2) !== row.amount.toFixed(2)) return -1;
  const dd = Math.min(Math.abs(daysBetween(sms.date, row.date)), row.valueDate ? Math.abs(daysBetween(sms.date, row.valueDate)) : Infinity);
  if (dd > window) return -1;
  const a = refsOf(sms);
  const b = refsOf(row);
  if (a.size && b.size) {
    for (const r of a) if (b.has(r)) return 1000 - dd;
    // Both carry references and none agree: possible, but only as a last resort
    return 10 - dd;
  }
  return 100 - dd * 10;
}

/** Best-first one-to-one matching, so two ₹20 payments on the same day each find their own partner */
export function pairUp(left: Transaction[], right: Transaction[], window = MATCH_WINDOW_DAYS): [Transaction, Transaction][] {
  const candidates: { l: Transaction; r: Transaction; s: number }[] = [];
  const byAmount = new Map<string, Transaction[]>();
  for (const r of right) {
    const k = `${r.accountId}|${r.amount.toFixed(2)}`;
    byAmount.set(k, [...(byAmount.get(k) ?? []), r]);
  }
  for (const l of left) {
    for (const r of byAmount.get(`${l.accountId}|${l.amount.toFixed(2)}`) ?? []) {
      const s = matchScore(l, r, window);
      if (s >= 0) candidates.push({ l, r, s });
    }
  }
  candidates.sort((x, y) => y.s - x.s);
  const usedL = new Set<string>();
  const usedR = new Set<string>();
  const pairs: [Transaction, Transaction][] = [];
  for (const { l, r } of candidates) {
    if (usedL.has(l.id) || usedR.has(r.id)) continue;
    usedL.add(l.id);
    usedR.add(r.id);
    pairs.push([l, r]);
  }
  return pairs;
}

/** The statement row, carrying over the SMS entry's id and everything the user set on it */
export function mergeInto(sms: Transaction, row: Transaction): Transaction {
  return {
    ...row,
    id: sms.id,
    category: sms.category ?? row.category,
    subcategory: sms.category ? sms.subcategory : row.subcategory,
    notes: sms.notes ?? row.notes,
    tags: sms.tags ?? row.tags,
    collectionId: sms.collectionId ?? row.collectionId,
    isTransfer: sms.isTransfer ?? row.isTransfer,
    autoTransfer: sms.autoTransfer ?? row.autoTransfer,
    source: undefined,
    smsId: sms.smsId,
  };
}

/** Statement import: pair incoming rows with existing unverified SMS entries */
export function reconcileStatement(existing: Transaction[], incoming: Transaction[]) {
  const smsPool = existing.filter((t) => t.source === 'sms');
  const pairs = pairUp(smsPool, incoming);
  const matched = new Set(pairs.map(([, r]) => r.id));
  return {
    merges: pairs.map(([sms, row]) => ({ sms, merged: mergeInto(sms, row) })),
    rest: incoming.filter((t) => !matched.has(t.id)),
  };
}

/** SMS import: drop alerts already imported, or already covered by a statement row */
export function newSmsOnly(existing: Transaction[], incoming: Transaction[]) {
  const seen = new Set(existing.map((t) => t.smsId).filter(Boolean));
  const unseen = incoming.filter((t) => !seen.has(t.smsId));
  // Statement rows already merged with an SMS are taken
  const statementRows = existing.filter((t) => t.source !== 'sms' && !t.smsId);
  const covered = new Set(pairUp(unseen, statementRows).map(([s]) => s.id));
  const fresh = unseen.filter((t) => !covered.has(t.id));
  return { fresh, duplicates: incoming.length - fresh.length };
}

/** SMS entries inside the statement's date range that the statement doesn't contain */
export function unmatchedSms(all: Transaction[], statementRows: Transaction[]): Transaction[] {
  const ranges = new Map<string, [string, string]>();
  for (const t of statementRows) {
    const r = ranges.get(t.accountId);
    ranges.set(t.accountId, r ? [t.date < r[0] ? t.date : r[0], t.date > r[1] ? t.date : r[1]] : [t.date, t.date]);
  }
  return all.filter((t) => {
    const r = t.source === 'sms' && ranges.get(t.accountId);
    return !!r && t.date >= r[0] && t.date <= r[1];
  });
}
