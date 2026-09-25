import type { AgeBand, FY, Regime, TaxYear } from '../types';
import { fyStartYear } from './dates';

/**
 * Indian income-tax computation (individual, resident).
 * Covers FY 2023-24 onwards. Rules for later years fall back to the latest known year.
 */

type Slab = [upto: number, rate: number];

interface RegimeRules {
  slabs: (age: AgeBand) => Slab[];
  standardDeduction: number;
  rebateLimit: number;
  rebateMax: number;
  /** Marginal relief on 87A rebate (new regime) */
  rebateMarginalRelief: boolean;
  maxSurcharge: number;
}

interface YearRules {
  new: RegimeRules;
  old: RegimeRules;
  stcgEquityRate: number;
  ltcgEquityRate: number;
  ltcgEquityExemption: number;
  ltcgOtherRate: number;
}

const OLD_SLABS = (age: AgeBand): Slab[] => {
  const exempt = age === 'above80' ? 500000 : age === '60to80' ? 300000 : 250000;
  return [
    [exempt, 0],
    [500000, 0.05],
    [1000000, 0.2],
    [Infinity, 0.3],
  ];
};

const OLD: RegimeRules = {
  slabs: OLD_SLABS,
  standardDeduction: 50000,
  rebateLimit: 500000,
  rebateMax: 12500,
  rebateMarginalRelief: false,
  maxSurcharge: 0.37,
};

const RULES: Record<number, YearRules> = {
  2023: {
    new: {
      slabs: () => [
        [300000, 0],
        [600000, 0.05],
        [900000, 0.1],
        [1200000, 0.15],
        [1500000, 0.2],
        [Infinity, 0.3],
      ],
      standardDeduction: 50000,
      rebateLimit: 700000,
      rebateMax: 25000,
      rebateMarginalRelief: true,
      maxSurcharge: 0.25,
    },
    old: OLD,
    stcgEquityRate: 0.15,
    ltcgEquityRate: 0.1,
    ltcgEquityExemption: 100000,
    ltcgOtherRate: 0.2,
  },
  2024: {
    new: {
      slabs: () => [
        [300000, 0],
        [700000, 0.05],
        [1000000, 0.1],
        [1200000, 0.15],
        [1500000, 0.2],
        [Infinity, 0.3],
      ],
      standardDeduction: 75000,
      rebateLimit: 700000,
      rebateMax: 25000,
      rebateMarginalRelief: true,
      maxSurcharge: 0.25,
    },
    old: OLD,
    // Rates effective 23-Jul-2024 (applied to the full year for simplicity)
    stcgEquityRate: 0.2,
    ltcgEquityRate: 0.125,
    ltcgEquityExemption: 125000,
    ltcgOtherRate: 0.125,
  },
  2025: {
    new: {
      slabs: () => [
        [400000, 0],
        [800000, 0.05],
        [1200000, 0.1],
        [1600000, 0.15],
        [2000000, 0.2],
        [2400000, 0.25],
        [Infinity, 0.3],
      ],
      standardDeduction: 75000,
      rebateLimit: 1200000,
      rebateMax: 60000,
      rebateMarginalRelief: true,
      maxSurcharge: 0.25,
    },
    old: OLD,
    stcgEquityRate: 0.2,
    ltcgEquityRate: 0.125,
    ltcgEquityExemption: 125000,
    ltcgOtherRate: 0.125,
  },
};

export function rulesFor(fy: FY): YearRules {
  const y = fyStartYear(fy);
  const years = Object.keys(RULES).map(Number).sort((a, b) => a - b);
  const pick = years.filter((k) => k <= y).pop() ?? years[0];
  return RULES[pick];
}

export const SUPPORTED_NOTE =
  'Rules: FY 2023-24 onwards (later years use the latest known slabs). Capital-gains rates for FY 2024-25 use post 23-Jul-2024 rates.';

export const LIMITS = {
  c80: 150000,
  ccd1b80: 50000,
  d80: 100000,
  homeLoanInterest24b: 200000,
  tta80: 10000,
  ttb80: 50000,
};

export function slabTax(income: number, slabs: Slab[]): number {
  let tax = 0;
  let prev = 0;
  for (const [upto, rate] of slabs) {
    if (income <= prev) break;
    tax += (Math.min(income, upto) - prev) * rate;
    prev = upto;
  }
  return tax;
}

