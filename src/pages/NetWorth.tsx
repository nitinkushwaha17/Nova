import { Camera, Landmark, Plus, Scale, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, Button, Card, ChartTooltip, confirmAction, Dot, Field, IconButton, Input, Modal, Money, NumberInput, PageHeader, Progress, Stat, Tabs, toast } from '../components/ui';
import { useNetWorth } from '../hooks';
import { endOfMonth, formatDate, monthLabel, todayISO } from '../lib/dates';
import { pct } from '../lib/format';
import { adjustForInflation } from '../lib/inflation';
import { accountBalances, ASSET_TYPES, LIABILITY_TYPES, upsertSnapshot } from '../lib/portfolio';
import { useStore } from '../store';
import type { AssetType, LiabilityType, NetWorthSnapshot } from '../types';

export default function NetWorth() {
  const nw = useNetWorth();
  const snapshots = useStore((s) => s.networth.snapshots);
  const accounts = useStore((s) => s.meta.accounts);
  const summaries = useStore((s) => s.summaries);
  const cpi = useStore((s) => s.cpi);
  const update = useStore((s) => s.update);
  const takeSnapshot = useStore((s) => s.takeSnapshot);
  const [mode, setMode] = useState<'nominal' | 'real'>('nominal');
  const [addOpen, setAddOpen] = useState(false);
  const today = todayISO();

  const sorted = useMemo(() => [...snapshots].sort((a, b) => a.month.localeCompare(b.month)), [snapshots]);
  const chart = useMemo(
    () =>
      sorted.map((s) => {
        const f = mode === 'real' ? adjustForInflation(cpi, 1, s.date, today) : 1;
        return { label: monthLabel(s.month), assets: Math.round(s.assets * f), liabilities: -Math.round(s.liabilities * f), netWorth: Math.round(s.netWorth * f) };
      }),
    [sorted, mode, cpi, today],
  );

  const ago = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return [...sorted].reverse().find((s) => s.month <= ym);
  };
  const m1 = ago(1);
  const y1 = ago(12);
  const first = sorted[0];
  const realChange = (s?: NetWorthSnapshot) => (s ? nw.netWorth - adjustForInflation(cpi, s.netWorth, s.date, today) : null);

  const balances = useMemo(() => accountBalances(accounts, summaries), [accounts, summaries]);
  const assetRows = (Object.entries(nw.byAssetType) as [AssetType | 'bank', number][]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const liabRows = (Object.entries(nw.byLiabilityType) as [LiabilityType, number][]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Net worth"
        subtitle="Everything you own minus everything you owe. A snapshot is saved automatically each month."
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
              Add past month
            </Button>
            <Button
              variant="primary"
              icon={<Camera className="size-4" />}
              onClick={() => {
                takeSnapshot();
                toast(`Snapshot saved for ${monthLabel(today.slice(0, 7), 'long')}`);
              }}
            >
              Snapshot now
            </Button>
          </>
        }
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Net worth" value={<Money value={nw.netWorth} />} icon={<Scale className="size-4" />} tone="accent" />
          <Stat label="Assets" value={<Money value={nw.assets} />} sub={`${pct(nw.bank / (nw.assets || 1))} in bank accounts`} icon={<TrendingUp className="size-4" />} tone="pos" />
          <Stat label="Liabilities" value={<Money value={nw.liabilities} />} sub={`Debt-to-assets ${pct(nw.assets ? nw.liabilities / nw.assets : 0)}`} icon={<Landmark className="size-4" />} tone="neg" />
          <Stat
            label="Growth · 12 months"
            value={y1 ? <Money value={nw.netWorth - y1.netWorth} sign colored /> : '—'}
            sub={y1 ? <>Real (after inflation) <Money value={realChange(y1)} sign colored short /></> : 'Needs a snapshot from a year ago'}
          />
        </div>

        <Card title="History" action={<Tabs value={mode} onChange={setMode} options={[{ value: 'nominal', label: 'Nominal' }, { value: 'real', label: "Today's money" }]} />}>
          {sorted.length > 1 ? (
            <div className="h-80">
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ left: -10, right: 4, top: 4 }} stackOffset="sign">
                  <defs>
                    <linearGradient id="nw-a" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="nw-l" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="#f87171" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#f87171" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={60} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Area dataKey="assets" name="Assets" stroke="#34d399" fill="url(#nw-a)" strokeWidth={1.5} type="monotone" />
                  <Area dataKey="liabilities" name="Liabilities" stroke="#f87171" fill="url(#nw-l)" strokeWidth={1.5} type="monotone" />
                  <Line dataKey="netWorth" name="Net worth" stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 2 }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted">
              History builds up automatically as months pass. Use <b>Add past month</b> to backfill earlier net-worth figures.
            </p>
          )}
          {sorted.length > 1 && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Change label={m1 ? `vs ${monthLabel(m1.month)}` : ''} from={m1} now={nw.netWorth} />
              <Change label={y1 ? `vs ${monthLabel(y1.month)} (1 yr)` : ''} from={y1 !== m1 ? y1 : undefined} now={nw.netWorth} />
              <Change label={first ? `since ${monthLabel(first.month)}` : 'since start'} from={first} now={nw.netWorth} real={realChange(first)} />
            </div>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="What you own">
            <div className="space-y-3">
              {assetRows.map(([k, v]) => {
                const meta = k === 'bank' ? { label: 'Bank & cash accounts', color: '#94a3b8' } : ASSET_TYPES[k];
                return (
                  <div key={k}>
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      <Dot color={meta.color} />
                      <span className="flex-1">{meta.label}</span>
                      <span className="text-xs text-faint">{pct(v / nw.assets)}</span>
                      <Money value={v} className="w-28 text-right font-medium" />
                    </div>
                    <Progress value={v / nw.assets} color={meta.color} />
                    {k === 'bank' && (
                      <div className="mt-2 space-y-1 pl-5">
                        {accounts
                          .filter((a) => a.includeInNetWorth && !a.archived && a.type !== 'credit_card')
                          .map((a) => (
                            <div key={a.id} className="flex items-center gap-2 text-xs text-muted">
                              <span className="flex-1">{a.name}</span>
                              <span className="text-faint">{balances[a.id] ? formatDate(balances[a.id].date) : 'no balance'}</span>
                              <Money value={balances[a.id]?.balance ?? 0} className="w-28 text-right" />
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!assetRows.length && <p className="text-sm text-muted">No assets yet.</p>}
            </div>
          </Card>
          <Card title="What you owe">
            <div className="space-y-3">
              {liabRows.map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1 flex items-center gap-2 text-sm">
                    <Dot color={LIABILITY_TYPES[k].color} />
                    <span className="flex-1">{LIABILITY_TYPES[k].label}</span>
                    <Money value={v} className="w-28 text-right font-medium" />
                  </div>
                  <Progress value={nw.liabilities ? v / nw.liabilities : 0} color={LIABILITY_TYPES[k].color} />
                </div>
              ))}
              {!liabRows.length && <p className="text-sm text-muted">No liabilities. 🎉</p>}
            </div>
          </Card>
        </div>

        {sorted.length > 0 && (
          <Card title="Snapshots" pad={false}>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-[11px] text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 text-left font-medium">Month</th>
                    <th className="px-3 py-2 text-right font-medium">Assets</th>
                    <th className="px-3 py-2 text-right font-medium">Liabilities</th>
                    <th className="px-3 py-2 text-right font-medium">Net worth</th>
                    <th className="px-3 py-2 text-right font-medium">Change</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {[...sorted].reverse().map((s, i, arr) => {
                    const prev = arr[i + 1];
                    return (
                      <tr key={s.month} className="border-b border-line/60 last:border-0">
                        <td className="px-5 py-2">{monthLabel(s.month, 'long')}</td>
                        <td className="px-3 py-2 text-right"><Money value={s.assets} /></td>
                        <td className="px-3 py-2 text-right"><Money value={s.liabilities} /></td>
                        <td className="px-3 py-2 text-right font-medium"><Money value={s.netWorth} /></td>
                        <td className="px-3 py-2 text-right">{prev ? <Money value={s.netWorth - prev.netWorth} sign colored short /> : '—'}</td>
                        <td className="px-2">
                          <IconButton
                            title="Delete snapshot"
                            onClick={() => confirmAction(`Delete snapshot for ${monthLabel(s.month, 'long')}?`) && update('networth', (d) => ({ snapshots: d.snapshots.filter((x) => x.month !== s.month) }))}
                          >
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
      <PastSnapshotModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function Change({ label, from, now, real }: { label: string; from?: NetWorthSnapshot; now: number; real?: number | null }) {
  if (!from) return null;
  const d = now - from.netWorth;
  return (
    <div className="rounded-xl bg-surface-2/60 p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <Money value={d} sign colored className="font-semibold" />
      <span className="ml-2 text-xs text-faint">{from.netWorth ? pct(d / Math.abs(from.netWorth)) : ''}</span>
      {real != null && (
        <div className="text-[11px] text-faint">
          Real: <Money value={real} sign short />
        </div>
      )}
    </div>
  );
}

function PastSnapshotModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const update = useStore((s) => s.update);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [assets, setAssets] = useState(0);
  const [liabilities, setLiabilities] = useState(0);
  const save = () => {
    if (!month) return;
    update('networth', (d) => ({
      snapshots: upsertSnapshot(d.snapshots, { month, date: endOfMonth(month), assets, liabilities, netWorth: assets - liabilities, byAssetType: {} }),
    }));
    toast(`Saved ${monthLabel(month, 'long')}`);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a past month"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!month || month >= todayISO().slice(0, 7)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Month">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={todayISO().slice(0, 7)} />
        </Field>
        <Field label="Total assets">
          <NumberInput value={assets} onChange={setAssets} />
        </Field>
        <Field label="Total liabilities">
          <NumberInput value={liabilities} onChange={setLiabilities} />
        </Field>
      </div>
      <p className="mt-3 text-sm text-muted">
        Net worth <Money value={assets - liabilities} className="font-semibold text-fg" />. Replaces any existing snapshot for that month.
      </p>
    </Modal>
  );
}
