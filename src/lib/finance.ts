import type { DepositDetails, ISODate, Liability } from '../types';
import { addMonths, daysBetween, monthsBetween, parseISO, todayISO } from './dates';

// ─── Deposits (FD / RD) ─────────────────────────────────────────────────────

function yearsBetween(a: ISODate, b: ISODate): number {
  return Math.max(0, daysBetween(a, b)) / 365;
}

/** Value of a deposit as of a date (accrued interest included; capped at maturity) */
export function depositValue(d: DepositDetails, isRD: boolean, asOf: ISODate = todayISO()): number {
  if (asOf < d.startDate) return 0;
  const end = asOf > d.maturityDate ? d.maturityDate : asOf;
  const r = d.rate / 100;
  const n = d.compounding;
  if (!isRD) {
    if (d.payout === 'payout') return d.principal;
    return d.principal * Math.pow(1 + r / n, n * yearsBetween(d.startDate, end));
  }
  const inst = d.installment ?? 0;
  const tenure = Math.max(1, monthsBetween(d.startDate, d.maturityDate));
  const paid = Math.min(tenure, monthsBetween(d.startDate, end) + 1);
  let total = 0;
  for (let i = 0; i < paid; i++) {
    const paidOn = addMonths(d.startDate, i);
    total += inst * Math.pow(1 + r / n, n * yearsBetween(paidOn, end));
  }
  return total;
}

export function depositInvested(d: DepositDetails, isRD: boolean, asOf: ISODate = todayISO()): number {
  if (asOf < d.startDate) return 0;
  if (!isRD) return d.principal;
  const end = asOf > d.maturityDate ? d.maturityDate : asOf;
  const tenure = Math.max(1, monthsBetween(d.startDate, d.maturityDate));
  const paid = Math.min(tenure, monthsBetween(d.startDate, end) + 1);
  return paid * (d.installment ?? 0);
}

export function depositMaturity(d: DepositDetails, isRD: boolean): number {
  if (!isRD && d.payout === 'payout') {
    return d.principal;
  }
  return depositValue(d, isRD, d.maturityDate);
}

/** Cash flows implied by a deposit (for XIRR) */
export function depositFlows(d: DepositDetails, isRD: boolean, asOf: ISODate = todayISO()) {
  if (!isRD) return [{ date: d.startDate, amount: d.principal }];
  const end = asOf > d.maturityDate ? d.maturityDate : asOf;
  const tenure = Math.max(1, monthsBetween(d.startDate, d.maturityDate));
  const paid = Math.min(tenure, monthsBetween(d.startDate, end) + 1);
  return Array.from({ length: Math.max(0, paid) }, (_, i) => ({
    date: addMonths(d.startDate, i),
    amount: d.installment ?? 0,
  }));
}

// ─── Loans ──────────────────────────────────────────────────────────────────

