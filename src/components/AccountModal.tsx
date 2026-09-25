import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { uid } from '../lib/format';
import { useStore } from '../store';
import type { Account, AccountType } from '../types';
import { Button, Field, Input, Modal, NumberInput, Select, Toggle } from './ui';

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  savings: 'Savings account',
  current: 'Current account',
  credit_card: 'Credit card',
  wallet: 'Wallet',
  cash: 'Cash',
};

export function newAccount(name = ''): Account {
  return { id: uid('acc'), name, type: 'savings', includeInNetWorth: true, createdAt: new Date().toISOString() };
}

export function AccountModal({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: Account; onSaved?: (a: Account) => void }) {
  const saveAccount = useStore((s) => s.saveAccount);
  const [a, setA] = useState<Account>(initial ?? newAccount());
  const [prevInitial, setPrevInitial] = useState(initial);
  const [prevOpen, setPrevOpen] = useState(open);
  if (initial !== prevInitial || open !== prevOpen) {
    setPrevInitial(initial);
    setPrevOpen(open);
    if (open) setA(initial ?? newAccount());
  }
  const set = (p: Partial<Account>) => setA((x) => ({ ...x, ...p }));
  const save = () => {
    if (!a.name.trim()) return;
    saveAccount({ ...a, name: a.name.trim() });
    onSaved?.(a);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit account' : 'New account'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={initial ? <Pencil className="size-4" /> : <Check className="size-4" />} onClick={save} disabled={!a.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. SBI Savings" onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        <Field label="Type">
          <Select value={a.type} onChange={(e) => set({ type: e.target.value as AccountType })}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bank / issuer">
          <Input value={a.bank ?? ''} onChange={(e) => set({ bank: e.target.value })} placeholder="optional" />
        </Field>
        <Field label="Last 4 digits">
          <Input value={a.last4 ?? ''} maxLength={4} onChange={(e) => set({ last4: e.target.value.replace(/\D/g, '') })} placeholder="optional" />
        </Field>
        <Field label="Manual balance" hint="Used when statements don't include a balance column (newer statement balances win).">
          <div className="flex gap-2">
            <NumberInput value={a.manualBalance?.value} onChange={(v) => set({ manualBalance: { date: a.manualBalance?.date ?? new Date().toISOString().slice(0, 10), value: v } })} placeholder="0" />
            <Input
              type="date"
              value={a.manualBalance?.date ?? ''}
              onChange={(e) => set({ manualBalance: { value: a.manualBalance?.value ?? 0, date: e.target.value } })}
              className="!w-40"
            />
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={a.includeInNetWorth} onChange={(v) => set({ includeInNetWorth: v })} label="Include balance in net worth" />
        </div>
      </div>
    </Modal>
  );
}
