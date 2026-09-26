/* Parse Indian bank transaction alert SMS into transactions. Pure functions, no platform code. */
import type { Account, ISODate, Transaction } from '../types';
import { uid } from './format';

export interface RawSms {
  id: string;
  address: string;
  body: string;
  /** Received time, epoch ms */
  date: number;
}

export interface SmsTxn {
  smsId: string;
  bank?: string;
  /** Last digits of the account / card number as printed in the SMS (usually 4) */
  last4?: string;
  date: ISODate;
  /** Signed: positive = credit, negative = debit */
  amount: number;
  counterparty?: string;
  reference?: string;
  balance?: number;
  kind: 'upi' | 'card' | 'atm' | 'neft' | 'imps' | 'other';
  description: string;
  body: string;
}

const BANKS: [RegExp, string][] = [
  [/SBI|SBIN|SBIUPI|SBIINB|SBMSMS|CBSSBI/, 'SBI'],
  [/HDFC/, 'HDFC'],
  [/ICICI/, 'ICICI'],
  [/AXIS/, 'Axis'],
  [/KOTAK|KMB/, 'Kotak'],
  [/PNB/, 'PNB'],
  [/BOB|BARODA/, 'Bank of Baroda'],
  [/CANARA|CANBNK/, 'Canara'],
  [/UNION|UBOI/, 'Union Bank'],
  [/IDFC/, 'IDFC First'],
  [/INDUS/, 'IndusInd'],
  [/YES ?B/, 'Yes Bank'],
  [/FEDERAL|FEDBNK/, 'Federal'],
  [/IDBI/, 'IDBI'],
  [/AUBANK|AU BANK/, 'AU'],
];

/** Promotions, OTPs, reminders and failures look like alerts but aren't money movements */
const NOT_A_TXN =
  /\bOTP\b|one[- ]time password|\bwill be (debited|credited|deducted)|\bis due\b|\bdue (date|on)\b|\brequest(ed)? (money|of|for)|\bcollect request|\bfailed\b|\bdeclined\b|\bunsuccessful\b|\bpre-?approved\b|\boffer\b|\bcashback of up to\b|\bmin(imum)? amount due\b|\bmandate\b.*\bcreated\b|\bauto-?pay\b.*\bscheduled\b/i;

const AMOUNT = String.raw`(?:(?:Rs\.?|INR|₹)\s*)?([\d,]+(?:\.\d{1,2})?)`;
const CURRENCY_AMOUNT = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

