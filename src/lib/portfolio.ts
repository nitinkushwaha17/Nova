import type { Account, Asset, AssetType, ISODate, Liability, LiabilityType, NetWorthSnapshot, SummariesDoc } from '../types';
import { depositFlows, depositInvested, depositMaturity, depositValue, loanStatus, xirr } from './finance';
import { todayISO } from './dates';

export const ASSET_TYPES: Record<AssetType, { label: string; color: string; group: string }> = {
  fd: { label: 'Fixed Deposit', color: '#60a5fa', group: 'Debt' },
  rd: { label: 'Recurring Deposit', color: '#38bdf8', group: 'Debt' },
  mutual_fund: { label: 'Mutual Fund', color: '#a78bfa', group: 'Equity' },
  stocks: { label: 'Stocks', color: '#818cf8', group: 'Equity' },
  ppf: { label: 'PPF', color: '#34d399', group: 'Debt' },
  epf: { label: 'EPF / VPF', color: '#2dd4bf', group: 'Debt' },
  nps: { label: 'NPS', color: '#4ade80', group: 'Retirement' },
  gold: { label: 'Gold', color: '#fbbf24', group: 'Gold' },
  bond: { label: 'Bonds', color: '#22d3ee', group: 'Debt' },
  real_estate: { label: 'Real Estate', color: '#fb923c', group: 'Real Estate' },
  crypto: { label: 'Crypto', color: '#f472b6', group: 'Alternative' },
  cash: { label: 'Cash', color: '#a3e635', group: 'Cash' },
  other: { label: 'Other', color: '#94a3b8', group: 'Other' },
};

export const LIABILITY_TYPES: Record<LiabilityType, { label: string; color: string }> = {
  home_loan: { label: 'Home Loan', color: '#f87171' },
  car_loan: { label: 'Car Loan', color: '#fb923c' },
  personal_loan: { label: 'Personal Loan', color: '#fbbf24' },
  education_loan: { label: 'Education Loan', color: '#facc15' },
  gold_loan: { label: 'Gold Loan', color: '#eab308' },
  credit_card: { label: 'Credit Card', color: '#f472b6' },
  other: { label: 'Other', color: '#94a3b8' },
};

export const isDeposit = (a: Asset) => (a.type === 'fd' || a.type === 'rd') && !!a.deposit;

