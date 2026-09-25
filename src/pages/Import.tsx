import { ArrowRight, CheckCircle2, ClipboardPaste, FileSpreadsheet, Plus, RotateCcw, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AccountModal } from '../components/AccountModal';
import { Badge, Button, Card, cx, Field, Money, NumberInput, PageHeader, Select, Spinner, Tabs, toast } from '../components/ui';
import { formatDate } from '../lib/dates';
import { detectDelimiter, findHeaderRow, parseDelimited, readRows, rowsToTransactions, type Row } from '../lib/parsers/tabular';
import { useStore, type ImportResult } from '../store';
import type { ColumnMapping } from '../types';

type FieldKey = keyof Omit<ColumnMapping, 'dateFormat'>;
const FIELDS: { key: FieldKey; label: string; required?: boolean; hint?: string }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description / narration', required: true },
  { key: 'debit', label: 'Debit (withdrawal)' },
  { key: 'credit', label: 'Credit (deposit)' },
  { key: 'amount', label: 'Single amount column', hint: 'Only if there are no separate debit/credit columns' },
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

  const onFile = async (f: File) => {
    if (/\.pdf$/i.test(f.name)) {
      toast('PDF statements aren’t supported — download the Excel/CSV version from net banking.', 'error');
      return;
    }
    setLoading(true);
    try {
      load(await readRows(f), f.name);
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
      saveAccount({ ...account, columnMapping: mapping });
      setResult(res);
      setRows(null);
      toast(`Imported ${res.added} transactions`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setRows(null);
    setMapping(null);
    setResult(null);
    setPasted('');
  };

  return (
    <>
      <PageHeader title="Import statement" subtitle="CSV, TSV, TXT or Excel exports from any bank or card. Columns are detected automatically and remembered per account." />

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
                <p className="text-xs text-muted">.csv .tsv .txt .xls .xlsx</p>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm,.ods"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void onFile(f);
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  className="input h-40 font-mono text-xs"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste rows copied from net banking or a spreadsheet (including the header row)"
                />
                <Button icon={<ClipboardPaste className="size-4" />} disabled={!pasted.trim()} onClick={() => load(parseDelimited(pasted, detectDelimiter(pasted)).filter((r) => r.some((c) => c.trim())), 'Pasted text')}>
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
                    <Select value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
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
                  <Select value={mapping.dateFormat ?? 'auto'} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as ColumnMapping['dateFormat'] })}>
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
            <Card>
              <div className="flex flex-col items-center gap-3 py-14 text-center text-muted">
                <FileSpreadsheet className="size-10" />
                <p className="max-w-md text-sm">
                  Upload a statement to preview it here. Duplicates are skipped automatically, so it's safe to import overlapping date ranges. Your auto-categorisation rules are
                  applied and transfers between your own accounts are detected.
                </p>
              </div>
            </Card>
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
