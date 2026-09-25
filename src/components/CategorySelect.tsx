import { useStore } from '../store';
import { Select, cx } from './ui';

export const catValue = (cat?: string | null, sub?: string | null) => (cat ? `${cat}|${sub ?? ''}` : '');
export const parseCatValue = (v: string): { category: string | null; subcategory: string | null } => {
  if (!v) return { category: null, subcategory: null };
  const [category, sub] = v.split('|');
  return { category, subcategory: sub || null };
};

/** One select with every category and its subcategories */
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
  autoFocus?: boolean;
  onBlur?: () => void;
}) {
  const cats = useStore((s) => s.meta.categories);
  const cat = cats.find((c) => c.id === category);
  return (
    <Select
      autoFocus={autoFocus}
      onBlur={onBlur}
      value={catValue(category, subcategory)}
      onChange={(e) => {
        const v = parseCatValue(e.target.value);
        onChange(v.category, v.subcategory);
      }}
      className={cx(compact && '!h-7 !py-0 !pl-2 !text-xs', !category && 'text-faint', className)}
      style={cat ? { color: cat.color } : undefined}
    >
      <option value="">{placeholder}</option>
      {cats.map((c) => (
        <optgroup key={c.id} label={c.name}>
          <option value={catValue(c.id, null)}>{c.name}</option>
          {c.subcategories.map((s) => (
            <option key={s} value={catValue(c.id, s)}>
              {c.name} › {s}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