export function hraExemption(basicDA: number, hraReceived: number, rentPaid: number, metro: boolean): number {
  return Math.max(0, Math.min(hraReceived, rentPaid - 0.1 * basicDA, (metro ? 0.5 : 0.4) * basicDA));
}

const SURCHARGE_BANDS: [threshold: number, rate: number][] = [
  [50000000, 0.37],
  [20000000, 0.25],
  [10000000, 0.15],
  [5000000, 0.1],
];

export interface RegimeResult {
  regime: Regime;
  grossTotalIncome: number;
  deductions: number;
  deductionItems: { label: string; amount: number }[];
  taxableIncome: number;
  /** Income taxed at slab rates */
  normalIncome: number;
  slabTax: number;
  specialTax: number;
  rebate87A: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  effectiveRate: number;
  slabs: { from: number; to: number; rate: number; tax: number }[];
}

export function computeRegime(t: TaxYear, regime: Regime): RegimeResult {
  const rules = rulesFor(t.fy);
  const R = rules[regime];
  const d = t.deductions;
  const cg = t.capitalGains;
  const salary = Math.max(0, t.income.salary);
  const items: { label: string; amount: number }[] = [];
  const push = (label: string, amount: number) => amount > 0 && items.push({ label, amount });

  push('Standard deduction', Math.min(R.standardDeduction, salary));
  push('80CCD(2) employer NPS', d.ccd2Employer80);

  let houseProperty = t.income.houseProperty;
  if (regime === 'old') {
    push('Professional tax', Math.min(2500, d.professionalTax));
    push('HRA exemption', d.hraExempt);
    push('80C', Math.min(LIMITS.c80, d.c80));
    push('80CCD(1B) NPS', Math.min(LIMITS.ccd1b80, d.ccd1b80));
    push('80D health insurance', Math.min(LIMITS.d80, d.d80));
    push('80E education loan', d.e80);
    push('80G donations', d.g80);
    push(
      t.ageBand === 'below60' ? '80TTA savings interest' : '80TTB interest',
      Math.min(t.ageBand === 'below60' ? LIMITS.tta80 : LIMITS.ttb80, d.tta80),
    );
    push('Other deductions', d.other);
    // Self-occupied home-loan interest: loss from house property, capped at 2L
    houseProperty -= Math.min(LIMITS.homeLoanInterest24b, d.homeLoanInterest24b);
  }
  // Loss from house property set-off capped at 2L (and not allowed in new regime)
  houseProperty = regime === 'new' ? Math.max(0, houseProperty) : Math.max(-200000, houseProperty);

  const normalGross = salary + t.income.otherSources + houseProperty + t.income.business + cg.stcgOther;
  const specialIncome = cg.stcgEquity + Math.max(0, cg.ltcgEquity - rules.ltcgEquityExemption) + cg.ltcgOther;
  const grossTotalIncome = normalGross + cg.stcgEquity + cg.ltcgEquity + cg.ltcgOther;

  const deductions = items.reduce((s, x) => s + x.amount, 0);
  const normalIncome = Math.max(0, normalGross - deductions);
  const taxableIncome = normalIncome + specialIncome;

  const slabs = R.slabs(t.ageBand);
  const sTax = slabTax(normalIncome, slabs);
  const slabRows: RegimeResult['slabs'] = [];
  let prev = 0;
  for (const [upto, rate] of slabs) {
    if (normalIncome <= prev && rate > 0) break;
    const portion = Math.max(0, Math.min(normalIncome, upto) - prev);
    slabRows.push({ from: prev, to: upto, rate, tax: portion * rate });
    prev = upto;
  }

  // Unused basic exemption can absorb special-rate gains
  const basicExemption = slabs[0][1] === 0 ? slabs[0][0] : 0;
  const unused = Math.max(0, basicExemption - normalIncome);
  let stcg = cg.stcgEquity;
  let ltcg = Math.max(0, cg.ltcgEquity - rules.ltcgEquityExemption);
  let ltcgOther = cg.ltcgOther;
  let absorb = unused;
  for (const ref of ['stcg', 'ltcgOther', 'ltcg'] as const) {
    const cur = ref === 'stcg' ? stcg : ref === 'ltcg' ? ltcg : ltcgOther;
    const take = Math.min(absorb, cur);
    absorb -= take;
    if (ref === 'stcg') stcg -= take;
    else if (ref === 'ltcg') ltcg -= take;
    else ltcgOther -= take;
  }
  const specialTax = stcg * rules.stcgEquityRate + ltcg * rules.ltcgEquityRate + ltcgOther * rules.ltcgOtherRate;

  // 87A rebate — only against slab-rate tax (not on 111A/112A gains)
  let rebate = 0;
  if (taxableIncome <= R.rebateLimit) {
    rebate = Math.min(sTax, R.rebateMax);
  } else if (R.rebateMarginalRelief && normalIncome > R.rebateLimit) {
    const excess = normalIncome - R.rebateLimit;
    rebate = Math.max(0, sTax - excess);
  }

  const baseTax = Math.max(0, sTax - rebate) + specialTax;

  // Surcharge (special-rate equity gains capped at 15%) with marginal relief
  const surchargeRate = (income: number) => {
    for (const [th, rate] of SURCHARGE_BANDS) if (income > th) return Math.min(rate, R.maxSurcharge);
    return 0;
  };
  const rate = surchargeRate(taxableIncome);
  const equitySpecial = stcg * rules.stcgEquityRate + ltcg * rules.ltcgEquityRate;
  const otherTax = baseTax - equitySpecial;
  let surcharge = otherTax * rate + equitySpecial * Math.min(rate, 0.15);
  if (rate > 0) {
    const threshold = SURCHARGE_BANDS.find(([th]) => taxableIncome > th)![0];
    const lowerRate = surchargeRate(threshold);
    const scale = threshold / taxableIncome;
    const taxAtThreshold = baseTax * scale * (1 + lowerRate);
    const maxTotal = taxAtThreshold + (taxableIncome - threshold);
    if (baseTax + surcharge > maxTotal) surcharge = Math.max(0, maxTotal - baseTax);
  }

  const cess = (baseTax + surcharge) * 0.04;
  const totalTax = Math.round(baseTax + surcharge + cess);
  return {
    regime,
    grossTotalIncome,
    deductions,
    deductionItems: items,
    taxableIncome,
    normalIncome,
    slabTax: sTax,
    specialTax,
    rebate87A: rebate,
    surcharge,
    cess,
    totalTax,
    effectiveRate: grossTotalIncome > 0 ? totalTax / grossTotalIncome : 0,
    slabs: slabRows,
  };
}