export function emi(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRate / 1200;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

export interface AmortRow {
  n: number;
  date: ISODate;
  emi: number;
  interest: number;
  principal: number;
  prepayment: number;
  balance: number;
}

export interface LoanStatus {
  emi: number;
  schedule: AmortRow[];
  outstanding: number;
  interestPaid: number;
  principalPaid: number;
  totalInterest: number;
  endDate: ISODate;
  paidEmis: number;
  remainingEmis: number;
}

/** Amortisation with prepayments (EMI kept constant → tenure shortens) */
export function loanStatus(loan: NonNullable<Liability['loan']>, asOf: ISODate = todayISO()): LoanStatus {
  const payment = emi(loan.principal, loan.rate, loan.tenureMonths);
  const r = loan.rate / 1200;
  const prepay = [...loan.prepayments].sort((a, b) => a.date.localeCompare(b.date));
  let balance = loan.principal;
  const schedule: AmortRow[] = [];
  let pi = 0;
  for (let n = 1; n <= loan.tenureMonths * 2 && balance > 0.5; n++) {
    const date = addMonths(loan.startDate, n);
    let prepayment = 0;
    while (pi < prepay.length && prepay[pi].date <= date) {
      prepayment += prepay[pi].amount;
      pi++;
    }
    balance = Math.max(0, balance - prepayment);
    const interest = balance * r;
    const principal = Math.min(balance, payment - interest);
    balance = Math.max(0, balance - principal);
    schedule.push({ n, date, emi: principal + interest, interest, principal, prepayment, balance });
  }
  const paid = schedule.filter((row) => row.date <= asOf);
  const last = paid[paid.length - 1];
  return {
    emi: payment,
    schedule,
    outstanding: asOf < loan.startDate ? 0 : last ? last.balance : loan.principal,
    interestPaid: paid.reduce((s, x) => s + x.interest, 0),
    principalPaid: paid.reduce((s, x) => s + x.principal + x.prepayment, 0),
    totalInterest: schedule.reduce((s, x) => s + x.interest, 0),
    endDate: schedule.length ? schedule[schedule.length - 1].date : loan.startDate,
    paidEmis: paid.length,
    remainingEmis: schedule.length - paid.length,
  };
}

// ─── Returns ────────────────────────────────────────────────────────────────

export interface DatedAmount {
  date: ISODate;
  amount: number;
}

/**
 * XIRR. Sign convention: money invested negative, money received / current value positive.
 * Returns annualised rate (0.12 = 12%) or null if it can't be computed.
 */
export function xirr(flows: DatedAmount[]): number | null {
  const cf = flows.filter((f) => f.amount !== 0);
  if (cf.length < 2) return null;
  if (!cf.some((f) => f.amount > 0) || !cf.some((f) => f.amount < 0)) return null;
  const t0 = parseISO(cf.reduce((m, f) => (f.date < m ? f.date : m), cf[0].date)).getTime();
  const ts = cf.map((f) => (parseISO(f.date).getTime() - t0) / (365 * 86400000));
  const npv = (rate: number) => cf.reduce((s, f, i) => s + f.amount / Math.pow(1 + rate, ts[i]), 0);
  const dnpv = (rate: number) => cf.reduce((s, f, i) => s - (ts[i] * f.amount) / Math.pow(1 + rate, ts[i] + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate);
    const d = dnpv(rate);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = rate - v / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }
  // Bisection fallback
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function cagr(start: number, end: number, years: number): number | null {
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

// ─── Planning helpers ───────────────────────────────────────────────────────

export function futureValue(pv: number, annualRate: number, years: number): number {
  return pv * Math.pow(1 + annualRate, years);
}

/** Monthly SIP needed to reach target in `months`, given already-saved corpus */
export function requiredSip(target: number, saved: number, annualRate: number, months: number): number {
  if (months <= 0) return Math.max(0, target - saved);
  const r = annualRate / 12;
  const fvSaved = saved * Math.pow(1 + r, months);
  const gap = target - fvSaved;
  if (gap <= 0) return 0;
  if (r === 0) return gap / months;
  // SIP paid at the start of each month
  return gap / (((Math.pow(1 + r, months) - 1) / r) * (1 + r));
}

export interface CompoundRow {
  year: number;
  nominalValue: number;
  realValue: number;
  totalInvested: number;
  realCostBasis: number;
  realGain: number;
  interestEarned: number;
  inflationEaten: number;
}

/** Year-by-year growth of a lump sum + monthly SIP, with inflation-adjusted values */
export function compoundSchedule(
  principal: number,
  annualRatePct: number,
  years: number,
  compoundingPerYear: number,
  monthlySip: number,
  inflationPct: number,
  sipStepUpPct = 0,
): CompoundRow[] {
  const r = annualRatePct / 100;
  const inf = inflationPct / 100;
  const out: CompoundRow[] = [];
  let value = principal;
  let invested = principal;
  let realCost = principal;
  let months = 0;
  let sip = monthlySip;
  for (let yr = 1; yr <= years; yr++) {
    for (let m = 0; m < 12; m++) {
      months++;
      value *= Math.pow(1 + r / compoundingPerYear, compoundingPerYear / 12);
      value += sip;
      invested += sip;
      realCost += sip / Math.pow(1 + inf, months / 12);
    }
    const realValue = value / Math.pow(1 + inf, yr);
    out.push({
      year: yr,
      nominalValue: value,
      realValue,
      totalInvested: invested,
      realCostBasis: realCost,
      realGain: realValue - realCost,
      interestEarned: value - invested,
      inflationEaten: value - realValue,
    });
    sip *= 1 + sipStepUpPct / 100;
  }
  return out;
}

/** Fisher equation: real return from nominal and inflation */
export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}
