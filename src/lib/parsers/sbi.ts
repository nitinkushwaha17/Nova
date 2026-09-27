/**
 * Parser for SBI's monthly consolidated e-statement PDF (the "Welcome … As on DD-MM-YY" email statement):
 * savings account transactions plus the list of fixed deposits (TDR/STDR).
 */
import type { Asset, DepositDetails, ISODate } from '../../types';
import { addMonths, daysBetween } from '../dates';
import { parseAmount, uid } from '../format';
import type { PdfItem, PdfLine } from './pdf';

export interface SbiTransaction {
  date: ISODate;
  description: string;
  reference: string;
  /** Signed: positive = credit */
  amount: number;
  balance: number | null;
}

export interface SbiAccount {
  /** Masked number as printed, e.g. XXXXXXX1234 */
  number: string;
  last4: string;
  type: string;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: SbiTransaction[];
}

export interface SbiDeposit {
  number: string;
  last4: string;
  type: string;
  openDate: ISODate;
  principal: number;
  rate: number;
  interestAccrued: number;
  maturityAmount: number;
  maturityDate: ISODate;
}

export interface SbiStatement {
  asOf: ISODate | null;
  /** Masked customer (CIF) number, e.g. XXXXXXX5678 */
  customer: string | null;
  accounts: SbiAccount[];
  deposits: SbiDeposit[];
  /** Rows whose running balance didn't reconcile, as human-readable notes */
  warnings: string[];
}

