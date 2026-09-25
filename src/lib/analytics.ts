import type { Category, Transaction, TaxYear } from '../types';
import { daysBetween, fyRange, type Period, periodRange } from './dates';
import { classify } from './transactions';
import { computeTax } from './tax';

export interface CategoryAgg {
  id: string;
  name: string;
  color: string;
  amount: number;
  count: number;
  subs: { name: string; amount: number; count: number }[];
}

export interface MonthAgg {
  month: string;
  income: number;
  expense: number;
  investment: number;
  net: number;
}

export interface Analysis {
  income: number;
  expense: number;
  investment: number;
  refunds: number;
  savings: number;
  savingsRate: number | null;
  count: number;
  byCategory: CategoryAgg[];
  incomeByCategory: CategoryAgg[];
  byMonth: MonthAgg[];
  largest: Transaction[];
}

const UNCAT = { id: '__none', name: 'Uncategorised', color: '#64748b' };

function bump(map: Map<string, CategoryAgg>, cat: Category | undefined, sub: string | null | undefined, amount: number) {
  const key = cat?.id ?? UNCAT.id;
  let agg = map.get(key);
  if (!agg) {
    agg = { id: key, name: cat?.name ?? UNCAT.name, color: cat?.color ?? UNCAT.color, amount: 0, count: 0, subs: [] };
    map.set(key, agg);
  }
  agg.amount += amount;
  agg.count++;
  const subName = sub || 'Other';
  let s = agg.subs.find((x) => x.name === subName);
  if (!s) agg.subs.push((s = { name: subName, amount: 0, count: 0 }));
  s.amount += amount;
  s.count++;
}

/** Aggregate a set of transactions (transfers excluded; refunds net against their expense category) */
export function analyze(txns: Transaction[], catMap: Map<string, Category>): Analysis {
  let income = 0;
  let expense = 0;
  let investment = 0;
  let refunds = 0;
  let count = 0;
  const cats = new Map<string, CategoryAgg>();
  const incomeCats = new Map<string, CategoryAgg>();
  const months = new Map<string, MonthAgg>();
  const expenses: Transaction[] = [];

  for (const t of txns) {
    const cat = t.category ? catMap.get(t.category) : undefined;
    const kind = classify(t, cat);
    if (kind === 'transfer') continue;
    count++;
    const ym = t.date.slice(0, 7);
    let m = months.get(ym);
    if (!m) months.set(ym, (m = { month: ym, income: 0, expense: 0, investment: 0, net: 0 }));
    if (kind === 'income') {
      income += t.amount;
      m.income += t.amount;
      bump(incomeCats, cat, t.subcategory, t.amount);
    } else if (kind === 'expense' || kind === 'refund') {
      const amt = -t.amount;
      expense += amt;
      m.expense += amt;
      if (kind === 'refund') refunds += t.amount;
      else expenses.push(t);
      bump(cats, cat, t.subcategory, amt);
    } else if (kind === 'investment') {
      investment -= t.amount;
      m.investment -= t.amount;
    }
  }
  for (const m of months.values()) m.net = m.income - m.expense - m.investment;
  const sortAgg = (list: CategoryAgg[]) => {
    for (const c of list) c.subs.sort((a, b) => b.amount - a.amount);
    return list.filter((c) => Math.abs(c.amount) > 0.005).sort((a, b) => b.amount - a.amount);
  };
  const savings = income - expense;
  return {
    income,
    expense,
    investment,
    refunds,
    savings,
    savingsRate: income > 0 ? savings / income : null,
    count,
    byCategory: sortAgg([...cats.values()]),
    incomeByCategory: sortAgg([...incomeCats.values()]),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    largest: expenses.sort((a, b) => a.amount - b.amount).slice(0, 10),
  };
}

/** Income-tax liability for a FY (computed if income entered, otherwise what was paid) */
export function directTaxForFY(t: TaxYear | undefined): number {
  if (!t) return 0;
  const s = computeTax(t);
  return s.chosen.totalTax > 0 ? s.chosen.totalTax : s.paid;
}

/** Share of each FY's direct tax that falls inside the period (by overlapping days) */
export function proportionalDirectTax(period: Period, taxByFY: Record<string, TaxYear>): number {
  const r = periodRange(period);
  let total = 0;
  for (const [fy, t] of Object.entries(taxByFY)) {
    const tax = directTaxForFY(t);
    if (!tax) continue;
    if (!r) {
      total += tax;
      continue;
    }
    const fr = fyRange(fy);
    const start = r.start > fr.start ? r.start : fr.start;
    const end = r.end < fr.end ? r.end : fr.end;
    if (end < start) continue;
    total += (tax * (daysBetween(start, end) + 1)) / (daysBetween(fr.start, fr.end) + 1);
  }
  return total;
}
