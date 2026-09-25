import type { Category, FYSummary, MonthSummary, Rule, Transaction } from '../types';
import { daysBetween, fyOf, parseISO } from './dates';

export type TxKind = 'income' | 'expense' | 'refund' | 'investment' | 'transfer';

const AUTO_TRANSFER_PATTERNS = [/\bSWEEP\b/i, /TRANSFER CREDIT/i, /TRF CREDT/i, /\bSELF\b.*\bTRANSFER\b/i];

export function looksLikeTransfer(description: string): boolean {
  return AUTO_TRANSFER_PATTERNS.some((re) => re.test(description));
}

export function isTransfer(t: Transaction, cat?: Category): boolean {
  if (t.isTransfer === true) return true;
  if (t.isTransfer === false) return false;
  if (cat?.kind === 'transfer') return true;
  return !!t.autoTransfer || looksLikeTransfer(t.description);
}

export function classify(t: Transaction, cat?: Category): TxKind {
  if (isTransfer(t, cat)) return 'transfer';
  if (cat?.kind === 'investment') return 'investment';
  if (t.amount > 0) return cat?.kind === 'expense' ? 'refund' : 'income';
  return 'expense';
}

// ─── Descriptions / merchants ───────────────────────────────────────────────

export function cleanDescription(description: string): string {
  if (!description) return '';
  return description
    .replace(/(TO|BY) TRANSFER-UPI\/[A-Z]+\/\d+\//gi, 'UPI/')
    .replace(/UPI\/(DR|CR)\/\d+\//gi, 'UPI/')
    .replace(/\/(DR|CR)\/\d+\//gi, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE = new Set([
  'UPI', 'IMPS', 'NEFT', 'RTGS', 'TO', 'BY', 'TRANSFER', 'DR', 'CR', 'PAYMENT', 'P2A', 'P2M', 'POS', 'ECOM', 'ACH', 'NACH',
  'YESB', 'HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'PYTM', 'AIRP', 'IBKL', 'BARB', 'PUNB', 'CNRB', 'IDFB', 'INDB', 'FDRL',
  'OK', 'OKSBI', 'OKAXIS', 'OKHDFCBANK', 'OKICICI', 'YBL', 'PAYTM', 'APL', 'IBL', 'AXL',
]);

/** Best-effort merchant/payee name from a bank narration */
export function merchantOf(description: string): string {
  const parts = cleanDescription(description)
    .toUpperCase()
    .split(/[/\-*|:@]+/)
    .map((p) => p.replace(/\d+/g, ' ').replace(/[^A-Z&. ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 3 && !NOISE.has(p) && !/^(MR|MRS|MS)\.?$/.test(p));
  const name = parts[0] ?? description.slice(0, 24).toUpperCase();
  return name
    .split(' ')
    .filter((w) => !NOISE.has(w))
    .slice(0, 3)
    .join(' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim() || 'Unknown';
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export function ruleMatches(rule: Rule, t: Transaction): boolean {
  if (rule.direction === 'debit' && t.amount >= 0) return false;
  if (rule.direction === 'credit' && t.amount <= 0) return false;
  const text = `${t.description} ${t.rawDescription ?? ''}`;
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  }
  return text.toUpperCase().includes(rule.pattern.toUpperCase());
}

export function findRule(rules: Rule[], t: Transaction): Rule | undefined {
  return [...rules].sort((a, b) => b.priority - a.priority).find((r) => r.pattern && ruleMatches(r, t));
}

/** Returns new array with rules applied; counts how many changed */
export function applyRules(txns: Transaction[], rules: Rule[], overwrite = false): { txns: Transaction[]; changed: number } {
  const sorted = [...rules].filter((r) => r.pattern).sort((a, b) => b.priority - a.priority);
  let changed = 0;
  const out = txns.map((t) => {
    if (t.category && !overwrite) return t;
    const r = sorted.find((rule) => ruleMatches(rule, t));
    if (!r) return t;
    if (t.category === r.category && (t.subcategory ?? '') === (r.subcategory ?? '')) return t;
    changed++;
    return { ...t, category: r.category, subcategory: r.subcategory || null };
  });
  return { txns: out, changed };
}

// ─── Dedupe / transfers ─────────────────────────────────────────────────────

export function txSignature(t: Transaction): string {
  const desc = (t.rawDescription ?? t.description).toUpperCase().replace(/\s+/g, '');
  return `${t.accountId}|${t.date}|${t.amount.toFixed(2)}|${desc}|${t.balance ?? ''}`;
}

/** Split incoming into new vs duplicates (multiset-aware, so repeated identical rows aren't collapsed) */
export function dedupe(existing: Transaction[], incoming: Transaction[]) {
  const counts = new Map<string, number>();
  for (const t of existing) {
    const s = txSignature(t);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const fresh: Transaction[] = [];
  const dupes: Transaction[] = [];
  for (const t of incoming) {
    const s = txSignature(t);
    const c = counts.get(s) ?? 0;
    if (c > 0) {
      counts.set(s, c - 1);
      dupes.push(t);
    } else fresh.push(t);
  }
  return { fresh, dupes };
}

/**
 * Find self-transfer pairs: a debit in one account matched by a credit of the same amount in
 * another of your accounts within `windowDays`. Returns ids to mark as auto transfers.
 */
export function detectTransferPairs(txns: Transaction[], windowDays = 3): Set<string> {
  const ids = new Set<string>();
  const credits = txns.filter((t) => t.amount > 0 && t.isTransfer !== false);
  const used = new Set<string>();
  const byAmount = new Map<string, Transaction[]>();
  for (const c of credits) {
    const k = c.amount.toFixed(2);
    byAmount.set(k, [...(byAmount.get(k) ?? []), c]);
  }
  for (const d of txns) {
    if (d.amount >= 0 || d.isTransfer === false) continue;
    const candidates = byAmount.get((-d.amount).toFixed(2)) ?? [];
    const match = candidates.find(
      (c) => !used.has(c.id) && c.accountId !== d.accountId && Math.abs(daysBetween(d.date, c.date)) <= windowDays,
    );
    if (match) {
      used.add(match.id);
      ids.add(match.id);
      ids.add(d.id);
    }
  }
  return ids;
}

// ─── Summaries ──────────────────────────────────────────────────────────────

export function emptyMonth(): MonthSummary {
  return { income: 0, expense: 0, investment: 0, transferIn: 0, transferOut: 0, expenseByCategory: {}, incomeByCategory: {}, count: 0 };
}

export function addToMonth(m: MonthSummary, t: Transaction, cat?: Category) {
  const kind = classify(t, cat);
  const key = t.category || 'uncategorized';
  m.count++;
  switch (kind) {
    case 'transfer':
      if (t.amount > 0) m.transferIn += t.amount;
      else m.transferOut -= t.amount;
      break;
    case 'investment':
      m.investment -= t.amount;
      break;
    case 'income':
      m.income += t.amount;
      m.incomeByCategory[key] = (m.incomeByCategory[key] ?? 0) + t.amount;
      break;
    case 'refund':
    case 'expense':
      m.expense -= t.amount;
      m.expenseByCategory[key] = (m.expenseByCategory[key] ?? 0) - t.amount;
      break;
  }
}

export function summarize(txns: Transaction[], catMap: Map<string, Category>): FYSummary {
  const months: Record<string, MonthSummary> = {};
  const lastBalances: FYSummary['lastBalances'] = {};
  for (const t of txns) {
    const ym = t.date.slice(0, 7);
    const m = (months[ym] ??= emptyMonth());
    addToMonth(m, t, t.category ? catMap.get(t.category) : undefined);
    if (t.balance != null) {
      const cur = lastBalances[t.accountId];
      if (!cur || t.date >= cur.date) lastBalances[t.accountId] = { date: t.date, balance: t.balance };
    }
  }
  return { months, count: txns.length, lastBalances, updatedAt: new Date().toISOString() };
}

export function mergeMonths(list: MonthSummary[]): MonthSummary {
  const out = emptyMonth();
  for (const m of list) {
    out.income += m.income;
    out.expense += m.expense;
    out.investment += m.investment;
    out.transferIn += m.transferIn;
    out.transferOut += m.transferOut;
    out.count += m.count;
    for (const [k, v] of Object.entries(m.expenseByCategory)) out.expenseByCategory[k] = (out.expenseByCategory[k] ?? 0) + v;
    for (const [k, v] of Object.entries(m.incomeByCategory)) out.incomeByCategory[k] = (out.incomeByCategory[k] ?? 0) + v;
  }
  return out;
}

export function groupByFY(txns: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const t of txns) {
    const fy = fyOf(t.date);
    const arr = map.get(fy);
    if (arr) arr.push(t);
    else map.set(fy, [t]);
  }
  return map;
}

export function sortTxns(txns: Transaction[]): Transaction[] {
  return [...txns].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

// ─── Recurring payments ─────────────────────────────────────────────────────

export interface Recurring {
  merchant: string;
  category?: string | null;
  avgAmount: number;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  occurrences: number;
  lastDate: string;
  nextDate: string;
  yearlyCost: number;
}

export function detectRecurring(txns: Transaction[], catMap: Map<string, Category>): Recurring[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const kind = classify(t, t.category ? catMap.get(t.category) : undefined);
    if (kind === 'transfer') continue;
    const m = merchantOf(t.description);
    if (m === 'Unknown') continue;
    groups.set(m, [...(groups.get(m) ?? []), t]);
  }
  const out: Recurring[] = [];
  for (const [merchant, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((t) => -t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const similar = sorted.filter((t) => Math.abs(-t.amount - median) <= Math.max(1, median * 0.2));
    if (similar.length < 3) continue;
    const gaps: number[] = [];
    for (let i = 1; i < similar.length; i++) gaps.push(daysBetween(similar[i - 1].date, similar[i].date));
    const gs = [...gaps].sort((a, b) => a - b);
    const gap = gs[Math.floor(gs.length / 2)];
    const regular = gaps.filter((g) => Math.abs(g - gap) <= Math.max(4, gap * 0.25)).length / gaps.length >= 0.6;
    if (!regular) continue;
    let frequency: Recurring['frequency'] | null = null;
    if (gap >= 5 && gap <= 9) frequency = 'weekly';
    else if (gap >= 25 && gap <= 35) frequency = 'monthly';
    else if (gap >= 80 && gap <= 100) frequency = 'quarterly';
    else if (gap >= 350 && gap <= 380) frequency = 'yearly';
    if (!frequency) continue;
    const avg = similar.reduce((s, t) => s - t.amount, 0) / similar.length;
    const last = similar[similar.length - 1];
    const next = parseISO(last.date);
    next.setDate(next.getDate() + gap);
    const perYear = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }[frequency];
    out.push({
      merchant,
      category: last.category,
      avgAmount: avg,
      frequency,
      occurrences: similar.length,
      lastDate: last.date,
      nextDate: next.toISOString().slice(0, 10),
      yearlyCost: avg * perYear,
    });
  }
  return out.sort((a, b) => b.yearlyCost - a.yearlyCost);
}

export function topMerchants(txns: Transaction[], catMap: Map<string, Category>, limit = 10) {
  const map = new Map<string, { amount: number; count: number }>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const kind = classify(t, t.category ? catMap.get(t.category) : undefined);
    if (kind !== 'expense') continue;
    const m = merchantOf(t.description);
    const cur = map.get(m) ?? { amount: 0, count: 0 };
    cur.amount -= t.amount;
    cur.count++;
    map.set(m, cur);
  }
  return [...map.entries()]
    .map(([merchant, v]) => ({ merchant, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
