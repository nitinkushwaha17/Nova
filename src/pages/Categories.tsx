import { Pencil, Plus, Play, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { newRule, RuleModal } from '../components/RuleModal';
import { Badge, Button, Card, Dot, Field, IconButton, Input, Modal, PageHeader, Select, Tabs, toast } from '../components/ui';
import { DEFAULT_RULES, PALETTE } from '../lib/defaults';
import { useCatMap, useKnownFYs, useStore } from '../store';
import type { Category, CategoryKind, Rule } from '../types';

const KINDS: { value: CategoryKind; label: string; hint: string }[] = [
  { value: 'expense', label: 'Expense', hint: 'Counts towards spending (credits are refunds)' },
  { value: 'income', label: 'Income', hint: 'Counts towards income' },
  { value: 'investment', label: 'Investment', hint: 'Money moved into investments — tracked as savings, not spending' },
  { value: 'transfer', label: 'Transfer', hint: 'Ignored in income & spending' },
];

function CategoryModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Category }) {
  const cats = useStore((s) => s.meta.categories);
  const saveCategories = useStore((s) => s.saveCategories);
  const blank = (): Category => ({ id: '', name: '', color: PALETTE[cats.length % PALETTE.length], kind: 'expense', subcategories: [] });
  const [c, setC] = useState<Category>(initial ?? blank());
  const [sub, setSub] = useState('');
  const [prev, setPrev] = useState({ initial, open });
  if (prev.initial !== initial || prev.open !== open) {
    setPrev({ initial, open });
    if (open) setC(initial ?? blank());
  }
  const addSub = () => {
    const s = sub.trim();
    if (s && !c.subcategories.includes(s)) setC({ ...c, subcategories: [...c.subcategories, s] });
    setSub('');
  };
  const save = () => {
    if (!c.name.trim()) return;
    if (initial) saveCategories(cats.map((x) => (x.id === initial.id ? { ...c, name: c.name.trim() } : x)));
    else {
      let id = c.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat';
      while (cats.some((x) => x.id === id)) id += '-2';
      saveCategories([...cats, { ...c, id, name: c.name.trim() }]);
    }
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!c.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Type" hint={KINDS.find((k) => k.value === c.kind)?.hint}>
          <Tabs value={c.kind} onChange={(kind) => setC({ ...c, kind })} options={KINDS} />
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap items-center gap-2">
            {PALETTE.map((p) => (
              <button key={p} onClick={() => setC({ ...c, color: p })} className="size-7 rounded-full ring-offset-2 ring-offset-bg transition" style={{ background: p, boxShadow: c.color === p ? `0 0 0 2px var(--bg), 0 0 0 4px ${p}` : undefined }} />
            ))}
            <input type="color" value={c.color} onChange={(e) => setC({ ...c, color: e.target.value })} className="size-7 cursor-pointer rounded-full border-0 bg-transparent" />
          </div>
        </Field>
        <Field label="Subcategories">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {c.subcategories.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-1 pr-1 pl-2 text-xs">
                {s}
                <button onClick={() => setC({ ...c, subcategories: c.subcategories.filter((x) => x !== s) })} className="rounded p-0.5 text-faint hover:text-neg">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="Add subcategory" />
            <Button onClick={addSub} disabled={!sub.trim()}>
              Add
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export default function Categories() {
  const cats = useStore((s) => s.meta.categories);
  const rules = useStore((s) => s.meta.rules);
  const saveCategories = useStore((s) => s.saveCategories);
  const saveRules = useStore((s) => s.saveRules);
  const applyRulesTo = useStore((s) => s.applyRulesTo);
  const fys = useKnownFYs();
  const catMap = useCatMap();
  const [catModal, setCatModal] = useState<{ open: boolean; c?: Category }>({ open: false });
  const [ruleModal, setRuleModal] = useState<{ open: boolean; r?: Rule }>({ open: false });
  const [running, setRunning] = useState(false);
  const [ruleQ, setRuleQ] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const missingBuiltins = DEFAULT_RULES.filter((d) => !rules.some((r) => r.id === d.id) && cats.some((c) => c.id === d.category));

  const sortedRules = [...rules]
    .filter((r) => !ruleQ || r.pattern.toLowerCase().includes(ruleQ.toLowerCase()) || catMap.get(r.category)?.name.toLowerCase().includes(ruleQ.toLowerCase()))
    .sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern));

  const run = async () => {
    setRunning(true);
    const n = await applyRulesTo(fys, overwrite);
    setRunning(false);
    toast(`${n} transaction${n === 1 ? '' : 's'} updated across ${fys.length} financial year${fys.length === 1 ? '' : 's'}`);
  };

  return (
    <>
      <PageHeader title="Categories & rules" subtitle="Organise spending and teach Nova how to categorise new transactions automatically." />
      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Card
          title="Categories"
          action={
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCatModal({ open: true })}>
              New
            </Button>
          }
        >
          {KINDS.map((k) => {
            const list = cats.filter((c) => c.kind === k.value);
            if (!list.length) return null;
            return (
              <div key={k.value} className="mb-4 last:mb-0">
                <div className="mb-2 text-[11px] font-semibold tracking-widest text-faint uppercase">{k.label}</div>
                <div className="space-y-1">
                  {list.map((c) => (
                    <div key={c.id} className="group flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-surface-2/60">
                      <Dot color={c.color} className="mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="mt-0.5 truncate text-xs text-faint">{c.subcategories.join(' · ') || 'No subcategories'}</div>
                      </div>
                      <div className="flex opacity-0 transition group-hover:opacity-100">
                        <IconButton title="Edit" onClick={() => setCatModal({ open: true, c })}>
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          title="Delete"
                          onClick={() => {
                            if (!window.confirm(`Delete “${c.name}”? Transactions in it become uncategorised.`)) return;
                            saveCategories(cats.filter((x) => x.id !== c.id));
                            saveRules(rules.filter((r) => r.category !== c.id));
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>

        <Card
          title={`Auto-categorisation rules · ${rules.length}`}
          action={
            <div className="flex gap-2">
              <Button size="sm" icon={<Play className="size-3.5" />} loading={running} onClick={run}>
                Run rules
              </Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setRuleModal({ open: true, r: newRule() })}>
                New rule
              </Button>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Input value={ruleQ} onChange={(e) => setRuleQ(e.target.value)} placeholder="Filter rules" className="!w-56" />
            <Select value={overwrite ? 'all' : 'empty'} onChange={(e) => setOverwrite(e.target.value === 'all')} className="!w-auto">
              <option value="empty">Run on uncategorised only</option>
              <option value="all">Run on all (overwrite)</option>
            </Select>
            {missingBuiltins.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => saveRules([...rules, ...missingBuiltins])}>
                Add {missingBuiltins.length} built-in merchant rules
              </Button>
            )}
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Pattern</th>
                  <th className="font-medium">Category</th>
                  <th className="font-medium">Applies to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedRules.map((r) => {
                  const c = catMap.get(r.category);
                  return (
                    <tr key={r.id} className="group border-t border-line">
                      <td className="max-w-64 py-2 pr-2">
                        <code className="block truncate font-mono text-xs" title={r.pattern}>
                          {r.pattern}
                        </code>
                        <div className="mt-0.5 flex gap-1">
                          {r.matchType === 'regex' && <Badge>regex</Badge>}
                          {r.id.startsWith('builtin-') && <Badge>built-in</Badge>}
                          {r.priority !== 0 && <Badge>priority {r.priority}</Badge>}
                        </div>
                      </td>
                      <td className="pr-2">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Dot color={c?.color ?? 'var(--line)'} />
                          {c?.name ?? r.category}
                          {r.subcategory && <span className="text-faint">› {r.subcategory}</span>}
                        </span>
                      </td>
                      <td className="text-xs text-muted capitalize">{r.direction === 'debit' ? 'Debits' : r.direction === 'credit' ? 'Credits' : 'All'}</td>
                      <td className="text-right whitespace-nowrap">
                        <span className="opacity-0 transition group-hover:opacity-100">
                          <IconButton title="Edit" onClick={() => setRuleModal({ open: true, r })}>
                            <Pencil className="size-3.5" />
                          </IconButton>
                          <IconButton title="Delete" onClick={() => saveRules(rules.filter((x) => x.id !== r.id))}>
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <CategoryModal open={catModal.open} initial={catModal.c} onClose={() => setCatModal({ open: false })} />
      <RuleModal open={ruleModal.open} initial={ruleModal.r} onClose={() => setRuleModal({ open: false })} />
    </>
  );
}
