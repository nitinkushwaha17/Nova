import { describe, expect, it } from 'vitest';
import type { Asset } from '../../types';
import { toLines, type PdfItem } from './pdf';
import { accountRows, applyDepositSync, depositRef, isSbiStatement, parseSbiStatement, planDepositSync, termStart } from './sbi';
import { findHeaderRow, rowsToTransactions } from './tabular';

// Synthetic statement mimicking SBI's e-statement layout (pdf.js coordinates, y grows upwards)
const at = (x: number, y: number, str: string, right = x + str.length * 4): PdfItem & { y: number } => ({ x, y, right, str });
const amt = (right: number, y: number, str: string) => at(right - str.length * 4, y, str, right);

const banner = (y = 760) => [at(20, y, 'Welcome'), at(20, y - 12, 'Customer XXXXXXX1234'), at(400, y, 'As on 31-08-26')];
const header = (y: number) => [
  at(24, y, 'Date'),
  at(126, y, 'Transaction Reference'),
  at(297, y, 'Ref.No./Chq.No.'),
  at(397, y, 'Credit'),
  at(468, y, 'Debit'),
  at(532, y, 'Balance'),
];
const row = (y: number, date: string, desc: string, credit: string, debit: string, balance: string) => [
  at(19, y, date),
  at(62, y, desc),
  at(367, y, '-'),
  amt(440, y, credit),
  amt(510, y, debit),
  amt(575, y, balance),
];
const footer = [at(20, 29, 'Visit https://sbi.co.in for more')];

function statement() {
  const p1 = [
    ...banner(),
    at(20, 700, 'MY ACCOUNTS'),
    at(20, 680, 'FIXED DEPOSITS (TDR AND STDR ACCOUNTS)'),
    at(20, 660, 'TERM DEPOSIT XXXXXXX1111 17-05-22 10000.00 P SINGLE 6.25 0.00 182.00 10640.00 17-05-27 Yes'),
    at(20, 645, 'TERM DEPOSIT XXXXXXX9876 07-06-24 1000000.00 P SINGLE 7.00 0.00 8000.00 1224418.00 07-05-27 Yes'),
    at(20, 600, 'TRANSACTION DETAILS'),
    at(20, 585, 'SAVING ACCOUNT'),
    at(20, 570, 'XXXXXXX4321'),
    at(20, 555, 'Opening Balance on 01-08-26: null null 1000.00'),
    ...header(540),
    ...row(520, '02-08-26', 'UPI/DR/1234/SWIGGY', '0', '250.00', '750.00'),
    // Narration hard-wrapped over three lines around the dated row
    at(62, 505, 'SBIPOS00000000123456789 POS PURCHASE LIMITEDSOUTH'),
    ...row(500, '05-08-26', 'WES', '0', '100.00', '650.00'),
    ...footer,
  ];
  const p2 = [
    ...banner(),
    ...header(700),
    ...row(680, '10-08-26', 'NEFT CR SALARY ACME', '5,000.00', '0', '5,650.00'),
    at(20, 660, 'Closing Balance on 31-08-26: 5,650.00'),
    ...footer,
  ];
  return [...toLines(1, p1), ...toLines(2, p2)];
}

describe('SBI e-statement', () => {
  it('detects and parses transactions with wrapped narrations', () => {
    const lines = statement();
    expect(isSbiStatement(lines)).toBe(true);
    const st = parseSbiStatement(lines);
    expect(st.asOf).toBe('2026-08-31');
    expect(st.customer).toBe('XXXXXXX1234');
    expect(st.accounts).toHaveLength(1);
    const a = st.accounts[0];
    expect(a).toMatchObject({ last4: '4321', openingBalance: 1000, closingBalance: 5650 });
    expect(a.transactions).toEqual([
      { date: '2026-08-02', description: 'UPI/DR/1234/SWIGGY', reference: '', amount: -250, balance: 750 },
      { date: '2026-08-05', description: 'SBIPOS00000000123456789 POS PURCHASE LIMITEDSOUTHWES', reference: '', amount: -100, balance: 650 },
      { date: '2026-08-10', description: 'NEFT CR SALARY ACME', reference: '', amount: 5000, balance: 5650 },
    ]);
    expect(st.warnings).toEqual([]);
  });

  it('parses fixed deposits', () => {
    const st = parseSbiStatement(statement());
    expect(st.deposits).toHaveLength(2);
    expect(st.deposits[1]).toEqual({
      number: 'XXXXXXX9876',
      last4: '9876',
      type: 'TERM DEPOSIT',
      openDate: '2024-06-07',
      principal: 1000000,
      rate: 7,
      interestAccrued: 8000,
      maturityAmount: 1224418,
      maturityDate: '2027-05-07',
    });
  });

  it('warns when balances do not reconcile', () => {
    const lines = statement().map((l) => (l.text.startsWith('Closing') ? { ...l, text: 'Closing Balance on 31-08-26: 9,999.00' } : l));
    expect(parseSbiStatement(lines).warnings).toHaveLength(1);
  });

  it('feeds the generic importer', () => {
    const rows = accountRows(parseSbiStatement(statement()).accounts[0]);
    const found = findHeaderRow(rows);
    const { transactions } = rowsToTransactions(rows, found.index, found.mapping!, 'acc');
    expect(transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2026-08-02', -250],
      ['2026-08-05', -100],
      ['2026-08-10', 5000],
    ]);
  });

  it('recovers the current term of auto-renewed FDs', () => {
    const [renewed, fresh] = parseSbiStatement(statement()).deposits;
    // Opened 2022 for 5 years on paper, but 10640 on 10000 is one year's interest: renewed on 17-05-26
    expect(termStart(renewed)).toBe('2026-05-17');
    expect(termStart(fresh)).toBe('2024-06-07');
  });

  it('syncs FDs to assets idempotently, keeping user edits and closing missing ones', () => {
    const st = parseSbiStatement(statement());
    const first = planDepositSync([], st);
    expect(first.add).toHaveLength(2);
    expect(first.add[1]).toMatchObject({
      type: 'fd',
      name: 'SBI FD ••9876',
      ref: depositRef(st.customer, st.deposits[1]),
      deposit: { principal: 1000000, rate: 7, compounding: 4 },
    });
    let assets: Asset[] = applyDepositSync([], first);
    assets = assets.map((a) => (a.ref?.endsWith('9876:2024-06-07') ? { ...a, name: 'Emergency FD' } : a));

    const again = planDepositSync(assets, st);
    expect([again.add.length, again.update.length, again.close.length, again.unchanged]).toEqual([0, 0, 0, 2]);

    // Next month: the small FD is gone and the big one's rate changed
    const next = { ...st, deposits: [{ ...st.deposits[1], rate: 7.1 }] };
    const plan = planDepositSync(assets, next);
    expect(plan.close.map((a) => a.name)).toEqual(['SBI FD ••1111']);
    expect(plan.update[0]).toMatchObject({ name: 'Emergency FD', deposit: { rate: 7.1 } });
    const after = applyDepositSync(assets, plan);
    expect(after).toHaveLength(2);
    expect(after.find((a) => a.name === 'SBI FD ••1111')?.closed).toBe(true);
  });
});
