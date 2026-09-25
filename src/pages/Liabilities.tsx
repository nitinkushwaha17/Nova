import { ChevronDown, CreditCard, Landmark, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LiabilityModal } from '../components/LiabilityModal';
import { axisMoney, Badge, Button, Card, ChartTooltip, Dot, Empty, Field, Money, NumberInput, PageHeader, Progress, Stat } from '../components/ui';
import { loanStatus } from '../lib/finance';
import { formatDate, monthsBetween, todayISO } from '../lib/dates';
import { pct } from '../lib/format';
import { accountBalances, LIABILITY_TYPES, liabilityOutstanding } from '../lib/portfolio';
import { useStore } from '../store';
import type { Liability, LiabilityType } from '../types';

export default function Liabilities() {
  const liabilities = useStore((s) => s.liabilities.liabilities);
  const accounts = useStore((s) => s.meta.accounts);
  const summaries = useStore((s) => s.summaries);
  const [edit, setEdit] = useState<Liability | undefined>();
  const [newType, setNewType] = useState<LiabilityType>('home_loan');
  const [open, setOpen] = useState(false);

  const cardAccounts = useMemo(() => {
    const bal = accountBalances(accounts, summaries);
    return accounts.filter((a) => a.type === 'credit_card' && a.includeInNetWorth && !a.archived).map((a) => ({ a, outstanding: Math.abs(bal[a.id]?.balance ?? 0), date: bal[a.id]?.date }));
  }, [accounts, summaries]);

  const active = liabilities.filter((l) => !l.closed);
  const total = active.reduce((s, l) => s + liabilityOutstanding(l), 0) + cardAccounts.reduce((s, c) => s + c.outstanding, 0);
  const monthlyEmi = active.reduce((s, l) => s + (l.loan ? loanStatus(l.loan).emi * (liabilityOutstanding(l) > 0 ? 1 : 0) : 0), 0);
  const interestLeft = active.reduce((s, l) => {
    if (!l.loan) return s;
    const st = loanStatus(l.loan);
    return s + st.totalInterest - st.interestPaid;
  }, 0);

  const add = (t: LiabilityType) => {
    setEdit(undefined);
    setNewType(t);
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Liabilities"
        subtitle="Loans, credit cards and anything you owe"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => add('home_loan')}>
            Add liability
          </Button>
        }
      />
      {!liabilities.length && !cardAccounts.length ? (
        <div className="card">
          <Empty
            icon={<Landmark />}
            title="Debt-free? Nice."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {(['home_loan', 'car_loan', 'personal_loan', 'education_loan', 'credit_card'] as LiabilityType[]).map((t) => (
                  <Button key={t} size="sm" icon={<Plus className="size-3.5" />} onClick={() => add(t)}>
                    {LIABILITY_TYPES[t].label}
                  </Button>
                ))}
              </div>
            }
          >
            Otherwise add your loans — Nova computes the amortisation schedule, outstanding principal and how much prepayments save you.
          </Empty>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Stat label="Total outstanding" value={<Money value={total} />} icon={<Landmark className="size-4" />} tone="neg" />
            <Stat label="Monthly EMIs" value={<Money value={monthlyEmi} />} />
            <Stat label="Interest still to pay" value={<Money value={interestLeft} />} sub="At current schedules" className="col-span-2 lg:col-span-1" />
          </div>

          {active.concat(liabilities.filter((l) => l.closed)).map((l) =>
            l.loan ? (
              <LoanCard key={l.id} l={l} onEdit={() => (setEdit(l), setOpen(true))} />
            ) : (
              <Card key={l.id} className={l.closed ? 'opacity-60' : ''}>
                <button className="flex w-full items-center gap-3 text-left" onClick={() => (setEdit(l), setOpen(true))}>
                  <Dot color={LIABILITY_TYPES[l.type].color} />
                  <div className="flex-1">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-faint">
                      {LIABILITY_TYPES[l.type].label}
                      {l.lender ? ` · ${l.lender}` : ''}
                      {l.valuations.length ? ` · updated ${formatDate([...l.valuations].sort((a, b) => b.date.localeCompare(a.date))[0].date)}` : ' · no balance entered'}
                    </div>
                  </div>
                  <Money value={liabilityOutstanding(l)} className="text-lg font-semibold" />
                </button>
              </Card>
            ),
          )}

          {cardAccounts.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><CreditCard className="size-4" /> Credit card accounts</span>}>
              <div className="space-y-2">
                {cardAccounts.map(({ a, outstanding, date }) => (
                  <div key={a.id} className="flex items-center gap-3 text-sm">
                    <span className="flex-1">{a.name}</span>
                    <span className="text-xs text-faint">{date ? `as of ${formatDate(date)}` : 'no balance yet'}</span>
                    <Money value={outstanding} className="font-medium" />
                  </div>
                ))}
                <p className="text-[11px] text-faint">From the latest statement balance of credit-card accounts (Accounts page).</p>
              </div>
            </Card>
          )}
        </div>
      )}
      <LiabilityModal open={open} onClose={() => setOpen(false)} initial={edit} newType={newType} />
    </>
  );
}

