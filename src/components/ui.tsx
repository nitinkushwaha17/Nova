import { clsx } from 'clsx';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { money, moneyShort, pct } from '../lib/format';

export const cx = clsx;

// ─── Layout primitives ─────────────────────────────────────────────────────

export function Card({ className, children, title, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('card animate-in', pad && 'p-5', className)}>
      {(title || action) && (
        <header className={cx('mb-4 flex items-center justify-between gap-3', !pad && 'px-5 pt-5')}>
          {title && <h3 className="text-sm font-semibold tracking-wide text-muted">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all select-none disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-9 px-3.5 text-sm' : 'h-7 px-2.5 text-xs',
        variant === 'primary' && 'bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-900/25 hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-surface-2 text-fg hover:border-accent/50',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'border border-neg/30 bg-neg/10 text-neg hover:bg-neg/20',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ className, title, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button {...rest} title={title} aria-label={title} className={cx('grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg', className)}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx('input', className)} />;
}

/** Number input that keeps a local string so users can type freely */
export function NumberInput({ value, onChange, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | undefined; onChange: (v: number) => void }) {
  const [text, setText] = useState(value === undefined || Number.isNaN(value) ? '' : String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(value === undefined || Number.isNaN(value) ? '' : String(value));
  }, [value]);
  return (
    <input
      {...rest}
      inputMode="decimal"
      className={cx('input tabular', className)}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/,/g, '');
        setText(t);
        const n = Number(t);
        if (t === '' || t === '-') onChange(0);
        else if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx('input', className)}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cx('inline-flex rounded-xl border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('rounded-[10px] px-3 py-1.5 text-xs font-medium transition', o.value === value ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', !color && 'bg-surface-2 text-muted', className)}
      style={color ? { background: `${color}22`, color } : undefined}
    >
      {children}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} />;
}

export function Progress({ value, color, className }: { value: number; color?: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-line', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v * 100}%`, background: color ?? 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
    </div>
  );
}

// ─── Numbers ───────────────────────────────────────────────────────────────

export function Money({ value, short, sign, className, colored }: { value: number | null | undefined; short?: boolean; sign?: boolean; className?: string; colored?: boolean }) {
  const cls = colored && value ? (value > 0 ? 'text-pos' : 'text-neg') : undefined;
  return <span className={cx('tabular', cls, className)}>{short ? moneyShort(value) : money(value, { sign })}</span>;
}

export function Stat({
  label,
  value,
  sub,
  icon,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'pos' | 'neg' | 'accent';
  className?: string;
}) {
  return (
    <div className={cx('card animate-in p-4', className)}>
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {icon && <span className={cx('grid size-7 place-items-center rounded-lg bg-surface-2', tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-accent')}>{icon}</span>}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Delta({ value, invert }: { value: number | null | undefined; invert?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-faint">—</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={cx('tabular', value === 0 ? 'text-muted' : good ? 'text-pos' : 'text-neg')}>
      {value > 0 ? '▲' : value < 0 ? '▼' : ''} {pct(Math.abs(value))}
    </span>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('card animate-in w-full !bg-bg/95', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ─── Toasts ────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}
const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let toastId = 0;

export function toast(text: string, tone: Toast['tone'] = 'success') {
  const id = ++toastId;
  useToasts.setState((s) => ({ list: [...s.list, { id, text, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 3500);
}

export function Toaster() {
  const list = useToasts((s) => s.list);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            'card animate-in pointer-events-auto max-w-sm px-4 py-2.5 text-sm',
            t.tone === 'error' && '!border-neg/40 text-neg',
            t.tone === 'success' && '!border-pos/30',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function confirmAction(message: string) {
  return window.confirm(message);
}

// ─── Charts ────────────────────────────────────────────────────────────────

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
  dataKey?: string | number;
}

export function ChartTooltip({ active, payload, label, formatter }: { active?: boolean; payload?: TooltipPayload[]; label?: ReactNode; formatter?: (v: number, name?: string) => ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card !bg-bg/95 px-3 py-2 text-xs shadow-xl">
      {label !== undefined && label !== '' && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <Dot color={p.color ?? (p.payload?.color as string) ?? 'var(--accent)'} className="size-2" />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular">{formatter ? formatter(p.value ?? 0, p.name) : money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export const axisMoney = (v: number) => moneyShort(v).replace('₹', '');
