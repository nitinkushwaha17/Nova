import { ArrowLeftRight, Download, Plus, Search, Tag, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BucketSelect } from '../components/BucketSelect';
import { CategorySelect } from '../components/CategorySelect';
import { PeriodPicker } from '../components/PeriodPicker';
import { TxnModal } from '../components/TxnModal';
import { Badge, Button, Card, cx, Dot, Empty, Input, Money, PageHeader, Select, Spinner, toast } from '../components/ui';
import { formatDate } from '../lib/dates';
import { bucketIcon } from '../lib/buckets';
import { classify, normalizeTag, type TxKind } from '../lib/transactions';
import { usePeriod, usePeriodTxns } from '../hooks';
import { useCatMap, useGroupTotals, useKnownFYs, useStore } from '../store';
import type { Transaction } from '../types';

const PAGE = 150;
const KIND_LABEL: Record<TxKind, string> = { expense: 'Expense', income: 'Income', refund: 'Refund', investment: 'Investment', transfer: 'Transfer' };
const KIND_COLOR: Record<TxKind, string> = { expense: '#fb7185', income: '#34d399', refund: '#fbbf24', investment: '#60a5fa', transfer: '#a78bfa' };

function toCSV(txns: Transaction[], accName: (id: string) => string, catName: (id?: string | null) => string) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Account', 'Description', 'Amount', 'Balance', 'Category', 'Subcategory', 'Notes', 'Tags', 'Reference'];
  const lines = txns.map((t) => [t.date, accName(t.accountId), t.description, t.amount, t.balance ?? '', catName(t.category), t.subcategory ?? '', t.notes ?? '', (t.tags ?? []).join(' '), t.reference ?? ''].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}