export interface TaxSummary {
  old: RegimeResult;
  new: RegimeResult;
  chosen: RegimeResult;
  better: Regime;
  saving: number;
  paid: number;
  balance: number;
}

export function computeTax(t: TaxYear): TaxSummary {
  const o = computeRegime(t, 'old');
  const n = computeRegime(t, 'new');
  const better: Regime = n.totalTax <= o.totalTax ? 'new' : 'old';
  const chosen = t.preferredRegime === 'auto' ? (better === 'new' ? n : o) : t.preferredRegime === 'new' ? n : o;
  const paid = t.payments.reduce((s, p) => s + p.amount, 0);
  return {
    old: o,
    new: n,
    chosen,
    better,
    saving: Math.abs(o.totalTax - n.totalTax),
    paid,
    balance: chosen.totalTax - paid,
  };
}

export function emptyTaxYear(fy: FY): TaxYear {
  return {
    fy,
    preferredRegime: 'auto',
    ageBand: 'below60',
    income: { salary: 0, otherSources: 0, houseProperty: 0, business: 0 },
    capitalGains: { stcgEquity: 0, ltcgEquity: 0, stcgOther: 0, ltcgOther: 0 },
    deductions: {
      c80: 0,
      ccd1b80: 0,
      ccd2Employer80: 0,
      d80: 0,
      hraExempt: 0,
      homeLoanInterest24b: 0,
      e80: 0,
      g80: 0,
      tta80: 0,
      professionalTax: 0,
      other: 0,
    },
    payments: [],
  };
}

/** Advance-tax instalment schedule (cumulative % due by date) */
export function advanceTaxSchedule(fy: FY, liability: number) {
  const y = fyStartYear(fy);
  return [
    { due: `${y}-06-15`, pct: 0.15 },
    { due: `${y}-09-15`, pct: 0.45 },
    { due: `${y}-12-15`, pct: 0.75 },
    { due: `${y + 1}-03-15`, pct: 1 },
  ].map((x) => ({ ...x, amount: Math.round(liability * x.pct) }));
}
