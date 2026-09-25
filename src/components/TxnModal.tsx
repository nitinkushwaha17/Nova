import { Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { todayISO } from '../lib/dates';
import { uid } from '../lib/format';
import { classify, merchantOf } from '../lib/transactions';
import { useCatMap, useStore } from '../store';
import type { Rule, Transaction } from '../types';
import { CategorySelect } from './CategorySelect';
import { newRule, RuleModal } from './RuleModal';
import { Badge, Button, Field, Input, Modal, NumberInput, Select, Tabs, toast } from './ui';

export function TxnModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Transaction }) {
  const accounts = useStore((s) => s.meta.accounts);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const importTransactions = useStore((s) => s.importTransactions);
  const deleteTransactions = useStore((s) => s.deleteTransactions);
  const catMap = useCatMap();
  const blank = (): Transaction => ({ id: uid('txn'), accountId: accounts[0]?.id ?? '', date: todayISO(), description: '', amount: 0, importId: 'manual' });
  const [t, setT] = useState<Transaction>(initial ?? blank());
  const [dir, setDir] = useState<'out' | 'in'>((initial?.amount ?? -1) < 0 ? 'out' : 'in');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleInit, setRuleInit] = useState<Rule>();
  const [prev, setPrev] = useState({ initial, open });
  if (prev.initial !== initial || prev.open !== open) {
    setPrev({ initial, open });
    if (open) {
      setT(initial ?? blank());
      setDir((initial?.amount ?? -1) < 0 ? 'out' : 'in');
      setTags((initial?.tags ?? []).join(', '));
    }
  }
  const isNew = !initial;
  const set = (p: Partial<Transaction>) => setT((x) => ({ ...x, ...p }));
  const amount = Math.abs(t.amount);
  const kind = classify({ ...t, amount: dir === 'out' ? -amount : amount }, t.category ? catMap.get(t.category) : undefined);

  const save = async () => {
    const final: Transaction = {
      ...t,
      description: t.description.trim(),
      amount: dir === 'out' ? -amount : amount,
      tags: tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (!final.description || !final.accountId || !amount) return;
    if (isNew) {
      await importTransactions([final]);
      toast('Transaction added');
    } else {
      updateTransaction(final.id, final);
    }
    onClose();
  };

  return (
    <>
      <Modal
        open={open && !ruleOpen}
        onClose={onClose}
        title={isNew ? 'Add transaction' : 'Edit transaction'}
        footer={
          <>
            {!isNew && (
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                className="mr-auto"
                onClick={() => {
                  if (!window.confirm('Delete this transaction?')) return;
                  deleteTransactions([t.id]);
                  onClose();
                }}
              >
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={!t.description.trim() || !t.accountId || !amount}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Description" className="sm:col-span-2">
            <Input value={t.description} onChange={(e) => set({ description: e.target.value })} autoFocus={isNew} />
            {t.rawDescription && t.rawDescription !== t.description && <p className="mt-1 font-mono text-[11px] break-all text-faint">{t.rawDescription}</p>}
          </Field>
          <Field label="Amount">
            <div className="flex gap-2">
              <Tabs
                value={dir}
                onChange={setDir}
                options={[
                  { value: 'out', label: 'Out' },
                  { value: 'in', label: 'In' },
                ]}
              />
              <NumberInput value={amount} onChange={(v) => set({ amount: Math.abs(v) })} />
            </div>
          </Field>
          <Field label="Date">
            <Input type="date" value={t.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Account">
            <Select value={t.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              <option value="">Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Counts as">
            <Select
              value={t.isTransfer === undefined ? 'auto' : t.isTransfer ? 'yes' : 'no'}
              onChange={(e) => set({ isTransfer: e.target.value === 'auto' ? undefined : e.target.value === 'yes' })}
            >
              <option value="auto">Auto ({kind}{t.autoTransfer ? ' · detected self-transfer' : ''})</option>
              <option value="yes">Transfer (exclude from income/expense)</option>
              <option value="no">Not a transfer</option>
            </Select>
          </Field>
          <Field label="Category" className="sm:col-span-2">
            <div className="flex gap-2">
              <CategorySelect category={t.category} subcategory={t.subcategory} onChange={(category, subcategory) => set({ category, subcategory })} />
              {!isNew && (
                <Button
                  icon={<Wand2 className="size-4" />}
                  title="Create a rule from this transaction"
                  onClick={() => {
                    setRuleInit(
                      newRule({
                        pattern: merchantOf(t.description).toUpperCase(),
                        category: t.category ?? '',
                        subcategory: t.subcategory ?? undefined,
                        direction: dir === 'out' ? 'debit' : 'credit',
                      }),
                    );
                    setRuleOpen(true);
                  }}
                >
                  Rule
                </Button>
              )}
            </div>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input value={t.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="optional" />
          </Field>
          <Field label="Tags" hint="Comma separated, e.g. goa-trip, reimbursable" className="sm:col-span-2">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          {t.reference && (
            <div className="text-xs text-muted sm:col-span-2">
              Ref <Badge>{t.reference}</Badge>
            </div>
          )}
        </div>
      </Modal>
      <RuleModal open={ruleOpen} onClose={() => setRuleOpen(false)} initial={ruleInit} />
    </>
  );
}
