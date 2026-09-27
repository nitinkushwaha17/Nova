/* Fetch missing monthly statements from Gmail and import the ones that need no decisions. */
import { create } from 'zustand';
import { PasswordError } from '../lib/parsers/officeCrypto';
import { readPdfLines } from '../lib/parsers/pdf';
import { accountRows, applyDepositSync, isSbiStatement, parseSbiStatement, planDepositSync, type SbiStatement } from '../lib/parsers/sbi';
import { findHeaderRow, mappingFits, readRows, rowsToTransactions, type Row } from '../lib/parsers/tabular';
import { coveredThrough, STATEMENT_TYPES } from '../lib/statementDue';
import { useStore } from '../store';
import type { ISODate } from '../types';
import { downloadAttachment, gmailQueryOf, searchStatements, type MailAttachment } from './gmail';

export interface SyncedStatement {
  file: string;
  account: string;
  added: number;
  merged: number;
  deposits: number;
}

export interface StatementSyncResult {
  imported: SyncedStatement[];
  /** Attachments that need the Import page: a password, an account choice, or an unknown format */
  review: { file: string; reason: string }[];
  /** SMS entries the new statements didn't list */
  smsUnmatched: number;
  at: number;
}

export const useStatementSync = create<{ running: boolean; result: StatementSyncResult | null; error: string | null }>(() => ({ running: false, result: null, error: null }));

type Opened = { kind: 'sbi'; st: SbiStatement } | { kind: 'rows'; rows: Row[] } | { kind: 'locked' } | { kind: 'unsupported' };

async function open(file: File, passwords: string[]): Promise<Opened> {
  for (const pw of passwords.length ? [undefined, ...passwords] : [undefined]) {
    try {
      if (/\.pdf$/i.test(file.name)) {
        const lines = await readPdfLines(new Uint8Array(await file.arrayBuffer()), pw);
        return isSbiStatement(lines) ? { kind: 'sbi', st: parseSbiStatement(lines) } : { kind: 'unsupported' };
      }
      return { kind: 'rows', rows: await readRows(file, pw) };
    } catch (e) {
      if (e instanceof PasswordError && e.reason !== 'unsupported') continue;
      throw e;
    }
  }
  return { kind: 'locked' };
}

const keyOf = (a: MailAttachment) => `${a.messageId}:${a.filename}`;
const gmailDate = (d: ISODate) => d.replace(/-/g, '/');

/**
 * Search Gmail for statement emails received after `since` and import every attachment that can be matched
 * to an account without asking: SBI PDFs by account number, spreadsheets when exactly one account's saved
 * column layout fits. Must run from a click unless Gmail access was already granted in this tab.
 */
export async function syncStatementsFromGmail(since: ISODate): Promise<StatementSyncResult> {
  useStatementSync.setState({ running: true, error: null });
  try {
    const store = useStore.getState();
    const { settings } = store;
    const query = `${gmailQueryOf(settings.gmailQuery)} after:${gmailDate(since)}`;
    const mails = (await searchStatements(query)).sort((a, b) => a.date.localeCompare(b.date));
    const done = new Set(settings.gmailImported ?? []);
    const passwords = [...new Set((settings.statementPasswords ?? []).map((p) => p.password).filter(Boolean))];
    const result: StatementSyncResult = { imported: [], review: [], smsUnmatched: 0, at: Date.now() };
    const handled: string[] = [];

    for (const mail of mails) {
      for (const att of mail.attachments) {
        if (done.has(keyOf(att))) continue;
        let opened: Opened;
        try {
          opened = await open(await downloadAttachment(att), passwords);
        } catch (e) {
          if (/gmail/i.test((e as Error).message)) throw e;
          result.review.push({ file: att.filename, reason: `Couldn't read it: ${(e as Error).message}` });
          continue;
        }
        const accounts = useStore.getState().meta.accounts.filter((a) => !a.archived && STATEMENT_TYPES.includes(a.type));
        if (opened.kind === 'locked') {
          result.review.push({ file: att.filename, reason: 'None of your saved passwords open it' });
          continue;
        }
        if (opened.kind === 'unsupported') {
          result.review.push({ file: att.filename, reason: "Nova can't read this PDF — use the bank's Excel/CSV download" });
          continue;
        }
        if (opened.kind === 'sbi') {
          const { st } = opened;
          let complete = true;
          let deposits = 0;
          if (st.deposits.length) {
            const plan = planDepositSync(useStore.getState().portfolio.assets, st);
            deposits = plan.add.length + plan.update.length + plan.close.length;
            if (deposits || plan.touch.length) useStore.getState().update('portfolio', (d) => ({ assets: applyDepositSync(d.assets, plan) }));
          }
          for (const sa of st.accounts) {
            const acc = accounts.find((a) => a.last4 && a.last4 === sa.last4);
            if (!acc) {
              if (sa.transactions.length) {
                complete = false;
                result.review.push({ file: att.filename, reason: `No account ending ${sa.last4} in Nova — add it, then import` });
              }
              continue;
            }
            let added = 0;
            let merged = 0;
            if (sa.transactions.length) {
              const rows = accountRows(sa);
              const head = findHeaderRow(rows);
              const res = await useStore.getState().importTransactions(rowsToTransactions(rows, head.index, head.mapping!, acc.id).transactions);
              added = res.added;
              merged = res.merged;
              result.smsUnmatched += res.smsUnmatched.length;
            }
            if (st.asOf) useStore.getState().noteStatement(acc.id, st.asOf);
            result.imported.push({ file: att.filename, account: acc.name, added, merged, deposits: 0 });
          }
          if (deposits) result.imported.push({ file: att.filename, account: 'Fixed deposits', added: 0, merged: 0, deposits });
          if (complete) handled.push(keyOf(att));
          continue;
        }
        // Spreadsheets carry no account number Nova can trust, so only a unique saved column layout identifies the account
        const top = opened.rows.slice(0, 60);
        const fits = accounts.map((a) => ({ a, row: top.findIndex((r) => mappingFits(a.columnMapping, r)) })).filter((x) => x.row >= 0);
        if (fits.length !== 1) {
          result.review.push({ file: att.filename, reason: fits.length ? 'Matches more than one account — pick one' : 'Pick the account and check the columns' });
          continue;
        }
        const { a: acc, row } = fits[0];
        const txns = rowsToTransactions(opened.rows, row, acc.columnMapping!, acc.id).transactions;
        const res = await useStore.getState().importTransactions(txns);
        const last = txns.reduce((m, t) => (t.date > m ? t.date : m), '');
        if (last) useStore.getState().noteStatement(acc.id, coveredThrough(last, mail.date.slice(0, 10)));
        result.smsUnmatched += res.smsUnmatched.length;
        result.imported.push({ file: att.filename, account: acc.name, added: res.added, merged: res.merged, deposits: 0 });
        handled.push(keyOf(att));
      }
    }
    if (handled.length) useStore.getState().update('settings', (s) => ({ ...s, gmailImported: [...new Set([...(s.gmailImported ?? []), ...handled])].slice(-500) }));
    useStatementSync.setState({ result });
    return result;
  } catch (e) {
    useStatementSync.setState({ error: (e as Error).message });
    throw e;
  } finally {
    useStatementSync.setState({ running: false });
  }
}
