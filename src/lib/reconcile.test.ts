import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { matchScore, pairUp, unmatchedSms } from './reconcile';

const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), accountId: 'a', date: '2025-06-03', description: 'X', amount: -20, ...p });

describe('reconcile', () => {
  it('requires the same account and amount within the date window', () => {
    const s = tx({ source: 'sms' });
    expect(matchScore(s, tx({ date: '2025-06-05' }))).toBeGreaterThan(0);
    expect(matchScore(s, tx({ date: '2025-06-10' }))).toBe(-1);
    expect(matchScore(s, tx({ amount: -21 }))).toBe(-1);
    expect(matchScore(s, tx({ accountId: 'b' }))).toBe(-1);
  });

  it('prefers a shared reference over a closer date', () => {
    const s = tx({ source: 'sms', reference: '515400000002' });
    const near = tx({ id: 'near', description: 'UPI/DR/515400000001/TEA' });
    const refd = tx({ id: 'refd', date: '2025-06-05', description: 'UPI/DR/515400000002/TEA' });
    expect(pairUp([s], [near, refd])[0][1].id).toBe('refd');
  });

  it('pairs identical same-day payments one-to-one', () => {
    const s1 = tx({ id: 's1', source: 'sms' });
    const s2 = tx({ id: 's2', source: 'sms' });
    const pairs = pairUp([s1, s2], [tx({ id: 'r1' }), tx({ id: 'r2' }), tx({ id: 'r3' })]);
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.map(([, r]) => r.id)).size).toBe(2);
  });

  it('flags SMS entries only inside the statement range of the same account', () => {
    const rows = [tx({ date: '2025-06-01' }), tx({ date: '2025-06-30' })];
    const all = [tx({ id: 'in', source: 'sms', date: '2025-06-15' }), tx({ id: 'after', source: 'sms', date: '2025-07-02' }), tx({ id: 'other', source: 'sms', accountId: 'b' })];
    expect(unmatchedSms(all, rows).map((t) => t.id)).toEqual(['in']);
  });
});
