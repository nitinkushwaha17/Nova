import { bucketIcon } from '../lib/buckets';
import { useStore } from '../store';
import { Select } from './ui';

export function BucketSelect({ value, onChange, className, emptyLabel = 'No bucket' }: { value?: string | null; onChange: (id: string | null) => void; className?: string; emptyLabel?: string }) {
  const buckets = useStore((s) => s.buckets.buckets);
  const visible = buckets.filter((b) => !b.archived || b.id === value);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">{emptyLabel}</option>
      {visible.map((b) => (
        <option key={b.id} value={b.id}>
          {bucketIcon(b)} {b.name}
        </option>
      ))}
    </Select>
  );
}