function latestValuation(list: { date: ISODate; value: number }[], asOf: ISODate) {
  return [...list].filter((v) => v.date <= asOf).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export interface AssetMetrics {
  value: number;
  invested: number;
  gain: number;
  gainPct: number | null;
  xirr: number | null;
  valueDate: ISODate | null;
  maturityValue?: number;
  navUsed?: { nav: number; date: string };
}

/** Current (or as-of) value of an asset. `navs` maps MF scheme code → latest NAV. */
export function assetMetrics(
  a: Asset,
  navs: Record<string, { nav: number; date: string }> = {},
  asOf: ISODate = todayISO(),
): AssetMetrics {
  if (isDeposit(a)) {
    const isRD = a.type === 'rd';
    const value = a.closed ? 0 : depositValue(a.deposit!, isRD, asOf);
    const invested = depositInvested(a.deposit!, isRD, asOf);
    const flows = depositFlows(a.deposit!, isRD, asOf).map((f) => ({ date: f.date, amount: -f.amount }));
    return {
      value,
      invested,
      gain: value - invested,
      gainPct: invested ? (value - invested) / invested : null,
      xirr: value > 0 ? xirr([...flows, { date: asOf, amount: value }]) : null,
      valueDate: asOf,
      maturityValue: depositMaturity(a.deposit!, isRD),
    };
  }
  const flows = a.flows.filter((f) => f.date <= asOf);
  const invested = flows.reduce((s, f) => s + f.amount, 0);
  let value = 0;
  let valueDate: ISODate | null = null;
  let navUsed: AssetMetrics['navUsed'];
  const code = a.mf?.schemeCode;
  if (a.type === 'mutual_fund' && code && navs[code] && a.mf!.units > 0 && asOf === todayISO()) {
    value = a.mf!.units * navs[code].nav;
    valueDate = asOf;
    navUsed = navs[code];
  } else {
    const v = latestValuation(a.valuations, asOf);
    value = v ? v.value : Math.max(0, invested);
    valueDate = v?.date ?? null;
  }
  if (a.closed) value = 0;
  const cf = [...flows.map((f) => ({ date: f.date, amount: -f.amount })), { date: asOf, amount: value }];
  return {
    value,
    invested,
    gain: value - invested,
    gainPct: invested > 0 ? (value - invested) / invested : null,
    xirr: xirr(cf),
    valueDate,
    navUsed,
  };
}

export function liabilityOutstanding(l: Liability, asOf: ISODate = todayISO()): number {
  if (l.closed) return 0;
  const manual = latestValuation(l.valuations, asOf);
  if (l.loan) {
    const computed = loanStatus(l.loan, asOf).outstanding;
    // A manual value newer than the loan start overrides the computed schedule
    return manual && manual.date >= l.loan.startDate ? manual.value : computed;
  }
  return manual?.value ?? 0;
}

/** Latest known balance for each account (from statements or manual override) */
export function accountBalances(accounts: Account[], summaries: SummariesDoc): Record<string, { date: ISODate; balance: number }> {
  const out: Record<string, { date: ISODate; balance: number }> = {};
  for (const s of Object.values(summaries)) {
    for (const [id, b] of Object.entries(s.lastBalances)) {
      if (!out[id] || b.date > out[id].date) out[id] = b;
    }
  }
  for (const a of accounts) {
    if (a.manualBalance && (!out[a.id] || a.manualBalance.date >= out[a.id].date)) {
      out[a.id] = { date: a.manualBalance.date, balance: a.manualBalance.value };
    }
  }
  return out;
}

export interface NetWorth {
  assets: number;
  liabilities: number;
  netWorth: number;
  bank: number;
  byAssetType: Partial<Record<AssetType | 'bank', number>>;
  byLiabilityType: Partial<Record<LiabilityType, number>>;
}

export function computeNetWorth(
  assets: Asset[],
  liabilities: Liability[],
  accounts: Account[],
  summaries: SummariesDoc,
  navs: Record<string, { nav: number; date: string }> = {},
): NetWorth {
  const byAssetType: NetWorth['byAssetType'] = {};
  let total = 0;
  for (const a of assets) {
    const v = assetMetrics(a, navs).value;
    byAssetType[a.type] = (byAssetType[a.type] ?? 0) + v;
    total += v;
  }
  const balances = accountBalances(accounts, summaries);
  let bank = 0;
  let cardDebt = 0;
  for (const acc of accounts) {
    if (!acc.includeInNetWorth || acc.archived) continue;
    const b = balances[acc.id]?.balance ?? 0;
    if (acc.type === 'credit_card') cardDebt += Math.abs(b);
    else bank += b;
  }
  if (bank) byAssetType.bank = bank;
  total += bank;
  const byLiabilityType: NetWorth['byLiabilityType'] = {};
  let liab = 0;
  for (const l of liabilities) {
    const v = liabilityOutstanding(l);
    byLiabilityType[l.type] = (byLiabilityType[l.type] ?? 0) + v;
    liab += v;
  }
  if (cardDebt) {
    byLiabilityType.credit_card = (byLiabilityType.credit_card ?? 0) + cardDebt;
    liab += cardDebt;
  }
  return { assets: total, liabilities: liab, netWorth: total - liab, bank, byAssetType, byLiabilityType };
}

export function snapshotFrom(nw: NetWorth, date: ISODate = todayISO()): NetWorthSnapshot {
  return {
    month: date.slice(0, 7),
    date,
    assets: Math.round(nw.assets),
    liabilities: Math.round(nw.liabilities),
    netWorth: Math.round(nw.netWorth),
    byAssetType: Object.fromEntries(Object.entries(nw.byAssetType).map(([k, v]) => [k, Math.round(v ?? 0)])),
  };
}

/** Insert or replace this month's snapshot */
export function upsertSnapshot(list: NetWorthSnapshot[], snap: NetWorthSnapshot): NetWorthSnapshot[] {
  const rest = list.filter((s) => s.month !== snap.month);
  return [...rest, snap].sort((a, b) => a.month.localeCompare(b.month));
}
