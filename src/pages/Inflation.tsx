import { ArrowRight, Flame, RotateCcw, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, Badge, Button, Card, ChartTooltip, Field, Input, Money, NumberInput, PageHeader, Stat, confirmAction } from '../components/ui';
import { useNetWorth } from '../hooks';
import { currentFY, fyRange, fyStartYear, monthLabel, shiftFY, todayISO } from '../lib/dates';
import { DEFAULT_CPI } from '../lib/defaults';
import { realReturn } from '../lib/finance';
import { money, pct } from '../lib/format';
import { adjustForInflation, annualisedInflation, inflationBetween, rateFor } from '../lib/inflation';
import { ASSET_TYPES, assetMetrics, isDeposit } from '../lib/portfolio';
import { useStore } from '../store';
import type { Asset, FY } from '../types';

const yearsAgo = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};

function holdingStart(a: Asset): string | null {
  if (isDeposit(a)) return a.deposit!.startDate;
  const dates = [...a.flows.map((f) => f.date), ...a.valuations.map((v) => v.date)].sort();
  return dates[0] ?? null;
}

export default function Inflation() {
  const cpi = useStore((s) => s.cpi);
  const update = useStore((s) => s.update);
  const assets = useStore((s) => s.portfolio.assets);
  const navs = useStore((s) => s.navs);
  const summaries = useStore((s) => s.summaries);
  const snapshots = useStore((s) => s.networth.snapshots);
  const nw = useNetWorth();
  const today = todayISO();
  const fy = currentFY();

  const fyList = useMemo(() => {
    const keys = new Set<FY>([...Object.keys(cpi.rates), ...Object.keys(summaries)]);
    let f: FY = '2012-13';
    while (fyStartYear(f) <= fyStartYear(fy)) {
      keys.add(f);
      f = shiftFY(f, 1);
    }
    return [...keys].sort();
  }, [cpi.rates, summaries, fy]);

  const rateChart = fyList.map((f) => ({ fy: f.slice(2), rate: +(rateFor(cpi, f) * 100).toFixed(2), assumed: cpi.rates[f] === undefined }));

  const i5 = annualisedInflation(cpi, yearsAgo(5), today);
  const i10 = annualisedInflation(cpi, yearsAgo(10), today);
  const lakh10 = adjustForInflation(cpi, 100000, yearsAgo(10), today);

  // Money time machine
  const [amt, setAmt] = useState(100000);
  const [from, setFrom] = useState(yearsAgo(10));
  const [to, setTo] = useState(today);
  const converted = from && to ? adjustForInflation(cpi, amt, from, to) : 0;

  // Real returns
  const realRows = useMemo(
    () =>
      assets
        .filter((a) => !a.closed)
        .map((a) => {
          const m = assetMetrics(a, navs, today);
          const start = holdingStart(a);
          const infl = start && start < today ? annualisedInflation(cpi, start, today) : rateFor(cpi, fy);
          const real = m.xirr !== null ? realReturn(m.xirr, infl) : null;
          const realInvested = start ? adjustForInflation(cpi, m.invested, start, today) : m.invested;
          return { a, m, start, infl, real, realInvested };
        })
        .filter((r) => r.m.value > 0)
        .sort((x, y) => (x.real ?? -9) - (y.real ?? -9)),
    [assets, navs, cpi, today, fy],
  );

  // Spending in today's money per FY (each month adjusted from its mid-point)
  const spendRows = useMemo(
    () =>
      Object.entries(summaries)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, s]) => {
          let nominal = 0;
          let real = 0;
          for (const [ym, m] of Object.entries(s.months)) {
            nominal += m.expense;
            real += adjustForInflation(cpi, m.expense, `${ym}-15`, today);
          }
          return { fy: f, nominal: Math.round(nominal), real: Math.round(real), months: Object.keys(s.months).length };
        })
        .filter((r) => r.nominal > 0),
    [summaries, cpi, today],
  );

  // Net worth in today's money
  const sortedSnaps = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  const firstSnap = sortedSnaps[0];
  const nwReal = firstSnap ? adjustForInflation(cpi, firstSnap.netWorth, firstSnap.date, today) : null;
  const nwChart = sortedSnaps.map((s) => ({ label: monthLabel(s.month), nominal: Math.round(s.netWorth), real: Math.round(adjustForInflation(cpi, s.netWorth, s.date, today)) }));

  const setRate = (f: FY, v: number | undefined) =>
    update('cpi', (d) => {
      const rates = { ...d.rates };
      if (v === undefined || Number.isNaN(v)) delete rates[f];
      else rates[f] = v;
      return { ...d, rates };
    });

  return (
    <>
      <PageHeader
        title="Inflation"
        subtitle="What your money is really worth. Every rupee today buys less than it did before; this page shows by how much."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={
            <>
              Inflation<span className="hidden sm:inline"> · FY {fy}</span>
            </>
          }
          value={pct(rateFor(cpi, fy))}
          sub={cpi.rates[fy] === undefined ? 'Assumed (default rate)' : 'From your CPI table'}
          icon={<Flame className="size-4" />}
          tone="neg"
        />
        <Stat label="Average · last 5 years" value={pct(i5)} sub={`Prices up ${pct(inflationBetween(cpi, yearsAgo(5), today), 0)} overall`} />
        <Stat label="Average · last 10 years" value={pct(i10)} sub={`Prices up ${pct(inflationBetween(cpi, yearsAgo(10), today), 0)} overall`} />
        <Stat label="₹1 lakh from 10 years ago" value={<Money value={lakh10} />} sub="is what you'd need today for the same things" icon={<TrendingDown className="size-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Money time machine" className="lg:col-span-1">
          <div className="space-y-3">
            <Field label="Amount">
              <NumberInput value={amt} onChange={setAmt} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="In money of">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Is worth in">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-muted">
                <Money value={amt} short /> <ArrowRight className="size-4" />
              </div>
              <div className="mt-1 text-2xl font-semibold text-accent tabular">
                <Money value={converted} />
              </div>
              <div className="mt-1 text-xs text-muted">
                {from && to && (converted >= amt ? `Prices ${from < to ? 'rose' : 'fell'} ${pct(Math.abs(converted / amt - 1), 1)}` : `Purchasing power ${pct(converted / amt - 1, 1)}`)}
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="CPI inflation by financial year"
          className="lg:col-span-2"
          action={<span className="text-xs text-muted">Faded bars use your default rate</span>}
        >
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={rateChart} margin={{ left: -20, right: 4, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="fy" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: 'var(--surface-2)' }} />
                <ReferenceLine y={cpi.defaultRate} stroke="var(--muted)" strokeDasharray="4 4" />
                <Bar dataKey="rate" name="Inflation" radius={[4, 4, 0, 0]}>
                  {rateChart.map((r) => (
                    <Cell key={r.fy} fill="#fb7185" fillOpacity={r.assumed ? 0.35 : 0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Real returns on your assets" className="mt-4" action={<span className="text-xs text-muted">Real = (1 + XIRR) ÷ (1 + inflation over holding period) − 1</span>}>
        {realRows.length === 0 ? (
          <p className="text-sm text-muted">Add assets with contributions to see whether they beat inflation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Asset</th>
                  <th className="py-2 text-right font-medium">Value</th>
                  <th className="py-2 text-right font-medium">Invested</th>
                  <th className="py-2 text-right font-medium">Invested in today's ₹</th>
                  <th className="py-2 text-right font-medium">XIRR</th>
                  <th className="py-2 text-right font-medium">Inflation</th>
                  <th className="py-2 text-right font-medium">Real return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {realRows.map(({ a, m, infl, real, realInvested }) => (
                  <tr key={a.id}>
                    <td className="py-2">
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted">{ASSET_TYPES[a.type].label}</div>
                    </td>
                    <td className="py-2 text-right">
                      <Money value={m.value} short />
                    </td>
                    <td className="py-2 text-right text-muted">
                      <Money value={m.invested} short />
                    </td>
                    <td className="py-2 text-right">
                      <Money value={realInvested} short className={m.value < realInvested ? 'text-neg' : undefined} />
                    </td>
                    <td className="py-2 text-right tabular">{m.xirr === null ? '—' : pct(m.xirr)}</td>
                    <td className="py-2 text-right tabular text-muted">{pct(infl)}</td>
                    <td className="py-2 text-right">
                      {real === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <Badge color={real < 0 ? '#fb7185' : real < 0.02 ? '#fbbf24' : '#34d399'}>{(real > 0 ? '+' : '') + pct(real)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Net worth in today's money">
          {nwChart.length < 2 ? (
            <p className="text-sm text-muted">Needs at least two monthly snapshots. They're taken automatically; you can also backfill them on the Net worth page.</p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted">Nominal growth since {monthLabel(firstSnap!.month)}</div>
                  <Money value={nw.netWorth - firstSnap!.netWorth} short sign colored className="text-lg font-semibold" />
                </div>
                <div>
                  <div className="text-xs text-muted">Real growth (after inflation)</div>
                  <Money value={nw.netWorth - nwReal!} short sign colored className="text-lg font-semibold" />
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer>
                  <ComposedChart data={nwChart} margin={{ left: -10, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip formatter={(v) => money(v)} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line dataKey="nominal" name="As recorded" stroke="#94a3b8" strokeDasharray="4 4" dot={false} strokeWidth={2} />
                    <Line dataKey="real" name="In today's money" stroke="#818cf8" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Card>

        <Card title="Spending in today's money">
          {spendRows.length === 0 ? (
            <p className="text-sm text-muted">Import bank statements to compare your spending across years after adjusting for inflation.</p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={spendRows} margin={{ left: -10, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="fy" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip formatter={(v) => money(v)} />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="nominal" name="As spent" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="real" name="In today's money" fill="#fb7185" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                {spendRows.some((r) => r.months < 12) && 'Some years have fewer than 12 months of data. '}Each month is adjusted from its mid-point to today.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card
        title="Your CPI table"
        className="mt-4"
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="size-3.5" />}
            onClick={async () => {
              if (await confirmAction('Reset CPI rates to the built-in estimates?')) update('cpi', () => DEFAULT_CPI);
            }}
          >
            Reset
          </Button>
        }
      >
        <p className="mb-3 text-sm text-muted">
          Annual CPI (combined) inflation per financial year, in percent. Pre-filled with approximate official figures; recent years are estimates, so update them as MOSPI publishes data. Years left blank use the default rate.
        </p>
        <div className="mb-4 max-w-xs">
          <Field label="Default rate (future / missing years)">
            <NumberInput value={cpi.defaultRate} onChange={(v) => update('cpi', (d) => ({ ...d, defaultRate: v }))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[...fyList, shiftFY(fy, 1)].map((f) => (
            <label key={f} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
              <div className="text-xs text-muted">
                FY {f} {f > fy && <span className="text-faint">(future)</span>}
              </div>
              <input
                className="w-full bg-transparent text-sm font-medium tabular outline-none placeholder:text-faint"
                inputMode="decimal"
                placeholder={`${cpi.defaultRate}`}
                defaultValue={cpi.rates[f] ?? ''}
                key={`${f}-${cpi.rates[f] ?? ''}`}
                onBlur={(e) => setRate(f, e.target.value.trim() === '' ? undefined : parseFloat(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          FY {fy} runs {fyRange(fy).start} to {fyRange(fy).end}. Within a year, inflation compounds smoothly day by day.
        </p>
      </Card>
    </>
  );
}
