import { Check, Loader2, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addMonths, formatDate, todayISO } from '../lib/dates';
import { uid } from '../lib/format';
import { searchSchemes, latestNav, type SchemeHit } from '../lib/mf';
import { ASSET_TYPES, assetMetrics, isDeposit } from '../lib/portfolio';
import { useStore } from '../store';
import type { Asset, AssetType, DepositDetails } from '../types';
import { DatedList } from './DatedList';
import { Button, confirmAction, Field, Input, Modal, Money, NumberInput, Select, Tabs, Toggle } from './ui';

export function newAsset(type: AssetType = 'fd'): Asset {
  return { id: uid('as'), type, name: '', valuations: [], flows: [], createdAt: new Date().toISOString() };
}

function defaultDeposit(): DepositDetails {
  const start = todayISO();
  return { principal: 100000, rate: 7, startDate: start, maturityDate: addMonths(start, 12), compounding: 4, payout: 'cumulative' };
}

type Tab = 'details' | 'flows' | 'valuations';

function freshAsset(type: AssetType = 'fd'): Asset {
  const a = newAsset(type);
  if (type === 'fd') a.deposit = defaultDeposit();
  if (type === 'rd') a.deposit = { ...defaultDeposit(), principal: 0, installment: 5000 };
  if (type === 'mutual_fund') a.mf = { units: 0 };
  return a;
}

