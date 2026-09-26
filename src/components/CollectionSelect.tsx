import { collectionIcon, flattenTree } from '../lib/collections';
import { useStore } from '../store';
import { Select } from './ui';

/** Collection picker showing nesting with indentation. `exclude` hides ids (e.g. a collection and its descendants when choosing a parent). */
export function CollectionSelect({
  value,
  onChange,
  className,
  emptyLabel = 'No collection',
  exclude,
}: {
  value?: string | null;
  onChange: (id: string | null) => void;
  className?: string;
  emptyLabel?: string;
  exclude?: Set<string>;
}) {
  const collections = useStore((s) => s.collections.collections);
  const rows = flattenTree(collections).filter(({ c }) => (!c.archived || c.id === value) && !exclude?.has(c.id));
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">{emptyLabel}</option>
      {rows.map(({ c, depth }) => (
        <option key={c.id} value={c.id}>
          {'\u00a0\u00a0\u00a0'.repeat(depth)}
          {depth ? '└ ' : ''}
          {collectionIcon(c)} {c.name}
        </option>
      ))}
    </Select>
  );
}
