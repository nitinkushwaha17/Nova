import type { Category, Transaction } from '../types';

/**
 * Indian GST rate history, versioned by effective date. Each entry lists only the rates that changed.
 * Lookup cascades: subcategory rate → category fallback → generic 12%.
 * To add a new rate change, append an entry with its effectiveFrom date.
 */
interface GstEntry {
  effectiveFrom: string;
  note: string;
  subcategoryRates?: Record<string, number>;
  categoryFallbackRates?: Record<string, number>;
}

export const GST_RATE_HISTORY: GstEntry[] = [
  {
    effectiveFrom: '2017-07-01',
    note: 'GST launched',
    subcategoryRates: {
      Restaurants: 0.12,
      Groceries: 0.03,
      'Food Delivery': 0.05,
      'Coffee & Tea': 0.05,
      'Fast Food': 0.12,
      Fuel: 0,
      'Public Transport': 0,
      'Cab/Taxi': 0.05,
      Parking: 0.18,
      'Vehicle Maintenance': 0.18,
      Flights: 0.12,
      Clothing: 0.12,
      Electronics: 0.28,
      'Home & Garden': 0.12,
      'Personal Care': 0.18,
      'Online Shopping': 0.12,
      Electricity: 0,
      Water: 0,
      Gas: 0.05,
      Internet: 0.18,
      Mobile: 0.18,
      'DTH/Cable': 0.18,
      Rent: 0,
      Maintenance: 0.18,
      Movies: 0.28,
      'Streaming Services': 0.18,
      Games: 0.18,
      Events: 0.18,
      Subscriptions: 0.18,
      Hotels: 0.12,
      Doctor: 0,
      Pharmacy: 0.12,
      'Health Insurance': 0.18,
      'Gym/Fitness': 0.18,
      'Medical Tests': 0.18,
      Courses: 0.18,
      Books: 0,
      Tuition: 0.18,
      'School/College Fees': 0,
      Stationery: 0.12,
      'Home Loan': 0.02,
      'Car Loan': 0.02,
      'Personal Loan': 0.02,
      'Credit Card Charges': 0.18,
      'Education Loan': 0.02,
      'ATM Withdrawal': 0,
      'Bank Charges': 0.18,
      'Life Insurance': 0.045,
      'Term Insurance': 0.18,
      'Vehicle Insurance': 0.18,
      Miscellaneous: 0.12,
    },
    categoryFallbackRates: {
      food: 0.05,
      transport: 0.05,
      shopping: 0.15,
      utilities: 0.12,
      housing: 0.05,
      entertainment: 0.18,
      travel: 0.12,
      health: 0.12,
      education: 0.08,
      emi: 0.02,
      insurance: 0.18,
      cash: 0,
      personal: 0.12,
      family: 0.05,
      other: 0.12,
    },
  },
  {
    effectiveFrom: '2017-11-15',
    note: 'All restaurants unified to 5%',
    subcategoryRates: { Restaurants: 0.05, 'Fast Food': 0.05 },
  },
  {
    effectiveFrom: '2025-09-22',
    note: 'GST 2.0: slabs 0/5/18/40%; health & life insurance exempt',
    subcategoryRates: {
      Clothing: 0.05,
      Electronics: 0.18,
      'Personal Care': 0.05,
      'Health Insurance': 0,
      'Life Insurance': 0,
      'Term Insurance': 0,
      Pharmacy: 0.05,
      'Gym/Fitness': 0.05,
      Stationery: 0,
      Groceries: 0.05,
      Hotels: 0.05,
    },
    categoryFallbackRates: { health: 0.03, shopping: 0.12, insurance: 0.05 },
  },
];

/** GST rate (decimal) applicable to a spend on a given date */
export function getGSTRate(category: Category | undefined, subcategory: string | null | undefined, date: string): number {
  if (!category || category.kind !== 'expense') return 0;
  const entries = GST_RATE_HISTORY.filter((e) => e.effectiveFrom <= (date || '2017-07-01')).reverse();
  if (subcategory) {
    for (const e of entries) {
      const r = e.subcategoryRates?.[subcategory];
      if (r !== undefined) return r;
    }
  }
  for (const e of entries) {
    const r = e.categoryFallbackRates?.[category.id];
    if (r !== undefined) return r;
  }
  return 0.12;
}

/** GST embedded in a GST-inclusive amount */
export function gstEmbedded(amount: number, rate: number): number {
  return amount - amount / (1 + rate);
}

export interface GstBreakdown {
  total: number;
  spend: number;
  byCategory: { id: string; name: string; color: string; tax: number; spend: number; rate: number }[];
}

/** Estimate GST paid on expense transactions (amounts treated as GST-inclusive) */
export function estimateGST(
  txns: Transaction[],
  catMap: Map<string, Category>,
  isCountedExpense: (t: Transaction) => boolean,
): GstBreakdown {
  const by = new Map<string, { tax: number; spend: number }>();
  let total = 0;
  let spend = 0;
  for (const t of txns) {
    if (t.amount >= 0 || !t.category || !isCountedExpense(t)) continue;
    const cat = catMap.get(t.category);
    const rate = getGSTRate(cat, t.subcategory, t.date);
    const amt = -t.amount;
    const tax = gstEmbedded(amt, rate);
    total += tax;
    spend += amt;
    const cur = by.get(t.category) ?? { tax: 0, spend: 0 };
    cur.tax += tax;
    cur.spend += amt;
    by.set(t.category, cur);
  }
  return {
    total,
    spend,
    byCategory: [...by.entries()]
      .map(([id, v]) => {
        const c = catMap.get(id);
        return { id, name: c?.name ?? id, color: c?.color ?? '#888', tax: v.tax, spend: v.spend, rate: v.spend ? v.tax / v.spend : 0 };
      })
      .filter((x) => x.tax > 0)
      .sort((a, b) => b.tax - a.tax),
  };
}