export function AssetModal({ open, onClose, initial, newType }: { open: boolean; onClose: () => void; initial?: Asset; newType?: AssetType }) {
  const update = useStore((s) => s.update);
  const navs = useStore((s) => s.navs);
  const [a, setA] = useState<Asset>(initial ?? freshAsset(newType));
  const [tab, setTab] = useState<Tab>('details');
  const [prev, setPrev] = useState({ initial, open });
  if (prev.initial !== initial || prev.open !== open) {
    setPrev({ initial, open });
    if (open) {
      setA(initial ?? freshAsset(newType));
      setTab('details');
    }
  }
  const set = (p: Partial<Asset>) => setA((x) => ({ ...x, ...p }));
  const setDep = (p: Partial<DepositDetails>) => setA((x) => ({ ...x, deposit: { ...(x.deposit ?? defaultDeposit()), ...p } }));
  const deposit = a.type === 'fd' || a.type === 'rd';
  const isMF = a.type === 'mutual_fund';

  const changeType = (type: AssetType) => {
    setA((x) => ({
      ...x,
      type,
      deposit: type === 'fd' || type === 'rd' ? (x.deposit ?? { ...defaultDeposit(), ...(type === 'rd' ? { installment: 5000, principal: 0 } : {}) }) : undefined,
      mf: type === 'mutual_fund' ? (x.mf ?? { units: 0 }) : undefined,
    }));
  };

  const valid = a.name.trim() && (!deposit || (a.deposit && a.deposit.maturityDate > a.deposit.startDate));
  const save = () => {
    if (!valid) return;
    const clean = { ...a, name: a.name.trim() };
    update('portfolio', (d) => ({ assets: d.assets.some((x) => x.id === a.id) ? d.assets.map((x) => (x.id === a.id ? clean : x)) : [...d.assets, clean] }));
    onClose();
  };
  const remove = () => {
    if (!confirmAction(`Delete "${a.name}"?`)) return;
    update('portfolio', (d) => ({ assets: d.assets.filter((x) => x.id !== a.id) }));
    onClose();
  };

  const m = valid || a.flows.length || a.valuations.length ? assetMetrics(a, navs) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={initial ? `Edit ${ASSET_TYPES[a.type].label.toLowerCase()}` : 'Add asset'}
      footer={
        <>
          {initial && (
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={remove} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check className="size-4" />} onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      {!deposit && (
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-4"
          options={[
            { value: 'details', label: 'Details' },
            { value: 'flows', label: `Contributions (${a.flows.length})` },
            { value: 'valuations', label: `Valuations (${a.valuations.length})` },
          ]}
        />
      )}

      {tab === 'details' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={a.type} onChange={(e) => changeType(e.target.value as AssetType)} disabled={!!initial && isDeposit(initial)}>
              {Object.entries(ASSET_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder={placeholderFor(a.type)} />
          </Field>
          <Field label={deposit ? 'Bank' : 'Institution / platform'}>
            <Input value={a.institution ?? ''} onChange={(e) => set({ institution: e.target.value || undefined })} placeholder={deposit ? 'e.g. HDFC Bank' : 'e.g. Zerodha, Groww'} />
          </Field>
          <Field label="Notes">
            <Input value={a.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </Field>

          {deposit && a.deposit && <DepositFields d={a.deposit} rd={a.type === 'rd'} onChange={setDep} />}
          {isMF && <MFFields a={a} onChange={set} />}

          {!deposit && !isMF && (
            <div className="rounded-xl border border-line bg-surface-2/40 p-3 text-xs text-muted sm:col-span-2">
              Record money you put in (or took out) under <b>Contributions</b>, and the current worth under <b>Valuations</b> — update it whenever you check your{' '}
              {a.type === 'stocks' ? 'demat holdings' : 'statement'}. Returns (XIRR) are computed from both.
            </div>
          )}

          <div className="sm:col-span-2">
            <Toggle checked={!!a.closed} onChange={(v) => set({ closed: v })} label="Closed / redeemed (kept for history, counts as ₹0)" />
          </div>

          {m && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2/40 p-3 text-sm sm:col-span-2 sm:grid-cols-4">
              <Metric label="Invested" value={<Money value={m.invested} />} />
              <Metric label="Current value" value={<Money value={m.value} />} sub={m.navUsed ? `NAV ${m.navUsed.nav} · ${formatDate(m.navUsed.date)}` : m.valueDate ? `as of ${formatDate(m.valueDate)}` : undefined} />
              <Metric label="Gain" value={<Money value={m.gain} sign colored />} sub={m.gainPct != null ? `${(m.gainPct * 100).toFixed(1)}%` : undefined} />
              <Metric label={m.maturityValue ? 'Maturity value' : 'XIRR'} value={m.maturityValue ? <Money value={m.maturityValue} /> : m.xirr != null ? `${(m.xirr * 100).toFixed(1)}%` : '—'} />
            </div>
          )}
        </div>
      )}

      {tab === 'flows' && (
        <DatedList
          rows={a.flows.map((f) => ({ id: f.id, date: f.date, value: f.amount, note: f.note }))}
          onChange={(rows) => set({ flows: rows.map((r) => ({ id: r.id ?? uid('f'), date: r.date, amount: r.value, note: r.note })) })}
          valueLabel="Amount"
          allowNegative
          withNote
          hint="Positive = money invested (purchase, SIP, deposit). Negative = money withdrawn (redemption, sale)."
          empty="No contributions recorded yet."
        />
      )}

      {tab === 'valuations' && (
        <DatedList
          rows={a.valuations.map((v) => ({ date: v.date, value: v.value }))}
          onChange={(rows) => set({ valuations: rows.map((r) => ({ date: r.date, value: r.value })) })}
          valueLabel="Value"
          hint={isMF && a.mf?.schemeCode ? 'Live NAV × units is used for today; valuations here are used for history.' : 'The latest valuation is the current value.'}
          empty="No valuations yet — until you add one, the amount invested is used as the value."
        />
      )}
    </Modal>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-semibold tabular">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

function placeholderFor(t: AssetType) {
  return (
    {
      fd: 'e.g. HDFC FD 2025',
      rd: 'e.g. SBI RD',
      mutual_fund: 'e.g. Parag Parikh Flexi Cap',
      stocks: 'e.g. Zerodha demat',
      ppf: 'PPF account',
      epf: 'EPF',
      nps: 'NPS Tier I',
      gold: 'e.g. Sovereign Gold Bonds',
      bond: 'e.g. RBI Floating Rate Bond',
      real_estate: 'e.g. Flat in Pune',
      crypto: 'e.g. Bitcoin',
      cash: 'Cash at home',
      other: 'Name',
    } as Record<AssetType, string>
  )[t];
}

function DepositFields({ d, rd, onChange }: { d: DepositDetails; rd: boolean; onChange: (p: Partial<DepositDetails>) => void }) {
  return (
    <>
      {rd ? (
        <Field label="Monthly instalment">
          <NumberInput value={d.installment} onChange={(v) => onChange({ installment: v })} />
        </Field>
      ) : (
        <Field label="Principal">
          <NumberInput value={d.principal} onChange={(v) => onChange({ principal: v })} />
        </Field>
      )}
      <Field label="Interest rate (% p.a.)">
        <NumberInput value={d.rate} onChange={(v) => onChange({ rate: v })} />
      </Field>
      <Field label="Start date">
        <Input type="date" value={d.startDate} onChange={(e) => onChange({ startDate: e.target.value })} />
      </Field>
      <Field label="Maturity date" hint={d.maturityDate <= d.startDate ? 'Must be after start date' : undefined}>
        <Input type="date" value={d.maturityDate} onChange={(e) => onChange({ maturityDate: e.target.value })} />
      </Field>
      <Field label="Compounding">
        <Select value={d.compounding} onChange={(e) => onChange({ compounding: Number(e.target.value) as DepositDetails['compounding'] })}>
          <option value={4}>Quarterly (most banks)</option>
          <option value={12}>Monthly</option>
          <option value={2}>Half-yearly</option>
          <option value={1}>Yearly</option>
        </Select>
      </Field>
      {!rd && (
        <Field label="Interest payout" hint={d.payout === 'payout' ? 'Interest is paid out to your account (value stays at principal)' : undefined}>
          <Select value={d.payout} onChange={(e) => onChange({ payout: e.target.value as DepositDetails['payout'] })}>
            <option value="cumulative">Cumulative (reinvested)</option>
            <option value="payout">Paid out periodically</option>
          </Select>
        </Field>
      )}
    </>
  );
}

function MFFields({ a, onChange }: { a: Asset; onChange: (p: Partial<Asset>) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SchemeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [nav, setNav] = useState<{ nav: number; date: string } | null>(null);
  const code = a.mf?.schemeCode;

  useEffect(() => {
    if (q.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      setErr('');
      try {
        const r = await searchSchemes(q);
        if (live) setHits(r);
      } catch {
        if (live) setErr('Could not reach mfapi.in');
      } finally {
        if (live) setBusy(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    if (!code) return;
    let live = true;
    void latestNav(code).then((n) => {
      if (!n) return;
      const v = { nav: n.nav, date: n.date };
      useStore.setState((s) => ({ navs: { ...s.navs, [code]: v } }));
      if (live) setNav(v);
    });
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <>
      <Field label="Scheme (AMFI)" className="sm:col-span-2" hint={code ? `Scheme code ${code}${nav ? ` · NAV ₹${nav.nav} on ${formatDate(nav.date)}` : ''}` : 'Search to link live NAVs from mfapi.in'}>
        {code ? (
          <div className="flex items-center gap-2">
            <div className="input flex-1 truncate">{a.mf?.schemeName}</div>
            <Button size="sm" variant="ghost" onClick={() => onChange({ mf: { units: a.mf?.units ?? 0 } })}>
              Change
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search e.g. parag parikh flexi direct growth" className="!pl-9" />
            {busy && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" />}
            {(hits.length > 0 || err) && q.trim().length >= 3 && (
              <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
                {err && <p className="px-2 py-1.5 text-xs text-neg">{err}</p>}
                {hits.map((h) => (
                  <button
                    key={h.schemeCode}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2"
                    onClick={() => {
                      onChange({ mf: { units: a.mf?.units ?? 0, schemeCode: String(h.schemeCode), schemeName: h.schemeName }, ...(a.name ? {} : { name: h.schemeName.split(' - ')[0] }) });
                      setQ('');
                      setHits([]);
                    }}
                  >
                    {h.schemeName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>
      <Field label="Units held">
        <NumberInput value={a.mf?.units ?? 0} onChange={(v) => onChange({ mf: { ...(a.mf ?? {}), units: v } })} />
      </Field>
      <Field label="Current value">
        <div className="input tabular text-muted">{nav && a.mf?.units ? <Money value={nav.nav * a.mf.units} /> : '—'}</div>
      </Field>
      <p className="text-xs text-muted sm:col-span-2">Add your purchases/SIPs under the Contributions tab so invested amount and XIRR are accurate.</p>
    </>
  );
}
