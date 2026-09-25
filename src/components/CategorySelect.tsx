import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { cx, Dot } from './ui';

export const catValue = (cat?: string | null, sub?: string | null) => (cat ? `${cat}|${sub ?? ''}` : '');
export const parseCatValue = (v: string): { category: string | null; subcategory: string | null } => {
  if (!v) return { category: null, subcategory: null };
  const [category, sub] = v.split('|');
  return { category, subcategory: sub || null };
};

interface Opt {
  value: string;
  category: string | null;
  subcategory: string | null;
  label: string;
  color?: string;
  isSub: boolean;
}

/** Searchable picker for a category or subcategory */
export function CategorySelect({
  category,
  subcategory,
  onChange,
  className,
  placeholder = 'Uncategorised',
  compact,
  autoFocus,
  onBlur,
}: {
  category?: string | null;
  subcategory?: string | null;
  onChange: (category: string | null, subcategory: string | null) => void;
  className?: string;
  placeholder?: string;
  compact?: boolean;
  /** Opens the list immediately (used for inline editing) */
  autoFocus?: boolean;
  /** Called when the list closes */
  onBlur?: () => void;
}) {
  const cats = useStore((s) => s.meta.categories);
  const [open, setOpen] = useState(!!autoFocus);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cat = cats.find((c) => c.id === category);
  const current = catValue(category, subcategory);

  const options = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (s: string) => words.every((w) => s.toLowerCase().includes(w));
    const out: Opt[] = [];
    if (!words.length) out.push({ value: '', category: null, subcategory: null, label: placeholder, isSub: false });
    for (const c of cats) {
      const subs = c.subcategories.filter((s) => hit(`${c.name} ${s}`));
      if (!hit(c.name) && !subs.length) continue;
      out.push({ value: catValue(c.id, null), category: c.id, subcategory: null, label: c.name, color: c.color, isSub: false });
      for (const s of subs) out.push({ value: catValue(c.id, s), category: c.id, subcategory: s, label: s, color: c.color, isSub: true });
    }
    return out;
  }, [cats, q, placeholder]);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 260);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    const maxHeight = Math.min(360, Math.max(below, r.top) - 12);
    setPos(below >= 240 || below >= r.top ? { top: r.bottom + 4, left, width, maxHeight } : { bottom: window.innerHeight - r.top + 4, left, width, maxHeight });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    const reflow = (e: Event) => !pop.current?.contains(e.target as Node) && place();
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openList = () => {
    setQ('');
    const i = options.findIndex((o) => o.value === current);
    setActive(Math.max(0, i));
    setOpen(true);
  };
  function close() {
    setOpen(false);
    onBlur?.();
  }
  const pick = (o: Opt) => {
    setOpen(false);
    onChange(o.category, o.subcategory);
    trigger.current?.focus();
    onBlur?.();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        autoFocus={autoFocus}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openList();
          } else if (!open && e.key.length === 1 && /\S/.test(e.key)) {
            openList();
            setQ(e.key);
            e.preventDefault();
          }
        }}
        className={cx('input flex w-full items-center gap-2 text-left', compact && '!h-7 !py-0 !pl-2 !text-xs', className)}
      >
        {cat ? <Dot color={cat.color} /> : null}
        <span className={cx('min-w-0 flex-1 truncate', !cat && 'text-faint')}>
          {cat ? (
            <>
              {cat.name}
              {subcategory && <span className="text-muted"> › {subcategory}</span>}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" />
      </button>
      {open &&
        createPortal(
          <div ref={pop} style={pos} className="card animate-in fixed z-[60] flex flex-col overflow-hidden !bg-bg/95 p-0 shadow-2xl backdrop-blur-xl">
            <div className="relative border-b border-line">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input
                autoFocus
                value={q}
                placeholder="Search categories…"
                className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-faint"
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((i) => Math.min(options.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (options[active]) pick(options[active]);
                  } else if (e.key === 'Escape') {
                    // Keep the surrounding modal open
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                    close();
                    trigger.current?.focus();
                  } else if (e.key === 'Tab') close();
                }}
              />
            </div>
            <div ref={list} className="flex-1 overflow-y-auto p-1">
              {!options.length && <p className="px-3 py-6 text-center text-sm text-muted">No category matches "{q}"</p>}
              {options.map((o, i) => (
                <button
                  key={o.value || '__none'}
                  type="button"
                  data-i={i}
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={() => pick(o)}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm',
                    o.isSub ? 'pl-7 text-muted' : 'font-medium',
                    i === active && 'bg-surface-2 text-fg',
                  )}
                >
                  {o.isSub ? <span className="size-1.5 rounded-full opacity-70" style={{ background: o.color }} /> : o.color ? <Dot color={o.color} /> : <span className="size-2" />}
                  <span className={cx('flex-1 truncate', !o.value && 'text-faint')}>{o.label}</span>
                  {o.value === current && <Check className="size-3.5 text-accent" />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
