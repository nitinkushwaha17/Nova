import { HeartPulse, LifeBuoy, PiggyBank, Plus, Shield, Sparkles, Target, Trash2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, confirmAction, Dot, Empty, Field, IconButton, Input, Modal, Money, NumberInput, PageHeader, Progress, Select, Stat, Tabs, toast, Toggle } from '../components/ui';
import { addMonths, daysBetween, formatDate, fyOf, monthLabel, monthsBetween, todayISO } from '../lib/dates';
import { PALETTE } from '../lib/defaults';
import { requiredSip } from '../lib/finance';
import { money, pct, uid } from '../lib/format';
import { accountBalances, ASSET_TYPES, assetMetrics } from '../lib/portfolio';
import { useCatMap, useStore } from '../store';
import type { Goal, InsurancePolicy, MonthSummary, SummariesDoc } from '../types';

type Section = 'budgets' | 'goals' | 'emergency' | 'insurance';

const ym = (d: string) => d.slice(0, 7);
function monthSummary(s: SummariesDoc, month: string): MonthSummary | undefined {
  return s[fyOf(`${month}-01`)]?.months[month];
}
function prevMonths(month: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => ym(addMonths(`${month}-01`, -(i + 1))));
}

export default function Planning() {
  const [section, setSection] = useState<Section>('budgets');
  return (
    <>
      <PageHeader
        title="Planning"
        subtitle="Budgets, goals, your safety net and insurance cover."
        actions={
          <Tabs
            value={section}
            onChange={setSection}
            options={[
              { value: 'budgets', label: 'Budgets' },
              { value: 'goals', label: 'Goals' },
              { value: 'emergency', label: 'Emergency fund' },
              { value: 'insurance', label: 'Insurance' },
            ]}
          />
        }
      />
      {section === 'budgets' && <Budgets />}
      {section === 'goals' && <Goals />}
      {section === 'emergency' && <Emergency />}
      {section === 'insurance' && <Insurance />}
    </>
  );
}

// ─── Budgets ────────────────────────────────────────────────────────────────

