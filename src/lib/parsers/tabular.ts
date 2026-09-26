import type { ColumnMapping, ISODate, Transaction } from '../../types';
import { parseAmount, uid } from '../format';
import { cleanDescription } from '../transactions';
import { decryptOOXML, isEncryptedOOXML, PasswordError } from './officeCrypto';

export type Row = string[];

// ─── Reading ────────────────────────────────────────────────────────────────

/** RFC-4180-ish parser: handles quotes, escaped quotes and newlines inside quoted fields */
export function parseDelimited(text: string, delimiter: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuote = false;
      } else if (ch === '\n' || ch === '\r') {
        // Multi-line narrations (common in SBI statements) → single line
        if (!(ch === '\r' && src[i + 1] === '\n')) field += ' ';
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuote = true;
      field = '';
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 40).join('\n');
  const counts: [string, number][] = ['\t', ',', ';', '|'].map((d) => [d, sample.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export async function readRows(file: File, password?: string): Promise<Row[]> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xls|xlsm|ods)$/.test(name)) {
    const XLSX = await import('xlsx');
    let data: Uint8Array = new Uint8Array(await file.arrayBuffer());
    // Encrypted .xlsx files are OLE containers; SheetJS can't open them, so decrypt first
    if (isEncryptedOOXML(data, XLSX.CFB)) data = await decryptOOXML(data, password, XLSX.CFB);
    let wb: import('xlsx').WorkBook;
    try {
      wb = XLSX.read(data, { type: 'array', cellDates: false, password });
    } catch (e) {
      // Legacy .xls: SheetJS handles XOR-obfuscated files when given the password, but not RC4
      if (/password/i.test((e as Error).message))
        throw new PasswordError(password ? 'unsupported' : 'required', password ? 'This .xls uses encryption that can’t be opened in the browser. Open it in Excel and save as .xlsx (the password can stay).' : 'This file is password-protected');
      throw e;
    }
    // Pick the sheet with most rows
    let best: Row[] = [];
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
      const clean = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c));
      if (clean.length > best.length) best = clean;
    }
    return best;
  }
  const text = await file.text();
  return parseDelimited(text, detectDelimiter(text));
}

// ─── Header detection & mapping ─────────────────────────────────────────────

