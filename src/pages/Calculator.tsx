import { Calculator as CalcIcon, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, Card, ChartTooltip, Field, Money, NumberInput, PageHeader, Select, Stat, Tabs } from '../components/ui';
import { compoundSchedule, realReturn } from '../lib/finance';
import { money, pct } from '../lib/format';
import { useStore } from '../store';

type Mode = 'grow' | 'goal';

function Slider({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return <input type="range" className="w-full accent-violet-500" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />;
}

export default function Calculator() {
  const defaultInflation = useStore((s) => s.cpi.defaultRate);
  const [mode, setMode] = useState<Mode>('grow');
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);
  const [comp, setComp] = useState(12);
  const [sip, setSip] = useState(10000);
  const [stepUp, setStepUp] = useState(0);
  const [inflation, setInflation] = useState<number | null>(null);
  const [target, setTarget] = useState(10000000);
  const [targetReal, setTargetReal] = useState(true);
  const infl = inflation ?? defaultInflation;

  const goalTarget = targetReal ? target * Math.pow(1 + infl / 100, years) : target;
  const neededSip = useMemo(() => {
    if (mode !== 'goal') return 0;
    // Final value is linear in SIP, so solve exactly against the same schedule used for display
    const base = compoundSchedule(principal, rate, years, comp, 0, infl).at(-1)!.nominalValue;
    const perRupee = compoundSchedule(0, rate, years, comp, 1, infl).at(-1)!.nominalValue;
    return Math.max(0, (goalTarget - base) / perRupee);
  }, [mode, principal, rate, years, comp, infl, goalTarget]);
  const effSip = mode === 'goal' ? neededSip : sip;
  const effStep = mode === 'goal' ? 0 : stepUp;

  const rows = useMemo(() => compoundSchedule(principal, rate, years, comp, effSip, infl, effStep), [principal, rate, years, comp, effSip, infl, effStep]);
  const last = rows[rows.length - 1];
  const chart = [
    { year: 0, nominal: principal, real: principal, invested: principal },
    ...rows.map((r) => ({ year: r.year, nominal: Math.round(r.nominalValue), real: Math.round(r.realValue), invested: Math.round(r.totalInvested) })),
  ];
  const realRate = realReturn(rate / 100, infl / 100);

  return (
    <>
      <PageHeader
        title="Growth calculator"
        subtitle="Compound growth of a lump sum and monthly SIP, with step-ups, shown both as a number on paper and in today's money."
        actions={
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: 'grow', label: 'How much will I have?' },
              { value: 'goal', label: 'How much to invest?' },
            ]}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={mode === 'grow' ? 'Inputs' : 'Your goal'} className="lg:col-span-1">
          <div className="space-y-4">
            {mode === 'goal' && (
              <>
                <Field label="Target amount" hint={targetReal ? `≈ ${money(goalTarget)} in ${years} years after inflation` : undefined}>
                  <NumberInput value={target} onChange={setTarget} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={targetReal} onChange={(e) => setTargetReal(e.target.checked)} className="accent-violet-500" /> Target is in today's money
                </label>
              </>
            )}
            <Field label={mode === 'goal' ? 'Already saved' : 'Lump sum today'}>
              <NumberInput value={principal} onChange={setPrincipal} />
            </Field>
            {mode === 'grow' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Monthly SIP">
                  <NumberInput value={sip} onChange={setSip} />
                </Field>
                <Field label="Yearly step-up %">
                  <NumberInput value={stepUp} onChange={setStepUp} />
                </Field>
              </div>
            )}
            <Field label={`Expected return · ${rate}% p.a.`}>
              <Slider value={rate} onChange={setRate} min={1} max={30} step={0.5} />
            </Field>
            <Field label={`Duration · ${years} year${years === 1 ? '' : 's'}`}>
              <Slider value={years} onChange={setYears} min={1} max={50} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Compounding">
                <Select value={comp} onChange={(e) => setComp(+e.target.value)}>
                  <option value={1}>Yearly</option>
                  <option value={2}>Half-yearly</option>
                  <option value={4}>Quarterly</option>
                  <option value={12}>Monthly</option>
                </Select>
              </Field>
              <Field label="Inflation %" hint={inflation === null ? 'Your default rate' : undefined}>
                <NumberInput value={infl} onChange={setInflation} />
              </Field>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
              Real return ≈ <span className={realRate < 0 ? 'text-neg' : 'text-pos'}>{pct(realRate)}</span> per year after {infl}% inflation.
            </div>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {mode === 'goal' ? (
              <Stat label="Monthly SIP needed" value={<Money value={neededSip} />} sub={`for ${years} years at ${rate}%`} icon={<Target className="size-4" />} tone="accent" />
            ) : (
              <Stat label="Final amount" value={<Money value={last?.nominalValue} short />} sub="On paper" icon={<CalcIcon className="size-4" />} tone="accent" />
            )}
            <Stat label="Total invested" value={<Money value={last?.totalInvested} short />} sub={`Gain ${money(last?.interestEarned ?? 0)}`} />
            <Stat label="In today's money" value={<Money value={last?.realValue} short />} sub={`Inflation eats ${money(last?.inflationEaten ?? 0)}`} tone="neg" />
            <Stat
              label="Real gain"
              value={<Money value={last?.realGain} short sign colored />}
              sub={`vs ${money(last?.realCostBasis ?? 0)} invested in today's ₹`}
              tone={last && last.realGain < 0 ? 'neg' : 'pos'}
            />
          </div>

          <Card title="Growth over time">
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ left: -4, right: 8 }}>
                  <defs>
                    <linearGradient id="calcNom" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={(y) => `Y${y}`} />
                  <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v) => money(v)} />} labelFormatter={(y) => `Year ${y}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area dataKey="nominal" name="Value on paper" stroke="#818cf8" fill="url(#calcNom)" strokeWidth={2} />
                  <Line dataKey="real" name="In today's money" stroke="#22d3ee" dot={false} strokeWidth={2} />
                  <Line dataKey="invested" name="Invested" stroke="#94a3b8" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Year by year" className="mt-4" pad={false}>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 text-right font-medium">Invested</th>
                <th className="px-4 py-2 text-right font-medium">Gain</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
                <th className="px-4 py-2 text-right font-medium">In today's ₹</th>
                <th className="px-4 py-2 text-right font-medium">Real gain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.year}>
                  <td className="px-4 py-2 text-muted">{r.year}</td>
                  <td className="px-4 py-2 text-right">
                    <Money value={r.totalInvested} />
                  </td>
                  <td className="px-4 py-2 text-right text-pos">
                    <Money value={r.interestEarned} />
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    <Money value={r.nominalValue} />
                  </td>
                  <td className="px-4 py-2 text-right text-accent">
                    <Money value={r.realValue} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={r.realGain} colored />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
