import { useState } from 'react';
import { uid } from '../lib/format';
import { ruleMatches } from '../lib/transactions';
import { useKnownFYs, useStore } from '../store';
import type { Rule } from '../types';
import { CategorySelect } from './CategorySelect';
import { Button, Field, Input, Modal, Select, Toggle, toast } from './ui';

export function newRule(p: Partial<Rule> = {}): Rule {
  return { id: uid('rule'), pattern: '', matchType: 'contains', category: '', direction: 'any', priority: 0, ...p };
}

export function RuleModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Rule }) {
  const rules = useStore((s) => s.meta.rules);
  const saveRules = useStore((s) => s.saveRules);
  const applyRulesTo = useStore((s) => s.applyRulesTo);
  const txByFY = useStore((s) => s.txByFY);
  const fys = useKnownFYs();
  const [rule, setRule] = useState<Rule>(initial ?? newRule());
  const [applyNow, setApplyNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState({ initial, open });
  if (prev.initial !== initial || prev.open !== open) {
    setPrev({ initial, open });
    if (open) setRule(initial ?? newRule());
  }

  let regexError = '';
  if (rule.matchType === 'regex') {
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      regexError = (e as Error).message;
    }
  }
  const loaded = Object.values(txByFY).flat();
  const matches = rule.pattern && !regexError ? loaded.filter((t) => ruleMatches(rule, t)).length : 0;
  const valid = rule.pattern.trim() && rule.category && !regexError;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const exists = rules.some((r) => r.id === rule.id);
    saveRules(exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
    if (applyNow) {
      const n = await applyRulesTo(fys, false);
      toast(`Rule saved · ${n} transaction${n === 1 ? '' : 's'} categorised`);
    } else toast('Rule saved');
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial && rules.some((r) => r.id === initial.id) ? 'Edit rule' : 'New rule'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!valid} loading={busy}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="When description" className="sm:col-span-2" hint={regexError || (rule.pattern ? `Matches ${matches} loaded transaction${matches === 1 ? '' : 's'}` : 'Case-insensitive')}>
          <div className="flex gap-2">
            <Select value={rule.matchType} onChange={(e) => setRule({ ...rule, matchType: e.target.value as Rule['matchType'] })} className="!w-36">
              <option value="contains">contains</option>
              <option value="regex">matches regex</option>
            </Select>
            <Input autoFocus value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} placeholder="e.g. SWIGGY" className="font-mono" />
          </div>
        </Field>
        <Field label="Set category" className="sm:col-span-2">
          <CategorySelect category={rule.category} subcategory={rule.subcategory} placeholder="Choose…" onChange={(c, s) => setRule({ ...rule, category: c ?? '', subcategory: s ?? undefined })} />
        </Field>
        <Field label="Applies to">
          <Select value={rule.direction ?? 'any'} onChange={(e) => setRule({ ...rule, direction: e.target.value as Rule['direction'] })}>
            <option value="any">Debits and credits</option>
            <option value="debit">Debits only</option>
            <option value="credit">Credits only</option>
          </Select>
        </Field>
        <Field label="Priority" hint="Higher runs first">
          <Input type="number" value={rule.priority} onChange={(e) => setRule({ ...rule, priority: Number(e.target.value) || 0 })} />
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={applyNow} onChange={setApplyNow} label="Apply to existing uncategorised transactions now" />
        </div>
      </div>
    </Modal>
  );
}