function LoanCard({ l, onEdit }: { l: Liability; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [extra, setExtra] = useState(100000);
  const loan = l.loan!;
  const st = useMemo(() => loanStatus(loan), [loan]);
  const base = useMemo(() => (loan.prepayments.length ? loanStatus({ ...loan, prepayments: [] }) : null), [loan]);
  const outstanding = liabilityOutstanding(l);
  const today = todayISO();
  const whatIf = useMemo(() => {
    if (!extra || outstanding <= 0) return null;
    const sim = loanStatus({ ...loan, prepayments: [...loan.prepayments, { id: 'sim', date: today, amount: extra }] });
    return { interestSaved: st.totalInterest - sim.totalInterest, monthsSaved: st.schedule.length - sim.schedule.length };
  }, [extra, loan, st, outstanding, today]);
  const yearly = useMemo(() => {
    const m = new Map<string, { year: string; interest: number; principal: number; balance: number }>();
    for (const r of st.schedule) {
      const y = r.date.slice(0, 4);
      const cur = m.get(y) ?? { year: y, interest: 0, principal: 0, balance: 0 };
      cur.interest += r.interest;
      cur.principal += r.principal + r.prepayment;
      cur.balance = r.balance;
      m.set(y, cur);
    }
    return [...m.values()];
  }, [st]);
  const chart = useMemo(() => st.schedule.filter((_, i) => i % 3 === 0).map((r) => ({ label: r.date.slice(0, 7), balance: Math.round(r.balance) })), [st]);
  const repaid = loan.principal ? 1 - outstanding / loan.principal : 0;

  return (
    <Card className={l.closed ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-start gap-4">
        <button className="min-w-48 flex-1 text-left" onClick={onEdit}>
          <div className="flex items-center gap-2">
            <Dot color={LIABILITY_TYPES[l.type].color} />
            <span className="font-medium">{l.name}</span>
            <Badge>{LIABILITY_TYPES[l.type].label}</Badge>
            {l.closed && <Badge color="#34d399">Closed</Badge>}
          </div>
          <div className="mt-1 text-xs text-faint">
            {[l.lender, `${loan.rate}% p.a.`, `${(loan.tenureMonths / 12).toFixed(1)} yrs`, `since ${formatDate(loan.startDate)}`].filter(Boolean).join(' · ')}
          </div>
        </button>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <KV label="Outstanding" value={<Money value={outstanding} className="font-semibold text-neg" />} />
          <KV label="EMI" value={<Money value={st.emi} />} />
          <KV label="EMIs left" value={`${st.remainingEmis}`} sub={`ends ${formatDate(st.endDate)}`} />
          <KV label="Interest paid" value={<Money value={st.interestPaid} short />} sub={<>of <Money value={st.totalInterest} short /></>} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Progress value={repaid} className="flex-1" color="linear-gradient(90deg,#34d399,#22d3ee)" />
        <span className="text-xs text-muted">{pct(repaid, 0)} repaid</span>
        <button className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => setExpanded((x) => !x)}>
          Schedule <ChevronDown className={`size-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {base && (
        <p className="mt-2 text-xs text-pos">
          Prepayments so far save <Money value={base.totalInterest - st.totalInterest} /> interest and {base.schedule.length - st.schedule.length} EMIs.
        </p>
      )}
      {expanded && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="h-52">
              <ResponsiveContainer>
                <AreaChart data={chart} margin={{ left: -10, right: 4, top: 4 }}>
                  <defs>
                    <linearGradient id={`lg-${l.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f87171" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area dataKey="balance" name="Balance" stroke="#f87171" fill={`url(#lg-${l.id})`} strokeWidth={2} type="monotone" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Year</th>
                    <th className="px-3 py-2 text-right font-medium">Principal</th>
                    <th className="px-3 py-2 text-right font-medium">Interest</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {yearly.map((y) => (
                    <tr key={y.year} className={`border-t border-line/60 ${y.year === today.slice(0, 4) ? 'bg-accent/10' : ''}`}>
                      <td className="px-3 py-1.5">{y.year}</td>
                      <td className="px-3 py-1.5 text-right"><Money value={y.principal} /></td>
                      <td className="px-3 py-1.5 text-right"><Money value={y.interest} /></td>
                      <td className="px-3 py-1.5 text-right"><Money value={y.balance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-4">
            <h4 className="mb-3 text-sm font-semibold">What if I prepay today?</h4>
            <Field label="Prepayment amount">
              <NumberInput value={extra} onChange={setExtra} />
            </Field>
            {whatIf && (
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Interest saved</span>
                  <Money value={whatIf.interestSaved} className="font-semibold text-pos" />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Tenure reduced by</span>
                  <span className="font-semibold">
                    {whatIf.monthsSaved} months ({(whatIf.monthsSaved / 12).toFixed(1)} yrs)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Effective return</span>
                  <span className="font-semibold">{loan.rate}% guaranteed (loan rate)</span>
                </div>
                <p className="pt-2 text-[11px] text-faint">
                  {monthsBetween(today, st.endDate)} months remain on the current schedule. Compare the loan rate with your expected post-tax investment return before prepaying.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function KV({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tabular">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}
