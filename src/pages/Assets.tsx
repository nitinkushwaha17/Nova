import { ArrowDown, ArrowUp, Coins, Plus, RefreshCw, Search, TrendingUp, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AssetModal } from '../components/AssetModal';
import { Badge, Button, Card, ChartTooltip, cx, Dot, Empty, Input, Money, PageHeader, Select, Stat, Tabs, toast } from '../components/ui';
import { daysBetween, formatDate, todayISO } from '../lib/dates';
import { pct } from '../lib/format';
import { ASSET_TYPES, assetMetrics, portfolioXirr, type AssetMetrics } from '../lib/portfolio';
import { useStore } from '../store';
import type { Asset, AssetType } from '../types';

const QUICK: AssetType[] = ['fd', 'mutual_fund', 'stocks', 'ppf', 'epf', 'gold'];

type Row = { a: Asset; m: AssetMetrics };
type SortKey = 'name' | 'invested' | 'value' | 'gain' | 'xirr' | 'date';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };
type Status = 'active' | 'maturing' | 'closed' | 'all';

const STATUS_LABEL: Record<Status, string> = { active: 'Active', maturing: 'Maturing in 60 days', closed: 'Closed', all: 'Active and closed' };
const MATURING_DAYS = 60;

/** Maturity date for deposits, else the date of the latest NAV or valuation */
const dateOf = (r: Row) => r.a.deposit?.maturityDate ?? r.m.navUsed?.date ?? r.m.valueDate ?? '';

function sortValue(r: Row, key: SortKey): string | number | null {
  switch (key) {
    case 'name':
      return r.a.name.toLowerCase();
    case 'invested':
      return r.m.invested;
    case 'value':
      return r.m.value;
    case 'gain':
      return r.m.gain;
    case 'xirr':
      return r.m.xirr ?? null;
    case 'date':
      return dateOf(r) || null;
  }
}

function sortRows(list: Row[], s: Sort): Row[] {
  const k = s.dir === 'asc' ? 1 : -1;
  return [...list].sort((x, y) => {
    const a = sortValue(x, s.key);
    const b = sortValue(y, s.key);
    // Missing values (no XIRR, no date) always go last
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return (a < b ? -1 : a > b ? 1 : 0) * k || x.a.name.localeCompare(y.a.name);
  });
}

