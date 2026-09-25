import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayISO } from '../lib/dates';
import { uid } from '../lib/format';
import { Button, IconButton, Input, Money, NumberInput } from './ui';

export interface DatedRow {
  id?: string;
  date: string;
  value: number;
  note?: string;
}

/** Small editor for dated values (valuations, contributions, prepayments) */
export function DatedList({
  rows,
  onChange,
  valueLabel = 'Value',
  allowNegative,
  withNote,
  empty = 'Nothing yet.',
  hint,
}: {
  rows: DatedRow[];
  onChange: (rows: DatedRow[]) => void;
  valueLabel?: string;
  allowNegative?: boolean;
  withNote?: boolean;
  empty?: string;
  hint?: string;
}) {
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState(0);
  const [note, setNote] = useState('');
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const add = () => {
    if (!date || !value || (!allowNegative && value < 0)) return;
    onChange([...rows, { id: uid('r'), date, value, ...(withNote && note ? { note } : {}) }]);
    setValue(0);
    setNote('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-40" />
        <NumberInput value={value} onChange={setValue} placeholder={valueLabel} className="!w-36" onKeyDown={(e) => e.key === 'Enter' && add()} />
        {withNote && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="!w-40 flex-1" />}
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={add} disabled={!value}>
          Add
        </Button>
      </div>
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
      <div className="max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {sorted.map((r, i) => (
          <div key={r.id ?? `${r.date}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="w-28 text-muted">{formatDate(r.date)}</span>
            <Money value={r.value} sign={allowNegative} colored={allowNegative} className="flex-1 font-medium" />
            {r.note && <span className="truncate text-xs text-faint">{r.note}</span>}
            <IconButton title="Remove" onClick={() => onChange(rows.filter((x) => x !== r))} className="size-7">
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        ))}
        {!rows.length && <p className="px-3 py-3 text-xs text-muted">{empty}</p>}
      </div>
    </div>
  );
}
