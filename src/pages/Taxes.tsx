import { Calculator, Landmark, Plus, Receipt, Scale, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, Badge, Button, Card, ChartTooltip, Dot, Field, IconButton, Input, Money, NumberInput, PageHeader, Select, Spinner, Stat, Tabs, toast, Toggle, cx } from '../components/ui';
import { loanStatus } from '../lib/finance';
import { currentFY, formatDate, fyRange, shiftFY, todayISO } from '../lib/dates';
import { pct, uid } from '../lib/format';
import { estimateGST } from '../lib/gst';
import { advanceTaxSchedule, computeTax, hraExemption, LIMITS, SUPPORTED_NOTE, type RegimeResult } from '../lib/tax';
import { classify } from '../lib/transactions';
import { useCatMap, useKnownFYs, useStore } from '../store';
import type { AgeBand, FY, Regime, TaxPayment, TaxYear } from '../types';

const PAYMENT_KINDS: Record<TaxPayment['kind'], string> = { tds: 'TDS', tcs: 'TCS', advance: 'Advance tax', self_assessment: 'Self-assessment' };

export default function Taxes() {
  const known = useKnownFYs();
  const [fy, setFy] = useState<FY>(currentFY());
  const fyOptions = useMemo(() => [...new Set([shiftFY(currentFY(), 1), ...known, currentFY(), shiftFY(currentFY(), -1)])].sort().reverse(), [known]);
  const taxByFY = useStore((s) => s.taxByFY);
  const ensureTax = useStore((s) => s.ensureTax);
  const saveTax = useStore((s) => s.saveTax);
  const ensureFYs = useStore((s) => s.ensureFYs);
  const txByFY = useStore((s) => s.txByFY);
  const liabilities = useStore((s) => s.liabilities.liabilities);
  const assets = useStore((s) => s.portfolio.assets);
  const summaries = useStore((s) => s.summaries);
  const catMap = useCatMap();

  useEffect(() => {
    void ensureTax(fy);
    void ensureFYs([fy]);
  }, [fy, ensureTax, ensureFYs]);
  useEffect(() => {
    for (const f of known) void ensureTax(f);
  }, [known, ensureTax]);

  const t = taxByFY[fy];
  const txns = txByFY[fy];
  const r = useMemo(() => (t ? computeTax(t) : null), [t]);
  const gst = useMemo(() => (txns ? estimateGST(txns, catMap, (x) => classify(x, x.category ? catMap.get(x.category) : undefined) === 'expense') : null), [txns, catMap]);
  const history = useMemo(
    () =>
      Object.values(taxByFY)
        .filter((x) => x.income.salary || x.income.otherSources || x.income.business || x.payments.length)
        .map((x) => ({ fy: x.fy, direct: Math.round(computeTax(x).chosen.totalTax) }))
        .sort((a, b) => a.fy.localeCompare(b.fy)),
    [taxByFY],
  );

  if (!t || !r) {
    return (
      <div className="grid h-60 place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  const set = (fn: (x: TaxYear) => TaxYear) => saveTax(fn(t));
  const setIncome = (k: keyof TaxYear['income'], v: number) => set((x) => ({ ...x, income: { ...x.income, [k]: v } }));
  const setCG = (k: keyof TaxYear['capitalGains'], v: number) => set((x) => ({ ...x, capitalGains: { ...x.capitalGains, [k]: v } }));
  const setDed = (k: keyof TaxYear['deductions'], v: number) => set((x) => ({ ...x, deductions: { ...x.deductions, [k]: v } }));

  const { start, end } = fyRange(fy);
  const today = todayISO();
  const withheld = t.payments.filter((p) => p.kind === 'tds' || p.kind === 'tcs').reduce((s, p) => s + p.amount, 0);
  const advPaid = (by: string) => t.payments.filter((p) => (p.kind === 'advance' || p.kind === 'self_assessment') && p.date <= by).reduce((s, p) => s + p.amount, 0);
  const advLiability = r.chosen.totalTax - withheld;
  const schedule = advanceTaxSchedule(fy, Math.max(0, advLiability));
  const income = t.income.salary + t.income.otherSources + t.income.business + Math.max(0, t.income.houseProperty) + Object.values(t.capitalGains).reduce((s, v) => s + v, 0);
  const fyCashIncome = Object.values(summaries[fy]?.months ?? {}).reduce((s, m) => s + m.income, 0);
  const burden = r.chosen.totalTax + (gst?.total ?? 0);

  const suggestFromTxns = () => {
    if (!txns) return;
    const sum = (subs: string[]) => txns.filter((x) => x.amount > 0 && !x.isTransfer && x.category === 'income' && subs.includes(x.subcategory ?? '')).reduce((s, x) => s + x.amount, 0);
    const salary = sum(['Salary', 'Bonus']);
    const other = sum(['Interest', 'Dividend']);
    const rent = sum(['Rental']);
    const freelance = sum(['Freelance']);
    set((x) => ({
      ...x,
      income: {
        salary: x.income.salary || salary,
        otherSources: x.income.otherSources || other,
        houseProperty: x.income.houseProperty || Math.round(rent * 0.7),
        business: x.income.business || freelance,
      },
    }));
    toast(salary ? 'Filled from categorised transactions — salary credits are take-home, so replace with gross salary from Form 16.' : 'Filled what was found in categorised transactions', 'info');
  };

  const loanFacts = () => {
    let interest = 0;
    let principal = 0;
    for (const l of liabilities) {
      if (l.type !== 'home_loan' || !l.loan) continue;
      for (const row of loanStatus(l.loan, end).schedule) {
        if (row.date < start || row.date > end) continue;
        interest += row.interest;
        principal += row.principal;
      }
    }
    return { interest: Math.round(interest), principal: Math.round(principal) };
  };
  const loans = loanFacts();

  const suggest80C = () => {
    const inFY = (d: string) => d >= start && d <= end;
    const retire = assets.filter((a) => a.type === 'ppf' || a.type === 'epf').flatMap((a) => a.flows.filter((f) => inFY(f.date) && f.amount > 0)).reduce((s, f) => s + f.amount, 0);
    const life = (txns ?? []).filter((x) => x.amount < 0 && x.category === 'insurance' && /life/i.test(x.subcategory ?? '')).reduce((s, x) => s - x.amount, 0);
    const total = Math.min(LIMITS.c80, retire + life + loans.principal);
    setDed('c80', total);
    toast(`80C: PPF/EPF ${Math.round(retire)} + life premiums ${Math.round(life)} + home-loan principal ${loans.principal} (capped at 1.5L). Add ELSS, tuition fees etc. manually.`, 'info');
  };

  const addPayment = (p: TaxPayment) => set((x) => ({ ...x, payments: [...x.payments, p] }));
  const removePayment = (id: string) => set((x) => ({ ...x, payments: x.payments.filter((p) => p.id !== id) }));

  return (
    <>
      <PageHeader
        title="Taxes"
        subtitle="Income tax (old vs new regime), advance tax, TDS and indirect taxes"
        actions={
          <>
            <Select value={fy} onChange={(e) => setFy(e.target.value)} className="!w-auto">
              {fyOptions.map((f) => (
                <option key={f} value={f}>
                  FY {f}
                </option>
              ))}
            </Select>
            <Tabs
              value={t.preferredRegime}
              onChange={(v) => set((x) => ({ ...x, preferredRegime: v }))}
              options={[
                { value: 'auto', label: 'Best regime' },
                { value: 'new', label: 'New' },
                { value: 'old', label: 'Old' },
              ]}
            />
          </>
        }
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label={`Income tax · ${r.chosen.regime} regime`}
            value={<Money value={r.chosen.totalTax} />}
            sub={`Effective ${pct(r.chosen.effectiveRate)} of gross income`}
            icon={<Landmark className="size-4" />}
            tone="accent"
          />
          <Stat
            label="Better regime"
            value={<span className="capitalize">{r.better} regime</span>}
            sub={r.saving ? <>Saves <Money value={r.saving} /></> : 'Both regimes cost the same'}
            icon={<Scale className="size-4" />}
            tone="pos"
          />
          <Stat label="Paid so far" value={<Money value={r.paid} />} sub={`TDS/TCS ${Math.round(withheld).toLocaleString('en-IN')} · others ${Math.round(r.paid - withheld).toLocaleString('en-IN')}`} icon={<Receipt className="size-4" />} />
          <Stat
            label={r.balance > 0 ? 'Still payable' : 'Refund due'}
            value={<Money value={Math.abs(r.balance)} />}
            sub={r.balance > 0 ? 'Pay before filing to avoid 234B/C interest' : r.balance < 0 ? 'Claim in your ITR' : 'All settled'}
            icon={<Calculator className="size-4" />}
            tone={r.balance > 0 ? 'neg' : 'pos'}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
          <div className="space-y-5">
            <Card
              title="Income"
              action={
                <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} onClick={suggestFromTxns} disabled={!txns}>
                  From transactions
                </Button>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Money2 label="Gross salary" hint="Before standard deduction (Form 16 Part B)" value={t.income.salary} onChange={(v) => setIncome('salary', v)} />
                <Money2 label="Other sources" hint="Interest, dividends, family pension" value={t.income.otherSources} onChange={(v) => setIncome('otherSources', v)} />
                <Money2 label="House property (net)" hint="Rent − 30% − municipal tax; negative for self-occupied loan interest in old regime" value={t.income.houseProperty} onChange={(v) => setIncome('houseProperty', v)} allowNeg />
                <Money2 label="Business / profession" hint="Net taxable profit (incl. 44ADA presumptive)" value={t.income.business} onChange={(v) => setIncome('business', v)} />
                <Field label="Age">
                  <Select value={t.ageBand} onChange={(e) => set((x) => ({ ...x, ageBand: e.target.value as AgeBand }))}>
                    <option value="below60">Below 60</option>
                    <option value="60to80">60 – 80 (senior)</option>
                    <option value="above80">80+ (super senior)</option>
                  </Select>
                </Field>
              </div>
              {fyCashIncome > 0 && (
                <p className="mt-3 text-[11px] text-faint">
                  Bank credits categorised as income this FY: <Money value={fyCashIncome} />.
                </p>
              )}
            </Card>

            <Card title="Capital gains">
              <div className="grid gap-4 sm:grid-cols-2">
                <Money2 label="STCG – listed equity / equity MF" hint="Sec 111A · 20% (15% before 23 Jul 2024)" value={t.capitalGains.stcgEquity} onChange={(v) => setCG('stcgEquity', v)} allowNeg />
                <Money2 label="LTCG – listed equity / equity MF" hint="Sec 112A · 12.5% above ₹1.25L exemption" value={t.capitalGains.ltcgEquity} onChange={(v) => setCG('ltcgEquity', v)} allowNeg />
                <Money2 label="STCG – other assets" hint="Debt MF, gold, property < holding period · slab rate" value={t.capitalGains.stcgOther} onChange={(v) => setCG('stcgOther', v)} allowNeg />
                <Money2 label="LTCG – other assets" hint="Sec 112 · 12.5% without indexation" value={t.capitalGains.ltcgOther} onChange={(v) => setCG('ltcgOther', v)} allowNeg />
              </div>
            </Card>

            <Card title="Deductions & exemptions" action={<Badge>Most apply to the old regime only</Badge>}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Money2
                  label={<>80C <Limit v={LIMITS.c80} /></>}
                  hint="EPF, PPF, ELSS, LIC, home-loan principal, tuition"
                  value={t.deductions.c80}
                  onChange={(v) => setDed('c80', v)}
                  action={<SuggestBtn onClick={suggest80C} />}
                />
                <Money2 label={<>80CCD(1B) NPS <Limit v={LIMITS.ccd1b80} /></>} value={t.deductions.ccd1b80} onChange={(v) => setDed('ccd1b80', v)} />
                <Money2 label={<>80CCD(2) employer NPS <Badge color="#34d399">both regimes</Badge></>} value={t.deductions.ccd2Employer80} onChange={(v) => setDed('ccd2Employer80', v)} />
                <Money2 label={<>80D health insurance <Limit v={LIMITS.d80} /></>} hint="Self/family ₹25K (₹50K senior) + parents" value={t.deductions.d80} onChange={(v) => setDed('d80', v)} />
                <Money2
                  label={<>24(b) home-loan interest <Limit v={LIMITS.homeLoanInterest24b} /></>}
                  hint={loans.interest ? `Your home loans: ${Math.round(loans.interest).toLocaleString('en-IN')} interest this FY` : 'Self-occupied property'}
                  value={t.deductions.homeLoanInterest24b}
                  onChange={(v) => setDed('homeLoanInterest24b', v)}
                  action={loans.interest > 0 && <SuggestBtn onClick={() => setDed('homeLoanInterest24b', Math.min(LIMITS.homeLoanInterest24b, loans.interest))} />}
                />
                <Money2 label="HRA exemption" hint="Use the calculator below" value={t.deductions.hraExempt} onChange={(v) => setDed('hraExempt', v)} />
                <Money2 label="80E education-loan interest" value={t.deductions.e80} onChange={(v) => setDed('e80', v)} />
                <Money2 label="80G donations (eligible)" value={t.deductions.g80} onChange={(v) => setDed('g80', v)} />
                <Money2 label={<>80TTA/TTB savings interest <Limit v={t.ageBand === 'below60' ? LIMITS.tta80 : LIMITS.ttb80} /></>} value={t.deductions.tta80} onChange={(v) => setDed('tta80', v)} />
                <Money2 label="Professional tax" value={t.deductions.professionalTax} onChange={(v) => setDed('professionalTax', v)} />
                <Money2 label="Other (80DD, 80U, 80EEA…)" value={t.deductions.other} onChange={(v) => setDed('other', v)} />
              </div>
              <HraHelper key={fy} t={t} onApply={(v, helper) => set((x) => ({ ...x, hraHelper: helper, deductions: { ...x.deductions, hraExempt: v } }))} />
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Old vs new regime">
              <Comparison o={r.old} n={r.new} better={r.better} chosen={r.chosen.regime} />
              <p className="mt-3 text-[11px] text-faint">{SUPPORTED_NOTE}</p>
            </Card>

            <Card title={`Slab breakdown · ${r.chosen.regime} regime`}>
              <div className="space-y-1.5 text-sm">
                {r.chosen.slabs
                  .filter((s) => s.tax > 0 || s.rate === 0)
                  .map((s) => (
                    <div key={s.from} className="flex items-center gap-2">
                      <span className="w-40 text-xs text-muted">
                        {short(s.from)} – {Number.isFinite(s.to) ? short(s.to) : '∞'}
                      </span>
                      <Badge>{pct(s.rate, 0)}</Badge>
                      <span className="flex-1" />
                      <Money value={s.tax} />
                    </div>
                  ))}
                {r.chosen.specialTax > 0 && (
                  <div className="flex items-center gap-2 border-t border-line pt-1.5">
                    <span className="flex-1 text-xs text-muted">Capital gains at special rates</span>
                    <Money value={r.chosen.specialTax} />
                  </div>
                )}
              </div>
            </Card>

            <Card title="Payments" action={<Badge>{t.payments.length}</Badge>}>
              <PaymentForm key={fy} onAdd={addPayment} fy={fy} />
              <div className="mt-3 divide-y divide-line rounded-xl border border-line">
                {[...t.payments]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                      <span className="w-24 text-xs text-muted">{formatDate(p.date)}</span>
                      <Badge>{PAYMENT_KINDS[p.kind]}</Badge>
                      <span className="flex-1 truncate text-xs text-faint">{p.note}</span>
                      <Money value={p.amount} className="font-medium" />
                      <IconButton title="Remove" onClick={() => removePayment(p.id)} className="size-7">
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  ))}
                {!t.payments.length && <p className="px-3 py-3 text-xs text-muted">Add TDS from Form 16 / 26AS / AIS, and any advance or self-assessment tax paid.</p>}
              </div>
            </Card>

            <Card title="Advance tax schedule">
              {advLiability >= 10000 ? (
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-muted uppercase">
                    <tr>
                      <th className="py-1 text-left font-medium">Due by</th>
                      <th className="py-1 text-right font-medium">Cumulative</th>
                      <th className="py-1 text-right font-medium">Paid by then</th>
                      <th className="py-1 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((s) => {
                      const paid = advPaid(s.due);
                      const short = s.amount - paid;
                      const past = s.due < today;
                      return (
                        <tr key={s.due} className="border-t border-line/60">
                          <td className="py-1.5">
                            {formatDate(s.due)} <span className="text-xs text-faint">({pct(s.pct, 0)})</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <Money value={s.amount} />
                          </td>
                          <td className="py-1.5 text-right">
                            <Money value={paid} />
                          </td>
                          <td className="py-1.5 text-right">
                            {short <= 0 ? <Badge color="#34d399">on track</Badge> : past ? <Badge color="#f87171">short <Money value={short} short /></Badge> : <Badge color="#fbbf24">pay <Money value={short} short /></Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">
                  Tax after TDS/TCS is <Money value={Math.max(0, advLiability)} /> — advance tax applies only when it's ₹10,000 or more.
                </p>
              )}
            </Card>

            <Card title={<span className="flex items-center gap-2"><Sparkles className="size-4" /> Total tax burden · FY {fy}</span>}>
              <div className="space-y-2 text-sm">
                <Row label="Income tax (direct)" value={<Money value={r.chosen.totalTax} />} color="#8b5cf6" />
                <Row label="GST on spending (estimated)" value={gst ? <Money value={gst.total} /> : '…'} color="#fb7185" />
                <div className="flex items-center justify-between border-t border-line pt-2 font-semibold">
                  <span>Total</span>
                  <Money value={burden} />
                </div>
                {income > 0 && <p className="text-xs text-muted">That's {pct(burden / income)} of your gross income.</p>}
                <p className="text-[11px] text-faint">GST is estimated from categorised spending in this FY's imported transactions. Other indirect taxes (fuel excise, stamp duty, customs) aren't included.</p>
              </div>
            </Card>

            {history.length > 1 && (
              <Card title="Income tax by year">
                <div className="h-48">
                  <ResponsiveContainer>
                    <BarChart data={history} margin={{ left: -10, right: 4, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="fy" tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="direct" name="Income tax" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function short(n: number) {
  if (n >= 1e7) return `${+(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${+(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString('en-IN');
}

function Limit({ v }: { v: number }) {
  return <span className="text-faint">(max {short(v)})</span>;
}

function SuggestBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-[11px] text-accent hover:underline">
      <Wand2 className="size-3" /> Suggest
    </button>
  );
}

function Money2({ label, hint, value, onChange, allowNeg, action }: { label: ReactNode; hint?: string; value: number; onChange: (v: number) => void; allowNeg?: boolean; action?: ReactNode }) {
  return (
    <Field
      label={
        <span className="flex items-center justify-between gap-2">
          <span>{label}</span>
          {action}
        </span>
      }
      hint={hint}
    >
      <NumberInput value={value} onChange={(v) => onChange(allowNeg ? v : Math.max(0, v))} />
    </Field>
  );
}

function Row({ label, value, color }: { label: string; value: ReactNode; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <Dot color={color} />
      <span className="flex-1 text-muted">{label}</span>
      {value}
    </div>
  );
}

function Comparison({ o, n, better, chosen }: { o: RegimeResult; n: RegimeResult; better: Regime; chosen: Regime }) {
  const rows: [string, (r: RegimeResult) => ReactNode][] = [
    ['Gross total income', (r) => <Money value={r.grossTotalIncome} />],
    ['Deductions', (r) => <Money value={-r.deductions} />],
    ['Taxable income', (r) => <Money value={r.taxableIncome} className="font-medium" />],
    ['Tax at slab rates', (r) => <Money value={r.slabTax} />],
    ['Special-rate tax (CG)', (r) => <Money value={r.specialTax} />],
    ['Rebate u/s 87A', (r) => <Money value={-r.rebate87A} />],
    ['Surcharge', (r) => <Money value={r.surcharge} />],
    ['Health & education cess', (r) => <Money value={r.cess} />],
  ];
  const head = (r: RegimeResult, label: string) => (
    <th className={cx('px-2 py-2 text-right font-medium', r.regime === chosen && 'text-fg')}>
      {label}
      {r.regime === better && <div className="text-[10px] font-normal text-pos">better</div>}
    </th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] text-muted uppercase">
          <tr>
            <th className="py-2 text-left font-medium" />
            {head(o, 'Old')}
            {head(n, 'New')}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-line/60">
              <td className="py-1.5 text-muted">{label}</td>
              <td className="px-2 py-1.5 text-right">{f(o)}</td>
              <td className="px-2 py-1.5 text-right">{f(n)}</td>
            </tr>
          ))}
          <tr className="border-t border-line font-semibold">
            <td className="py-2">Total tax</td>
            <td className={cx('px-2 py-2 text-right', better === 'old' && 'text-pos')}>
              <Money value={o.totalTax} />
            </td>
            <td className={cx('px-2 py-2 text-right', better === 'new' && 'text-pos')}>
              <Money value={n.totalTax} />
            </td>
          </tr>
          <tr>
            <td className="py-1 text-xs text-muted">Effective rate</td>
            <td className="px-2 py-1 text-right text-xs">{pct(o.effectiveRate)}</td>
            <td className="px-2 py-1 text-right text-xs">{pct(n.effectiveRate)}</td>
          </tr>
        </tbody>
      </table>
      {(o.deductionItems.length > 0 || n.deductionItems.length > 0) && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-fg">Deductions applied</summary>
          <div className="mt-2 grid grid-cols-2 gap-4">
            {[o, n].map((r) => (
              <div key={r.regime} className="space-y-1">
                <div className="font-medium text-fg capitalize">{r.regime}</div>
                {r.deductionItems.map((d) => (
                  <div key={d.label} className="flex justify-between gap-2">
                    <span>{d.label}</span>
                    <Money value={d.amount} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function HraHelper({ t, onApply }: { t: TaxYear; onApply: (v: number, helper: NonNullable<TaxYear['hraHelper']>) => void }) {
  const [open, setOpen] = useState(!!t.hraHelper);
  const [h, setH] = useState(t.hraHelper ?? { basicDA: 0, hraReceived: 0, rentPaid: 0, metro: true });
  const v = hraExemption(h.basicDA, h.hraReceived, h.rentPaid, h.metro);
  return (
    <div className="mt-5 rounded-xl border border-line bg-surface-2/40 p-4">
      <button className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setOpen((x) => !x)}>
        HRA exemption calculator <span className="text-xs text-accent">{open ? 'Hide' : 'Open'}</span>
      </button>
      {open && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Basic + DA (annual)">
              <NumberInput value={h.basicDA} onChange={(x) => setH({ ...h, basicDA: x })} />
            </Field>
            <Field label="HRA received (annual)">
              <NumberInput value={h.hraReceived} onChange={(x) => setH({ ...h, hraReceived: x })} />
            </Field>
            <Field label="Rent paid (annual)">
              <NumberInput value={h.rentPaid} onChange={(x) => setH({ ...h, rentPaid: x })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Toggle checked={h.metro} onChange={(m) => setH({ ...h, metro: m })} label="Metro city (Delhi, Mumbai, Kolkata, Chennai)" />
            <div className="flex items-center gap-3 text-sm">
              Exempt: <Money value={v} className="font-semibold" />
              <Button size="sm" variant="primary" onClick={() => onApply(Math.round(v), h)}>
                Use
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-faint">Least of: HRA received · rent − 10% of basic+DA · {h.metro ? '50%' : '40%'} of basic+DA.</p>
        </>
      )}
    </div>
  );
}

function PaymentForm({ onAdd, fy }: { onAdd: (p: TaxPayment) => void; fy: FY }) {
  const [kind, setKind] = useState<TaxPayment['kind']>('tds');
  const [date, setDate] = useState(() => {
    const { end } = fyRange(fy);
    const t = todayISO();
    return t > end ? end : t;
  });
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const add = () => {
    if (!amount) return;
    onAdd({ id: uid('tp'), kind, date, amount, ...(note ? { note } : {}) });
    setAmount(0);
    setNote('');
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={kind} onChange={(e) => setKind(e.target.value as TaxPayment['kind'])} className="!w-36">
        {Object.entries(PAYMENT_KINDS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-40" />
      <NumberInput value={amount} onChange={setAmount} placeholder="Amount" className="!w-32" />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Deductor / challan" className="!w-36 flex-1" />
      <Button size="sm" icon={<Plus className="size-3.5" />} onClick={add} disabled={!amount}>
        Add
      </Button>
    </div>
  );
}

