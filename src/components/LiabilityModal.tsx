import { Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { emi } from '../lib/finance';
import { todayISO } from '../lib/dates';
import { uid } from '../lib/format';
import { LIABILITY_TYPES } from '../lib/portfolio';
import { useStore } from '../store';
import type { Liability, LiabilityType } from '../types';
import { DatedList } from './DatedList';
import { Button, confirmAction, Field, Input, Modal, Money, NumberInput, Select, Tabs, Toggle } from './ui';

function fresh(type: LiabilityType = 'home_loan'): Liability {
  return {
    id: uid('li'),
    type,
    name: '',
    valuations: [],
    createdAt: new Date().toISOString(),
    ...(type === 'credit_card' ? {} : { loan: { principal: 2500000, rate: 8.5, tenureMonths: 240, startDate: todayISO(), prepayments: [] } }),
  };
}

type Tab = 'details' | 'prepayments' | 'valuations';

export function LiabilityModal({ open, onClose, initial, newType }: { open: boolean; onClose: () => void; initial?: Liability; newType?: LiabilityType }) {
  const update = useStore((s) => s.update);
  const [l, setL] = useState<Liability>(initial ?? fresh(newType));
  const [tab, setTab] = useState<Tab>('details');
  const [prev, setPrev] = useState({ initial, open });
  if (prev.initial !== initial || prev.open !== open) {
    setPrev({ initial, open });
    if (open) {
      setL(initial ?? fresh(newType));
      setTab('details');
    }
  }
  const set = (p: Partial<Liability>) => setL((x) => ({ ...x, ...p }));
  const setLoan = (p: Partial<NonNullable<Liability['loan']>>) => setL((x) => ({ ...x, loan: { ...x.loan!, ...p } }));
  const valid = !!l.name.trim() && (!l.loan || (l.loan.principal > 0 && l.loan.tenureMonths > 0));

  const save = () => {
    if (!valid) return;
    const clean = { ...l, name: l.name.trim() };
    update('liabilities', (d) => ({
      liabilities: d.liabilities.some((x) => x.id === l.id) ? d.liabilities.map((x) => (x.id === l.id ? clean : x)) : [...d.liabilities, clean],
    }));
    onClose();
  };
  const remove = () => {
    if (!confirmAction(`Delete "${l.name}"?`)) return;
    update('liabilities', (d) => ({ liabilities: d.liabilities.filter((x) => x.id !== l.id) }));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={initial ? 'Edit liability' : 'Add liability'}
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
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'details', label: 'Details' },
          ...(l.loan ? [{ value: 'prepayments' as Tab, label: `Prepayments (${l.loan.prepayments.length})` }] : []),
          { value: 'valuations', label: l.loan ? 'Balance overrides' : `Outstanding (${l.valuations.length})` },
        ]}
      />
      {tab === 'details' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={l.type} onChange={(e) => set({ type: e.target.value as LiabilityType })}>
              {Object.entries(LIABILITY_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input autoFocus value={l.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. SBI Home Loan" />
          </Field>
          <Field label="Lender">
            <Input value={l.lender ?? ''} onChange={(e) => set({ lender: e.target.value || undefined })} />
          </Field>
          <Field label="Notes">
            <Input value={l.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </Field>
          <div className="sm:col-span-2">
            <Toggle
              checked={!!l.loan}
              onChange={(v) => set({ loan: v ? (l.loan ?? fresh('personal_loan').loan) : undefined })}
              label="Amortising loan with EMI (otherwise enter outstanding balances manually)"
            />
          </div>
          {l.loan && (
            <>
              <Field label="Loan amount">
                <NumberInput value={l.loan.principal} onChange={(v) => setLoan({ principal: v })} />
              </Field>
              <Field label="Interest rate (% p.a.)">
                <NumberInput value={l.loan.rate} onChange={(v) => setLoan({ rate: v })} />
              </Field>
              <Field label="Tenure (months)" hint={l.loan.tenureMonths ? `${(l.loan.tenureMonths / 12).toFixed(1)} years` : undefined}>
                <NumberInput value={l.loan.tenureMonths} onChange={(v) => setLoan({ tenureMonths: Math.round(v) })} />
              </Field>
              <Field label="Disbursed on" hint="First EMI is assumed one month later">
                <Input type="date" value={l.loan.startDate} onChange={(e) => setLoan({ startDate: e.target.value })} />
              </Field>
              <div className="rounded-xl border border-line bg-surface-2/40 p-3 text-sm sm:col-span-2">
                EMI <Money value={emi(l.loan.principal, l.loan.rate, l.loan.tenureMonths)} className="font-semibold" /> per month
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Toggle checked={!!l.closed} onChange={(v) => set({ closed: v })} label="Closed / fully repaid" />
          </div>
        </div>
      )}
      {tab === 'prepayments' && l.loan && (
        <DatedList
          rows={l.loan.prepayments.map((p) => ({ id: p.id, date: p.date, value: p.amount }))}
          onChange={(rows) => setLoan({ prepayments: rows.map((r) => ({ id: r.id ?? uid('pp'), date: r.date, amount: r.value })) })}
          valueLabel="Amount"
          hint="Part-prepayments reduce principal; EMI stays the same, so the tenure shortens."
          empty="No prepayments."
        />
      )}
      {tab === 'valuations' && (
        <DatedList
          rows={l.valuations.map((v) => ({ date: v.date, value: v.value }))}
          onChange={(rows) => set({ valuations: rows.map((r) => ({ date: r.date, value: r.value })) })}
          valueLabel="Outstanding"
          hint={l.loan ? 'Optional: a balance from your lender statement overrides the computed schedule.' : 'Latest entry is the current outstanding amount.'}
          empty="No entries."
        />
      )}
    </Modal>
  );
}
