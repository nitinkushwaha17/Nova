import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardPaste, FileSpreadsheet, Landmark, LockKeyhole, Plus, RotateCcw, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AccountModal } from '../components/AccountModal';
import { Badge, Button, Card, cx, Field, Input, Money, NumberInput, PageHeader, Select, Spinner, Tabs, toast } from '../components/ui';
import { formatDate } from '../lib/dates';
import { uid } from '../lib/format';
import { PasswordError } from '../lib/parsers/officeCrypto';
import { readPdfLines } from '../lib/parsers/pdf';
import { accountRows, applyDepositSync, isSbiStatement, parseSbiStatement, planDepositSync, type SbiStatement } from '../lib/parsers/sbi';
import { detectDelimiter, findHeaderRow, parseDelimited, readRows, rowsToTransactions, type Row } from '../lib/parsers/tabular';
import { useStore, type ImportResult } from '../store';
import type { ColumnMapping } from '../types';

type FieldKey = keyof Omit<ColumnMapping, 'dateFormat'>;
const FIELDS: {
  key: FieldKey;
  label: string;
  required?: boolean;
  hint?: string;
}[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description / narration', required: true },
  { key: 'debit', label: 'Debit (withdrawal)' },
  { key: 'credit', label: 'Credit (deposit)' },
  {
    key: 'amount',
    label: 'Single amount column',
    hint: 'Only if there are no separate debit/credit columns',
  },
  { key: 'drCr', label: 'Dr/Cr indicator', hint: 'For single amount columns' },
  { key: 'balance', label: 'Balance' },
  { key: 'reference', label: 'Reference / cheque no.' },
  { key: 'valueDate', label: 'Value date' },
];

function mappingFits(m: ColumnMapping | undefined, headers: string[]) {
  if (!m) return false;
  return [m.date, m.description, m.debit, m.credit, m.amount].filter(Boolean).every((h) => headers.includes(h!));
}

