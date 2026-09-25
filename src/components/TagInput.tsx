import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { normalizeTag } from '../lib/transactions';
import { useGroupTotals } from '../store';
import { cx } from './ui';

/** Chip-style tag editor with suggestions from tags you've used before */
export function TagInput({ value, onChange, placeholder = 'Add tag…', className }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState('');
  const known = useGroupTotals('tag');
  const listId = useId();
  const add = (raw: string) => {
    const tags = raw.split(',').map(normalizeTag).filter(Boolean);
    if (tags.length) onChange([...new Set([...value, ...tags])]);
    setDraft('');
  };
  const suggestions = [...known.entries()]
    .filter(([t]) => !value.includes(t))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 50);

  return (
    <div className={cx('flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2 py-1 focus-within:border-accent/60', className)}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs text-accent">
          #{t}
          <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((x) => x !== t))} title={`Remove ${t}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        list={listId}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        onChange={(e) => {
          const v = e.target.value;
          // Picking from the datalist fires a change with the full value
          if (v.endsWith(',') || known.has(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {suggestions.map(([t]) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
