import type { Category, Rule, Transaction } from '../../types';
import { uid } from '../format';
import { cleanDescription } from '../transactions';

interface LegacyTxn {
  id?: string;
  date?: string | null;
  valueDate?: string | null;
  description?: string;
  reference?: string;
  debit?: number;
  credit?: number;
  balance?: number;
  amount?: number;
  category?: string | null;
  subcategory?: string | null;
  notes?: string;
  isTransfer?: boolean;
}

interface LegacyBackup {
  transactions?: LegacyTxn[];
  categories?: { id: string; name: string; color: string; subcategories: string[] }[];
  autoLabelRules?: { keyword: string; category: string; subcategory?: string }[];
  profileName?: string;
}

const CATEGORY_MAP: Record<string, string> = { atm: 'cash' };
/** (legacy category:subcategory) → [new category, new subcategory] */
const PAIR_MAP: Record<string, [string, string]> = {
  'health:Insurance': ['insurance', 'Health Insurance'],
  'investment:Insurance Premium': ['insurance', 'Life Insurance'],
  'emi:Credit Card': ['emi', 'Credit Card Bill'],
};
const SUB_MAP: Record<string, string> = {
  'Cash Deposit': 'ATM Withdrawal',
  'Bank Transfer': 'Self Transfer',
  'UPI Transfer': 'Self Transfer',
  'NEFT/RTGS': 'Self Transfer',
  IMPS: 'Self Transfer',
  Unknown: 'Miscellaneous',
  Uncategorized: 'Miscellaneous',
};

function mapPair(category?: string | null, sub?: string | null): [string | null, string | null] {
  if (!category) return [null, null];
  const pair = PAIR_MAP[`${category}:${sub ?? ''}`];
  if (pair) return pair;
  return [CATEGORY_MAP[category] ?? category, sub ? (SUB_MAP[sub] ?? sub) : null];
}

export function isLegacyBackup(data: unknown): data is LegacyBackup {
  return !!data && typeof data === 'object' && Array.isArray((data as LegacyBackup).transactions) && !('schemaVersion' in (data as object));
}

/** Convert a Bank-statement-analyser backup JSON into Nova records */
export function convertLegacy(data: LegacyBackup, accountId: string, existing: Category[]) {
  const catIds = new Set(existing.map((c) => c.id));
  const newCategories: Category[] = [];
  for (const c of data.categories ?? []) {
    const id = CATEGORY_MAP[c.id] ?? c.id;
    if (!catIds.has(id)) {
      catIds.add(id);
      newCategories.push({ id, name: c.name, color: c.color, kind: 'expense', subcategories: c.subcategories ?? [] });
    }
  }
  const importId = uid('imp');
  const transactions: Transaction[] = (data.transactions ?? [])
    .filter((t) => t.date && t.description)
    .map((t) => {
      const amount = typeof t.amount === 'number' && t.amount !== 0 ? t.amount : (t.credit ?? 0) - (t.debit ?? 0);
      const [category, sub] = mapPair(t.category, t.subcategory);
      return {
        id: uid('txn'),
        accountId,
        date: t.date!,
        valueDate: t.valueDate ?? null,
        description: cleanDescription(t.description!),
        rawDescription: t.description,
        reference: t.reference ?? '',
        amount,
        balance: t.balance ?? null,
        category,
        subcategory: sub,
        notes: t.notes ?? '',
        isTransfer: t.isTransfer ? true : undefined,
        importId,
      };
    });
  const rules: Rule[] = (data.autoLabelRules ?? [])
    .filter((r) => r.keyword && r.category)
    .map((r) => {
      const [category, sub] = mapPair(r.category, r.subcategory);
      return {
        id: uid('rule'),
        pattern: r.keyword,
        matchType: 'contains' as const,
        category: category!,
        subcategory: sub ?? undefined,
        direction: 'any' as const,
        priority: 0,
      };
    });
  return { transactions, rules, newCategories, profileName: data.profileName };
}
