import { ArrowLeft, Archive, CalendarRange, ChevronRight, FolderTree, Hash, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CollectionSelect } from '../components/CollectionSelect';
import { TxnModal } from '../components/TxnModal';
import { axisMoney, Badge, Button, Card, ChartTooltip, cx, Dot, Empty, Field, IconButton, Input, Modal, Money, NumberInput, PageHeader, Progress, Select, Spinner, Stat, Tabs, Toggle, toast } from '../components/ui';
import { ancestorsOf, childrenMap, COLLECTION_KINDS, collectionIcon, collectionStatus, descendantIds, flattenTree, newCollection, rollupTotals, STATUS_LABEL } from '../lib/collections';
import { addDays, daysBetween, formatDate, fysBetween, monthLabel, todayISO } from '../lib/dates';
import { PALETTE } from '../lib/defaults';
import { classify, normalizeTag } from '../lib/transactions';
import { useCatMap, useGroupTotals, useStore } from '../store';
import type { Collection, CollectionKind, GroupTotals, Transaction } from '../types';

const net = (g?: GroupTotals) => (g ? g.spent - g.received : 0);

function dateSpan(b: Collection, g?: GroupTotals) {
  const start = b.startDate ?? g?.first;
  const end = b.endDate ?? g?.last;
  if (!start || !end) return null;
  return { start, end, days: Math.max(1, daysBetween(start, end) + 1) };
}

