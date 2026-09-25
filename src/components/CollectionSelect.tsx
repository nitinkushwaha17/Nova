import { collectionIcon } from '../lib/collections';
import { useStore } from '../store';
import { Select } from './ui';

export function CollectionSelect({ value, onChange, className, emptyLabel = 'No collection' }: { value?: string | null; onChange: (id: string | null) => void; className?: string; emptyLabel?: string }) {
  const collections = useStore((s) => s.collections.collections);
  const visible = collections.filter((b) => !b.archived || b.id === value);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">{emptyLabel}</option>
      {visible.map((b) => (
        <option key={b.id} value={b.id}>
          {collectionIcon(b)} {b.name}
        </option>
      ))}
    </Select>
  );
}
