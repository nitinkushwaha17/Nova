import { Coins, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AssetModal } from '../components/AssetModal';
import { Badge, Button, Card, ChartTooltip, Dot, Empty, Money, PageHeader, Stat, Tabs, toast, Toggle } from '../components/ui';
import { daysBetween, formatDate, todayISO } from '../lib/dates';
import { pct } from '../lib/format';
import { ASSET_TYPES, assetMetrics, portfolioXirr, type AssetMetrics } from '../lib/portfolio';
import { useStore } from '../store';
import type { Asset, AssetType } from '../types';

const QUICK: AssetType[] = ['fd', 'mutual_fund', 'stocks', 'ppf', 'epf', 'gold'];

export default function Assets() {
  const assets = useStore((s) => s.portfolio.assets);
  const navs = useStore((s) => s.navs);
  const refreshNavs = useStore((s) => s.refreshNavs);
  const [edit, setEdit] = useState<Asset | undefined>();
  const [newType, setNewType] = useState<AssetType | undefined>();
  const [open, setOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [groupBy, setGroupBy] = useState<'type' | 'group'>('group');
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => assets.map((a) => ({ a, m: assetMetrics(a, navs) })), [assets, navs]);
  const active = rows.filter((r) => !r.a.closed);
  const visible = showClosed ? rows : active;
  const totals = active.reduce((s, r) => ({ value: s.value + r.m.value, invested: s.invested + r.m.invested }), { value: 0, invested: 0 });
  const xirr = useMemo(() => portfolioXirr(assets.filter((a) => !a.closed), navs), [assets, navs]);

  const alloc = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color: string }>();
    for (const r of active) {
      const t = ASSET_TYPES[r.a.type];
      const key = groupBy === 'type' ? r.a.type : t.group;
      const cur = map.get(key) ?? { name: groupBy === 'type' ? t.label : t.group, value: 0, color: groupBy === 'type' ? t.color : GROUP_COLORS[t.group] ?? t.color };
      cur.value += r.m.value;
      map.set(key, cur);
    }
    return [...map.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [active, groupBy]);

  const byType = useMemo(() => {
    const g = new Map<AssetType, { a: Asset; m: AssetMetrics }[]>();
    for (const r of visible) g.set(r.a.type, [...(g.get(r.a.type) ?? []), r]);
    return [...g.entries()].sort((x, y) => sum(y[1]) - sum(x[1]));
  }, [visible]);

  const today = todayISO();
  const openNew = (type?: AssetType) => {
    setEdit(undefined);
    setNewType(type ?? 'fd');
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
          <Empty icon={<Coins />} title="No assets yet" action={<QuickAdd onPick={openNew} />}>
            Add fixed deposits, mutual funds (with live NAVs), your stock portfolio value, PPF/EPF/NPS, gold, property or anything else.
          </Empty>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            <Card title="Allocation" action={<Tabs value={groupBy} onChange={setGroupBy} options={[{ value: 'group', label: 'Class' }, { value: 'type', label: 'Type' }]} />}>
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

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <QuickAdd onPick={openNew} />
                {rows.some((r) => r.a.closed) && <Toggle checked={showClosed} onChange={setShowClosed} label="Show closed" />}
              </div>
              {byType.map(([type, list]) => (
                <Card
                  key={type}
                  pad={false}
                  title={
                    <span className="flex items-center gap-2 px-5 pt-4">
                      <Dot color={ASSET_TYPES[type].color} /> {ASSET_TYPES[type].label}
                      <Badge>{list.length}</Badge>
                    </span>
                  }
                  action={<Money value={sum(list)} className="px-5 pt-4 text-sm font-semibold" />}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[11px] text-muted uppercase">
                        <tr className="border-b border-line">
                          <th className="px-5 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-right font-medium">Invested</th>
                          <th className="px-3 py-2 text-right font-medium">Value</th>
                          <th className="px-3 py-2 text-right font-medium">Gain</th>
                          <th className="px-3 py-2 text-right font-medium">XIRR</th>
                          <th className="px-5 py-2 text-right font-medium">{type === 'fd' || type === 'rd' ? 'Matures' : 'Updated'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map(({ a, m }) => {
                          const matures = a.deposit?.maturityDate;
                          const days = matures ? daysBetween(today, matures) : null;
                          const stale = !matures && !m.navUsed && m.valueDate ? daysBetween(m.valueDate, today) > 60 : false;
                          return (
                            <tr key={a.id} onClick={() => (setEdit(a), setOpen(true))} className={`cursor-pointer border-b border-line/60 last:border-0 hover:bg-surface-2/60 ${a.closed ? 'opacity-50' : ''}`}>
                              <td className="px-5 py-2.5">
                                <div className="font-medium">{a.name}</div>
                                <div className="text-[11px] text-faint">
                                  {[a.institution, a.deposit && `${a.deposit.rate}% p.a.`, a.mf?.units ? `${a.mf.units} units` : null, a.closed && 'Closed'].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <Money value={m.invested} />
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium">
                                <Money value={m.value} />
                                {m.maturityValue && !a.closed ? (
                                  <div className="text-[11px] font-normal text-faint">
                                    → <Money value={m.maturityValue} short />
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <Money value={m.gain} sign colored />
                                {m.gainPct != null && <div className="text-[11px] text-faint">{pct(m.gainPct)}</div>}
                              </td>
                              <td className="px-3 py-2.5 text-right">{m.xirr != null ? pct(m.xirr) : '—'}</td>
                              <td className="px-5 py-2.5 text-right text-xs">
                                {matures ? (
                                  <>
                                    {formatDate(matures)}
                                    {days != null && days >= 0 && days <= 60 && <div><Badge color="#fbbf24">in {days}d</Badge></div>}
                                    {days != null && days < 0 && !a.closed && <div><Badge color="#34d399">matured</Badge></div>}
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
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
      <AssetModal open={open} onClose={() => setOpen(false)} initial={edit} newType={newType} />
    </>
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

function QuickAdd({ onPick }: { onPick: (t: AssetType) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {QUICK.map((t) => (
        <Button key={t} size="sm" icon={<Plus className="size-3.5" />} onClick={() => onPick(t)}>
          {ASSET_TYPES[t].label}
        </Button>
      ))}
    </div>
  );
}