function CollectionModal({ open, onClose, initial, parentId }: { open: boolean; onClose: () => void; initial?: Collection; parentId?: string }) {
  const all = useStore((s) => s.collections.collections);
  const count = all.length;
  const saveCollection = useStore((s) => s.saveCollection);
  const [b, setB] = useState<Collection>(() => initial ?? newCollection({ parentId }, count));
  const [prev, setPrev] = useState({ open, initial });
  if (prev.open !== open || prev.initial !== initial) {
    setPrev({ open, initial });
    if (open) {
      const parent = parentId ? all.find((x) => x.id === parentId) : undefined;
      setB(initial ?? newCollection(parent ? { parentId, kind: parent.kind, color: parent.color, startDate: parent.startDate, endDate: parent.endDate } : {}, count));
    }
  }
  const set = (p: Partial<Collection>) => setB((x) => ({ ...x, ...p }));
  // Can't nest a collection inside itself or one of its own sub-collections
  const notParents = useMemo(() => (initial ? descendantIds(initial.id, all) : undefined), [initial, all]);
  const valid = b.name.trim() && !(b.startDate && b.endDate && b.endDate < b.startDate);
  const save = () => {
    if (!valid) return;
    saveCollection({ ...b, name: b.name.trim(), notes: b.notes?.trim() || undefined, emoji: b.emoji?.trim() || undefined });
    toast(initial ? 'Collection updated' : 'Collection created');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit collection' : parentId ? 'New sub-collection' : 'New collection'}
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
            <Input value={b.emoji ?? ''} onChange={(e) => set({ emoji: [...e.target.value].slice(-2).join('') })} placeholder={COLLECTION_KINDS[b.kind].emoji} className="!w-14 text-center" title="Emoji" />
            <Input value={b.name} onChange={(e) => set({ name: e.target.value })} placeholder="Goa trip, Wedding, Home renovation…" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
          </div>
        </Field>
        <Field label="Inside" hint="Optional parent, e.g. a city inside a Europe trip. Its totals include this one." className="sm:col-span-2">
          <CollectionSelect value={b.parentId} onChange={(id) => set({ parentId: id })} emptyLabel="None (top level)" exclude={notParents} />
        </Field>
        <Field label="Kind">
          <Select value={b.kind} onChange={(e) => set({ kind: e.target.value as CollectionKind })}>
            {Object.entries(COLLECTION_KINDS).map(([k, v]) => (
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

function CollectionCard({ b, g, subs }: { b: Collection; g?: GroupTotals; subs?: Collection[] }) {
  const status = collectionStatus(b, todayISO());
  const cost = net(g);
  const span = dateSpan(b, g);
  return (
    <Link to={`/collections/${b.id}`} className="card group block p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${b.color}22` }}>
          {collectionIcon(b)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold group-hover:text-accent">{b.name}</h3>
            {b.archived ? <Badge>Archived</Badge> : <Badge color={STATUS_LABEL[status].color}>{STATUS_LABEL[status].label}</Badge>}
          </div>
          <p className="truncate text-xs text-muted">
            {COLLECTION_KINDS[b.kind].label}
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
      {subs && subs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <FolderTree className="size-3.5 text-faint" />
          {subs.slice(0, 4).map((s) => (
            <Badge key={s.id} color={s.color}>
              {collectionIcon(s)} {s.name}
            </Badge>
          ))}
          {subs.length > 4 && <span className="text-[11px] text-faint">+{subs.length - 4}</span>}
        </div>
      )}
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

function CollectionList() {
  const collections = useStore((s) => s.collections.collections);
  const own = useGroupTotals('collection');
  const totals = useMemo(() => rollupTotals(own, collections), [own, collections]);
  const kids = useMemo(() => childrenMap(collections), [collections]);
  const roots = useMemo(() => new Set(flattenTree(collections).filter((r) => !r.depth).map((r) => r.c.id)), [collections]);
  const [modal, setModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayISO();
  const order = { active: 0, upcoming: 1, open: 2, done: 3 };
  const visible = collections
    .filter((b) => (showArchived || !b.archived) && roots.has(b.id))
    .sort((a, b) => order[collectionStatus(a, today)] - order[collectionStatus(b, today)] || (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt));
  const archived = collections.filter((b) => b.archived).length;
  // Roots only: parents already include their sub-collections
  const totalCost = collections.filter((b) => roots.has(b.id)).reduce((s, b) => s + net(totals.get(b.id)), 0);

  return (
    <>
      <PageHeader
        title="Collections & tags"
        subtitle="Group spending across categories, like a trip, a wedding or a renovation"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setModal(true)}>
            New collection
          </Button>
        }
      />
      {!collections.length ? (
        <Card className="mb-4">
          <Empty icon={<CalendarRange />} title="No collections yet" action={<Button variant="primary" onClick={() => setModal(true)}>Create your first collection</Button>}>
            A collection collects every expense for one thing, whatever its category. A Goa trip might hold flights (Travel), hotels (Travel), dinners (Food) and souvenirs (Shopping). Each transaction can sit in one collection and carry any number of tags.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4 text-sm text-muted">
            <span>
              {collections.length - archived} {collections.length - archived === 1 ? 'collection' : 'collections'} · <Money value={totalCost} className="font-medium text-fg" /> tracked
            </span>
            {archived > 0 && (
              <button className="ml-auto flex items-center gap-1.5 text-xs hover:text-fg" onClick={() => setShowArchived((v) => !v)}>
                <Archive className="size-3.5" /> {showArchived ? 'Hide' : 'Show'} {archived} archived
              </button>
            )}
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((b) => (
              <CollectionCard key={b.id} b={b} g={totals.get(b.id)} subs={(kids.get(b.id) ?? []).filter((s) => showArchived || !s.archived)} />
            ))}
          </div>
        </>
      )}
      <TagsCard />
      <CollectionModal open={modal} onClose={() => setModal(false)} />
    </>
  );
}

function FindTransactions({ open, onClose, collection }: { open: boolean; onClose: () => void; collection: Collection }) {
  const txByFY = useStore((s) => s.txByFY);
  const ensureFYs = useStore((s) => s.ensureFYs);
  const updateTransactions = useStore((s) => s.updateTransactions);
  const catMap = useCatMap();
  const [start, setStart] = useState(collection.startDate ?? addDays(todayISO(), -30));
  const [end, setEnd] = useState(collection.endDate ?? todayISO());
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
      .filter((t) => t.date >= start && t.date <= end && !t.collectionId && classify(t, t.category ? catMap.get(t.category) : undefined) !== 'transfer')
      .filter((t) => !needle || `${t.description} ${t.notes ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [fys, txByFY, start, end, q, catMap]);

  const add = () => {
    updateTransactions([...picked], { collectionId: collection.id });
    toast(`Added ${picked.size} to ${collection.name}`);
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
      title={`Find transactions for ${collection.name}`}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            {picked.size} selected · <Money value={-candidates.filter((t) => picked.has(t.id)).reduce((s, t) => s + t.amount, 0)} />
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={add} disabled={!picked.size}>
            Add to collection
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
      <p className="mb-2 text-xs text-faint">Showing transactions not already in a collection (self-transfers hidden).</p>
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

function CollectionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const all = useStore((s) => s.collections.collections);
  const collection = all.find((b) => b.id === id);
  const ownTotals = useGroupTotals('collection');
  const totals = useMemo(() => rollupTotals(ownTotals, all), [ownTotals, all]);
  const children = useMemo(() => childrenMap(all).get(id) ?? [], [all, id]);
  const ancestors = useMemo(() => ancestorsOf(id, all), [all, id]);
  const ids = useMemo(() => descendantIds(id, all), [all, id]);
  // Maps every nested collection id to the direct child of this one it rolls up into
  const childOf = useMemo(() => {
    const m = new Map<string, Collection>();
    for (const ch of children) for (const d of descendantIds(ch.id, all)) m.set(d, ch);
    return m;
  }, [children, all]);
  const byId = useMemo(() => new Map(all.map((b) => [b.id, b])), [all]);
  const [subModal, setSubModal] = useState(false);
  const summaries = useStore((s) => s.summaries);
  const txByFY = useStore((s) => s.txByFY);
  const ensureFYs = useStore((s) => s.ensureFYs);
  const fysWith = useStore((s) => s.fysWith);
  const deleteCollection = useStore((s) => s.deleteCollection);
  const updateTransactions = useStore((s) => s.updateTransactions);
  const accounts = useStore((s) => s.meta.accounts);
  const catMap = useCatMap();
  const [editOpen, setEditOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [txnModal, setTxnModal] = useState<{ open: boolean; t?: Transaction }>({ open: false });
  const [breakdown, setBreakdown] = useState<'category' | 'tag' | 'sub'>('category');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- summaries changes when this collection's FYs change
  const fys = useMemo(() => [...new Set([...ids].flatMap((i) => fysWith('collection', i)))].sort(), [ids, summaries, fysWith]);
  useEffect(() => {
    void ensureFYs(fys);
  }, [fys, ensureFYs]);
  const loading = fys.some((f) => !txByFY[f]);
  const txns = useMemo(
    () =>
      fys
        .flatMap((f) => txByFY[f] ?? [])
        .filter((t) => t.collectionId && ids.has(t.collectionId))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [fys, txByFY, ids],
  );

  const stats = useMemo(() => {
    let spent = 0,
      received = 0;
    const byCat = new Map<string, number>();
    const byTag = new Map<string, number>();
    const bySub = new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const t of txns) {
      if (classify(t, t.category ? catMap.get(t.category) : undefined) === 'transfer') continue;
      if (t.amount < 0) spent -= t.amount;
      else received += t.amount;
      const c = t.category ?? '__none';
      byCat.set(c, (byCat.get(c) ?? 0) - t.amount);
      const sub = childOf.get(t.collectionId!)?.id ?? '__self';
      bySub.set(sub, (bySub.get(sub) ?? 0) - t.amount);
      for (const tg of t.tags?.length ? t.tags : ['(untagged)']) byTag.set(tg, (byTag.get(tg) ?? 0) - t.amount);
      byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amount);
    }
    return { spent, received, net: spent - received, byCat, byTag, bySub, byDay };
  }, [txns, catMap, childOf]);

  const chart = useMemo(() => {
    const days = [...stats.byDay.keys()].sort();
    if (!days.length) return [];
    const first = collection?.startDate && collection.startDate < days[0] ? collection.startDate : days[0];
    const last = collection?.endDate && collection.endDate > days[days.length - 1] ? collection.endDate : days[days.length - 1];
    const span = daysBetween(first, last);
    if (span > 62) {
      const byMonth = new Map<string, number>();
      for (const [d, v] of stats.byDay) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + v);
      return [...byMonth.entries()].sort().map(([m, v]) => ({ label: monthLabel(m), spent: Math.round(v) }));
    }
    const out: { label: string; spent: number }[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) out.push({ label: formatDate(d).replace(/ \d{4}$/, ''), spent: Math.round(stats.byDay.get(d) ?? 0) });
    return out;
  }, [stats.byDay, collection?.startDate, collection?.endDate]);

  if (!collection)
    return (
      <Empty icon={<CalendarRange />} title="Collection not found" action={<Link to="/collections"><Button>Back to collections</Button></Link>}>
        It may have been deleted on another device.
      </Empty>
    );

  const g = fys.length ? { first: txns[txns.length - 1]?.date, last: txns[0]?.date } : undefined;
  const span = dateSpan(collection, g as GroupTotals | undefined);
  const status = collectionStatus(collection, todayISO());
  const accName = (aid: string) => accounts.find((a) => a.id === aid)?.name ?? '—';
  const tab = breakdown === 'sub' && !children.length ? 'category' : breakdown;
  const rows = [...(tab === 'category' ? stats.byCat : tab === 'tag' ? stats.byTag : stats.bySub).entries()].filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => b[1] - a[1]);
  const maxRow = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));

  return (
    <>
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link to="/collections" className="inline-flex items-center gap-1.5 hover:text-fg">
          <ArrowLeft className="size-4" /> All collections
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5 text-faint" />
            <Link to={`/collections/${a.id}`} className="hover:text-fg">
              {collectionIcon(a)} {a.name}
            </Link>
          </span>
        ))}
      </nav>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl text-xl" style={{ background: `${collection.color}22` }}>
              {collectionIcon(collection)}
            </span>
            {collection.name}
            {collection.archived ? <Badge>Archived</Badge> : <Badge color={STATUS_LABEL[status].color}>{STATUS_LABEL[status].label}</Badge>}
          </span>
        }
        subtitle={
          <>
            {COLLECTION_KINDS[collection.kind].label}
            {span && ` · ${formatDate(span.start)} – ${formatDate(span.end)} (${span.days} days)`}
            {collection.notes && ` · ${collection.notes}`}
          </>
        }
        actions={
          <>
            <Button icon={<FolderTree className="size-4" />} onClick={() => setSubModal(true)}>
              Add sub-collection
            </Button>
            <Button icon={<Search className="size-4" />} onClick={() => setFindOpen(true)}>
              Find transactions
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <IconButton
              title="Delete collection"
              onClick={async () => {
                const own = txns.filter((t) => t.collectionId === collection.id).length;
                const moveTo = ancestors.length ? ancestors[ancestors.length - 1].name : 'the top level';
                if (!window.confirm(`Delete "${collection.name}"? Its ${own} transactions stay, just without a collection.${children.length ? ` Its ${children.length} sub-collection${children.length === 1 ? '' : 's'} move to ${moveTo}.` : ''}`)) return;
                await deleteCollection(collection.id);
                toast('Collection deleted');
                navigate(ancestors.length ? `/collections/${ancestors[ancestors.length - 1].id}` : '/collections');
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
        {collection.budget ? (
          <Stat
            label="Budget"
            value={<Money value={collection.budget - stats.net} />}
            sub={
              <>
                <Progress value={stats.net / collection.budget} color={stats.net > collection.budget ? '#fb7185' : collection.color} className="my-1" />
                {stats.net > collection.budget ? 'over budget' : 'left'} of <Money value={collection.budget} short />
              </>
            }
          />
        ) : (
          <Stat label="Per day" value={<Money value={span ? stats.net / span.days : 0} />} sub={span ? `over ${span.days} days` : 'set dates for a daily rate'} />
        )}
      </div>

      {children.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
            <FolderTree className="size-4" /> Sub-collections
            <span className="text-xs text-faint">· included in the totals above</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {children.map((ch) => (
              <CollectionCard key={ch.id} b={ch} g={totals.get(ch.id)} subs={childrenMap(all).get(ch.id)} />
            ))}
          </div>
        </div>
      )}

      {loading && !txns.length ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="size-6" />
        </div>
      ) : !txns.length ? (
        <Card>
          <Empty
            icon={<CalendarRange />}
            title="Nothing in this collection yet"
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
            Pick imported transactions from the collection's dates, add them from the Transactions page (select, then "Move to collection"), or add a cash expense directly.
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
                    <Bar dataKey="spent" name="Net spent" fill={collection.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card
              title="Breakdown"
              className="lg:col-span-2"
              action={
                <Tabs
                  value={tab}
                  onChange={setBreakdown}
                  options={[
                    { value: 'category', label: 'Category' },
                    { value: 'tag', label: 'Tag' },
                    ...(children.length ? [{ value: 'sub' as const, label: 'Sub-collection' }] : []),
                  ]}
                />
              }
            >
              <ul className="space-y-2.5">
                {rows.map(([k, v]) => {
                  const cat = tab === 'category' ? catMap.get(k) : undefined;
                  const subC = tab === 'sub' ? byId.get(k) : undefined;
                  const color = tab === 'category' ? (cat?.color ?? '#94a3b8') : (subC?.color ?? collection.color);
                  const label = tab === 'category' ? (cat?.name ?? 'Uncategorised') : tab === 'tag' ? k : subC ? `${collectionIcon(subC)} ${subC.name}` : `Directly in ${collection.name}`;
                  return (
                    <li key={k}>
                      <div className="mb-1 flex items-center gap-2 text-sm">
                        {tab === 'tag' ? <Hash className="size-3.5 text-faint" /> : <Dot color={color} />}
                        <span className="flex-1 truncate">{label}</span>
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
              {tab === 'tag' && <p className="mt-3 text-[11px] text-faint">A transaction with several tags counts under each of them.</p>}
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
                          {t.collectionId !== collection.id && byId.get(t.collectionId!) && (
                            <Badge color={byId.get(t.collectionId!)!.color}>
                              {collectionIcon(byId.get(t.collectionId!)!)} {byId.get(t.collectionId!)!.name}
                            </Badge>
                          )}
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
                        <IconButton title="Remove from collection" className="opacity-0 group-hover:opacity-100" onClick={() => updateTransactions([t.id], { collectionId: null })}>
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

      <CollectionModal open={editOpen} onClose={() => setEditOpen(false)} initial={collection} />
      <CollectionModal open={subModal} onClose={() => setSubModal(false)} parentId={collection.id} />
      <FindTransactions open={findOpen} onClose={() => setFindOpen(false)} collection={collection} />
      <TxnModal
        open={txnModal.open}
        onClose={() => setTxnModal({ open: false })}
        initial={txnModal.t}
        defaults={{ collectionId: collection.id, date: collection.startDate && collection.endDate && todayISO() > collection.endDate ? collection.startDate : todayISO() }}
      />
    </>
  );
}

export default function Collections() {
  const { id } = useParams();
  const upgradeSummaries = useStore((s) => s.upgradeSummaries);
  useEffect(() => {
    void upgradeSummaries();
  }, [upgradeSummaries]);
  return id ? <CollectionDetail key={id} id={id} /> : <CollectionList />;
}