export default function Assets() {
  const assets = useStore((s) => s.portfolio.assets);
  const navs = useStore((s) => s.navs);
  const refreshNavs = useStore((s) => s.refreshNavs);
  const [edit, setEdit] = useState<Asset | undefined>();
  const [newType, setNewType] = useState<AssetType | undefined>();
  const [open, setOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<'type' | 'group'>('group');
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [type, setType] = useState<AssetType | ''>('');
  const [institution, setInstitution] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [sort, setSort] = useState<Sort>({ key: 'value', dir: 'desc' });
  const [layout, setLayout] = useState<'grouped' | 'flat'>('grouped');

  const rows = useMemo(() => assets.map((a) => ({ a, m: assetMetrics(a, navs) })), [assets, navs]);
  const active = rows.filter((r) => !r.a.closed);
  const totals = active.reduce((s, r) => ({ value: s.value + r.m.value, invested: s.invested + r.m.invested }), { value: 0, invested: 0 });
  const xirr = useMemo(
    () =>
      portfolioXirr(
        assets.filter((a) => !a.closed),
        navs,
      ),
    [assets, navs],
  );
  const today = todayISO();

  const types = useMemo(() => [...new Set(assets.map((a) => a.type))].sort((x, y) => ASSET_TYPES[x].label.localeCompare(ASSET_TYPES[y].label)), [assets]);
  const institutions = useMemo(() => [...new Set(assets.map((a) => a.institution?.trim()).filter((x): x is string => !!x))].sort(), [assets]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(({ a }) => {
      if (status === 'active' && a.closed) return false;
      if (status === 'closed' && !a.closed) return false;
      if (status === 'maturing') {
        const d = a.deposit?.maturityDate;
        if (a.closed || !d) return false;
        const days = daysBetween(today, d);
        if (days < 0 || days > MATURING_DAYS) return false;
      }
      if (type && a.type !== type) return false;
      if (institution && a.institution?.trim() !== institution) return false;
      if (needle) {
        const hay = [a.name, a.institution, a.notes, ASSET_TYPES[a.type].label, a.mf?.schemeName].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, type, institution, status, today]);

  const alloc = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color: string }>();
    for (const r of active) {
      const t = ASSET_TYPES[r.a.type];
      const key = groupBy === 'type' ? r.a.type : t.group;
      const cur = map.get(key) ?? { name: groupBy === 'type' ? t.label : t.group, value: 0, color: groupBy === 'type' ? t.color : (GROUP_COLORS[t.group] ?? t.color) };
      cur.value += r.m.value;
      map.set(key, cur);
    }
    return [...map.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [active, groupBy]);

  const byType = useMemo(() => {
    const g = new Map<AssetType, Row[]>();
    for (const r of visible) g.set(r.a.type, [...(g.get(r.a.type) ?? []), r]);
    return [...g.entries()].map(([t, list]) => [t, sortRows(list, sort)] as const).sort((x, y) => sum(y[1]) - sum(x[1]));
  }, [visible, sort]);
  const flat = useMemo(() => sortRows(visible, sort), [visible, sort]);

  const filters: { key: string; label: string; value: string; color?: string; clear: () => void }[] = [];
  if (q.trim()) filters.push({ key: 'q', label: 'Search', value: q.trim(), clear: () => setQ('') });
  if (type) filters.push({ key: 'type', label: 'Type', value: ASSET_TYPES[type].label, color: ASSET_TYPES[type].color, clear: () => setType('') });
  if (institution) filters.push({ key: 'inst', label: 'Institution', value: institution, clear: () => setInstitution('') });
  if (status !== 'active') filters.push({ key: 'status', label: 'Status', value: STATUS_LABEL[status], clear: () => setStatus('active') });
  const clearAll = () => {
    setQ('');
    setType('');
    setInstitution('');
    setStatus('active');
  };

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'date' ? 'asc' : 'desc' }));
  const openEdit = (a: Asset) => {
    setEdit(a);
    setOpen(true);
  };
  const openNew = (t?: AssetType) => {
    setEdit(undefined);
    setNewType(t ?? 'fd');
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Deposits, funds, stocks, retirement accounts, gold, property and everything else you own"
        actions={
          <>
            {assets.some((a) => a.type === 'mutual_fund' && a.mf?.schemeCode) && (
              <Button
                icon={<RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />}
                onClick={async () => {
                  setRefreshing(true);
                  await refreshNavs(true);
                  setRefreshing(false);
                  toast('NAVs refreshed');
                }}
              >
                Refresh NAVs
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openNew()}>
              Add asset
            </Button>
          </>
        }
      />

      {!assets.length ? (
        <div className="card">
          <Empty icon={<Coins />} title="No assets yet" action={<QuickAdd onPick={openNew} center />}>
            Add fixed deposits, mutual funds (with live NAVs), your stock portfolio value, PPF/EPF/NPS, gold, property or anything else.
          </Empty>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Current value" value={<Money value={totals.value} />} icon={<Coins className="size-4" />} tone="accent" />
            <Stat label="Invested" value={<Money value={totals.invested} />} />
            <Stat
              label="Total gain"
              value={<Money value={totals.value - totals.invested} sign colored />}
              sub={totals.invested ? pct((totals.value - totals.invested) / totals.invested) : undefined}
              icon={<TrendingUp className="size-4" />}
              tone={totals.value >= totals.invested ? 'pos' : 'neg'}
            />
            <Stat label="Portfolio XIRR" value={xirr != null ? pct(xirr) : '—'} sub="Annualised, money-weighted" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_2fr]">
            <Card
              title="Allocation"
              action={
                <Tabs
                  value={groupBy}
                  onChange={setGroupBy}
                  options={[
                    { value: 'group', label: 'Class' },
                    { value: 'type', label: 'Type' },
                  ]}
                />
              }
            >
              <div className="relative mx-auto h-48 w-48">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={alloc} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" paddingAngle={1.5} stroke="none">
                      {alloc.map((x) => (
                        <Cell key={x.name} fill={x.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="text-[10px] text-muted uppercase">Assets</div>
                    <Money value={totals.value} short className="text-sm font-semibold" />
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-1.5">
                {alloc.map((x) => (
                  <div key={x.name} className="flex items-center gap-2 text-sm">
                    <Dot color={x.color} />
                    <span className="flex-1">{x.name}</span>
                    <span className="text-xs text-faint">{pct(x.value / totals.value)}</span>
                    <Money value={x.value} short className="w-16 text-right font-medium" />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-faint">Bank balances are shown on the Net worth page.</p>
            </Card>

            <div className="min-w-0 space-y-4">
              <QuickAdd onPick={openNew} />

              <Card className="!p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-44 flex-1">
                    <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, institution or notes" className="!pl-8" />
                  </div>
                  <Select value={type} onChange={(e) => setType(e.target.value as AssetType | '')} className="!w-auto">
                    <option value="">All types</option>
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {ASSET_TYPES[t].label}
                      </option>
                    ))}
                  </Select>
                  {institutions.length > 1 && (
                    <Select value={institution} onChange={(e) => setInstitution(e.target.value)} className="!w-auto">
                      <option value="">All institutions</option>
                      {institutions.map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="!w-auto">
                    {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                  <Tabs
                    value={layout}
                    onChange={setLayout}
                    options={[
                      { value: 'grouped', label: 'By type' },
                      { value: 'flat', label: 'All' },
                    ]}
                  />
                </div>
                {filters.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                    <span className="mr-1 text-xs text-faint">Filtered by</span>
                    {filters.map((f) => (
                      <span key={f.key} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 pr-1 pl-2.5 text-xs">
                        {f.color && <Dot color={f.color} className="size-2" />}
                        <span className="text-muted">{f.label}:</span>
                        <span className="max-w-48 truncate font-medium">{f.value}</span>
                        <button
                          onClick={f.clear}
                          title={`Remove ${f.label.toLowerCase()} filter`}
                          className="grid size-5 place-items-center rounded-md text-muted hover:bg-accent/20 hover:text-fg"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    <button onClick={clearAll} className="ml-1 text-xs font-medium text-accent hover:underline">
                      Clear all
                    </button>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-4 px-1 text-xs text-muted">
                  <span>
                    {visible.length} of {rows.length} asset{rows.length === 1 ? '' : 's'}
                  </span>
                  <span>
                    Value <Money value={sum(visible)} className="font-medium text-fg" />
                  </span>
                  <span>
                    Gain <Money value={visible.reduce((s, r) => s + r.m.gain, 0)} sign colored className="font-medium" />
                  </span>
                </div>
              </Card>

              {!visible.length ? (
                <div className="card">
                  <Empty icon={<Search />} title="No assets match" action={filters.length ? <Button onClick={clearAll}>Clear all filters</Button> : undefined}>
                    Try another search or filter.
                  </Empty>
                </div>
              ) : layout === 'flat' ? (
                <Card pad={false}>
                  <AssetTable list={flat} sort={sort} onSort={onSort} onOpen={openEdit} today={today} dateLabel="Matures / updated" showType />
                </Card>
              ) : (
                byType.map(([t, list]) => (
                  <Card
                    key={t}
                    pad={false}
                    title={
                      <span className="flex items-center gap-2 px-5 pt-4">
                        <Dot color={ASSET_TYPES[t].color} /> {ASSET_TYPES[t].label}
                        <Badge>{list.length}</Badge>
                      </span>
                    }
                    action={<Money value={sum(list)} className="px-5 pt-4 text-sm font-semibold" />}
                  >
                    <AssetTable list={list} sort={sort} onSort={onSort} onOpen={openEdit} today={today} dateLabel={t === 'fd' || t === 'rd' ? 'Matures' : 'Updated'} />
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <AssetModal open={open} onClose={() => setOpen(false)} initial={edit} newType={newType} />
    </>
  );
}

function SortTh({
  k,
  sort,
  onSort,
  align = 'right',
  className,
  children,
}: {
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  const on = sort.key === k;
  const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={cx('py-2 font-medium', align === 'left' ? 'text-left' : 'text-right', className)} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        onClick={() => onSort(k)}
        className={cx('inline-flex items-center gap-1 uppercase transition hover:text-fg', on && 'text-fg', align === 'right' && 'flex-row-reverse')}
        title={`Sort by ${String(children).toLowerCase()}`}
      >
        {children}
        <Icon className={cx('size-3', on ? 'opacity-100' : 'opacity-0')} />
      </button>
    </th>
  );
}

function AssetTable({
  list,
  sort,
  onSort,
  onOpen,
  today,
  dateLabel,
  showType,
}: {
  list: Row[];
  sort: Sort;
  onSort: (k: SortKey) => void;
  onOpen: (a: Asset) => void;
  today: string;
  dateLabel: string;
  showType?: boolean;
}) {
  const th = { sort, onSort };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] text-muted">
          <tr className="border-b border-line">
            <SortTh k="name" align="left" className="pr-2 pl-4 sm:px-5" {...th}>
              Name
            </SortTh>
            <SortTh k="invested" className="hidden px-3 sm:table-cell" {...th}>
              Invested
            </SortTh>
            <SortTh k="value" className="px-3" {...th}>
              Value
            </SortTh>
            <SortTh k="gain" className="pr-4 pl-3 sm:px-3" {...th}>
              Gain
            </SortTh>
            <SortTh k="xirr" className="hidden px-3 md:table-cell" {...th}>
              XIRR
            </SortTh>
            <SortTh k="date" className="hidden px-5 sm:table-cell" {...th}>
              {dateLabel}
            </SortTh>
          </tr>
        </thead>
        <tbody>
          {list.map(({ a, m }) => {
            const matures = a.deposit?.maturityDate;
            const days = matures ? daysBetween(today, matures) : null;
            const stale = !matures && !m.navUsed && m.valueDate ? daysBetween(m.valueDate, today) > 60 : false;
            return (
              <tr key={a.id} onClick={() => onOpen(a)} className={`cursor-pointer border-b border-line/60 last:border-0 hover:bg-surface-2/60 ${a.closed ? 'opacity-50' : ''}`}>
                <td className="min-w-36 py-2.5 pr-2 pl-4 sm:px-5">
                  <div className="flex items-center gap-2 font-medium">
                    {showType && <Dot color={ASSET_TYPES[a.type].color} className="size-2" />}
                    {a.name}
                  </div>
                  <div className="text-[11px] text-faint">
                    {[
                      showType && ASSET_TYPES[a.type].label,
                      a.institution,
                      a.deposit && `${a.deposit.rate}% p.a.`,
                      a.mf?.units ? `${a.mf.units} units` : null,
                      a.closed && 'Closed',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                  <Money value={m.invested} />
                </td>
                <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  <Money value={m.value} />
                  {m.maturityValue && !a.closed ? (
                    <div className="text-[11px] font-normal text-faint">
                      → <Money value={m.maturityValue} short />
                    </div>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4 pl-3 text-right whitespace-nowrap sm:px-3">
                  <Money value={m.gain} sign colored />
                  {m.gainPct != null && <div className="text-[11px] text-faint">{pct(m.gainPct)}</div>}
                </td>
                <td className="hidden px-3 py-2.5 text-right md:table-cell">{m.xirr != null ? pct(m.xirr) : '—'}</td>
                <td className="hidden px-5 py-2.5 text-right text-xs sm:table-cell">
                  {matures ? (
                    <>
                      {formatDate(matures)}
                      {days != null && days >= 0 && days <= MATURING_DAYS && (
                        <div>
                          <Badge color="#fbbf24">in {days}d</Badge>
                        </div>
                      )}
                      {days != null && days < 0 && !a.closed && (
                        <div>
                          <Badge color="#34d399">matured</Badge>
                        </div>
                      )}
                    </>
                  ) : m.navUsed ? (
                    <span className="text-muted">NAV {formatDate(m.navUsed.date)}</span>
                  ) : (
                    <span className={stale ? 'text-warn' : 'text-muted'} title={stale ? 'Valuation is over 60 days old' : undefined}>
                      {m.valueDate ? formatDate(m.valueDate) : 'No valuation'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const GROUP_COLORS: Record<string, string> = {
  Equity: '#a78bfa',
  Debt: '#60a5fa',
  Retirement: '#34d399',
  Gold: '#fbbf24',
  'Real Estate': '#fb923c',
  Alternative: '#f472b6',
  Cash: '#a3e635',
  Other: '#94a3b8',
};

function sum(list: { m: AssetMetrics }[]) {
  return list.reduce((s, r) => s + r.m.value, 0);
}

function QuickAdd({ onPick, center }: { onPick: (t: AssetType) => void; center?: boolean }) {
  return (
    <div className={center ? 'flex flex-wrap justify-center gap-2' : 'flex flex-wrap gap-2'}>
      {QUICK.map((t) => (
        <Button key={t} size="sm" icon={<Plus className="size-3.5" />} onClick={() => onPick(t)}>
          {ASSET_TYPES[t].label}
        </Button>
      ))}
    </div>
  );
}
