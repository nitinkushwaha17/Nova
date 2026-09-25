const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let privacyMode = false;
export function setPrivacyMode(v: boolean) {
  privacyMode = v;
}

const MASK = '••••••';

/** ₹1,23,456 */
export function money(n: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (privacyMode) return `₹${MASK}`;
  const abs = Math.abs(n);
  const body = opts.decimals ? inr2.format(abs) : inr.format(Math.round(abs));
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}₹${body}`;
}

/** ₹1.2L, ₹3.4Cr, ₹12K */
export function moneyShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (privacyMode) return `₹${MASK}`;
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

function trim(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '');
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number, digits = 2): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Parse "1,23,456.78", "₹ 500", "(1,000)", "500 Dr" → number */
export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  let s = String(value).trim().replace(/^["']|["']$/g, '').trim();
  if (!s || s === '-') return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(s)) negative = true;
  s = s.replace(/\b(cr|dr)\.?$/i, '').replace(/[₹$,\s]|INR|Rs\.?/gi, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}
