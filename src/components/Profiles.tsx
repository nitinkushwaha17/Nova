import { Check, ChevronsUpDown, Pencil, Plus, Settings2, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PALETTE } from '../lib/defaults';
import { flushWrites } from '../storage/db';
import { createProfile, DEFAULT_PROFILE_ID, deleteProfileLocal, switchProfile, updateProfile, useProfiles, type Profile } from '../storage/profiles';
import { Badge, Button, Card, cx, Field, IconButton, Input, Modal, toast } from './ui';

/** Waits for pending local writes so nothing is lost when the page reloads into the other profile */
export async function goToProfile(id: string) {
  await flushWrites();
  switchProfile(id);
}

export function useProfileList() {
  const all = useProfiles((s) => s.all);
  const activeId = useProfiles((s) => s.activeId);
  const list = all.filter((p) => !p.deleted);
  return { list, activeId, active: list.find((p) => p.id === activeId) ?? list[0] };
}

export function Avatar({ p, className }: { p: Pick<Profile, 'name' | 'color'>; className?: string }) {
  return (
    <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold text-white', className)} style={{ background: p.color }}>
      {(p.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function ProfileModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Profile }) {
  const count = useProfiles((s) => s.all.length);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [switchTo, setSwitchTo] = useState(true);
  const [prev, setPrev] = useState({ open, initial });
  if (prev.open !== open || prev.initial !== initial) {
    setPrev({ open, initial });
    if (open) {
      setName(initial?.name ?? '');
      setColor(initial?.color ?? PALETTE[(count * 3) % PALETTE.length]);
    }
  }
  const save = () => {
    if (!name.trim()) return;
    if (initial) {
      updateProfile(initial.id, { name: name.trim(), color });
      toast('Profile updated');
      onClose();
      return;
    }
    const p = createProfile(name, color);
    toast(`Created ${p.name}`);
    onClose();
    if (switchTo) void goToProfile(p.id);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit profile' : 'New profile'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            {initial ? 'Save' : switchTo ? 'Create & switch' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!initial && <p className="text-sm text-muted">Each profile has completely separate accounts, transactions, investments, taxes and settings. Useful for tracking a spouse's, parent's or business's finances. All profiles sync to the same Google Drive.</p>}
        <Field label="Name">
          <div className="flex items-center gap-2">
            <Avatar p={{ name: name || '?', color }} className="size-9 text-sm" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya, Mom, Business" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
          </div>
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={cx('size-7 rounded-full ring-offset-2 ring-offset-surface transition', color === c && 'ring-2 ring-fg')} style={{ background: c }} title={c} />
            ))}
          </div>
        </Field>
        {!initial && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} className="accent-violet-500" /> Switch to it now
          </label>
        )}
      </div>
    </Modal>
  );
}

/** Sidebar dropdown for switching between profiles */
export function ProfileSwitcher() {
  const { list, activeId, active } = useProfileList();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-2.5 py-2 text-left transition hover:border-accent/40" title="Switch profile">
        <Avatar p={active} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{active.name}</div>
          <div className="text-[10px] text-faint">{list.length > 1 ? `${list.length} profiles` : 'Profile'}</div>
        </div>
        <ChevronsUpDown className="size-4 text-faint" />
      </button>
      {open && (
        <div className="card animate-in absolute inset-x-3 top-full z-50 mt-1 overflow-hidden p-1 shadow-xl">
          {list.map((p) => (
            <button
              key={p.id}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
              onClick={() => {
                setOpen(false);
                if (p.id !== activeId) void goToProfile(p.id);
              }}
            >
              <Avatar p={p} className="size-6 text-[11px]" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === activeId && <Check className="size-4 text-accent" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-fg"
            onClick={() => {
              setOpen(false);
              setModal(true);
            }}
          >
            <Plus className="size-4" /> New profile
          </button>
          <Link to="/settings#profiles" onClick={() => setOpen(false)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg">
            <Settings2 className="size-4" /> Manage profiles
          </Link>
        </div>
      )}
      <ProfileModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}

/** Settings card for adding, renaming, switching and deleting profiles */
export function ProfilesCard() {
  const { list, activeId } = useProfileList();
  const [modal, setModal] = useState<{ open: boolean; p?: Profile }>({ open: false });
  return (
    <Card
      title={
        <span id="profiles" className="flex items-center gap-2">
          <UserRound className="size-4 text-accent" /> Profiles
        </span>
      }
      action={
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setModal({ open: true })}>
          New
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">Separate datasets for different people or entities. Each profile has its own local database and its own files in your Drive app folder.</p>
      <ul className="divide-y divide-line">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <Avatar p={p} />
            <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
            {p.id === activeId ? (
              <Badge color="#34d399">Active</Badge>
            ) : (
              <Button size="sm" onClick={() => void goToProfile(p.id)}>
                Switch
              </Button>
            )}
            <IconButton title="Edit profile" onClick={() => setModal({ open: true, p })}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              title={p.id === DEFAULT_PROFILE_ID ? 'The primary profile cannot be deleted' : p.id === activeId ? 'Switch to another profile first' : 'Delete profile'}
              disabled={p.id === DEFAULT_PROFILE_ID || p.id === activeId}
              className="disabled:opacity-30"
              onClick={async () => {
                if (!window.confirm(`Delete "${p.name}" and ALL of its data on this device and in Google Drive? This cannot be undone.`)) return;
                if (window.prompt(`Type ${p.name} to confirm`) !== p.name) return;
                await deleteProfileLocal(p.id);
                toast(`Deleted ${p.name}`);
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <ProfileModal open={modal.open} initial={modal.p} onClose={() => setModal({ open: false })} />
    </Card>
  );
}