// "debited by 250.0", "credited with Rs 500", "Debited INR 500.00", "debited for Rs 250"
const DIRECTED_AMOUNT = new RegExp(String.raw`\b(debited|credited|deducted|deposited|withdrawn|spent|sent|received|paid|transferred)\b[\s:-]*(?:by|with|for|of)?\s*${AMOUNT}`, 'i');
const DEBIT_WORDS = /\b(debited|deducted|withdrawn|withdrawal|spent|sent|paid|purchase|transferred to|dr\.?)\b/i;
const CREDIT_WORDS = /\b(credited|deposited|received|refund(ed)?|reversed|cr\.?)\b/i;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const num = (s: string) => Number(s.replace(/,/g, ''));
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function toISO(epoch: number): ISODate {
  const d = new Date(epoch);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function bankFromSender(address: string, body = ''): string | undefined {
  const a = address.toUpperCase();
  for (const [re, name] of BANKS) if (re.test(a)) return name;
  const tail = body.slice(-40).toUpperCase();
  for (const [re, name] of BANKS) if (re.test(tail)) return name;
  return undefined;
}

/** Parse a date written in the SMS; falls back to the received date when absent or implausible */
export function smsDate(body: string, received: number): ISODate {
  const fallback = toISO(received);
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m: RegExpMatchArray | null;
  let found: ISODate | null = null;
  if ((m = body.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) found = iso(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = body.match(/\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s,]*(\d{2,4})\b/)) && MONTHS[m[2].toLowerCase()])
    found = iso(year(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  else if ((m = body.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/))) found = iso(year(m[3]), Number(m[2]), Number(m[1]));
  if (!found || Number.isNaN(Date.parse(found))) return fallback;
  // Alerts arrive within minutes; anything more than a week away was misread
  return Math.abs(Date.parse(found) - Date.parse(fallback)) <= 7 * 86400000 ? found : fallback;
}

function tidy(s: string | undefined): string | undefined {
  const t = s
    ?.replace(/\s+/g, ' ')
    .replace(/^(the|a|mr\.?|ms\.?|mrs\.?)\s+/i, '')
    .replace(/[.,;:\-\s]+$/, '')
    .trim();
  return t && t.length > 1 && !/^\d+$/.test(t) ? t.slice(0, 60) : undefined;
}

function counterpartyOf(body: string, debit: boolean): string | undefined {
  const stop = String.raw`(?=\s+(?:on|ref|refno|upi|avl|avbl|bal|via|dt|date|if|not|for|txn|call|info)\b|[.;,(]|\s-|\s*$)`;
  const patterns = debit
    ? [
        new RegExp(String.raw`;\s*([A-Za-z0-9 &@._'-]{2,50}?)\s+credited`, 'i'),
        new RegExp(String.raw`\b(?:trf|transfer(?:red)?|sent|paid|payment)\s+to\s+([A-Za-z0-9 &@._'/-]{2,50}?)${stop}`, 'i'),
        new RegExp(String.raw`\bto\s+(?:VPA\s+)?([A-Za-z0-9 &@._'/-]{2,50}?)${stop}`, 'i'),
        new RegExp(String.raw`\b(?:at|@)\s+([A-Za-z0-9 &._'*/-]{2,50}?)${stop}`, 'i'),
      ]
    : [
        new RegExp(String.raw`;\s*([A-Za-z0-9 &@._'-]{2,50}?)\s+debited`, 'i'),
        new RegExp(String.raw`\b(?:transfer|trf|received)?\s*from\s+(?:VPA\s+)?([A-Za-z0-9 &@._'/-]{2,50}?)${stop}`, 'i'),
        new RegExp(String.raw`\bby\s+(?:VPA\s+)?([A-Za-z][A-Za-z0-9 &@._'/-]{1,50}?)${stop}`, 'i'),
      ];
  for (const re of patterns) {
    const c = tidy(body.match(re)?.[1]);
    if (c && !/^(your|a\/?c|account|ac|card|bank|you|rs|inr)\b/i.test(c)) return c;
  }
  return undefined;
}

export function parseSms(sms: RawSms): SmsTxn | null {
  const body = sms.body.replace(/\s+/g, ' ').trim();
  // Personal senders are phone numbers; bank alerts come from alphanumeric headers like VM-SBIUPI
  if (/^\+?\d{8,}$/.test(sms.address.replace(/[\s-]/g, ''))) return null;
  if (NOT_A_TXN.test(body)) return null;

  let amount: number | null = null;
  let debit: boolean | null = null;
  const directed = body.match(DIRECTED_AMOUNT);
  if (directed) {
    amount = num(directed[2]);
    debit = !/credited|deposited|received/i.test(directed[1]);
  } else {
    const cur = body.match(CURRENCY_AMOUNT);
    if (!cur) return null;
    amount = num(cur[1]);
    const d = body.search(DEBIT_WORDS);
    const c = body.search(CREDIT_WORDS);
    if (d < 0 && c < 0) return null;
    debit = c < 0 || (d >= 0 && d < c);
  }
  if (!amount || !Number.isFinite(amount)) return null;

  const acct = body.match(/\b(?:a\/?c|acct|account|card|ac)(?:\s*(?:no\.?|number|ending(?:\s+with)?|xx+))?[\s:.#-]*[xX*]*(\d{3,6})\b/i);
  const ref = [...body.matchAll(/\b(?:ref(?:erence)?(?:\s*no\.?)?|refno|rrn|utr|upi(?:\s*ref)?(?:\s*no)?|txn\s*(?:id|no)?|imps\s*ref(?:\s*no)?)[\s:.#-]*([A-Z0-9]{6,22})\b/gi)]
    .map((m) => m[1])
    .find((r) => /\d{6}/.test(r));
  const bal = body.match(/\b(?:avl\.?|avbl\.?|available|closing)\s*(?:bal(?:ance)?|limit)?[\s:.-]*(?:is\s*)?(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);

  const kind: SmsTxn['kind'] = /\bUPI\b|\bVPA\b/i.test(body)
    ? 'upi'
    : /\bATM\b|withdrawn|withdrawal/i.test(body)
      ? 'atm'
      : /\bcard\b/i.test(body)
        ? 'card'
        : /\bNEFT\b|\bRTGS\b/i.test(body)
          ? 'neft'
          : /\bIMPS\b/i.test(body)
            ? 'imps'
            : 'other';
  const counterparty = counterpartyOf(body, debit);
  const label = { upi: 'UPI', card: 'Card', atm: 'ATM', neft: 'NEFT', imps: 'IMPS', other: '' }[kind];
  const description = counterparty ? `${label ? label + ' ' : ''}${debit ? 'to' : 'from'} ${counterparty}` : `${label ? label + ' ' : ''}${debit ? 'debit' : 'credit'}`;

  return {
    smsId: sms.id,
    bank: bankFromSender(sms.address, body),
    last4: acct?.[1]?.slice(-4),
    date: smsDate(body, sms.date),
    amount: debit ? -amount : amount,
    counterparty,
    reference: ref,
    balance: bal ? num(bal[1]) : undefined,
    kind,
    description,
    body,
  };
}

export interface UnlinkedSms {
  /** Account digits from the SMS, or '' when the SMS names only the bank */
  last4: string;
  bank?: string;
  count: number;
  /** Oldest message date, to rescan from after linking */
  oldest: ISODate;
}

/** Find the account an alert belongs to: by account/card digits, else the only account at that bank */
export function accountFor(s: SmsTxn, accounts: Account[]): Account | undefined {
  const open = accounts.filter((a) => !a.archived);
  if (s.last4) {
    const hits = open.filter((a) => a.last4 && (a.last4.endsWith(s.last4!) || s.last4!.endsWith(a.last4)));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1 && s.bank) return hits.find((a) => a.bank?.toUpperCase() === s.bank!.toUpperCase());
    return undefined;
  }
  if (!s.bank) return undefined;
  const atBank = open.filter((a) => a.bank?.toUpperCase() === s.bank!.toUpperCase());
  return atBank.length === 1 ? atBank[0] : undefined;
}

export function smsToTransactions(parsed: SmsTxn[], accounts: Account[]): { txns: Transaction[]; unlinked: UnlinkedSms[] } {
  const txns: Transaction[] = [];
  const unlinked = new Map<string, UnlinkedSms>();
  for (const s of parsed) {
    const acc = accountFor(s, accounts);
    if (!acc) {
      const key = `${s.last4 ?? ''}|${s.bank ?? ''}`;
      const u = unlinked.get(key) ?? { last4: s.last4 ?? '', bank: s.bank, count: 0, oldest: s.date };
      u.count++;
      if (s.date < u.oldest) u.oldest = s.date;
      unlinked.set(key, u);
      continue;
    }
    txns.push({
      id: uid('tx'),
      accountId: acc.id,
      date: s.date,
      description: s.description,
      rawDescription: s.body,
      reference: s.reference,
      amount: s.amount,
      // SMS balances are ignored so they never disturb the statement balance trail
      balance: null,
      source: 'sms',
      smsId: s.smsId,
    });
  }
  return { txns, unlinked: [...unlinked.values()] };
}
