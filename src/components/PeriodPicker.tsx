import { CalendarRange } from 'lucide-react';
import { currentFY, fyMonths, monthLabel, todayISO, type Period, type PeriodPreset } from '../lib/dates';
import { cx, Input, Select } from './ui';

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'fy', label: 'Financial year' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'month', label: 'Month' },
  { value: 'last12', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

export function defaultPeriod(): Period {
  return { preset: 'fy', fy: currentFY() };
}

export function PeriodPicker({ value, onChange, fys, className }: { value: Period; onChange: (p: Period) => void; fys: string[]; className?: string }) {
  const fy = value.fy ?? value.quarter?.split(' Q')[0] ?? (value.month ? undefined : fys[0]) ?? currentFY();
  const setPreset = (preset: PeriodPreset) => {
    const base = value.fy ?? fys[0] ?? currentFY();
    if (preset === 'fy') onChange({ preset, fy: base });
    else if (preset === 'quarter') onChange({ preset, quarter: `${base} Q1`, fy: base });
    else if (preset === 'month') onChange({ preset, month: todayISO().slice(0, 7), fy: base });
    else if (preset === 'custom') onChange({ preset, from: `${todayISO().slice(0, 4)}-01-01`, to: todayISO(), fy: base });
    else onChange({ preset, fy: base });
  };
  const months = fys.flatMap((f) => [...fyMonths(f)].reverse());

  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <CalendarRange className="size-4 text-muted" />
      <Select value={value.preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} className="!w-auto">
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {value.preset === 'fy' && (
        <Select value={value.fy} onChange={(e) => onChange({ preset: 'fy', fy: e.target.value })} className="!w-auto">
          {fys.map((f) => (
            <option key={f} value={f}>
              FY {f}
            </option>
          ))}
        </Select>
      )}
      {value.preset === 'quarter' && (
        <Select value={value.quarter} onChange={(e) => onChange({ preset: 'quarter', quarter: e.target.value, fy: e.target.value.split(' Q')[0] })} className="!w-auto">
          {fys.flatMap((f) =>
            [1, 2, 3, 4].map((q) => (
              <option key={`${f} Q${q}`} value={`${f} Q${q}`}>
                FY {f} · Q{q}
              </option>
            )),
          )}
        </Select>
      )}
      {value.preset === 'month' && (
        <Select value={value.month} onChange={(e) => onChange({ preset: 'month', month: e.target.value, fy })} className="!w-auto">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, 'long')}
            </option>
          ))}
        </Select>
      )}
      {value.preset === 'custom' && (
        <>
          <Input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="!w-auto" />
          <span className="text-muted">→</span>
          <Input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className="!w-auto" />
        </>
      )}
    </div>
  );
}