function Budgets() {
  const budgets = useStore((s) => s.planning.budgets);
  const summaries = useStore((s) => s.summaries);
  const cats = useStore((s) => s.meta.categories);
  const catMap = useCatMap();
  const update = useStore((s) => s.update);
  const today = todayISO();
  const months = useMemo(() => {
    const set = new Set<string>([ym(today)]);
    for (const f of Object.values(summaries)) for (const m of Object.keys(f.months)) set.add(m);
    return [...set].sort().reverse();
  }, [summaries, today]);
  const [month, setMonth] = useState(ym(today));
  const [newCat, setNewCat] = useState('');
  const [newLimit, setNewLimit] = useState(0);

  const actual = monthSummary(summaries, month)?.expenseByCategory ?? {};
  const avg3 = (cat: string) => prevMonths(month, 3).reduce((s, m) => s + (monthSummary(summaries, m)?.expenseByCategory[cat] ?? 0), 0) / 3;
  const isCurrent = month === ym(today);
  const dim = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
  const pace = isCurrent ? +today.slice(8, 10) / dim : 1;

  const expenseCats = cats.filter((c) => c.kind === 'expense');
  const unbudgeted = expenseCats.filter((c) => !budgets.some((b) => b.category === c.id));
  const totalLimit = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const totalSpent = budgets.reduce((s, b) => s + Math.max(0, actual[b.category] ?? 0), 0);
  const allSpent = Object.values(actual).reduce((s, v) => s + Math.max(0, v), 0);

  const setBudgets = (fn: (b: typeof budgets) => typeof budgets) => update('planning', (d) => ({ ...d, budgets: fn(d.budgets) }));

  const suggest = () => {
    const add = unbudgeted
      .map((c) => ({ c, v: avg3(c.id) }))
      .filter((x) => x.v >= 500)
      .map((x) => ({ id: uid('bud'), category: x.c.id, monthlyLimit: Math.ceil(x.v / 500) * 500 }));
    if (!add.length) return toast('Not enough spending history in the last 3 months', 'info');
    setBudgets((b) => [...b, ...add]);
    toast(`Added ${add.length} budgets from your 3-month average`);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Budgeted" value={<Money value={totalLimit} />} sub={`${budgets.length} categories`} icon={<Wallet className="size-4" />} />
        <Stat label="Spent in budgeted" value={<Money value={totalSpent} />} sub={totalLimit ? `${pct(totalSpent / totalLimit, 0)} of budget` : undefined} tone={totalSpent > totalLimit ? 'neg' : undefined} />
        <Stat label="Left" value={<Money value={totalLimit - totalSpent} colored />} sub={isCurrent ? `${dim - +today.slice(8, 10)} days to go` : monthLabel(month, 'long')} />
        <Stat label="All spending" value={<Money value={allSpent} />} sub="Including categories without a budget" />
      </div>

      <Card
        className="mt-4"
        title={
          <div className="flex items-center gap-3 whitespace-nowrap">
            Budgets for
            <Select value={month} onChange={(e) => setMonth(e.target.value)} className="!h-8 !w-auto !py-0 text-sm">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, 'long')}
                </option>
              ))}
            </Select>
          </div>
        }
        action={
          <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} onClick={suggest}>
            Suggest from history
          </Button>
        }
      >
        {budgets.length === 0 ? (
          <Empty icon={<Wallet className="size-6" />} title="No budgets yet">
            Add a monthly limit per category, or let Nova suggest limits from your last 3 months.
          </Empty>
        ) : (
          <div className="space-y-4">
            {budgets
              .map((b) => ({ b, spent: Math.max(0, actual[b.category] ?? 0) }))
              .sort((x, y) => y.spent / (y.b.monthlyLimit || 1) - x.spent / (x.b.monthlyLimit || 1))
              .map(({ b, spent }) => {
                const c = catMap.get(b.category);
                const ratio = b.monthlyLimit ? spent / b.monthlyLimit : 0;
                const over = ratio > 1;
                const ahead = !over && isCurrent && ratio > pace + 0.1;
                return (
                  <div key={b.id} className="group">
                    <div className="mb-1.5 flex items-center gap-3 text-sm">
                      <Dot color={c?.color ?? '#94a3b8'} />
                      <span className="font-medium">{c?.name ?? b.category}</span>
                      {over && <Badge color="#fb7185">Over by {money(spent - b.monthlyLimit)}</Badge>}
                      {ahead && <Badge color="#fbbf24">Ahead of pace</Badge>}
                      <span className="ml-auto tabular text-muted">
                        <Money value={spent} /> /{' '}
                      </span>
                      <NumberInput
                        value={b.monthlyLimit}
                        onChange={(v) => setBudgets((all) => all.map((x) => (x.id === b.id ? { ...x, monthlyLimit: v } : x)))}
                        className="h-7 w-28 text-right"
                      />
                      <IconButton title="Remove" className="opacity-0 group-hover:opacity-100" onClick={() => setBudgets((all) => all.filter((x) => x.id !== b.id))}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                    <div className="relative">
                      <Progress value={ratio} color={over ? '#fb7185' : ahead ? '#fbbf24' : c?.color} className="h-2" />
                      {isCurrent && <div className="absolute top-[-2px] h-3 w-px bg-fg/50" style={{ left: `${pace * 100}%` }} title="Today" />}
                    </div>
                    <div className="mt-1 text-xs text-faint">3-month average {money(avg3(b.category))}</div>
                  </div>
                );
              })}
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <Field label="Category" className="min-w-48">
            <Select value={newCat} onChange={(e) => setNewCat(e.target.value)}>
              <option value="">Choose…</option>
              {unbudgeted.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monthly limit" hint={newCat ? `3-month average ${money(avg3(newCat))}` : undefined}>
            <NumberInput value={newLimit} onChange={setNewLimit} />
          </Field>
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            disabled={!newCat || newLimit <= 0}
            onClick={() => {
              setBudgets((b) => [...b, { id: uid('bud'), category: newCat, monthlyLimit: newLimit }]);
              setNewCat('');
              setNewLimit(0);
            }}
          >
            Add budget
          </Button>
        </div>
      </Card>
    </>
  );
}

// ─── Goals ──────────────────────────────────────────────────────────────────

function useAssetValue() {
  const assets = useStore((s) => s.portfolio.assets);
  const navs = useStore((s) => s.navs);
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.id, assetMetrics(a, navs).value);
    return m;
  }, [assets, navs]);
}

