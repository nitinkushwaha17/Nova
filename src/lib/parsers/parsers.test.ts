import { describe, expect, it } from 'vitest';
import { autoMap, findHeaderRow, parseDate, parseDelimited, rowsToTransactions } from './tabular';
import { convertLegacy } from './legacy';
import { DEFAULT_CATEGORIES } from '../defaults';
import { applyRules, classify, dedupe, detectTransferPairs, merchantOf, summarize } from '../transactions';
import type { Transaction } from '../../types';

const SBI = [
  'Account Name\t:\tMr. Test',
  'Address\t:\tSomewhere',
  '',
  'Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tDebit\tCredit\tBalance',
  '1 Apr 2025\t1 Apr 2025\t"TO TRANSFER-UPI/DR/10000000001/SWIGGY/YESB/test.user@ybl/Payment\nfrom PhonePe"\tTRANSFER TO 0000000000001\t"1,234.56"\t\t"1,00,000.00"',
  '2 Apr 2025\t2 Apr 2025\tBY TRANSFER-NEFT*ACME CORP SALARY\tNEFT123\t\t"1,50,000.00"\t"2,50,000.00"',
  '3 Apr 2025\t3 Apr 2025\tSWEEP TRANSFER TO FD\t\t50000\t\t"2,00,000.00"',
].join('\n');

describe('tabular parser', () => {
  it('parses SBI TSV with info lines and multi-line narration', () => {
    const rows = parseDelimited(SBI, '\t');
    const { index, mapping } = findHeaderRow(rows);
    expect(index).toBe(2);
    expect(mapping?.debit).toBe('Debit');
    expect(mapping?.credit).toBe('Credit');
    expect(mapping?.description).toBe('Description');
    const res = rowsToTransactions(rows, index, mapping!, 'acc1');
    expect(res.transactions).toHaveLength(3);
    const [a, b] = res.transactions;
    expect(a.date).toBe('2025-04-01');
    expect(a.amount).toBe(-1234.56);
    expect(a.balance).toBe(100000);
    expect(a.description).not.toContain('10000000001');
    expect(b.amount).toBe(150000);
  });

  it('handles single amount + Dr/Cr column CSV', () => {
    const csv = 'Date,Narration,Amount,Dr/Cr,Balance\n05/04/2025,"AMAZON, PAY",1200.50,DR,10000\n06/04/2025,INTEREST,20,CR,10020';
    const rows = parseDelimited(csv, ',');
    const { index, mapping } = findHeaderRow(rows);
    expect(mapping?.amount).toBe('Amount');
    expect(mapping?.drCr).toBe('Dr/Cr');
    const res = rowsToTransactions(rows, index, mapping!, 'a');
    expect(res.transactions.map((t) => t.amount)).toEqual([-1200.5, 20]);
    expect(res.transactions[0].description).toBe('AMAZON, PAY');
  });

  it('does not map "cr" onto Description', () => {
    const m = autoMap(['Date', 'Description', 'Dr', 'Cr', 'Balance']);
    expect(m?.credit).toBe('Cr');
    expect(m?.debit).toBe('Dr');
  });

  it('parses many date formats', () => {
    expect(parseDate('01-Jan-24')).toBe('2024-01-01');
    expect(parseDate('2024-03-05')).toBe('2024-03-05');
    expect(parseDate('05/03/2024')).toBe('2024-03-05');
    expect(parseDate('05/03/2024', 'MDY')).toBe('2024-05-03');
    expect(parseDate('Mar 5, 2024')).toBe('2024-03-05');
    expect(parseDate('05 Sept 2024')).toBe('2024-09-05');
  });
});

const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(), accountId: 'a', date: '2025-04-01', description: 'X', amount: -100, ...p });

describe('transactions', () => {
  const catMap = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

  it('dedupes but keeps legitimately repeated rows', () => {
    const existing = [tx({ description: 'TEA' })];
    const incoming = [tx({ description: 'TEA' }), tx({ description: 'TEA' })];
    const { fresh, dupes } = dedupe(existing, incoming);
    expect(fresh).toHaveLength(1);
    expect(dupes).toHaveLength(1);
  });

  it('detects self transfers across accounts', () => {
    const d = tx({ id: 'd', accountId: 'a', amount: -5000, date: '2025-04-01' });
    const c = tx({ id: 'c', accountId: 'b', amount: 5000, date: '2025-04-02' });
    const other = tx({ id: 'o', accountId: 'a', amount: 5000, date: '2025-04-02' });
    const ids = detectTransferPairs([d, c, other]);
    expect([...ids].sort()).toEqual(['c', 'd']);
  });

  it('classifies refunds, investments and sweeps', () => {
    expect(classify(tx({ amount: 200, category: 'shopping' }), catMap.get('shopping'))).toBe('refund');
    expect(classify(tx({ amount: -200, category: 'investment' }), catMap.get('investment'))).toBe('investment');
    expect(classify(tx({ amount: -200, description: 'SWEEP TO FD' }))).toBe('transfer');
    expect(classify(tx({ amount: -200, description: 'SWEEP TO FD', isTransfer: false }))).toBe('expense');
  });

  it('applies rules by priority', () => {
    const rules = [
      { id: '1', pattern: 'SWIGGY', matchType: 'contains' as const, category: 'food', subcategory: 'Food Delivery', priority: 0 },
      { id: '2', pattern: 'swiggy.*instamart', matchType: 'regex' as const, category: 'food', subcategory: 'Groceries', priority: 5 },
    ];
    const { txns, changed } = applyRules([tx({ description: 'UPI/SWIGGY INSTAMART' }), tx({ description: 'UPI/SWIGGY' })], rules);
    expect(changed).toBe(2);
    expect(txns[0].subcategory).toBe('Groceries');
    expect(txns[1].subcategory).toBe('Food Delivery');
  });

  it('summarises months with refunds netted', () => {
    const s = summarize(
      [
        tx({ amount: -1000, category: 'shopping' }),
        tx({ amount: 200, category: 'shopping' }),
        tx({ amount: 50000, category: 'income' }),
        tx({ amount: -10000, category: 'investment' }),
        tx({ amount: -3000, description: 'SWEEP' }),
      ],
      catMap,
    );
    const m = s.months['2025-04'];
    expect(m.expense).toBe(800);
    expect(m.expenseByCategory.shopping).toBe(800);
    expect(m.income).toBe(50000);
    expect(m.investment).toBe(10000);
    expect(m.transferOut).toBe(3000);
  });

  it('extracts merchant names', () => {
    expect(merchantOf('UPI/SWIGGY/YESB/test.user@ybl/Payment')).toBe('Swiggy');
  });
});

describe('legacy backup', () => {
  it('converts old analyser backups', () => {
    const res = convertLegacy(
      {
        transactions: [{ date: '2025-01-01', description: 'ATM WDL', debit: 500, credit: 0, amount: -500, category: 'atm', subcategory: 'ATM Withdrawal' }],
        autoLabelRules: [{ keyword: 'ZOMATO', category: 'food' }],
      },
      'acc',
      DEFAULT_CATEGORIES,
    );
    expect(res.transactions[0].category).toBe('cash');
    expect(res.transactions[0].amount).toBe(-500);
    expect(res.rules[0].pattern).toBe('ZOMATO');
  });
});
