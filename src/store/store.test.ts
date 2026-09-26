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
});
