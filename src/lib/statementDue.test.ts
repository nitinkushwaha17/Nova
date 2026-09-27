import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from '../types';
import { coveredThrough, dueStatements, lastMonth, statementCoverage } from './statementDue';

const acc = (id: string, extra: Partial<Account> = {}): Account => ({ id, name: id, type: 'savings', includeInNetWorth: true, createdAt: '', ...extra });
const tx = (accountId: string, date: string, extra: Partial<Transaction> = {}) =>
  ({ id: `${accountId}${date}`, accountId, date, description: 'x', amount: -1, ...extra }) as Transaction;

describe('statement due check', () => {
  it('last month wraps the year', () => {
    expect(lastMonth('2026-01-10')).toEqual({ month: '2025-12', end: '2025-12-31' });
    expect(lastMonth('2026-03-31')).toEqual({ month: '2026-02', end: '2026-02-28' });
  });

  it('coverage ignores SMS entries and prefers the recorded statement date', () => {
    const cover = statementCoverage(
      [acc('a', { statementThrough: '2026-08-31' }), acc('b')],
      [tx('a', '2026-08-20'), tx('b', '2026-08-10'), tx('b', '2026-09-02', { source: 'sms' })],
    );
    expect(cover.get('a')).toBe('2026-08-31');
    expect(cover.get('b')).toBe('2026-08-10');
  });

  it('a spreadsheet mailed after its month ended covers the whole month', () => {
    expect(coveredThrough('2026-08-20', '2026-09-03')).toBe('2026-08-31');
    expect(coveredThrough('2026-08-20', '2026-08-25')).toBe('2026-08-20');
  });

  it('flags accounts whose statements stop before last month ends', () => {
    const accounts = [
      acc('covered', { statementThrough: '2026-08-31' }),
      acc('quietEnd'),
      acc('behind'),
      acc('never'),
      acc('cash', { type: 'cash' }),
      acc('old', { archived: true, statementThrough: '2026-01-31' }),
    ];
    const txns = [tx('quietEnd', '2026-08-28'), tx('behind', '2026-07-30'), tx('behind', '2026-09-03', { source: 'sms' }), tx('cash', '2026-06-01')];
    const { month, due } = dueStatements(accounts, txns, '2026-09-27');
    expect(month).toBe('2026-08');
    expect(due.map((d) => [d.account.id, d.through])).toEqual([['behind', '2026-07-30']]);
  });
});
