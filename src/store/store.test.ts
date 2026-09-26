import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '../types';

beforeAll(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  accountId: 'a',
  date: '2025-04-10',
  description: 'X',
  amount: -100,
  ...p,
});

describe('store', () => {
  it('imports into per-FY files, dedupes, applies rules, detects transfers and persists', async () => {
    const { useStore } = await import('./index');
    const { getFile } = await import('../storage/db');
    const s = useStore.getState();
    s.saveRules([{ id: 'r', pattern: 'ZOMATO', matchType: 'contains', category: 'food', subcategory: 'Food Delivery', priority: 0 }]);

    const first = await s.importTransactions([
      tx({ description: 'UPI/ZOMATO', amount: -450 }),
      tx({ description: 'SALARY', amount: 100000, date: '2025-03-31' }),
      tx({ description: 'TO SAVINGS', amount: -5000, date: '2025-05-01' }),
      tx({ description: 'FROM MAIN', amount: 5000, date: '2025-05-02', accountId: 'b' }),
    ]);
    expect(first.added).toBe(4);
    expect(first.categorized).toBe(1);
    expect(first.transfers).toBe(2);
    expect(first.fys).toEqual(['2024-25', '2025-26']);

    const again = await useStore.getState().importTransactions([tx({ description: 'UPI/ZOMATO', amount: -450 })]);
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(1);

    const st = useStore.getState();
    expect(st.txByFY['2025-26']).toHaveLength(3);
    expect(st.summaries['2025-26'].months['2025-04'].expenseByCategory.food).toBe(450);
    expect(st.summaries['2025-26'].months['2025-05'].transferOut).toBe(5000);

    await new Promise((r) => setTimeout(r, 50));
    const f = await getFile<Transaction[]>('transactions/FY2024-25');
    expect(f?.data).toHaveLength(1);
    expect(f?.dirty).toBe(true);
  });

  it('moves a transaction between FY files when its date changes', async () => {
    const { useStore } = await import('./index');
    const st = useStore.getState();
    const t = st.txByFY['2025-26'][0];
    st.updateTransaction(t.id, { date: '2024-12-01' });
    await new Promise((r) => setTimeout(r, 50));
    const after = useStore.getState();
    expect(after.txByFY['2025-26'].some((x) => x.id === t.id)).toBe(false);
    expect(after.txByFY['2024-25'].some((x) => x.id === t.id)).toBe(true);
  });

  it('promotes sub-collections to the parent when a collection is deleted', async () => {
    const { useStore } = await import('./index');
    const { newCollection } = await import('../lib/collections');
    const st = useStore.getState();
    st.saveCollection(newCollection({ id: 'eu', name: 'Europe' }));
    st.saveCollection(newCollection({ id: 'fr', name: 'France', parentId: 'eu' }));
    st.saveCollection(newCollection({ id: 'paris', name: 'Paris', parentId: 'fr' }));
    await useStore.getState().deleteCollection('fr');
    const cols = useStore.getState().collections.collections;
    expect(cols.some((c) => c.id === 'fr')).toBe(false);
    expect(cols.find((c) => c.id === 'paris')?.parentId).toBe('eu');
  });

  it('confirms SMS entries with the statement, keeps user edits, adds missing rows and flags unlisted SMS', async () => {
    const { useStore } = await import('./index');
    const sms = (p: Partial<Transaction>) => tx({ accountId: 'sbi', source: 'sms', smsId: Math.random().toString(36), ...p });
    await useStore
      .getState()
      .importTransactions([
        sms({ id: 'sms1', date: '2025-06-03', amount: -250, description: 'UPI to SWIGGY', reference: '515412345678' }),
        sms({ id: 'sms2', date: '2025-06-05', amount: -99, description: 'UPI to X' }),
        sms({ id: 'sms3', date: '2025-06-07', amount: -500, description: 'UPI to FAILED' }),
      ]);
    useStore.getState().updateTransaction('sms1', { category: 'food', notes: 'team lunch' });

    // Re-reading the same SMS adds nothing
    const smsIds = Object.values(useStore.getState().txByFY)
      .flat()
      .filter((t) => t.accountId === 'sbi')
      .map((t) => t.smsId!);
    const rescan = await useStore.getState().importTransactions(smsIds.map((smsId) => sms({ smsId, amount: -1 })));
    expect(rescan.added).toBe(0);

    const res = await useStore
      .getState()
      .importTransactions([
        tx({ accountId: 'sbi', date: '2025-06-01', amount: 10000, description: 'SALARY', balance: 10000 }),
        tx({ accountId: 'sbi', date: '2025-06-04', amount: -250, description: 'TO TRANSFER-UPI/DR/515412345678/SWIGGY/YESB', balance: 9750 }),
        tx({ accountId: 'sbi', date: '2025-06-05', amount: -99, description: 'TO TRANSFER-UPI/DR/515499999999/X/SBIN', balance: 9651 }),
        tx({ accountId: 'sbi', date: '2025-06-08', amount: -40, description: 'ATM CHARGES', balance: 9611 }),
      ]);
    expect(res.merged).toBe(2);
    expect(res.added).toBe(2);
    expect(res.smsUnmatched).toEqual(['sms3']);

    const rows = useStore
      .getState()
      .txByFY['2025-26'].filter((t) => t.accountId === 'sbi')
      .sort((a, b) => a.date.localeCompare(b.date));
    expect(rows).toHaveLength(5);
    const swiggy = rows.find((t) => t.id === 'sms1')!;
    expect(swiggy.source).toBeUndefined();
    expect(swiggy.date).toBe('2025-06-04');
    expect(swiggy.balance).toBe(9750);
    expect(swiggy.description).toContain('SWIGGY/YESB');
    expect(swiggy.category).toBe('food');
    expect(swiggy.notes).toBe('team lunch');

    // An SMS arriving after its statement row is already in is skipped
    const late = await useStore.getState().importTransactions([sms({ date: '2025-06-08', amount: -40, description: 'debit' })]);
    expect(late.added).toBe(0);
    expect(late.duplicates).toBe(1);
  });
});
