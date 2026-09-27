import { ArrowRight, CalendarClock, Cloud, Landmark, PiggyBank, Plus, Sparkles, TrendingDown, TrendingUp, Upload, Wallet } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatementReminder } from '../components/StatementReminder';
import { axisMoney, Badge, Card, ChartTooltip, Delta, Dot, Money, PageHeader, Progress, Stat } from '../components/ui';
import { useNetWorth } from '../hooks';
import { addDays, addMonths, currentFY, daysBetween, formatDate, fyMonths, monthLabel, shiftFY, todayISO } from '../lib/dates';
import { pct } from '../lib/format';
import { ASSET_TYPES } from '../lib/portfolio';
import { advanceTaxSchedule, computeTax } from '../lib/tax';
import { emptyMonth, merchantOf, mergeMonths } from '../lib/transactions';
import { useCatMap, useStore } from '../store';
import { useSync } from '../sync/engine';

interface Upcoming {
  date: string;
  title: string;
  sub: string;
  amount?: number;
  to: string;
  tone: string;
}

export default function Dashboard() {
  const settings = useStore((s) => s.settings);
  const accounts = useStore((s) => s.meta.accounts);
  const summaries = useStore((s) => s.summaries);
  const snapshots = useStore((s) => s.networth.snapshots);
  const assets = useStore((s) => s.portfolio.assets);
  const planning = useStore((s) => s.planning);
  const hasWealth = useStore((s) => s.portfolio.assets.length > 0 || s.liabilities.liabilities.length > 0);
  const txByFY = useStore((s) => s.txByFY);
  const taxByFY = useStore((s) => s.taxByFY);
  const ensureFYs = useStore((s) => s.ensureFYs);
  const ensureTax = useStore((s) => s.ensureTax);
  const connected = useSync((s) => s.status !== 'disconnected');
  const catMap = useCatMap();
  const nw = useNetWorth();
  const fy = currentFY();
  const today = todayISO();

  useEffect(() => {
    void ensureFYs([fy]);
    void ensureTax(fy);
  }, [fy, ensureFYs, ensureTax]);

  const fyTotals = useMemo(() => mergeMonths(Object.values(summaries[fy]?.months ?? {})), [summaries, fy]);
  const prevTotals = useMemo(() => {
    const n = fyMonths(fy).filter((m) => m <= today.slice(0, 7)).length;
    const months = new Set(fyMonths(shiftFY(fy, -1)).slice(0, n));
    const prev = summaries[shiftFY(fy, -1)]?.months ?? {};
    return mergeMonths(
      Object.entries(prev)
        .filter(([m]) => months.has(m))
        .map(([, v]) => v),
    );
  }, [summaries, fy, today]);
  const savings = fyTotals.income - fyTotals.expense - fyTotals.investment;

  const last12 = useMemo(() => {
    const months = [...fyMonths(shiftFY(fy, -1)), ...fyMonths(fy)].filter((m) => m <= today.slice(0, 7)).slice(-12);
    return months.map((m) => {
      const s = Object.values(summaries).find((x) => x.months[m])?.months[m] ?? emptyMonth();
      return { month: m, label: monthLabel(m), income: s.income, expense: s.expense, investment: s.investment, net: s.income - s.expense - s.investment };
    });
  }, [summaries, fy, today]);
  const hasFlow = last12.some((m) => m.income || m.expense);

  const topCats = useMemo(
    () =>
      Object.entries(fyTotals.expenseByCategory)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id, v]) => ({ id, amount: v, cat: catMap.get(id) })),
    [fyTotals, catMap],
  );

  const fyTx = txByFY[fy];
  const recent = useMemo(() => [...(fyTx ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7), [fyTx]);
  const uncategorised = useMemo(() => (fyTx ?? []).filter((t) => !t.category && !t.isTransfer).length, [fyTx]);

  const prevSnap = useMemo(() => [...snapshots].filter((s) => s.month < today.slice(0, 7)).sort((a, b) => b.month.localeCompare(a.month))[0], [snapshots, today]);
  const nwChange = prevSnap ? nw.netWorth - prevSnap.netWorth : null;

  const upcoming = useMemo(() => {
    const horizon = addDays(today, 90);
    const out: Upcoming[] = [];
    for (const a of assets) {
      const d = a.deposit?.maturityDate;
      if (!a.closed && d && d >= today && d <= horizon) out.push({ date: d, title: `${a.name} matures`, sub: ASSET_TYPES[a.type].label, to: '/assets', tone: '#34d399' });
    }
    for (const p of planning.insurance) {
      if (!p.renewalDate || p.frequency === 'single') continue;
      let d = p.renewalDate;
      const step = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[p.frequency];
      for (let i = 0; d < today && i < 600; i++) d = addMonths(d, step);
      if (d <= horizon) out.push({ date: d, title: `${p.name} premium`, sub: p.insurer ?? 'Insurance', amount: p.premium, to: '/planning', tone: '#fbbf24' });
    }
    const tax = taxByFY[fy];
    if (tax) {
      const r = computeTax(tax);
      const withheld = tax.payments.filter((p) => p.kind === 'tds' || p.kind === 'tcs').reduce((s, p) => s + p.amount, 0);
      const advPaid = tax.payments.filter((p) => p.kind === 'advance').reduce((s, p) => s + p.amount, 0);
      const liability = r.chosen.totalTax - withheld;
      if (liability >= 10000) {
        const next = advanceTaxSchedule(fy, liability).find((x) => x.due >= today && x.amount > advPaid);
        if (next && next.due <= horizon)
          out.push({ date: next.due, title: 'Advance tax instalment', sub: `${pct(next.pct, 0)} cumulative due`, amount: next.amount - advPaid, to: '/taxes', tone: '#a78bfa' });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  }, [assets, planning.insurance, taxByFY, fy, today]);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const onboarding = !accounts.length || !Object.keys(summaries).length;
  const alloc = Object.entries(nw.byAssetType)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <>
      <PageHeader
        title={
          <>
            {greeting}
            {settings.displayName ? (
              <>
                , <span className="gradient-text">{settings.displayName}</span>
              </>
            ) : (
              ''
            )}
          </>
        }
        subtitle={`Your financial picture for FY ${fy}`}
        actions={
          <Link
            to="/import"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 px-3.5 text-sm font-medium text-white shadow-lg shadow-violet-900/25 hover:brightness-110"
          >
            <Upload className="size-4" /> Import statement
          </Link>
        }
      />

      {onboarding && <Onboarding hasAccount={!!accounts.length} hasTxns={!!Object.keys(summaries).length} connected={connected} hasWealth={hasWealth} />}
      <StatementReminder />

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label="Net worth"
            value={<Money value={nw.netWorth} />}
            sub={
              nwChange !== null ? (
                <>
                  <Money value={nwChange} sign colored short /> since {monthLabel(prevSnap!.month)}
                </>
              ) : (
                `${pct(nw.assets ? nw.liabilities / nw.assets : 0)} debt-to-assets`
              )
            }
            icon={<Landmark className="size-4" />}
            tone="accent"
            to="/networth"
          />
          <Stat
            label={
              <>
                Income<span className="hidden sm:inline"> · FY {fy}</span>
              </>
            }
            value={<Money value={fyTotals.income} />}
            sub={
              prevTotals.income ? (
                <>
                  <Delta value={fyTotals.income / prevTotals.income - 1} /> vs same period last FY
                </>
              ) : undefined
            }
            icon={<TrendingUp className="size-4" />}
            tone="pos"
          />
          <Stat
            label={
              <>
                Spending<span className="hidden sm:inline"> · FY {fy}</span>
              </>
            }
            value={<Money value={fyTotals.expense} />}
            sub={
              prevTotals.expense ? (
                <>
                  <Delta value={fyTotals.expense / prevTotals.expense - 1} invert /> vs same period last FY
                </>
              ) : undefined
            }
            icon={<TrendingDown className="size-4" />}
            tone="neg"
          />
          <Stat
            label="Saved + invested"
            value={<Money value={savings + fyTotals.investment} colored />}
            sub={fyTotals.income ? `Savings rate ${pct((savings + fyTotals.investment) / fyTotals.income)}` : undefined}
            icon={<PiggyBank className="size-4" />}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
          <Card
            title="Cash flow · last 12 months"
            action={
              <Link to="/analytics" className="text-xs text-accent hover:underline">
                Analytics →
              </Link>
            }
          >
            {hasFlow ? (
              <div className="h-72">
                <ResponsiveContainer>
                  <ComposedChart data={last12} margin={{ left: -10, right: 4, top: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Income" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="expense" name="Spending" fill="#fb7185" radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="investment" name="Invested" fill="#60a5fa" radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Line dataKey="net" name="Net" stroke="#a78bfa" strokeWidth={2} dot={false} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted">Import a bank statement to see your cash flow.</p>
            )}
          </Card>

          <Card
            title="Net worth"
            action={
              <Link to="/networth" className="text-xs text-accent hover:underline">
                Details →
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted">Assets</div>
                <Money value={nw.assets} className="text-lg font-semibold text-pos" />
              </div>
              <div>
                <div className="text-xs text-muted">Liabilities</div>
                <Money value={nw.liabilities} className="text-lg font-semibold text-neg" />
              </div>
            </div>
            {snapshots.length > 1 && (
              <div className="mt-3 h-24">
                <ResponsiveContainer>
                  <AreaChart data={snapshots.map((s) => ({ label: monthLabel(s.month), netWorth: s.netWorth }))} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip content={<ChartTooltip />} />
                    <XAxis dataKey="label" hide />
                    <Area dataKey="netWorth" name="Net worth" stroke="#8b5cf6" strokeWidth={2} fill="url(#nwg)" type="monotone" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-4 space-y-2">
              {alloc.slice(0, 6).map(([k, v]) => {
                const meta = k === 'bank' ? { label: 'Bank balances', color: '#94a3b8' } : ASSET_TYPES[k as keyof typeof ASSET_TYPES];
                return (
                  <div key={k}>
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <Dot color={meta.color} />
                      <span className="flex-1">{meta.label}</span>
                      <span className="text-faint">{pct((v ?? 0) / nw.assets, 0)}</span>
                      <Money value={v} short className="w-16 text-right font-medium" />
                    </div>
                    <Progress value={(v ?? 0) / nw.assets} color={meta.color} />
                  </div>
                );
              })}
              {!alloc.length && (
                <p className="text-sm text-muted">
                  <Link to="/assets" className="text-accent hover:underline">
                    Add FDs, funds, stocks and other assets
                  </Link>{' '}
                  to track your net worth.
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Card title={`Top spending · FY ${fy}`}>
            <div className="space-y-3">
              {topCats.map((c) => (
                <div key={c.id}>
                  <div className="mb-1 flex items-center gap-2 text-sm">
                    <Dot color={c.cat?.color ?? 'var(--faint)'} />
                    <span className="flex-1 truncate">{c.cat?.name ?? (c.id === 'uncategorized' ? 'Uncategorised' : c.id)}</span>
                    <Money value={c.amount} className="font-medium" />
                  </div>
                  <Progress value={c.amount / topCats[0].amount} color={c.cat?.color} />
                </div>
              ))}
              {!topCats.length && <p className="text-sm text-muted">No spending recorded this FY yet.</p>}
              {uncategorised > 0 && (
                <Link to="/transactions?uncategorized=1" className="mt-2 flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn hover:bg-warn/15">
                  <Sparkles className="size-3.5" /> {uncategorised} uncategorised transaction{uncategorised > 1 ? 's' : ''} — categorise now
                  <ArrowRight className="ml-auto size-3.5" />
                </Link>
              )}
            </div>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <CalendarClock className="size-4" /> Coming up · 90 days
              </span>
            }
          >
            {upcoming.length ? (
              <div className="space-y-2.5">
                {upcoming.map((u, i) => {
                  const days = daysBetween(today, u.date);
                  return (
                    <Link key={i} to={u.to} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
                      <div className="grid w-11 shrink-0 place-items-center rounded-lg bg-surface-2 py-1 text-center leading-tight">
                        <span className="text-[10px] text-muted uppercase">{formatDate(u.date).slice(3, 6)}</span>
                        <span className="text-sm font-semibold">{u.date.slice(8)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{u.title}</div>
                        <div className="text-[11px] text-faint">{u.sub}</div>
                      </div>
                      <div className="text-right">
                        {u.amount != null && <Money value={u.amount} className="block font-medium" />}
                        <Badge color={u.tone}>{days === 0 ? 'today' : `in ${days}d`}</Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">No FD maturities, insurance renewals or advance-tax dues in the next 90 days.</p>
            )}
          </Card>

          <Card
            title="Recent transactions"
            action={
              <Link to="/transactions" className="text-xs text-accent hover:underline">
                All →
              </Link>
            }
            className="lg:col-span-2 xl:col-span-1"
          >
            <div className="space-y-2">
              {recent.map((t) => {
                const c = t.category ? catMap.get(t.category) : undefined;
                return (
                  <div key={t.id} className="flex items-center gap-3 text-sm">
                    <div
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold"
                      style={{ background: `${c?.color ?? '#64748b'}22`, color: c?.color ?? 'var(--muted)' }}
                    >
                      {(c?.name ?? '?').slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate" title={t.description}>
                        {merchantOf(t.description)}
                      </div>
                      <div className="text-[11px] text-faint">
                        {formatDate(t.date)} · {t.isTransfer ? 'Transfer' : (c?.name ?? 'Uncategorised')}
                      </div>
                    </div>
                    <Money value={t.amount} sign colored className="font-medium" />
                  </div>
                );
              })}
              {!recent.length && <p className="text-sm text-muted">No transactions this FY yet.</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Onboarding({ hasAccount, hasTxns, connected, hasWealth }: { hasAccount: boolean; hasTxns: boolean; connected: boolean; hasWealth: boolean }) {
  const steps: { done: boolean; title: string; body: string; to: string; icon: ReactNode; cta: string }[] = [
    { done: hasAccount, title: 'Add an account', body: 'Savings, salary, credit card or wallet.', to: '/accounts', icon: <Wallet className="size-4" />, cta: 'Add account' },
    { done: hasTxns, title: 'Import a statement', body: 'CSV or Excel export from your bank.', to: '/import', icon: <Upload className="size-4" />, cta: 'Import' },
    { done: connected, title: 'Connect Google Drive', body: 'Private sync & backup in your own Drive.', to: '/settings', icon: <Cloud className="size-4" />, cta: 'Connect' },
    { done: hasWealth, title: 'Add assets & loans', body: 'FDs, funds, stocks, PPF, loans…', to: '/assets', icon: <Plus className="size-4" />, cta: 'Add' },
  ];
  return (
    <div className="card relative mb-5 overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-accent/20 blur-3xl" />
      <h2 className="text-lg font-semibold">
        Welcome to <span className="gradient-text">Nova</span>
      </h2>
      <p className="mb-4 text-sm text-muted">A few steps to build your complete financial picture. Everything stays on this device and in your own Google Drive.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <Link key={s.title} to={s.to} className={`rounded-xl border p-3 transition hover:border-accent/60 ${s.done ? 'border-pos/30 bg-pos/5' : 'border-line bg-surface-2/50'}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`grid size-7 place-items-center rounded-lg ${s.done ? 'bg-pos/20 text-pos' : 'bg-accent/15 text-accent'}`}>{s.done ? '✓' : s.icon}</span>
              <span className="text-xs text-faint">Step {i + 1}</span>
            </div>
            <div className="text-sm font-medium">{s.title}</div>
            <div className="text-xs text-muted">{s.body}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
