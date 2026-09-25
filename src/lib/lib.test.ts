import { describe, expect, it } from 'vitest';
import { emi, depositValue, loanStatus, xirr, requiredSip, compoundSchedule } from './finance';
import { fyOf, fyMonths, addMonths, periodRange } from './dates';
import { computeRegime, computeTax, emptyTaxYear, hraExemption } from './tax';
import { adjustForInflation } from './inflation';
import { DEFAULT_CPI, DEFAULT_CATEGORIES } from './defaults';
import { getGSTRate, gstEmbedded } from './gst';
import { parseAmount } from './format';

describe('dates', () => {
  it('computes financial year', () => {
    expect(fyOf('2025-03-31')).toBe('2024-25');
    expect(fyOf('2025-04-01')).toBe('2025-26');
    expect(fyOf('1999-12-01')).toBe('1999-00');
  });
  it('lists FY months', () => {
    const m = fyMonths('2025-26');
    expect(m[0]).toBe('2025-04');
    expect(m[11]).toBe('2026-03');
  });
  it('adds months clamping day', () => {
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
  });
  it('quarter range', () => {
    expect(periodRange({ preset: 'quarter', quarter: '2025-26 Q4' })).toEqual({ start: '2026-01-01', end: '2026-03-31' });
  });
});

describe('format', () => {
  it('parses amounts', () => {
    expect(parseAmount('1,00,000.00')).toBe(100000);
    expect(parseAmount('₹ 500 Dr')).toBe(-500);
    expect(parseAmount('(1,000)')).toBe(-1000);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('1,000 Cr')).toBe(1000);
  });
});

describe('finance', () => {
  it('computes EMI', () => {
    expect(emi(1000000, 8.5, 240)).toBeCloseTo(8678.23, 1);
  });
  it('computes FD value at maturity', () => {
    const v = depositValue(
      { principal: 100000, rate: 7, startDate: '2024-01-01', maturityDate: '2024-12-31', compounding: 4, payout: 'cumulative' },
      false,
      '2025-06-01',
    );
    expect(v).toBeGreaterThan(107100);
    expect(v).toBeLessThan(107200);
  });
  it('computes RD value', () => {
    const v = depositValue(
      { principal: 0, installment: 1000, rate: 7, startDate: '2024-01-01', maturityDate: '2025-01-01', compounding: 4, payout: 'cumulative' },
      true,
      '2025-01-01',
    );
    expect(v).toBeGreaterThan(12000);
    expect(v).toBeLessThan(12500);
  });
  it('amortises loans and honours prepayments', () => {
    const base = { principal: 1000000, rate: 8.5, tenureMonths: 240, startDate: '2020-01-01', prepayments: [] };
    const s = loanStatus(base, '2100-01-01');
    expect(s.schedule.length).toBe(240);
    expect(s.outstanding).toBeLessThan(1);
    const withPrepay = loanStatus({ ...base, prepayments: [{ id: 'p', date: '2021-01-15', amount: 200000 }] }, '2100-01-01');
    expect(withPrepay.schedule.length).toBeLessThan(240);
    expect(withPrepay.totalInterest).toBeLessThan(s.totalInterest);
  });
  it('computes XIRR', () => {
    const r = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2025-01-01', amount: 1100 },
    ]);
    expect(r).toBeCloseTo(Math.pow(1.1, 365 / 366) - 1, 4);
    expect(xirr([{ date: '2024-01-01', amount: -1000 }])).toBeNull();
  });
  it('required SIP reaches the target', () => {
    const sip = requiredSip(1000000, 0, 0.12, 60);
    const rows = compoundSchedule(0, 12, 5, 12, sip, 0);
    expect(rows[4].nominalValue).toBeGreaterThan(980000);
    expect(rows[4].nominalValue).toBeLessThan(1020000);
  });
});

describe('income tax', () => {
  it('new regime FY 2025-26: zero tax up to 12L taxable', () => {
    const t = emptyTaxYear('2025-26');
    t.income.salary = 1275000;
    expect(computeRegime(t, 'new').totalTax).toBe(0);
  });
  it('new regime FY 2025-26: 13L taxable', () => {
    const t = emptyTaxYear('2025-26');
    t.income.salary = 1375000;
    expect(computeRegime(t, 'new').totalTax).toBe(78000);
  });
  it('new regime FY 2025-26: marginal relief just above 12L', () => {
    const t = emptyTaxYear('2025-26');
    t.income.salary = 1285000;
    expect(computeRegime(t, 'new').totalTax).toBe(10400);
  });
  it('old regime with 80C', () => {
    const t = emptyTaxYear('2025-26');
    t.income.salary = 1000000;
    t.deductions.c80 = 200000; // capped at 1.5L
    expect(computeRegime(t, 'old').totalTax).toBe(75400);
  });
  it('new regime FY 2023-24', () => {
    const t = emptyTaxYear('2023-24');
    t.income.salary = 1000000;
    expect(computeRegime(t, 'new').totalTax).toBe(54600);
  });
  it('equity LTCG exemption and rates', () => {
    const t = emptyTaxYear('2025-26');
    t.income.salary = 2000000;
    t.capitalGains.ltcgEquity = 225000; // 1L taxable at 12.5%
    const n = computeRegime(t, 'new');
    const base = emptyTaxYear('2025-26');
    base.income.salary = 2000000;
    expect(n.totalTax - computeRegime(base, 'new').totalTax).toBe(13000);
  });
  it('picks the better regime and balance', () => {
    const t = emptyTaxYear('2025-26');
    t.income.salary = 1500000;
    t.payments.push({ id: 'x', date: '2025-06-01', kind: 'tds', amount: 50000 });
    const s = computeTax(t);
    expect(s.better).toBe('new');
    expect(s.balance).toBe(s.new.totalTax - 50000);
  });
  it('HRA exemption', () => {
    expect(hraExemption(600000, 240000, 300000, true)).toBe(240000);
    expect(hraExemption(600000, 240000, 120000, false)).toBe(60000);
  });
});

describe('inflation', () => {
  it('adjusts money across years', () => {
    const v = adjustForInflation(DEFAULT_CPI, 100, '2023-04-01', '2024-04-01');
    expect(v).toBeCloseTo(105.4, 1);
  });
});

describe('gst', () => {
  const food = DEFAULT_CATEGORIES.find((c) => c.id === 'food');
  const shopping = DEFAULT_CATEGORIES.find((c) => c.id === 'shopping');
  it('is date aware', () => {
    expect(getGSTRate(food, 'Restaurants', '2017-08-01')).toBe(0.12);
    expect(getGSTRate(food, 'Restaurants', '2018-01-01')).toBe(0.05);
    expect(getGSTRate(shopping, 'Electronics', '2024-01-01')).toBe(0.28);
    expect(getGSTRate(shopping, 'Electronics', '2025-10-01')).toBe(0.18);
  });
  it('extracts GST from inclusive price', () => {
    expect(gstEmbedded(118, 0.18)).toBeCloseTo(18, 6);
  });
});