const DMY = /^(\d{2})-(\d{2})-(\d{2}|\d{4})$/;
export function dmy(s: string): ISODate | null {
  const m = s.trim().match(DMY);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${m[2]}-${m[1]}`;
}

const num = (s: string | undefined) => (s && !/^(-|null)$/i.test(s.trim()) ? parseAmount(s) : 0);

export function isSbiStatement(lines: PdfLine[]): boolean {
  const text = lines.map((l) => l.text).join('\n');
  return /sbi\.co\.in/i.test(text) && /TRANSACTION OVERVIEW|TDR AND STDR ACCOUNTS|MY ACCOUNTS/i.test(text);
}

interface Columns {
  date: number;
  desc: number;
  ref: number;
  credit: number;
  debit: number;
  balance: number;
}

function headerColumns(l: PdfLine): Columns | null {
  const at = (re: RegExp) => l.items.find((i) => re.test(i.str.trim()))?.x;
  const c = {
    date: at(/^Date$/i),
    desc: at(/^Transaction (Reference|Details|Particulars)|^Description|^Narration/i),
    ref: at(/^Ref/i),
    credit: at(/^Credit$/i),
    debit: at(/^Debit$/i),
    balance: at(/^Balance$/i),
  };
  if (Object.values(c).some((v) => v === undefined)) return null;
  return c as Columns;
}

/** Numbers are right-aligned under headers, so pick the column by the item's right edge */
function amountColumn(it: PdfItem, c: Columns): 'ref' | 'credit' | 'debit' | 'balance' {
  if (it.right > c.balance) return 'balance';
  if (it.right > c.debit) return 'debit';
  if (it.right > c.credit) return 'credit';
  return 'ref';
}

const FD_ROW =
  /^(.*?(?:DEPOSIT|TDR|STDR).*?)\s+(X*\d{3,})\s+(\d{2}-\d{2}-\d{2,4})\s+([\d,]+(?:\.\d+)?)\s+[PS]\s+(.+?)\s+([\d.]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+(\d{2}-\d{2}-\d{2,4})\b/i;

export function parseSbiStatement(lines: PdfLine[]): SbiStatement {
  const out: SbiStatement = { asOf: null, customer: null, accounts: [], deposits: [], warnings: [] };
  let section: 'none' | 'fd' | 'txn' = 'none';
  let pendingType = 'SAVING ACCOUNT';
  let account: SbiAccount | null = null;
  let cols: Columns | null = null;
  let tablePage = -1;
  // Lines of the current page's table, grouped into transactions after the page is read
  let pageRows: PdfLine[] = [];

  const flushPage = () => {
    if (!account || !cols || !pageRows.length) return (pageRows = []);
    const c = cols;
    // Narrations start left of their (centred) header, so the column is: after the date, before Ref
    const isDateItem = (i: PdfItem) => i.x < c.desc - 5 && !!dmy(i.str);
    const inDesc = (i: PdfItem) => !isDateItem(i) && i.x < c.ref - 5;
    const isDate = (l: PdfLine) => l.items.some(isDateItem);
    const anchors = pageRows.filter(isDate);
    // Wrapped narrations sit on their own lines just above/below the dated row
    const frags = new Map<PdfLine, PdfLine[]>(anchors.map((a) => [a, []]));
    for (const l of pageRows) {
      if (isDate(l) || !anchors.length) continue;
      if (!l.items.every(inDesc)) continue;
      const near = anchors.reduce((best, a) => (Math.abs(a.y - l.y) < Math.abs(best.y - l.y) ? a : best));
      if (Math.abs(near.y - l.y) <= 10) frags.get(near)!.push(l);
    }
    for (const a of anchors) {
      const parts = [a, ...frags.get(a)!].sort((x, y) => y.y - x.y);
      let desc = '';
      for (const p of parts) {
        const piece = p.items
          .filter(inDesc)
          .map((i) => i.str.trim())
          .join(' ');
        if (!piece) continue;
        // SBI hard-wraps long narrations mid-word at ~45 characters
        desc = !desc ? piece : desc.length >= 45 ? desc + piece : `${desc} ${piece}`;
      }
      const val: Record<string, string> = {};
      for (const it of a.items) {
        if (isDateItem(it) || inDesc(it)) continue;
        const k = amountColumn(it, c);
        val[k] = val[k] ? `${val[k]} ${it.str.trim()}` : it.str.trim();
      }
      const date = dmy(a.items.find(isDateItem)!.str)!;
      const amount = Math.round((num(val.credit) - num(val.debit)) * 100) / 100;
      if (!amount) continue;
      account.transactions.push({ date, description: desc, reference: val.ref && val.ref !== '-' ? val.ref : '', amount, balance: val.balance ? parseAmount(val.balance) : null });
    }
    pageRows = [];
  };

  for (const l of lines) {
    const t = l.text;
    if (l.page !== tablePage) {
      flushPage();
      tablePage = l.page;
      // Tables restart below a repeated header on each page; until then, skip the page banner
      if (section === 'txn') cols = null;
    }
    if (!out.asOf) {
      const m = t.match(/As on (\d{2}-\d{2}-\d{2,4})/i);
      if (m) out.asOf = dmy(m[1]);
    }
    if (!out.customer) {
      const m = t.match(/^Customer\s+(X*\d{3,})\b/i);
      if (m) out.customer = m[1];
    }
    if (/^Visit https|^\*All dates|^Contents of this statement/i.test(t)) continue;

    if (/^FIXED DEPOSITS\b|TDR AND STDR ACCOUNTS/i.test(t)) section = 'fd';
    if (/^TRANSACTION DETAILS\b/i.test(t)) section = 'txn';

    if (section === 'fd') {
      const m = t.match(FD_ROW);
      if (m) {
        const [, type, number, open, principal, , rate, , interest, maturity, maturityDate] = m;
        out.deposits.push({
          number,
          last4: number.slice(-4),
          type: type.trim(),
          openDate: dmy(open)!,
          principal: parseAmount(principal),
          rate: +rate,
          interestAccrued: parseAmount(interest),
          maturityAmount: parseAmount(maturity),
          maturityDate: dmy(maturityDate)!,
        });
      }
      continue;
    }
    if (section !== 'txn') continue;

    if (/^(SAVINGS?|CURRENT) ACCOUNT\b/i.test(t) && l.items.length === 1) pendingType = t.trim();
    if (/^X+\d{3,}$/.test(t.trim())) {
      flushPage();
      account = { number: t.trim(), last4: t.trim().slice(-4), type: pendingType, openingBalance: null, closingBalance: null, transactions: [] };
      out.accounts.push(account);
      cols = null;
      continue;
    }
    if (!account) continue;
    const open = t.match(/Opening Balance on [\d-]+:?\s*(.*)$/i);
    if (open) {
      account.openingBalance =
        open[1]
          .split(/\s+/)
          .map((s) => (/^[\d,]+\.\d+$/.test(s) ? parseAmount(s) : null))
          .find((v) => v !== null) ?? null;
      continue;
    }
    const close = t.match(/Closing Balance on [\d-]+:?\s*([\d,]+\.?\d*)/i);
    if (close) {
      flushPage();
      account.closingBalance = parseAmount(close[1]);
      cols = null;
      continue;
    }
    const h = headerColumns(l);
    if (h) {
      flushPage();
      cols = h;
      continue;
    }
    if (cols) pageRows.push(l);
  }
  flushPage();

  for (const a of out.accounts) {
    let bal = a.openingBalance;
    for (const t of a.transactions) {
      if (bal !== null && t.balance !== null && Math.abs(bal + t.amount - t.balance) > 0.01)
        out.warnings.push(`${a.number} ${t.date} "${t.description}": balance doesn't reconcile`);
      bal = t.balance ?? (bal === null ? null : bal + t.amount);
    }
    if (bal !== null && a.closingBalance !== null && Math.abs(bal - a.closingBalance) > 0.01)
      out.warnings.push(`${a.number}: closing balance ${a.closingBalance} doesn't match transactions (${bal.toFixed(2)})`);
  }
  return out;
}

// ─── Into Nova ──────────────────────────────────────────────────────────────

