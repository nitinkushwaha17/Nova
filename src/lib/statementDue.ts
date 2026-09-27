import type { Account, AccountType, ISODate, Transaction } from '../types';
import { addDays, addMonths, endOfMonth, todayISO } from './dates';

/** Account types that get monthly bank statements */
export const STATEMENT_TYPES: AccountType[] = ['savings', 'current', 'credit_card'];

/** A statement's last row can be a few days before month end when nothing happened in between */
const SLACK_DAYS = 5;

export interface DueStatement {
  account: Account;
  /** Last day covered by statements so far */
  through: ISODate;
}

/**
 * Spreadsheets don't state their period. One emailed after the month of its last row ended is taken to be
 * that month's statement, so it covers the whole month even if the last few days had no activity.
 */
export function coveredThrough(lastRow: ISODate, mailed: ISODate): ISODate {
  const monthEnd = endOfMonth(lastRow.slice(0, 7));
  return mailed > monthEnd ? monthEnd : lastRow;
}

/** Last statement day per account: the recorded one, else the newest non-SMS transaction loaded */
export function statementCoverage(accounts: Account[], txns: Transaction[]): Map<string, ISODate> {
  const out = new Map<string, ISODate>();
  for (const t of txns) {
    if (t.source === 'sms') continue;
    const cur = out.get(t.accountId);
    if (!cur || t.date > cur) out.set(t.accountId, t.date);
  }
  for (const a of accounts) {
    const cur = out.get(a.id);
    if (a.statementThrough && (!cur || a.statementThrough > cur)) out.set(a.id, a.statementThrough);
  }
  return out;
}

/** The previous calendar month, whose statement should have arrived by now */
export function lastMonth(today: ISODate = todayISO()): { month: string; end: ISODate } {
  const month = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  return { month, end: endOfMonth(month) };
}

/** Active statement accounts whose statements stop before the end of last month. Accounts never imported from a statement are skipped. */
export function dueStatements(accounts: Account[], txns: Transaction[], today: ISODate = todayISO()): { month: string; due: DueStatement[] } {
  const { month, end } = lastMonth(today);
  const cover = statementCoverage(accounts, txns);
  const due: DueStatement[] = [];
  for (const a of accounts) {
    const through = cover.get(a.id);
    if (a.archived || !STATEMENT_TYPES.includes(a.type) || !through) continue;
    if (through < addDays(end, -SLACK_DAYS)) due.push({ account: a, through });
  }
  return { month, due };
}
