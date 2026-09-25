import { ArrowDownRight, ArrowUpRight, ChevronLeft, PiggyBank, Receipt, Repeat, Store, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PeriodPicker } from '../components/PeriodPicker';
import { axisMoney, Badge, Card, ChartTooltip, Dot, Empty, Money, PageHeader, Progress, Select, Spinner, Stat } from '../components/ui';
import { usePeriod, usePeriodTxns } from '../hooks';
import { analyze, proportionalDirectTax } from '../lib/analytics';
import { formatDate, monthLabel, periodLabel } from '../lib/dates';
import { pct } from '../lib/format';
import { estimateGST } from '../lib/gst';
import { classify, detectRecurring, merchantOf, topMerchants } from '../lib/transactions';
import { useCatMap, useKnownFYs, useStore } from '../store';

export default function Analytics() {
  const { period, setPeriod } = usePeriod();
  const knownFYs = useKnownFYs();
  const { txns: all, loading, fys } = usePeriodTxns(period);
  const accounts = useStore((s) => s.meta.accounts);
  const taxByFY = useStore((s) => s.taxByFY);
  const ensureTax = useStore((s) => s.ensureTax);
  const catMap = useCatMap();
  const [account, setAccount] = useState('');
  const [drill, setDrill] = useState<string | null>(null);

  useEffect(() => {
    for (const fy of fys) void ensureTax(fy);
  }, [fys, ensureTax]);

  const txns = useMemo(() => (account ? all.filter((t) => t.accountId === account) : all), [all, account]);
  const a = useMemo(() => analyze(txns, catMap), [txns, catMap]);
  const drillTx = useMemo(() => (drill ? txns.filter((t) => (t.category ?? '__none') === drill && classify(t, t.category ? catMap.get(t.category) : undefined) !== 'transfer') : txns), [drill, txns, catMap]);
  const drillA = useMemo(() => (drill ? analyze(drillTx, catMap) : a), [drill, drillTx, a, catMap]);
  const merchants = useMemo(() => topMerchants(drillTx, catMap, 8), [drillTx, catMap]);
  const recurring = useMemo(() => detectRecurring(txns, catMap).slice(0, 10), [txns, catMap]);
  const gst = useMemo(() => estimateGST(txns, catMap, (t) => classify(t, t.category ? catMap.get(t.category) : undefined) === 'expense'), [txns, catMap]);
  const periodTax = useMemo(() => {
    const scoped: typeof taxByFY = {};
    for (const fy of fys) if (taxByFY[fy]) scoped[fy] = taxByFY[fy];
    return proportionalDirectTax(period, scoped);
  }, [fys, taxByFY, period]);

  const drillCat = drill ? a.byCategory.find((c) => c.id === drill) : undefined;
  const chartData = drillA.byMonth.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const pieData = drillCat ? drillCat.subs.map((s, i) => ({ name: s.name, value: s.amount, color: shade(drillCat.color, i) })) : a.byCategory.map((c) => ({ name: c.name, value: c.amount, color: c.color, id: c.id }));
  const pieTotal = pieData.reduce((s, x) => s + Math.max(0, x.value), 0);
  const totalTax = periodTax + gst.total;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={`${periodLabel(period)} · ${a.count.toLocaleString()} transactions (transfers excluded)`}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} fys={knownFYs} />
            <Select value={account} onChange={(e) => setAccount(e.target.value)} className="!w-auto">
              <option value="">All accounts</option>
              {accounts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </>
        }
      />
      {loading && !all.length ? (
        <div className="grid h-60 place-items-center">
          <Spinner className="size-6" />
        </div>
      ) : !a.count ? (
        <div className="card">
          <Empty icon={<Receipt />} title="Nothing to analyse in this period" action={<Link to="/import" className="text-sm text-accent hover:underline">Import a statement →</Link>}>
            Pick another period or import statements.
          </Empty>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label="Income" value={<Money value={a.income} />} icon={<ArrowDownRight className="size-4" />} tone="pos" />
            <Stat label="Spending" value={<Money value={a.expense} />} sub={a.refunds ? <>incl. <Money value={a.refunds} /> refunds</> : undefined} icon={<ArrowUpRight className="size-4" />} tone="neg" />
            <Stat label="Invested" value={<Money value={a.investment} />} sub={a.income ? `${pct(a.investment / a.income)} of income` : undefined} icon={<PiggyBank className="size-4" />} />
            <Stat
              label="Saved"
              value={<Money value={a.savings} colored />}
              sub={a.savingsRate !== null ? `Savings rate ${pct(a.savingsRate)}` : 'No income in period'}
              icon={<Wallet className="size-4" />}
              tone={a.savings >= 0 ? 'pos' : 'neg'}
            />
            <Stat
              label="Tax burden"
              value={<Money value={totalTax} />}
              sub={
                <>
                  Direct <Money value={periodTax} short /> · GST ~<Money value={gst.total} short />
                  {a.income ? ` · ${pct(totalTax / a.income)} of income` : ''}
                </>
              }
              icon={<Receipt className="size-4" />}
              className="col-span-2 lg:col-span-1"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Card
              title={drillCat ? <span className="flex items-center gap-2"><Dot color={drillCat.color} /> {drillCat.name} · monthly</span> : 'Monthly cash flow'}
              action={drill && <button onClick={() => setDrill(null)} className="flex items-center gap-1 text-xs text-accent hover:underline"><ChevronLeft className="size-3.5" /> All categories</button>}
            >
              <div className="h-72">
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ left: -10, right: 4, top: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    {!drill && <Bar dataKey="income" name="Income" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={22} />}
                    <Bar dataKey="expense" name={drill ? 'Spent' : 'Spending'} fill={drillCat?.color ?? '#fb7185'} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    {!drill && <Bar dataKey="investment" name="Invested" fill="#60a5fa" radius={[4, 4, 0, 0]} maxBarSize={22} />}
                    {!drill && <Line dataKey="net" name="Net" stroke="#a78bfa" strokeWidth={2} dot={false} type="monotone" />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title={drillCat ? `${drillCat.name} by subcategory` : 'Where the money went'}>
              <div className="flex items-center gap-4">
                <div className="relative h-44 w-44 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={pieData.filter((p) => p.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="64%"
                        outerRadius="100%"
                        paddingAngle={1.5}
                        stroke="none"
                        onClick={(_d, i) => {
                          const p = pieData.filter((x) => x.value > 0)[i];
                          if (!drill && p && 'id' in p) setDrill(p.id as string);
                        }}
                        className="cursor-pointer outline-none"
                      >
                        {pieData
                          .filter((p) => p.value > 0)
                          .map((p) => (
                            <Cell key={p.name} fill={p.color} />
                          ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div>
                      <div className="text-[10px] text-muted uppercase">Total</div>
                      <div className="text-sm font-semibold">
                        <Money value={drillCat?.amount ?? a.expense} short />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="max-h-44 min-w-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                  {pieData.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => !drill && 'id' in p && setDrill(p.id as string)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-surface-2"
                    >
                      <Dot color={p.color} className="size-2" />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-faint">{pctOf(p.value, pieTotal)}</span>
                      <Money value={p.value} short className="w-16 text-right font-medium" />
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <Card title="Spending by category">
              <div className="space-y-3">
                {a.byCategory.slice(0, 10).map((c) => (
                  <button key={c.id} className="block w-full text-left" onClick={() => setDrill(c.id)}>
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      <Dot color={c.color} />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-faint">{c.count}×</span>
                      <Money value={c.amount} className="font-medium" />
                    </div>
                    <Progress value={a.byCategory[0].amount ? c.amount / a.byCategory[0].amount : 0} color={c.color} />
                  </button>
                ))}
              </div>
            </Card>

            <Card title={<span className="flex items-center gap-2"><Store className="size-4" /> Top merchants{drillCat ? ` · ${drillCat.name}` : ''}</span>}>
              <div className="space-y-2">
                {merchants.map((m, i) => (
                  <Link key={m.merchant} to={`/transactions?q=${encodeURIComponent(m.merchant)}`} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
                    <span className="grid size-6 place-items-center rounded-md bg-surface-2 text-[11px] text-muted">{i + 1}</span>
                    <span className="flex-1 truncate">{m.merchant}</span>
                    <span className="text-xs text-faint">{m.count}×</span>
                    <Money value={m.amount} className="font-medium" />
                  </Link>
                ))}
                {!merchants.length && <p className="text-sm text-muted">No spending.</p>}
              </div>
            </Card>

            <Card title={<span className="flex items-center gap-2"><Repeat className="size-4" /> Recurring payments</span>}>
              {recurring.length ? (
                <div className="space-y-2">
                  {recurring.map((r) => {
                    const c = r.category ? catMap.get(r.category) : undefined;
                    return (
                      <div key={r.merchant} className="flex items-center gap-3 text-sm">
                        <Dot color={c?.color ?? 'var(--line)'} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{r.merchant}</div>
                          <div className="text-[11px] text-faint">
                            {r.frequency} · next ~{formatDate(r.nextDate)}
                          </div>
                        </div>
                        <div className="text-right">
                          <Money value={r.avgAmount} className="font-medium" />
                          <div className="text-[11px] text-faint">
                            <Money value={r.yearlyCost} short />
                            /yr
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted">No recurring payments detected in this period (needs at least 3 similar payments).</p>
              )}
            </Card>

            <Card title="Largest expenses">
              <div className="space-y-2">
                {drillA.largest.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-xs text-faint">{formatDate(t.date).slice(0, 6)}</span>
                    <span className="flex-1 truncate" title={t.description}>
                      {merchantOf(t.description)}
                    </span>
                    <Money value={-t.amount} className="font-medium" />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Income sources">
              <div className="space-y-2">
                {a.incomeByCategory.flatMap((c) =>
                  c.subs.map((s) => (
                    <div key={c.id + s.name} className="flex items-center gap-2 text-sm">
                      <Dot color={c.color} />
                      <span className="flex-1 truncate">{c.id === 'income' ? s.name : `${c.name}${s.name !== 'Other' ? ` › ${s.name}` : ''}`}</span>
                      <span className="text-xs text-faint">{pctOf(s.amount, a.income)}</span>
                      <Money value={s.amount} className="font-medium" />
                    </div>
                  )),
                )}
                {!a.incomeByCategory.length && <p className="text-sm text-muted">No income in this period.</p>}
              </div>
            </Card>

            <Card title={<span className="flex items-center gap-2"><Receipt className="size-4" /> Estimated GST paid</span>} action={<Badge>~{pct(gst.spend ? gst.total / gst.spend : 0)} of taxable spend</Badge>}>
              <div className="space-y-2">
                {gst.byCategory.slice(0, 8).map((g) => (
                  <div key={g.id} className="flex items-center gap-2 text-sm">
                    <Dot color={g.color} />
                    <span className="flex-1 truncate">{g.name}</span>
                    <span className="text-xs text-faint">{pct(g.rate)}</span>
                    <Money value={g.tax} className="font-medium" />
                  </div>
                ))}
                <p className="pt-1 text-[11px] text-faint">
                  Estimated from category GST slabs (rates as on each transaction date, incl. GST 2.0 from 22 Sep 2025). Amounts are treated as tax-inclusive.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function pctOf(v: number, total: number) {
  return total > 0 ? pct(v / total, 0) : '';
}

function shade(hex: string, i: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = 1 - Math.min(i * 0.13, 0.7);
  const r = Math.round(((n >> 16) & 255) * f + 30 * (1 - f));
  const g = Math.round(((n >> 8) & 255) * f + 30 * (1 - f));
  const b = Math.round((n & 255) * f + 45 * (1 - f));
  return `rgb(${r},${g},${b})`;
}
