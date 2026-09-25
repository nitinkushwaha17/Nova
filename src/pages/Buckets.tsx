import { ArrowLeft, Archive, CalendarRange, Hash, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TxnModal } from '../components/TxnModal';
import { axisMoney, Badge, Button, Card, ChartTooltip, cx, Dot, Empty, Field, IconButton, Input, Modal, Money, NumberInput, PageHeader, Progress, Select, Spinner, Stat, Tabs, Toggle, toast } from '../components/ui';
import { BUCKET_KINDS, bucketIcon, bucketStatus, newBucket, STATUS_LABEL } from '../lib/buckets';
import { addDays, daysBetween, formatDate, fysBetween, monthLabel, todayISO } from '../lib/dates';
import { PALETTE } from '../lib/defaults';
import { classify, normalizeTag } from '../lib/transactions';
import { useCatMap, useGroupTotals, useStore } from '../store';
import type { Bucket, BucketKind, GroupTotals, Transaction } from '../types';

const net = (g?: GroupTotals) => (g ? g.spent - g.received : 0);

function dateSpan(b: Bucket, g?: GroupTotals) {
  const start = b.startDate ?? g?.first;
  const end = b.endDate ?? g?.last;
  if (!start || !end) return null;
  return { start, end, days: Math.max(1, daysBetween(start, end) + 1) };
}

function BucketModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Bucket }) {
  const count = useStore((s) => s.buckets.buckets.length);
  const saveBucket = useStore((s) => s.saveBucket);
  const [b, setB] = useState<Bucket>(() => initial ?? newBucket({}, count));
  const [prev, setPrev] = useState({ open, initial });
  if (prev.open !== open || prev.initial !== initial) {
    setPrev({ open, initial });
    if (open) setB(initial ?? newBucket({}, count));
  }
  const set = (p: Partial<Bucket>) => setB((x) => ({ ...x, ...p }));
  const valid = b.name.trim() && !(b.startDate && b.endDate && b.endDate < b.startDate);
  const save = () => {
    if (!valid) return;
    saveBucket({ ...b, name: b.name.trim(), notes: b.notes?.trim() || undefined, emoji: b.emoji?.trim() || undefined });
    toast(initial ? 'Bucket updated' : 'Bucket created');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit bucket' : 'New bucket'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <div className="flex gap-2">
            <Input value={b.emoji ?? ''} onChange={(e) => set({ emoji: [...e.target.value].slice(-2).join('') })} placeholder={BUCKET_KINDS[b.kind].emoji} className="!w-14 text-center" title="Emoji" />
            <Input value={b.name} onChange={(e) => set({ name: e.target.value })} placeholder="Goa trip, Wedding, Home renovation…" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
          </div>
        </Field>
        <Field label="Kind">
          <Select value={b.kind} onChange={(e) => set({ kind: e.target.value as BucketKind })}>
            {Object.entries(BUCKET_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.emoji} {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget" hint="Optional spending cap">
          <NumberInput value={b.budget} onChange={(v) => set({ budget: v || undefined })} placeholder="—" />
        </Field>
        <Field label="Start date">
          <Input type="date" value={b.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || undefined })} />
        </Field>
        <Field label="End date" hint={b.startDate && b.endDate && b.endDate < b.startDate ? <span className="text-neg">Ends before it starts</span> : 'Leave empty if ongoing'}>
          <Input type="date" value={b.endDate ?? ''} min={b.startDate} onChange={(e) => set({ endDate: e.target.value || undefined })} />
        </Field>
        <Field label="Colour" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} className={cx('size-7 rounded-full ring-offset-2 ring-offset-surface transition', b.color === c && 'ring-2 ring-fg')} style={{ background: c }} title={c} />
            ))}
          </div>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={b.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Who went, what it covered, split details…" />
        </Field>
        {initial && (
          <div className="sm:col-span-2">
            <Toggle checked={!!b.archived} onChange={(archived) => set({ archived })} label="Archived (hidden from pickers)" />
          </div>
        )}
      </div>
    </Modal>
  );
}