function goalMath(g: Goal, values: Map<string, number>, inflation: number, today: string) {
  const saved = g.manualSaved + g.linkedAssetIds.reduce((s, id) => s + (values.get(id) ?? 0), 0);
  const months = Math.max(0, monthsBetween(today, g.targetDate));
  const target = g.inflationAdjust ? g.targetAmount * Math.pow(1 + inflation, months / 12) : g.targetAmount;
  const sip = requiredSip(target, saved, g.expectedReturn / 100, months);
  return { saved, months, target, sip, progress: target ? saved / target : 0 };
}

function Goals() {
  const goals = useStore((s) => s.planning.goals);
  const inflation = useStore((s) => s.cpi.defaultRate) / 100;
  const values = useAssetValue();
  const [edit, setEdit] = useState<Goal | null>(null);
  const today = todayISO();
  const rows = goals.map((g) => ({ g, ...goalMath(g, values, inflation, today) })).sort((a, b) => a.g.targetDate.localeCompare(b.g.targetDate));
  const totalSip = rows.reduce((s, r) => s + r.sip, 0);

  const blank = (): Goal => ({
    id: uid('goal'),
    name: '',
    targetAmount: 1000000,
    targetDate: addMonths(today, 60),
    inflationAdjust: true,
    expectedReturn: 10,
    linkedAssetIds: [],
    manualSaved: 0,
    color: PALETTE[goals.length % PALETTE.length],
    createdAt: new Date().toISOString(),
  });

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Goals" value={goals.length} icon={<Target className="size-4" />} />
        <Stat label="Saved towards goals" value={<Money value={rows.reduce((s, r) => s + r.saved, 0)} short />} />
        <Stat label="Needed at target dates" value={<Money value={rows.reduce((s, r) => s + r.target, 0)} short />} sub="Inflated where you chose" />
        <Stat label="Monthly SIP needed" value={<Money value={totalSip} />} sub="Across all goals" tone="accent" />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(blank())}>
          New goal
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="mt-3">
          <Empty icon={<Target className="size-6" />} title="No goals yet">
            Retirement, a house, a car, a child's education: set a target and date, link the assets set aside for it, and see the monthly SIP you need.
          </Empty>
        </Card>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ g, saved, months, target, sip, progress }) => (
            <button key={g.id} onClick={() => setEdit(g)} className="card animate-in p-4 text-left transition hover:border-accent/50">
              <div className="flex items-center gap-2">
                <Dot color={g.color} />
                <span className="font-semibold">{g.name || 'Untitled goal'}</span>
                {progress >= 1 && <Badge color="#34d399">Funded</Badge>}
                <span className="ml-auto text-xs text-muted">{formatDate(g.targetDate)}</span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <Money value={saved} short className="text-xl font-semibold" />
                <span className="text-sm text-muted">
                  of <Money value={target} short />
                </span>
              </div>
              <Progress value={progress} color={g.color} className="mt-2 h-2" />
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted">Monthly SIP needed</div>
                  <div className="text-sm font-medium tabular">{money(sip)}</div>
                </div>
                <div>
                  <div className="text-muted">Time left</div>
                  <div className="text-sm font-medium">{months >= 12 ? `${Math.floor(months / 12)}y ${months % 12}m` : `${months}m`}</div>
                </div>
              </div>
              {g.inflationAdjust && <div className="mt-2 text-xs text-faint">{money(g.targetAmount)} in today's money, at {pct(inflation)} inflation</div>}
            </button>
          ))}
        </div>
      )}
      {edit && <GoalModal key={edit.id} goal={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function GoalModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const assets = useStore((s) => s.portfolio.assets).filter((a) => !a.closed);
  const exists = useStore((s) => s.planning.goals.some((g) => g.id === goal.id));
  const update = useStore((s) => s.update);
  const inflation = useStore((s) => s.cpi.defaultRate) / 100;
  const values = useAssetValue();
  const [g, setG] = useState(goal);
  const set = (p: Partial<Goal>) => setG((x) => ({ ...x, ...p }));
  const m = goalMath(g, values, inflation, todayISO());

  const save = () => {
    if (!g.name.trim()) return toast('Give the goal a name', 'error');
    update('planning', (d) => ({ ...d, goals: exists ? d.goals.map((x) => (x.id === g.id ? g : x)) : [...d.goals, g] }));
    onClose();
  };
  const remove = async () => {
    if (!(await confirmAction(`Delete goal "${g.name}"?`))) return;
    update('planning', (d) => ({ ...d, goals: d.goals.filter((x) => x.id !== g.id) }));
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={exists ? 'Edit goal' : 'New goal'}
      footer={
        <>
          {exists && (
            <Button variant="danger" className="mr-auto" icon={<Trash2 className="size-4" />} onClick={remove}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={g.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Retirement, House down payment" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={g.inflationAdjust ? "Target (today's money)" : 'Target amount'}>
            <NumberInput value={g.targetAmount} onChange={(v) => set({ targetAmount: v })} />
          </Field>
          <Field label="Target date">
            <Input type="date" value={g.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
          </Field>
          <Field label="Expected return % p.a.">
            <NumberInput value={g.expectedReturn} onChange={(v) => set({ expectedReturn: v })} />
          </Field>
          <Field label="Other savings for this goal" hint="Not tracked as an asset">
            <NumberInput value={g.manualSaved} onChange={(v) => set({ manualSaved: v })} />
          </Field>
        </div>
        <Toggle checked={g.inflationAdjust} onChange={(v) => set({ inflationAdjust: v })} label="Target is in today's money (grow it with inflation)" />
        <Field label="Linked assets" hint="Their current value counts towards this goal">
          <div className="max-h-44 space-y-1 overflow-auto rounded-xl border border-line p-2">
            {assets.length === 0 && <div className="p-2 text-sm text-muted">No assets yet</div>}
            {assets.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="accent-violet-500"
                  checked={g.linkedAssetIds.includes(a.id)}
                  onChange={(e) => set({ linkedAssetIds: e.target.checked ? [...g.linkedAssetIds, a.id] : g.linkedAssetIds.filter((x) => x !== a.id) })}
                />
                <Dot color={ASSET_TYPES[a.type].color} />
                {a.name}
                <Money value={values.get(a.id)} short className="ml-auto text-muted" />
              </label>
            ))}
          </div>
        </Field>
        <div className="flex gap-2">
          {PALETTE.map((c) => (
            <button key={c} onClick={() => set({ color: c })} className={`size-6 rounded-full ring-offset-2 ring-offset-surface ${g.color === c ? 'ring-2 ring-fg' : ''}`} style={{ background: c }} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <div>
            <div className="text-xs text-muted">Needed then</div>
            <Money value={m.target} short />
          </div>
          <div>
            <div className="text-xs text-muted">Saved now</div>
            <Money value={m.saved} short />
          </div>
          <div>
            <div className="text-xs text-muted">SIP / month</div>
            <Money value={m.sip} className="font-semibold text-accent" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Emergency fund ─────────────────────────────────────────────────────────

function Emergency() {
  const planning = useStore((s) => s.planning);
  const assets = useStore((s) => s.portfolio.assets).filter((a) => !a.closed);
  const accounts = useStore((s) => s.meta.accounts);
  const summaries = useStore((s) => s.summaries);
  const update = useStore((s) => s.update);
  const values = useAssetValue();
  const balances = useMemo(() => accountBalances(accounts, summaries), [accounts, summaries]);
  const today = todayISO();

  const recent = prevMonths(ym(today), 6).map((m) => monthSummary(summaries, m)?.expense ?? 0);
  const withData = recent.filter((v) => v > 0);
  const [manual, setManual] = useState<number | null>(null);
  const avgExpense = manual ?? (withData.length ? withData.reduce((s, v) => s + v, 0) / withData.length : 0);

  const sources = [
    ...accounts.filter((a) => a.type !== 'credit_card').map((a) => ({ id: a.id, name: a.name, kind: 'Bank account', value: balances[a.id]?.balance ?? 0 })),
    ...assets.map((a) => ({ id: a.id, name: a.name, kind: ASSET_TYPES[a.type].label, value: values.get(a.id) ?? 0 })),
  ];
  const selected = sources.filter((s) => planning.emergencyAssetIds.includes(s.id));
  const available = selected.reduce((s, x) => s + x.value, 0);
  const target = avgExpense * planning.emergencyMonths;
  const covered = avgExpense ? available / avgExpense : 0;

  const toggle = (id: string, on: boolean) =>
    update('planning', (d) => ({ ...d, emergencyAssetIds: on ? [...d.emergencyAssetIds, id] : d.emergencyAssetIds.filter((x) => x !== id) }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly expenses" value={<Money value={avgExpense} />} sub={manual !== null ? 'Entered manually' : withData.length ? `Average of last ${withData.length} months` : 'No history, enter below'} />
        <Stat label="Target" value={<Money value={target} short />} sub={`${planning.emergencyMonths} months of expenses`} icon={<LifeBuoy className="size-4" />} />
        <Stat label="Set aside" value={<Money value={available} short />} sub={`${selected.length} source${selected.length === 1 ? '' : 's'}`} icon={<PiggyBank className="size-4" />} />
        <Stat label="Covers" value={`${covered.toFixed(1)} months`} sub={available >= target ? 'Fully funded' : `Short by ${money(target - available)}`} tone={available >= target ? 'pos' : 'neg'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Settings">
          <div className="space-y-4">
            <Field label={`Months of cover · ${planning.emergencyMonths}`} hint="6 is typical; 9–12 if income is irregular or you have dependants">
              <input
                type="range"
                className="w-full accent-violet-500"
                min={1}
                max={24}
                value={planning.emergencyMonths}
                onChange={(e) => update('planning', (d) => ({ ...d, emergencyMonths: +e.target.value }))}
              />
            </Field>
            <Field label="Monthly expenses override" hint="Leave empty to use your statement average">
              <Input type="number" value={manual ?? ''} placeholder={Math.round(avgExpense).toString()} onChange={(e) => setManual(e.target.value === '' ? null : +e.target.value)} />
            </Field>
            <Progress value={target ? available / target : 0} className="h-3" color={available >= target ? '#34d399' : undefined} />
            <div className="text-center text-sm text-muted">{target ? pct(Math.min(1, available / target), 0) : '—'} funded</div>
          </div>
        </Card>
        <Card title="What counts as your emergency fund" className="lg:col-span-2">
          {sources.length === 0 ? (
            <p className="text-sm text-muted">Add bank accounts or assets (savings, liquid funds, FDs) first.</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {sources.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-2">
                  <input type="checkbox" className="accent-violet-500" checked={planning.emergencyAssetIds.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{s.kind}</div>
                  </div>
                  <Money value={s.value} short className="ml-auto text-sm" />
                </label>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-faint">Pick money you can reach within a few days: savings accounts, sweep FDs, liquid or overnight funds.</p>
        </Card>
      </div>
    </>
  );
}

// ─── Insurance ──────────────────────────────────────────────────────────────

const KINDS: Record<InsurancePolicy['kind'], { label: string; color: string }> = {
  term: { label: 'Term life', color: '#818cf8' },
  health: { label: 'Health', color: '#34d399' },
  life: { label: 'Life / endowment', color: '#c084fc' },
  vehicle: { label: 'Vehicle', color: '#fbbf24' },
  home: { label: 'Home', color: '#22d3ee' },
  other: { label: 'Other', color: '#94a3b8' },
};
const PER_YEAR: Record<InsurancePolicy['frequency'], number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1, single: 0 };

function nextRenewal(p: InsurancePolicy, today: string): string | undefined {
  if (!p.renewalDate || p.frequency === 'single') return p.renewalDate;
  let d = p.renewalDate;
  const step = 12 / PER_YEAR[p.frequency];
  for (let i = 0; d < today && i < 600; i++) d = addMonths(d, step);
  return d;
}

function Insurance() {
  const policies = useStore((s) => s.planning.insurance);
  const summaries = useStore((s) => s.summaries);
  const [edit, setEdit] = useState<InsurancePolicy | null>(null);
  const today = todayISO();

  const annualIncome = prevMonths(ym(today), 12).reduce((s, m) => s + (monthSummary(summaries, m)?.income ?? 0), 0);
  const cover = (k: InsurancePolicy['kind']) => policies.filter((p) => p.kind === k).reduce((s, p) => s + p.sumAssured, 0);
  const premiums = policies.reduce((s, p) => s + p.premium * PER_YEAR[p.frequency], 0);
  const termCover = cover('term') + cover('life');
  const termNeed = annualIncome * 10;
  const health = cover('health');

  const blank = (): InsurancePolicy => ({ id: uid('ins'), kind: 'term', name: '', sumAssured: 0, premium: 0, frequency: 'yearly' });

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Policies" value={policies.length} icon={<Shield className="size-4" />} />
        <Stat label="Yearly premiums" value={<Money value={premiums} />} sub={annualIncome ? `${pct(premiums / annualIncome)} of income` : undefined} />
        <Stat
          label="Life cover"
          value={<Money value={termCover} short />}
          sub={annualIncome ? (termCover >= termNeed ? '≥ 10× annual income ✓' : `Rule of thumb: ${money(termNeed)} (10× income)`) : 'Aim for 10–15× annual income'}
          tone={annualIncome && termCover < termNeed ? 'neg' : 'pos'}
        />
        <Stat
          label="Health cover"
          value={<Money value={health} short />}
          sub={health >= 1000000 ? 'Good for a metro family' : 'Consider ₹10L+ (base + super top-up)'}
          icon={<HeartPulse className="size-4" />}
          tone={health >= 1000000 ? 'pos' : 'neg'}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(blank())}>
          Add policy
        </Button>
      </div>

      <Card className="mt-3" pad={false}>
        {policies.length === 0 ? (
          <div className="p-4">
            <Empty icon={<Shield className="size-6" />} title="No policies yet">
              Track term, health, vehicle and other policies with their renewal dates. Upcoming renewals show on the dashboard.
            </Empty>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Policy</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Cover</th>
                <th className="px-4 py-2 text-right font-medium">Premium</th>
                <th className="px-4 py-2 font-medium">Next renewal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...policies]
                .sort((a, b) => (nextRenewal(a, today) ?? '9').localeCompare(nextRenewal(b, today) ?? '9'))
                .map((p) => {
                  const nr = nextRenewal(p, today);
                  const days = nr ? daysBetween(today, nr) : null;
                  return (
                    <tr key={p.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit(p)}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted">{[p.insurer, p.policyNumber].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge color={KINDS[p.kind].color}>{KINDS[p.kind].label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={p.sumAssured} short />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={p.premium} /> <span className="text-xs text-muted">{p.frequency === 'single' ? 'once' : `/${p.frequency.replace('_yearly', ' yr').replace('ly', '')}`}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {nr ? (
                          <span className="flex items-center gap-2">
                            {formatDate(nr)}
                            {days !== null && days >= 0 && days <= 30 && <Badge color="#fbbf24">in {days}d</Badge>}
                            {days !== null && days < 0 && <Badge color="#94a3b8">ended</Badge>}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <PolicyModal key={edit.id} policy={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PolicyModal({ policy, onClose }: { policy: InsurancePolicy; onClose: () => void }) {
  const exists = useStore((s) => s.planning.insurance.some((p) => p.id === policy.id));
  const update = useStore((s) => s.update);
  const [p, setP] = useState(policy);
  const set = (x: Partial<InsurancePolicy>) => setP((v) => ({ ...v, ...x }));

  const save = () => {
    if (!p.name.trim()) return toast('Give the policy a name', 'error');
    update('planning', (d) => ({ ...d, insurance: exists ? d.insurance.map((x) => (x.id === p.id ? p : x)) : [...d.insurance, p] }));
    onClose();
  };
  const remove = async () => {
    if (!(await confirmAction(`Delete policy "${p.name}"?`))) return;
    update('planning', (d) => ({ ...d, insurance: d.insurance.filter((x) => x.id !== p.id) }));
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={exists ? 'Edit policy' : 'Add policy'}
      footer={
        <>
          {exists && (
            <Button variant="danger" className="mr-auto" icon={<Trash2 className="size-4" />} onClick={remove}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. HDFC Click 2 Protect" autoFocus />
        </Field>
        <Field label="Type">
          <Select value={p.kind} onChange={(e) => set({ kind: e.target.value as InsurancePolicy['kind'] })}>
            {Object.entries(KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Insurer">
          <Input value={p.insurer ?? ''} onChange={(e) => set({ insurer: e.target.value })} />
        </Field>
        <Field label="Policy number">
          <Input value={p.policyNumber ?? ''} onChange={(e) => set({ policyNumber: e.target.value })} />
        </Field>
        <Field label="Sum assured / cover">
          <NumberInput value={p.sumAssured} onChange={(v) => set({ sumAssured: v })} />
        </Field>
        <Field label="Premium">
          <NumberInput value={p.premium} onChange={(v) => set({ premium: v })} />
        </Field>
        <Field label="Paid">
          <Select value={p.frequency} onChange={(e) => set({ frequency: e.target.value as InsurancePolicy['frequency'] })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="half_yearly">Half-yearly</option>
            <option value="yearly">Yearly</option>
            <option value="single">Single premium</option>
          </Select>
        </Field>
        <Field label="Renewal / due date" className="col-span-2" hint="Any past due date works; the next one is worked out from the frequency">
          <Input type="date" value={p.renewalDate ?? ''} onChange={(e) => set({ renewalDate: e.target.value || undefined })} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Input value={p.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