function CategoryCell({ t, color, name, onChange }: { t: Transaction; color?: string; name?: string; onChange: (c: string | null, s: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <CategorySelect
        compact
        autoFocus
        category={t.category}
        subcategory={t.subcategory}
        onChange={(c, s) => {
          onChange(c, s);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      />
    );
  return (
    <button onClick={() => setEditing(true)} className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-surface-2">
      <Dot color={color ?? 'var(--line)'} />
      {name ? (
        <span className="truncate">
          {name}
          {t.subcategory && <span className="text-faint"> › {t.subcategory}</span>}
        </span>
      ) : (
        <span className="text-warn">Uncategorised</span>
      )}
    </button>
  );
}

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const { period, setPeriod } = usePeriod();
  const fys = useKnownFYs();
  const { txns, loading } = usePeriodTxns(period);
  const accounts = useStore((s) => s.meta.accounts);
  const updateTransactions = useStore((s) => s.updateTransactions);
  const deleteTransactions = useStore((s) => s.deleteTransactions);
  const catMap = useCatMap();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [account, setAccount] = useState(params.get('account') ?? '');
  const category = params.get('uncategorized') ? '__none' : (params.get('category') ?? '');
  const setCategory = (v: string) => {
    const p = new URLSearchParams(params);
    p.delete('uncategorized');
    p.delete('category');
    if (v === '__none') p.set('uncategorized', '1');
    else if (v) p.set('category', v);
    setParams(p, { replace: true });
  };
  const bucket = params.get('bucket') ?? '';
  const tag = params.get('tag') ?? '';
  const setParam = (key: 'bucket' | 'tag', v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(key, v);
    else p.delete(key);
    setParams(p, { replace: true });
  };
  const buckets = useStore((s) => s.buckets.buckets);
  const bucketMap = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const knownTags = useGroupTotals('tag');
  const [bulkTag, setBulkTag] = useState('');
  const [kind, setKind] = useState<TxKind | ''>('');
  const [sort, setSort] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [edit, setEdit] = useState<Transaction | undefined>();
  const [modal, setModal] = useState(false);

  const accName = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a.name]));
    return (id: string) => m.get(id) ?? '—';
  }, [accounts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const amt = Number(needle.replace(/[,₹]/g, ''));
    let list = txns.filter((t) => {
      if (account && t.accountId !== account) return false;
      if (category === '__none' && t.category) return false;
      if (category && category !== '__none' && t.category !== category) return false;
      if (bucket === '__none' ? t.bucketId : bucket && t.bucketId !== bucket) return false;
      if (tag && !t.tags?.includes(tag)) return false;
      if (kind && classify(t, t.category ? catMap.get(t.category) : undefined) !== kind) return false;
      if (needle) {
        const hay = `${t.description} ${t.rawDescription ?? ''} ${t.notes ?? ''} ${(t.tags ?? []).join(' ')} ${t.subcategory ?? ''} ${t.reference ?? ''}`.toLowerCase();
        if (!hay.includes(needle) && !(amt && Math.abs(Math.abs(t.amount) - amt) < 1)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'date-asc':
          return a.date.localeCompare(b.date);
        case 'amount-desc':
          return Math.abs(b.amount) - Math.abs(a.amount);
        case 'amount-asc':
          return Math.abs(a.amount) - Math.abs(b.amount);
        default:
          return b.date.localeCompare(a.date);
      }
    });
    return list;
  }, [txns, q, account, category, bucket, tag, kind, sort, catMap]);

  const totals = useMemo(() => {
    let inc = 0,
      exp = 0,
      inv = 0;
    for (const t of filtered) {
      const k = classify(t, t.category ? catMap.get(t.category) : undefined);
      if (k === 'income') inc += t.amount;
      else if (k === 'expense' || k === 'refund') exp -= t.amount;
      else if (k === 'investment') inv -= t.amount;
    }
    return { inc, exp, inv };
  }, [filtered, catMap]);

  const uncategorised = useMemo(() => txns.filter((t) => !t.category && classify(t) !== 'transfer').length, [txns]);
  const shown = filtered.slice(0, limit);
  const allSelected = shown.length > 0 && shown.every((t) => selected.has(t.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = [...selected];

  const exportCSV = () => {
    const csv = toCSV(filtered, accName, (id) => (id ? (catMap.get(id)?.name ?? id) : ''));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${period.fy ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={
          <>
            {filtered.length.toLocaleString()} of {txns.length.toLocaleString()} transactions
            {uncategorised > 0 && (
              <button className="ml-2 text-warn hover:underline" onClick={() => setCategory('__none')}>
                · {uncategorised} uncategorised
              </button>
            )}
          </>
        }
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={exportCSV} disabled={!filtered.length}>
              CSV
            </Button>
            <Link to="/import">
              <Button icon={<Upload className="size-4" />}>Import</Button>
            </Link>
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              disabled={!accounts.length}
              onClick={() => {
                setEdit(undefined);
                setModal(true);
              }}
            >
              Add
            </Button>
          </>
        }
      />

      <Card className="mb-4 !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker value={period} onChange={setPeriod} fys={fys} />
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description, notes, tags or amount" className="!pl-8" />
          </div>
          <Select value={account} onChange={(e) => setAccount(e.target.value)} className="!w-auto">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="!w-auto">
            <option value="">All categories</option>
            <option value="__none">Uncategorised</option>
            {[...catMap.values()].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {buckets.length > 0 && (
            <Select value={bucket} onChange={(e) => setParam('bucket', e.target.value)} className="!w-auto">
              <option value="">All buckets</option>
              <option value="__none">Not in a bucket</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {bucketIcon(b)} {b.name}
                </option>
              ))}
            </Select>
          )}
          {(knownTags.size > 0 || tag) && (
            <Select value={tag} onChange={(e) => setParam('tag', e.target.value)} className="!w-auto">
              <option value="">All tags</option>
              {[...new Set([...knownTags.keys(), ...(tag ? [tag] : [])])].sort().map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </Select>
          )}
          <Select value={kind} onChange={(e) => setKind(e.target.value as TxKind | '')} className="!w-auto">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="!w-auto">
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="amount-desc">Largest first</option>
            <option value="amount-asc">Smallest first</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 px-1 text-xs text-muted">
          <span>
            Income <Money value={totals.inc} className="font-medium text-pos" />
          </span>
          <span>
            Spent <Money value={totals.exp} className="font-medium text-neg" />
          </span>
          <span>
            Invested <Money value={totals.inv} className="font-medium text-accent-2" />
          </span>
          <span>
            Net <Money value={totals.inc - totals.exp - totals.inv} colored className="font-medium" />
          </span>
          <span className="text-faint">transfers excluded</span>
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="card animate-in sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 !border-accent/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="w-64">
            <CategorySelect
              compact
              placeholder="Set category…"
              onChange={(c, s) => {
                updateTransactions(ids, { category: c, subcategory: s });
                toast(`Categorised ${ids.length}`);
                setSelected(new Set());
              }}
            />
          </div>
          <Button size="sm" icon={<ArrowLeftRight className="size-3.5" />} onClick={() => (updateTransactions(ids, { isTransfer: true }), setSelected(new Set()))}>
            Mark transfer
          </Button>
          <Button size="sm" onClick={() => (updateTransactions(ids, { isTransfer: false, autoTransfer: false }), setSelected(new Set()))}>
            Not transfer
          </Button>
          <div className="w-44">
            <BucketSelect
              emptyLabel="Move to bucket…"
              className="!h-8 text-xs"
              onChange={(id) => {
                if (!id) return;
                updateTransactions(ids, { bucketId: id });
                toast(`Added ${ids.length} to ${bucketMap.get(id)?.name ?? 'bucket'}`);
                setSelected(new Set());
              }}
            />
          </div>
          {filtered.some((t) => selected.has(t.id) && t.bucketId) && (
            <Button size="sm" onClick={() => (updateTransactions(ids, { bucketId: null }), setSelected(new Set()))}>
              Remove from bucket
            </Button>
          )}
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              const tg = normalizeTag(bulkTag);
              if (!tg) return;
              for (const t of filtered.filter((x) => selected.has(x.id))) updateTransactions([t.id], { tags: [...new Set([...(t.tags ?? []), tg])] });
              toast(`Tagged ${ids.length} with #${tg}`);
              setBulkTag('');
              setSelected(new Set());
            }}
          >
            <Tag className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input list="bulk-tags" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="Add tag ⏎" className="!h-8 w-32 !pl-7 text-xs" />
            <datalist id="bulk-tags">
              {[...knownTags.keys()].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </form>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => {
              if (!window.confirm(`Delete ${ids.length} transactions?`)) return;
              deleteTransactions(ids);
              setSelected(new Set());
            }}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card pad={false} className="overflow-hidden">
        {loading && !txns.length ? (
          <div className="grid h-40 place-items-center">
            <Spinner className="size-6" />
          </div>
        ) : !filtered.length ? (
          <Empty icon={<ArrowLeftRight />} title={txns.length ? 'No matching transactions' : 'No transactions in this period'} action={!txns.length && <Link to="/import"><Button variant="primary">Import a statement</Button></Link>}>
            {txns.length ? 'Try clearing a filter.' : 'Import a bank or card statement, or pick another period.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/60 text-left text-xs text-muted">
                <tr>
                  <th className="w-10 py-2.5 pl-4">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((t) => t.id)))} className="accent-violet-500" />
                  </th>
                  <th className="px-2 font-medium">Date</th>
                  <th className="px-2 font-medium">Description</th>
                  <th className="px-2 font-medium">Category</th>
                  <th className="px-4 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const cat = t.category ? catMap.get(t.category) : undefined;
                  const k = classify(t, cat);
                  return (
                    <tr key={t.id} className={cx('group border-t border-line transition hover:bg-surface-2/50', selected.has(t.id) && 'bg-accent/5')}>
                      <td className="py-2 pl-4">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-violet-500" />
                      </td>
                      <td className="px-2 whitespace-nowrap text-muted tabular">{formatDate(t.date)}</td>
                      <td className="max-w-0 min-w-56 px-2">
                        <button
                          className="block w-full truncate text-left hover:text-accent"
                          title={t.rawDescription ?? t.description}
                          onClick={() => {
                            setEdit(t);
                            setModal(true);
                          }}
                        >
                          {t.description}
                        </button>
                        <div className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                          {accName(t.accountId)}
                          {(k === 'transfer' || k === 'refund' || k === 'investment') && <Badge color={KIND_COLOR[k]}>{KIND_LABEL[k]}</Badge>}
                          {t.bucketId && bucketMap.get(t.bucketId) && (
                            <Link to={`/buckets/${t.bucketId}`}>
                              <Badge color={bucketMap.get(t.bucketId)!.color}>
                                {bucketIcon(bucketMap.get(t.bucketId)!)} {bucketMap.get(t.bucketId)!.name}
                              </Badge>
                            </Link>
                          )}
                          {t.notes && <span className="truncate">· {t.notes}</span>}
                          {t.tags?.map((tg) => (
                            <button key={tg} onClick={() => setParam('tag', tg)}>
                              <Badge>#{tg}</Badge>
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="w-60 px-2">
                        <CategoryCell t={t} color={cat?.color} name={cat?.name} onChange={(c, s) => updateTransactions([t.id], { category: c, subcategory: s })} />
                      </td>
                      <td className="px-4 text-right font-medium whitespace-nowrap">
                        <Money value={t.amount} sign className={t.amount > 0 ? 'text-pos' : k === 'transfer' ? 'text-muted' : ''} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div className="border-t border-line p-3 text-center">
                <Button size="sm" onClick={() => setLimit((l) => l + PAGE * 2)}>
                  Show more ({(filtered.length - limit).toLocaleString()} remaining)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      <TxnModal open={modal} onClose={() => setModal(false)} initial={edit} defaults={bucket && bucket !== '__none' ? { bucketId: bucket } : undefined} />
    </>
  );
}