function BucketCard({ b, g }: { b: Bucket; g?: GroupTotals }) {
  const status = bucketStatus(b, todayISO());
  const cost = net(g);
  const span = dateSpan(b, g);
  return (
    <Link to={`/buckets/${b.id}`} className="card group block p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${b.color}22` }}>
          {bucketIcon(b)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold group-hover:text-accent">{b.name}</h3>
            {b.archived ? <Badge>Archived</Badge> : <Badge color={STATUS_LABEL[status].color}>{STATUS_LABEL[status].label}</Badge>}
          </div>
          <p className="truncate text-xs text-muted">
            {BUCKET_KINDS[b.kind].label}
            {span && ` · ${formatDate(span.start)} – ${formatDate(span.end)}`}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-xs text-faint">Net cost</div>
          <Money value={cost} className="text-xl font-semibold" />
        </div>
        <div className="text-right text-xs text-muted">
          {g?.count ?? 0} txns
          {g && g.received > 0 && (
            <div>
              <Money value={g.received} short className="text-pos" /> back
            </div>
          )}
        </div>
      </div>
      {b.budget ? (
        <div className="mt-3">
          <Progress value={cost / b.budget} color={cost > b.budget ? '#fb7185' : b.color} />
          <div className="mt-1 text-[11px] text-faint">
            {Math.round((cost / b.budget) * 100)}% of <Money value={b.budget} short /> budget
          </div>
        </div>
      ) : null}
    </Link>
  );
}

function TagsCard() {
  const tags = useGroupTotals('tag');
  const renameTag = useStore((s) => s.renameTag);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = [...tags.entries()].sort((a, b) => net(b[1]) - net(a[1]));
  const max = Math.max(1, ...rows.map(([, g]) => Math.abs(net(g))));

  const apply = async (from: string, to: string) => {
    setBusy(true);
    const n = await renameTag(from, to);
    setBusy(false);
    setEditing(null);
    toast(to ? `Renamed #${from} → #${to} on ${n} transactions` : `Removed #${from} from ${n} transactions`);
  };

  return (
    <Card title="Tags" action={<span className="text-xs text-faint">spend across all time</span>}>
      {!rows.length ? (
        <p className="text-sm text-muted">Add tags like #reimbursable, #gift or #work while editing a transaction, or tag many at once from the Transactions page.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(([t, g]) => (
            <li key={t} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2/60">
              {editing === t ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const to = normalizeTag(draft);
                    if (to && to !== t) void apply(t, to);
                    else setEditing(null);
                  }}
                >
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus className="!h-8" />
                  <Button size="sm" type="submit" loading={busy}>
                    Rename
                  </Button>
                  <IconButton title="Cancel" type="button" onClick={() => setEditing(null)}>
                    <X className="size-4" />
                  </IconButton>
                </form>
              ) : (
                <>
                  <Link to={`/transactions?tag=${encodeURIComponent(t)}`} className="w-40 truncate text-sm hover:text-accent">
                    #{t}
                  </Link>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent/70" style={{ width: `${(Math.abs(net(g)) / max) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs text-faint">{g.count}</span>
                  <Money value={net(g)} className="w-24 text-right text-sm font-medium" />
                  <div className="flex opacity-0 transition group-hover:opacity-100">
                    <IconButton
                      title="Rename tag"
                      onClick={() => {
                        setEditing(t);
                        setDraft(t);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton title="Remove tag everywhere" onClick={() => window.confirm(`Remove #${t} from ${g.count} transactions?`) && void apply(t, '')}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BucketList() {
  const buckets = useStore((s) => s.buckets.buckets);
  const totals = useGroupTotals('bucket');
  const [modal, setModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayISO();
  const order = { active: 0, upcoming: 1, open: 2, done: 3 };
  const visible = buckets
    .filter((b) => showArchived || !b.archived)
    .sort((a, b) => order[bucketStatus(a, today)] - order[bucketStatus(b, today)] || (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt));
  const archived = buckets.filter((b) => b.archived).length;
  const totalCost = buckets.reduce((s, b) => s + net(totals.get(b.id)), 0);

  return (
    <>
      <PageHeader
        title="Buckets & tags"
        subtitle="Group spending across categories, like a trip, a wedding or a renovation"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setModal(true)}>
            New bucket
          </Button>
        }
      />
      {!buckets.length ? (
        <Card className="mb-4">
          <Empty icon={<CalendarRange />} title="No buckets yet" action={<Button variant="primary" onClick={() => setModal(true)}>Create your first bucket</Button>}>
            A bucket collects every expense for one thing, whatever its category. A Goa trip might hold flights (Travel), hotels (Travel), dinners (Food) and souvenirs (Shopping). Each transaction can sit in one bucket and carry any number of tags.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4 text-sm text-muted">
            <span>
              {buckets.length - archived} buckets · <Money value={totalCost} className="font-medium text-fg" /> tracked
            </span>
            {archived > 0 && (
              <button className="ml-auto flex items-center gap-1.5 text-xs hover:text-fg" onClick={() => setShowArchived((v) => !v)}>
                <Archive className="size-3.5" /> {showArchived ? 'Hide' : 'Show'} {archived} archived
              </button>
            )}
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((b) => (
              <BucketCard key={b.id} b={b} g={totals.get(b.id)} />
            ))}
          </div>
        </>
      )}
      <TagsCard />
      <BucketModal open={modal} onClose={() => setModal(false)} />
    </>
  );
}

function FindTransactions({ open, onClose, bucket }: { open: boolean; onClose: () => void; bucket: Bucket }) {
  const txByFY = useStore((s) => s.txByFY);
  const ensureFYs = useStore((s) => s.ensureFYs);
  const updateTransactions = useStore((s) => s.updateTransactions);
  const catMap = useCatMap();
  const [start, setStart] = useState(bucket.startDate ?? addDays(todayISO(), -30));
  const [end, setEnd] = useState(bucket.endDate ?? todayISO());
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fys = useMemo(() => (start && end && start <= end ? fysBetween(start, end) : []), [start, end]);
  useEffect(() => {
    if (open) void ensureFYs(fys);
  }, [open, fys, ensureFYs]);
  const loading = fys.some((f) => !txByFY[f]);
  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fys
      .flatMap((f) => txByFY[f] ?? [])
      .filter((t) => t.date >= start && t.date <= end && !t.bucketId && classify(t, t.category ? catMap.get(t.category) : undefined) !== 'transfer')
      .filter((t) => !needle || `${t.description} ${t.notes ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [fys, txByFY, start, end, q, catMap]);

  const add = () => {
    updateTransactions([...picked], { bucketId: bucket.id });
    toast(`Added ${picked.size} to ${bucket.name}`);
    setPicked(new Set());
    onClose();
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Find transactions for ${bucket.name}`}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            {picked.size} selected · <Money value={-candidates.filter((t) => picked.has(t.id)).reduce((s, t) => s + t.amount, 0)} />
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={add} disabled={!picked.size}>
            Add to bucket
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="!w-auto" />
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="!w-auto" />
        <div className="relative min-w-40 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="!pl-8" />
        </div>
        <Button size="sm" className="!h-9" onClick={() => setPicked(new Set(candidates.filter((t) => t.amount < 0).map((t) => t.id)))}>
          Select all spends
        </Button>
      </div>
      <p className="mb-2 text-xs text-faint">Showing transactions not already in a bucket (self-transfers hidden).</p>
      <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line">
        {loading ? (
          <div className="grid h-32 place-items-center">
            <Spinner />
          </div>
        ) : !candidates.length ? (
          <p className="p-6 text-center text-sm text-muted">Nothing unassigned in this date range.</p>
        ) : (
          candidates.map((t) => {
            const cat = t.category ? catMap.get(t.category) : undefined;
            return (
              <label key={t.id} className={cx('flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-0 hover:bg-surface-2/50', picked.has(t.id) && 'bg-accent/5')}>
                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} className="accent-violet-500" />
                <span className="w-20 shrink-0 text-xs text-muted tabular">{formatDate(t.date)}</span>
                <span className="min-w-0 flex-1 truncate">{t.description}</span>
                {cat && (
                  <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
                    <Dot color={cat.color} /> {cat.name}
                  </span>
                )}
                <Money value={t.amount} sign className={cx('w-24 text-right font-medium', t.amount > 0 && 'text-pos')} />
              </label>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function BucketDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const bucket = useStore((s) => s.buckets.buckets.find((b) => b.id === id));
  const summaries = useStore((s) => s.summaries);
  const txByFY = useStore((s) => s.txByFY);
  const ensureFYs = useStore((s) => s.ensureFYs);
  const fysWith = useStore((s) => s.fysWith);
  const deleteBucket = useStore((s) => s.deleteBucket);
  const updateTransactions = useStore((s) => s.updateTransactions);
  const accounts = useStore((s) => s.meta.accounts);
  const catMap = useCatMap();
  const [editOpen, setEditOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [txnModal, setTxnModal] = useState<{ open: boolean; t?: Transaction }>({ open: false });
  const [breakdown, setBreakdown] = useState<'category' | 'tag'>('category');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- summaries changes when this bucket's FYs change
  const fys = useMemo(() => fysWith('bucket', id), [id, summaries, fysWith]);
  useEffect(() => {
    void ensureFYs(fys);
  }, [fys, ensureFYs]);
  const loading = fys.some((f) => !txByFY[f]);
  const txns = useMemo(
    () =>
      fys
        .flatMap((f) => txByFY[f] ?? [])
        .filter((t) => t.bucketId === id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [fys, txByFY, id],
  );

  const stats = useMemo(() => {
    let spent = 0,
      received = 0;
    const byCat = new Map<string, number>();
    const byTag = new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const t of txns) {
      if (classify(t, t.category ? catMap.get(t.category) : undefined) === 'transfer') continue;
      if (t.amount < 0) spent -= t.amount;
      else received += t.amount;
      const c = t.category ?? '__none';
      byCat.set(c, (byCat.get(c) ?? 0) - t.amount);
      for (const tg of t.tags?.length ? t.tags : ['(untagged)']) byTag.set(tg, (byTag.get(tg) ?? 0) - t.amount);
      byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amount);
    }
    return { spent, received, net: spent - received, byCat, byTag, byDay };
  }, [txns, catMap]);

  const chart = useMemo(() => {
    const days = [...stats.byDay.keys()].sort();
    if (!days.length) return [];
    const first = bucket?.startDate && bucket.startDate < days[0] ? bucket.startDate : days[0];
    const last = bucket?.endDate && bucket.endDate > days[days.length - 1] ? bucket.endDate : days[days.length - 1];
    const span = daysBetween(first, last);
    if (span > 62) {
      const byMonth = new Map<string, number>();
      for (const [d, v] of stats.byDay) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + v);
      return [...byMonth.entries()].sort().map(([m, v]) => ({ label: monthLabel(m), spent: Math.round(v) }));
    }
    const out: { label: string; spent: number }[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) out.push({ label: formatDate(d).replace(/ \d{4}$/, ''), spent: Math.round(stats.byDay.get(d) ?? 0) });
    return out;
  }, [stats.byDay, bucket?.startDate, bucket?.endDate]);

  if (!bucket)
    return (
      <Empty icon={<CalendarRange />} title="Bucket not found" action={<Link to="/buckets"><Button>Back to buckets</Button></Link>}>
        It may have been deleted on another device.
      </Empty>
    );

  const g = fys.length ? { first: txns[txns.length - 1]?.date, last: txns[0]?.date } : undefined;
  const span = dateSpan(bucket, g as GroupTotals | undefined);
  const status = bucketStatus(bucket, todayISO());
  const accName = (aid: string) => accounts.find((a) => a.id === aid)?.name ?? '—';
  const rows = (breakdown === 'category' ? [...stats.byCat.entries()] : [...stats.byTag.entries()]).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => b[1] - a[1]);
  const maxRow = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));

  return (
    <>
      <Link to="/buckets" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All buckets
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl text-xl" style={{ background: `${bucket.color}22` }}>
              {bucketIcon(bucket)}
            </span>
            {bucket.name}
            {bucket.archived ? <Badge>Archived</Badge> : <Badge color={STATUS_LABEL[status].color}>{STATUS_LABEL[status].label}</Badge>}
          </span>
        }
        subtitle={
          <>
            {BUCKET_KINDS[bucket.kind].label}
            {span && ` · ${formatDate(span.start)} – ${formatDate(span.end)} (${span.days} days)`}
            {bucket.notes && ` · ${bucket.notes}`}
          </>
        }
        actions={
          <>
            <Button icon={<Search className="size-4" />} onClick={() => setFindOpen(true)}>
              Find transactions
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <IconButton
              title="Delete bucket"
              onClick={async () => {
                if (!window.confirm(`Delete "${bucket.name}"? Its ${txns.length} transactions stay, just without a bucket.`)) return;
                await deleteBucket(bucket.id);
                toast('Bucket deleted');
                navigate('/buckets');
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
            <Button variant="primary" icon={<Plus className="size-4" />} disabled={!accounts.length} onClick={() => setTxnModal({ open: true })}>
              Add expense
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net cost" value={<Money value={stats.net} />} sub={`${txns.length} transactions`} tone="accent" />
        <Stat label="Spent" value={<Money value={stats.spent} />} tone="neg" />
        <Stat label="Paid back / refunds" value={<Money value={stats.received} />} sub="reduces net cost" tone="pos" />
        {bucket.budget ? (
          <Stat
            label="Budget"
            value={<Money value={bucket.budget - stats.net} />}
            sub={
              <>
                <Progress value={stats.net / bucket.budget} color={stats.net > bucket.budget ? '#fb7185' : bucket.color} className="my-1" />
                {stats.net > bucket.budget ? 'over budget' : 'left'} of <Money value={bucket.budget} short />
              </>
            }
          />
        ) : (
          <Stat label="Per day" value={<Money value={span ? stats.net / span.days : 0} />} sub={span ? `over ${span.days} days` : 'set dates for a daily rate'} />
        )}
      </div>

      {loading && !txns.length ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="size-6" />
        </div>
      ) : !txns.length ? (
        <Card>
          <Empty
            icon={<CalendarRange />}
            title="Nothing in this bucket yet"
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setFindOpen(true)}>
                  Find transactions
                </Button>
                <Button onClick={() => setTxnModal({ open: true })} disabled={!accounts.length}>
                  Add cash expense
                </Button>
              </div>
            }
          >
            Pick imported transactions from the bucket's dates, add them from the Transactions page (select, then "Move to bucket"), or add a cash expense directly.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-5">
            <Card title="Spending over time" className="lg:col-span-3">
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ left: -10, right: 4, top: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} />
                    <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="spent" name="Net spent" fill={bucket.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card
              title="Breakdown"
              className="lg:col-span-2"
              action={
                <Tabs
                  value={breakdown}
                  onChange={setBreakdown}
                  options={[
                    { value: 'category', label: 'Category' },
                    { value: 'tag', label: 'Tag' },
                  ]}
                />
              }
            >
              <ul className="space-y-2.5">
                {rows.map(([k, v]) => {
                  const cat = breakdown === 'category' ? catMap.get(k) : undefined;
                  const color = breakdown === 'category' ? (cat?.color ?? '#94a3b8') : bucket.color;
                  return (
                    <li key={k}>
                      <div className="mb-1 flex items-center gap-2 text-sm">
                        {breakdown === 'category' ? <Dot color={color} /> : <Hash className="size-3.5 text-faint" />}
                        <span className="flex-1 truncate">{breakdown === 'category' ? (cat?.name ?? 'Uncategorised') : k}</span>
                        <span className="text-xs text-faint">{stats.spent > 0 && v > 0 ? `${Math.round((v / stats.spent) * 100)}%` : ''}</span>
                        <Money value={v} className={cx('w-24 text-right font-medium', v < 0 && 'text-pos')} />
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${(Math.abs(v) / maxRow) * 100}%`, background: color }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {breakdown === 'tag' && <p className="mt-3 text-[11px] text-faint">A transaction with several tags counts under each of them.</p>}
            </Card>
          </div>

          <Card pad={false} title={<span className="px-4 pt-4">Transactions</span>} className="overflow-hidden">
            <table className="mt-2 w-full text-sm">
              <tbody>
                {txns.map((t) => {
                  const cat = t.category ? catMap.get(t.category) : undefined;
                  return (
                    <tr key={t.id} className="group border-t border-line hover:bg-surface-2/50">
                      <td className="w-24 py-2 pl-4 text-xs whitespace-nowrap text-muted tabular">{formatDate(t.date)}</td>
                      <td className="max-w-0 px-2">
                        <button className="block w-full truncate text-left hover:text-accent" onClick={() => setTxnModal({ open: true, t })}>
                          {t.description}
                        </button>
                        <div className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                          {accName(t.accountId)}
                          {t.notes && <span>· {t.notes}</span>}
                          {t.tags?.map((tg) => (
                            <Badge key={tg}>#{tg}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="hidden w-44 px-2 text-xs text-muted md:table-cell">
                        <span className="flex items-center gap-1.5">
                          <Dot color={cat?.color ?? 'var(--line)'} />
                          {cat?.name ?? <span className="text-warn">Uncategorised</span>}
                        </span>
                      </td>
                      <td className="px-2 text-right font-medium whitespace-nowrap">
                        <Money value={t.amount} sign className={t.amount > 0 ? 'text-pos' : ''} />
                      </td>
                      <td className="w-10 pr-2">
                        <IconButton title="Remove from bucket" className="opacity-0 group-hover:opacity-100" onClick={() => updateTransactions([t.id], { bucketId: null })}>
                          <X className="size-3.5" />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <BucketModal open={editOpen} onClose={() => setEditOpen(false)} initial={bucket} />
      <FindTransactions open={findOpen} onClose={() => setFindOpen(false)} bucket={bucket} />
      <TxnModal
        open={txnModal.open}
        onClose={() => setTxnModal({ open: false })}
        initial={txnModal.t}
        defaults={{ bucketId: bucket.id, date: bucket.startDate && bucket.endDate && todayISO() > bucket.endDate ? bucket.startDate : todayISO() }}
      />
    </>
  );
}

export default function Buckets() {
  const { id } = useParams();
  const upgradeSummaries = useStore((s) => s.upgradeSummaries);
  useEffect(() => {
    void upgradeSummaries();
  }, [upgradeSummaries]);
  return id ? <BucketDetail key={id} id={id} /> : <BucketList />;
}