/** Statement rows in the shape the generic importer maps automatically */
export function accountRows(a: SbiAccount): string[][] {
  return [
    ['Date', 'Description', 'Reference', 'Credit', 'Debit', 'Balance'],
    ...a.transactions.map((t) => [
      t.date,
      t.description,
      t.reference,
      t.amount > 0 ? String(t.amount) : '',
      t.amount < 0 ? String(-t.amount) : '',
      t.balance === null ? '' : String(t.balance),
    ]),
  ];
}

/** Stable id for an FD: SBI masks all but the last 4 digits, so the open date disambiguates */
export const depositRef = (customer: string | null, d: SbiDeposit) => `sbi:${customer ?? ''}:${d.number}:${d.openDate}`;

/**
 * Start of the FD's current term. Auto-renewed FDs keep their original open date on the statement, but the
 * principal is the reinvested amount, so the term is recovered from SBI's own maturity amount (quarterly compounding).
 */
export function termStart(d: SbiDeposit): ISODate {
  const q = Math.log(1 + d.rate / 400);
  if (!(d.maturityAmount > d.principal) || !q) return d.openDate;
  const fromOpen = d.principal * Math.pow(1 + d.rate / 400, (4 * Math.max(0, daysBetween(d.openDate, d.maturityDate))) / 365);
  if (Math.abs(fromOpen - d.maturityAmount) / d.maturityAmount < 0.002) return d.openDate;
  const months = Math.round((12 * Math.log(d.maturityAmount / d.principal)) / (4 * q));
  const start = addMonths(d.maturityDate, -months);
  return months > 0 && start > d.openDate ? start : d.openDate;
}

export interface DepositSyncPlan {
  add: Asset[];
  update: Asset[];
  /** Previously synced FDs from the same customer that are no longer listed (matured or closed) */
  close: Asset[];
  unchanged: number;
  /** Same terms, only the statement date moves forward (applied, not reported) */
  touch: Asset[];
  /** Set when a newer statement from this customer was already synced: nothing is applied */
  staleVs?: ISODate;
}

export function planDepositSync(assets: Asset[], st: SbiStatement, now = new Date().toISOString()): DepositSyncPlan {
  const plan: DepositSyncPlan = { add: [], update: [], close: [], unchanged: 0, touch: [] };
  const prefix = `sbi:${st.customer ?? ''}:`;
  const asOf = st.asOf ?? undefined;
  // An older statement would reopen matured FDs and roll back renewed terms
  const latest = assets.reduce<ISODate | undefined>((m, a) => (a.ref?.startsWith(prefix) && a.syncedAsOf && (!m || a.syncedAsOf > m) ? a.syncedAsOf : m), undefined);
  if (asOf && latest && asOf < latest) {
    plan.staleVs = latest;
    plan.unchanged = st.deposits.length;
    return plan;
  }
  const byRef = new Map(assets.filter((a) => a.ref).map((a) => [a.ref!, a]));
  const seen = new Set<string>();
  for (const d of st.deposits) {
    const ref = depositRef(st.customer, d);
    seen.add(ref);
    // SBI compounds term deposits quarterly
    const deposit: DepositDetails = { principal: d.principal, rate: d.rate, startDate: termStart(d), maturityDate: d.maturityDate, compounding: 4, payout: 'cumulative' };
    const existing = byRef.get(ref);
    if (!existing) {
      plan.add.push({ id: uid('as'), type: 'fd', name: `SBI FD ••${d.last4}`, institution: 'SBI', deposit, valuations: [], flows: [], createdAt: now, ref, syncedAsOf: asOf });
      continue;
    }
    // A statement without a date can't prove it's newer than this asset's last sync
    if (existing.syncedAsOf && (!asOf || asOf < existing.syncedAsOf)) {
      plan.unchanged++;
      continue;
    }
    const same = existing.deposit && !existing.closed && (Object.keys(deposit) as (keyof DepositDetails)[]).every((k) => existing.deposit![k] === deposit[k]);
    const syncedAsOf = asOf ?? existing.syncedAsOf;
    if (same) {
      plan.unchanged++;
      if (syncedAsOf !== existing.syncedAsOf) plan.touch.push({ ...existing, syncedAsOf });
    }
    // Keep the user's name/notes; refresh the terms from the bank
    else plan.update.push({ ...existing, deposit: { ...existing.deposit, ...deposit }, closed: false, syncedAsOf });
  }
  for (const a of assets) {
    if (!a.ref?.startsWith(prefix) || seen.has(a.ref) || a.closed) continue;
    if (a.syncedAsOf && (!asOf || asOf < a.syncedAsOf)) continue;
    plan.close.push({ ...a, closed: true, syncedAsOf: asOf ?? a.syncedAsOf });
  }
  return plan;
}

export function applyDepositSync(assets: Asset[], plan: DepositSyncPlan): Asset[] {
  const changed = new Map([...plan.touch, ...plan.update, ...plan.close].map((a) => [a.id, a]));
  return [...assets.map((a) => changed.get(a.id) ?? a), ...plan.add];
}