export default function Import() {
  const [params] = useSearchParams();
  const accounts = useStore((s) => s.meta.accounts);
  const saveAccount = useStore((s) => s.saveAccount);
  const importTransactions = useStore((s) => s.importTransactions);
  const assets = useStore((s) => s.portfolio.assets);
  const update = useStore((s) => s.update);
  // Parsed SBI e-statement (PDF): transactions go through the normal preview, FDs sync to Assets
  const [sbi, setSbi] = useState<{ st: SbiStatement; accountIndex: number } | null>(null);
  const [accountId, setAccountId] = useState(params.get('account') ?? accounts[0]?.id ?? '');
  const [newAcc, setNewAcc] = useState(false);
  const [source, setSource] = useState<'file' | 'paste'>('file');
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Password-protected file waiting for a password. Saved passwords (Settings) are tried first; the last
  // working one is also kept in memory for this visit.
  const [locked, setLocked] = useState<{ file: File; wrong: boolean; triedSaved: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const savedPasswords = useStore((s) => s.settings.statementPasswords) ?? [];
  const lastPassword = useRef<string | undefined>(undefined);
  const account = accounts.find((a) => a.id === accountId);

  const load = (r: Row[], name: string) => {
    if (!r.length) {
      toast('No rows found in that file', 'error');
      return;
    }
    const found = findHeaderRow(r);
    const saved = account?.columnMapping;
    const idx = found.index;
    setRows(r);
    setFileName(name);
    setHeaderIndex(idx);
    setMapping(mappingFits(saved, r[idx]) ? saved! : (found.mapping ?? { date: '', description: '', dateFormat: 'auto' }));
    setResult(null);
  };

  const pickSbiAccount = (st: SbiStatement, i: number, name: string) => {
    setSbi({ st, accountIndex: i });
    const a = st.accounts[i];
    if (a?.transactions.length) load(accountRows(a), name);
    else {
      setRows(null);
      setFileName(name);
      setResult(null);
      if (!st.deposits.length) toast('No transactions or fixed deposits found in that statement', 'error');
    }
  };

  const openFile = async (f: File, pw: string | undefined) => {
    if (/\.pdf$/i.test(f.name)) {
      const lines = await readPdfLines(new Uint8Array(await f.arrayBuffer()), pw);
      if (!isSbiStatement(lines)) {
        toast('Only SBI e-statement PDFs can be read. For other banks, download the Excel/CSV version.', 'error');
        return;
      }
      const st = parseSbiStatement(lines);
      // Prefer the statement account matching the selected Nova account's last 4 digits
      pickSbiAccount(
        st,
        Math.max(
          0,
          st.accounts.findIndex((a) => !!account?.last4 && a.last4 === account.last4),
        ),
        f.name,
      );
    } else {
      setSbi(null);
      load(await readRows(f, pw), f.name);
    }
  };

  /** `typed` is a password the user just entered; otherwise saved passwords are tried in turn */
  const onFile = async (f: File, typed?: string) => {
    const saved = [...new Set([lastPassword.current, ...savedPasswords.map((p) => p.password)].filter((p): p is string => !!p))];
    const candidates: (string | undefined)[] = typed !== undefined ? [typed] : saved.length ? saved : [undefined];
    setLoading(true);
    try {
      for (const pw of candidates) {
        try {
          await openFile(f, pw);
          if (pw) lastPassword.current = pw;
          if (typed && remember && !savedPasswords.some((p) => p.password === typed)) {
            update('settings', (s) => ({ ...s, statementPasswords: [...(s.statementPasswords ?? []), { id: uid('pw'), label: f.name.replace(/\.[^.]+$/, ''), password: typed }] }));
            toast('Password saved to Settings → Statement passwords', 'info');
          }
          setLocked(null);
          setPassword('');
          return;
        } catch (e) {
          if (e instanceof PasswordError && e.reason !== 'unsupported') continue;
          throw e;
        }
      }
      // Saved passwords not fitting isn't the user's mistake; only flag a password they typed
      setLocked({ file: f, wrong: typed !== undefined, triedSaved: typed === undefined && savedPasswords.length > 0 });
    } catch (e) {
      toast(`Could not read file: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const headers = rows?.[headerIndex] ?? [];
  const parsed = useMemo(() => {
    if (!rows || !mapping || !mapping.date || !mapping.description || (!mapping.debit && !mapping.credit && !mapping.amount)) return null;
    return rowsToTransactions(rows, headerIndex, mapping, accountId || 'preview');
  }, [rows, headerIndex, mapping, accountId]);

  const stats = useMemo(() => {
    if (!parsed) return null;
    const t = parsed.transactions;
    const dates = t.map((x) => x.date).sort();
    return {
      count: t.length,
      debit: t.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0),
      credit: t.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0),
      from: dates[0],
      to: dates[dates.length - 1],
    };
  }, [parsed]);

  const doImport = async () => {
    if (!parsed || !account || !mapping) return;
    setImporting(true);
    try {
      const res = await importTransactions(parsed.transactions.map((t) => ({ ...t, accountId: account.id })));
      saveAccount({ ...account, columnMapping: mapping, last4: account.last4 || sbi?.st.accounts[sbi.accountIndex]?.last4 });
      setResult(res);
      setRows(null);
      toast(`Imported ${res.added} transactions`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const fdPlan = useMemo(() => (sbi?.st.deposits.length ? planDepositSync(assets, sbi.st) : null), [sbi, assets]);
  const syncDeposits = () => {
    if (!fdPlan) return;
    update('portfolio', (d) => ({ assets: applyDepositSync(d.assets, fdPlan) }));
    toast(`Fixed deposits synced: ${fdPlan.add.length} added, ${fdPlan.update.length} updated, ${fdPlan.close.length} closed`);
  };

  const reset = () => {
    setSbi(null);
    setRows(null);
    setMapping(null);
    setResult(null);
    setPasted('');
  };

  return (
    <>
      <PageHeader
        title="Import statement"
        subtitle="CSV, TSV, TXT or Excel exports from any bank or card, or SBI's e-statement PDF. Columns are detected automatically and remembered per account."
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <Card title="1 · Account">
            <div className="flex gap-2">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Button icon={<Plus className="size-4" />} onClick={() => setNewAcc(true)} title="New account" />
            </div>
            {account?.columnMapping && <p className="mt-2 text-xs text-muted">Saved column format will be reused if the headers match.</p>}
          </Card>

          <Card title="2 · Statement">
            <Tabs
              value={source}
              onChange={setSource}
              className="mb-4"
              options={[
                { value: 'file', label: 'Upload file' },
                { value: 'paste', label: 'Paste text' },
              ]}
            />
            {source === 'file' ? (
              locked ? (
                <form
                  className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-accent/50 bg-accent/5 px-4 py-6 text-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (password) void onFile(locked.file, password);
                  }}
                >
                  <LockKeyhole className="size-6 text-accent" />
                  <div>
                    <p className="text-sm font-medium break-all">{locked.file.name}</p>
                    <p className="text-xs text-muted">{locked.triedSaved ? 'is password-protected and none of your saved passwords opened it' : 'is password-protected'}</p>
                  </div>
                  <Input
                    type="password"
                    autoFocus
                    autoComplete="off"
                    value={password}
                    onChange={(e) => (setPassword(e.target.value), locked.wrong && setLocked({ ...locked, wrong: false }))}
                    placeholder="File password"
                    className={cx(locked.wrong && '!border-neg')}
                  />
                  {locked.wrong && <p className="-mt-1 text-xs text-neg">Wrong password, try again</p>}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                    <input type="checkbox" className="accent-accent" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Remember in Settings for future statements
                  </label>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => (setLocked(null), setPassword(''))}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" loading={loading} disabled={!password}>
                      Unlock
                    </Button>
                  </div>
                  <p className="text-[11px] text-faint">Decrypted on this device.</p>
                </form>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    const f = e.dataTransfer.files[0];
                    if (f) void onFile(f);
                  }}
                  onClick={() => fileRef.current?.click()}
                  className={cx(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
                    drag ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/50',
                  )}
                >
                  {loading ? <Spinner className="size-6" /> : <Upload className="size-6 text-accent" />}
                  <p className="text-sm font-medium">{fileName && rows ? fileName : 'Drop a statement or click to browse'}</p>
                  <p className="text-xs text-muted">.csv .tsv .txt .xls .xlsx · SBI e-statement .pdf</p>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm,.ods,.pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void onFile(f);
                    }}
                  />
                </div>
              )
            ) : (
              <div className="space-y-2">
                <textarea
                  className="input h-40 font-mono text-xs"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste rows copied from net banking or a spreadsheet (including the header row)"
                />
                <Button
                  icon={<ClipboardPaste className="size-4" />}
                  disabled={!pasted.trim()}
                  onClick={() =>
                    load(
                      parseDelimited(pasted, detectDelimiter(pasted)).filter((r) => r.some((c) => c.trim())),
                      'Pasted text',
                    )
                  }
                >
                  Read pasted rows
                </Button>
              </div>
            )}
          </Card>

          {rows && mapping && (
            <Card title="3 · Columns" action={<Badge>{headers.filter(Boolean).length} columns</Badge>}>
              <div className="space-y-3">
                <Field label="Header row" hint="Detected automatically — change it if account details sit above the table.">
                  <NumberInput value={headerIndex + 1} onChange={(v) => setHeaderIndex(Math.max(0, Math.min(rows.length - 1, Math.round(v) - 1)))} />
                </Field>
                {FIELDS.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
                    <Select
                      value={mapping[f.key] ?? ''}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          [f.key]: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">—</option>
                      {headers.map((h, i) =>
                        h ? (
                          <option key={i} value={h}>
                            {h}
                          </option>
                        ) : null,
                      )}
                    </Select>
                  </Field>
                ))}
                <Field label="Date format">
                  <Select
                    value={mapping.dateFormat ?? 'auto'}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        dateFormat: e.target.value as ColumnMapping['dateFormat'],
                      })
                    }
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="DMY">DD/MM/YYYY</option>
                    <option value="MDY">MM/DD/YYYY</option>
                    <option value="YMD">YYYY-MM-DD</option>
                  </Select>
                </Field>
              </div>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {sbi && !result && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <Landmark className="size-4 text-accent" /> SBI e-statement{sbi.st.asOf && <span className="font-normal text-muted">· as on {formatDate(sbi.st.asOf)}</span>}
                </span>
              }
            >
              <div className="space-y-4">
                {sbi.st.accounts.length > 1 && (
                  <Field label="Savings account to import">
                    <Select value={sbi.accountIndex} onChange={(e) => pickSbiAccount(sbi.st, +e.target.value, fileName)}>
                      {sbi.st.accounts.map((a, i) => (
                        <option key={i} value={i}>
                          {a.type || 'Account'} ••{a.last4} · {a.transactions.length} transactions
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {(() => {
                  const a = sbi.st.accounts[sbi.accountIndex];
                  if (!a) return null;
                  const mismatch = !!account?.last4 && account.last4 !== a.last4;
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge>Account ••{a.last4}</Badge>
                      {a.openingBalance !== null && (
                        <Badge>
                          Opening <Money value={a.openingBalance} />
                        </Badge>
                      )}
                      {a.closingBalance !== null && (
                        <Badge>
                          Closing <Money value={a.closingBalance} />
                        </Badge>
                      )}
                      {mismatch && (
                        <Badge color="#fbbf24">
                          {account!.name} ends in {account!.last4}
                        </Badge>
                      )}
                    </div>
                  );
                })()}
                {sbi.st.warnings.length > 0 && (
                  <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-warn">
                      <AlertTriangle className="size-3.5" /> Some balances didn't reconcile — check these rows before importing
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5 text-muted">
                      {sbi.st.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {fdPlan && (
                  <div className="rounded-xl border border-line bg-surface-2/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{sbi.st.deposits.length} fixed deposits</p>
                        <p className="mt-0.5 text-xs text-muted">
                          Principal <Money value={sbi.st.deposits.reduce((s, d) => s + d.principal, 0)} /> · with accrued interest{' '}
                          <Money value={sbi.st.deposits.reduce((s, d) => s + d.principal + d.interestAccrued, 0)} /> · at maturity{' '}
                          <Money value={sbi.st.deposits.reduce((s, d) => s + d.maturityAmount, 0)} />
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {fdPlan.add.length > 0 && <Badge color="#34d399">{fdPlan.add.length} new</Badge>}
                          {fdPlan.update.length > 0 && <Badge color="#60a5fa">{fdPlan.update.length} changed</Badge>}
                          {fdPlan.close.length > 0 && <Badge color="#fbbf24">{fdPlan.close.length} no longer listed → closed</Badge>}
                          {fdPlan.unchanged > 0 && <Badge>{fdPlan.unchanged} already up to date</Badge>}
                        </div>
                      </div>
                      <Button variant="primary" size="sm" disabled={!fdPlan.add.length && !fdPlan.update.length && !fdPlan.close.length} onClick={syncDeposits}>
                        {fdPlan.add.length || fdPlan.update.length || fdPlan.close.length ? 'Sync to Assets' : 'In sync'}
                      </Button>
                    </div>
                    <p className="mt-3 text-[11px] text-faint">
                      Each FD becomes an asset valued from its rate and dates (quarterly compounding). Names and notes you edit are kept on re-sync. Sweep transfers into FDs are
                      treated as self-transfers, so they don't count as spending.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
          {result ? (
            <Card>
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <CheckCircle2 className="size-12 text-pos" />
                <h2 className="text-xl font-semibold">Imported {result.added} transactions</h2>
                <div className="flex flex-wrap justify-center gap-2 text-sm">
                  <Badge>{result.duplicates} duplicates skipped</Badge>
                  <Badge color="#a78bfa">{result.categorized} auto-categorised</Badge>
                  <Badge color="#22d3ee">{result.transfers} self-transfers detected</Badge>
                  <Badge>FY {result.fys.join(', ')}</Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link to="/transactions?uncategorized=1">
                    <Button variant="primary" icon={<ArrowRight className="size-4" />}>
                      Review uncategorised
                    </Button>
                  </Link>
                  <Button icon={<RotateCcw className="size-4" />} onClick={reset}>
                    Import another
                  </Button>
                </div>
              </div>
            </Card>
          ) : !rows ? (
            !sbi && (
              <Card>
                <div className="flex flex-col items-center gap-3 py-14 text-center text-muted">
                  <FileSpreadsheet className="size-10" />
                  <p className="max-w-md text-sm">
                    Upload a statement to preview it here. Duplicates are skipped automatically, so it's safe to import overlapping date ranges. Your auto-categorisation rules are
                    applied and transfers between your own accounts are detected.
                  </p>
                </div>
              </Card>
            )
          ) : (
            <>
              {stats && (
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="card p-4">
                    <div className="text-xs text-muted">Transactions</div>
                    <div className="mt-1 text-lg font-semibold">{stats.count}</div>
                  </div>
                  <div className="card p-4">
                    <div className="text-xs text-muted">Period</div>
                    <div className="mt-1 text-sm font-semibold">{stats.from ? `${formatDate(stats.from)} – ${formatDate(stats.to)}` : '—'}</div>
                  </div>
                  <div className="card p-4">
                    <div className="text-xs text-muted">Money out</div>
                    <div className="mt-1 text-lg font-semibold text-neg">
                      <Money value={stats.debit} />
                    </div>
                  </div>
                  <div className="card p-4">
                    <div className="text-xs text-muted">Money in</div>
                    <div className="mt-1 text-lg font-semibold text-pos">
                      <Money value={stats.credit} />
                    </div>
                  </div>
                </div>
              )}
              <Card
                pad={false}
                title="Preview"
                action={
                  <div className="flex items-center gap-2">
                    {parsed && parsed.skipped > 0 && <Badge color="#fbbf24">{parsed.skipped} rows skipped</Badge>}
                    <Button variant="primary" loading={importing} disabled={!parsed?.transactions.length || !account} onClick={doImport}>
                      {account ? `Import ${parsed?.transactions.length ?? 0} into ${account.name}` : 'Select an account'}
                    </Button>
                  </div>
                }
              >
                {!parsed ? (
                  <p className="px-5 pb-5 text-sm text-muted">Map at least Date, Description and an amount column (Debit/Credit or Amount).</p>
                ) : (
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
                        <tr>
                          <th className="px-5 py-2 font-medium">Date</th>
                          <th className="px-2 font-medium">Description</th>
                          <th className="px-2 text-right font-medium">Amount</th>
                          <th className="px-5 text-right font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.transactions.slice(0, 200).map((t) => (
                          <tr key={t.id} className="border-t border-line">
                            <td className="px-5 py-1.5 whitespace-nowrap text-muted">{formatDate(t.date)}</td>
                            <td className="max-w-md truncate px-2" title={t.description}>
                              {t.description}
                            </td>
                            <td className="px-2 text-right whitespace-nowrap">
                              <Money value={t.amount} colored sign />
                            </td>
                            <td className="px-5 text-right whitespace-nowrap text-muted">{t.balance != null ? <Money value={t.balance} /> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.transactions.length > 200 && <p className="px-5 py-3 text-xs text-muted">…and {parsed.transactions.length - 200} more</p>}
                    {parsed.errors.length > 0 && (
                      <div className="border-t border-line px-5 py-3 text-xs text-warn">
                        {parsed.errors.slice(0, 5).map((e, i) => (
                          <div key={i}>{e}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
      <AccountModal open={newAcc} onClose={() => setNewAcc(false)} onSaved={(a) => setAccountId(a.id)} />
    </>
  );
}