const SYNONYMS: Record<keyof Omit<ColumnMapping, 'dateFormat'>, string[]> = {
  date: ['txn date', 'transaction date', 'tran date', 'date', 'posting date', 'trans date'],
  valueDate: ['value date', 'value dt', 'valdate'],
  description: ['description', 'narration', 'particulars', 'details', 'transaction details', 'remarks', 'transaction remarks'],
  reference: ['ref no./cheque no.', 'ref no/cheque no', 'chq/ref number', 'cheque no', 'ref no', 'reference', 'chq no', 'utr'],
  debit: ['debit', 'withdrawal amt', 'withdrawal', 'withdrawals', 'debit amount', 'dr amount', 'amount debited', 'dr'],
  credit: ['credit', 'deposit amt', 'deposit', 'deposits', 'credit amount', 'cr amount', 'amount credited', 'cr'],
  amount: ['amount', 'transaction amount', 'amt', 'amount (inr)'],
  drCr: ['dr/cr', 'cr/dr', 'type', 'debit/credit', 'transaction type'],
  balance: ['balance', 'closing balance', 'available balance', 'running balance', 'balance amount'],
};

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[()₹]/g, '').replace(/\binr\b/, '').trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find the header matching one of the names: exact first, then whole-word match (so "cr" ≠ "description") */
export function findHeader(headers: string[], names: string[], taken: Set<string> = new Set()): string | undefined {
  const free = headers.filter((h) => h && !taken.has(h));
  for (const n of names) {
    const hit = free.find((h) => norm(h) === n);
    if (hit) return hit;
  }
  for (const n of names) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(n)}([^a-z]|$)`);
    const hit = free.find((h) => re.test(norm(h)));
    if (hit) return hit;
  }
  return undefined;
}

export function autoMap(headers: string[]): ColumnMapping | null {
  const taken = new Set<string>();
  const pick = (k: keyof typeof SYNONYMS) => {
    const h = findHeader(headers, SYNONYMS[k], taken);
    if (h) taken.add(h);
    return h;
  };
  const valueDate = pick('valueDate');
  const date = pick('date') ?? valueDate;
  const description = pick('description');
  const balance = pick('balance');
  // A "Dr/Cr" indicator column must not be mistaken for a debit/credit amount column
  const hasAmountCol = !!findHeader(headers, SYNONYMS.amount, taken);
  const drCrEarly = hasAmountCol ? pick('drCr') : undefined;
  const debit = pick('debit');
  const credit = pick('credit');
  const amount = debit || credit ? undefined : pick('amount');
  const drCr = amount ? drCrEarly : undefined;
  const reference = pick('reference');
  if (!date || !description || (!debit && !credit && !amount)) return null;
  return { date, description, debit, credit, amount, drCr, balance, reference, valueDate: valueDate !== date ? valueDate : undefined, dateFormat: 'auto' };
}

/** Scan the first rows for the transaction table header (skips account info lines above it) */
export function findHeaderRow(rows: Row[]): { index: number; mapping: ColumnMapping | null } {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const m = autoMap(rows[i]);
    if (m) return { index: i, mapping: m };
  }
  return { index: 0, mapping: null };
}

// ─── Values ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function iso(y: number, m: number, d: number): ISODate | null {
  if (y < 100) y += y > 50 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(raw: string, format: ColumnMapping['dateFormat'] = 'auto'): ISODate | null {
  const s = (raw ?? '').trim().replace(/^["']|["']$/g, '').split(/\s+\d{1,2}:\d{2}/)[0].trim();
  if (!s) return null;
  // Excel serial date
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,4})[a-z]*[-/., ]+(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,4})[a-z]*[ -](\d{1,2}),?[ -](\d{2,4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (format === 'MDY' || (format === 'auto' && b > 12 && a <= 12)) return iso(+m[3], a, b);
    return iso(+m[3], b, a);
  }
  return null;
}

/** Decide DMY vs MDY by looking at all date values */
export function detectDateFormat(values: string[]): 'DMY' | 'MDY' {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'MDY' : 'DMY';
}

export interface ParseResult {
  transactions: Transaction[];
  skipped: number;
  errors: string[];
}

export function rowsToTransactions(rows: Row[], headerIndex: number, mapping: ColumnMapping, accountId: string): ParseResult {
  const headers = rows[headerIndex];
  const col = (name?: string) => (name ? headers.indexOf(name) : -1);
  const idx = {
    date: col(mapping.date),
    valueDate: col(mapping.valueDate),
    description: col(mapping.description),
    reference: col(mapping.reference),
    debit: col(mapping.debit),
    credit: col(mapping.credit),
    amount: col(mapping.amount),
    drCr: col(mapping.drCr),
    balance: col(mapping.balance),
  };
  const body = rows.slice(headerIndex + 1);
  const fmt = mapping.dateFormat && mapping.dateFormat !== 'auto' ? mapping.dateFormat : detectDateFormat(body.map((r) => r[idx.date] ?? ''));
  const importId = uid('imp');
  const out: Transaction[] = [];
  const errors: string[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[idx.date] ?? '', fmt === 'YMD' ? 'auto' : fmt);
    const rawDesc = (r[idx.description] ?? '').trim();
    if (!date || !rawDesc) {
      skipped++;
      continue;
    }
    let amount = 0;
    if (idx.debit >= 0 || idx.credit >= 0) {
      const dr = Math.abs(parseAmount(r[idx.debit]));
      const cr = Math.abs(parseAmount(r[idx.credit]));
      amount = cr - dr;
    } else if (idx.amount >= 0) {
      amount = parseAmount(r[idx.amount]);
      if (idx.drCr >= 0) {
        const t = (r[idx.drCr] ?? '').trim().toLowerCase();
        if (/^(dr|d|debit|withdrawal)/.test(t)) amount = -Math.abs(amount);
        else if (/^(cr|c|credit|deposit)/.test(t)) amount = Math.abs(amount);
      }
    }
    if (amount === 0) {
      skipped++;
      continue;
    }
    const balanceRaw = idx.balance >= 0 ? (r[idx.balance] ?? '').trim() : '';
    out.push({
      id: uid('txn'),
      accountId,
      date,
      valueDate: idx.valueDate >= 0 ? parseDate(r[idx.valueDate] ?? '', fmt === 'YMD' ? 'auto' : fmt) : null,
      description: cleanDescription(rawDesc),
      rawDescription: rawDesc,
      reference: idx.reference >= 0 ? (r[idx.reference] ?? '').trim() : '',
      amount: Math.round(amount * 100) / 100,
      balance: balanceRaw ? parseAmount(balanceRaw) : null,
      category: null,
      subcategory: null,
      importId,
    });
  }
  if (!out.length) errors.push('No transactions found. Check the column mapping.');
  return { transactions: out, skipped, errors };
}
